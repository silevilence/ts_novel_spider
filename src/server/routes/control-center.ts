import { Router } from 'express';

import {
  ControlCenterService,
  type CrawlTaskSnapshot,
  type PreviewNovelResult,
  type SpiderSourceDescriptor,
  type SnapshotSummary,
} from '../core/control-center';
import type { SpiderLogEvent } from '../core/logging';
import type {
  NetworkProxyConfig,
  NetworkProxyConfigInput,
  NetworkProxyValidationResult,
} from '../core/network-proxy';
import type { NovelMetadata, ResolvedChapterState, SpiderRunFailure } from '../core/spider';

export interface ApiLogEvent {
  type: SpiderLogEvent['type'];
  level: SpiderLogEvent['level'];
  message: string;
  context: SpiderLogEvent['context'];
  payload?: SpiderLogEvent['payload'];
  errorMessage: string | null;
  timestamp: string;
}

export interface ApiTaskSnapshot {
  id: string;
  sourceId: string;
  novelId: string;
  status: CrawlTaskSnapshot['status'];
  runId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  options: CrawlTaskSnapshot['options'];
  progress: CrawlTaskSnapshot['progress'];
  metadata: NovelMetadata | null;
  chapters: ResolvedChapterState[];
  failures: SpiderRunFailure[];
  snapshotSummary: SnapshotSummary | null;
  events: ApiLogEvent[];
}

export interface ControlSourcesPayload {
  sources: SpiderSourceDescriptor[];
}

export interface ControlPreviewPayload {
  source: SpiderSourceDescriptor;
  metadata: NovelMetadata;
  chapters: ResolvedChapterState[];
  snapshotSummary: SnapshotSummary | null;
  activeTask: ApiTaskSnapshot | null;
}

export interface ControlTasksPayload {
  tasks: ApiTaskSnapshot[];
}

export interface ControlTaskPayload {
  task: ApiTaskSnapshot;
}

export interface ControlNetworkProxyPayload {
  config: NetworkProxyConfig;
  validation: NetworkProxyValidationResult | null;
}

export interface ControlCenterRouterOptions {
  service: ControlCenterService;
}

interface CreateTaskRequestBody {
  sourceId?: unknown;
  novelId?: unknown;
  chapterIds?: unknown;
  forceRefetch?: unknown;
  chapterConcurrency?: unknown;
  chapterRetryCount?: unknown;
}

interface UpdateNetworkProxyRequestBody {
  enabled?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
  bypassHosts?: unknown;
}

interface ValidateNetworkProxyRequestBody {
  targetUrl?: unknown;
}

export function createControlCenterRouter({ service }: ControlCenterRouterOptions): Router {
  const router = Router();

  router.get('/sources', (_request, response) => {
    const payload: ControlSourcesPayload = {
      sources: service.listSources(),
    };

    response.json(payload);
  });

  router.get('/network-proxy', (_request, response) => {
    response.json(serializeNetworkProxyState(service.getNetworkProxyState()));
  });

  router.put('/network-proxy', (request, response) => {
    try {
      const body = request.body as UpdateNetworkProxyRequestBody;
      const payload = serializeNetworkProxyState(
        service.updateNetworkProxy(parseNetworkProxyBody(body)),
      );

      response.json(payload);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid network proxy request.',
      });
    }
  });

  router.post('/network-proxy/validate', async (request, response) => {
    try {
      const body = (request.body ?? {}) as ValidateNetworkProxyRequestBody;
      const payload = serializeNetworkProxyState(
        await service.validateNetworkProxy(optionalUrlString(body.targetUrl)),
      );

      response.json(payload);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid proxy validation request.',
      });
    }
  });

  router.get('/preview', async (request, response) => {
    try {
      const sourceId = requiredQueryString(request.query.sourceId, 'sourceId');
      const novelId = requiredQueryString(request.query.novelId, 'novelId');
      const preview = await service.previewNovel({ sourceId, novelId });

      response.json(serializePreview(preview));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid preview request.',
      });
    }
  });

  router.get('/tasks', (request, response) => {
    const limit = optionalPositiveInteger(request.query.limit, 20);
    const payload: ControlTasksPayload = {
      tasks: service.listTasks(limit).map(serializeTaskSnapshot),
    };

    response.json(payload);
  });

  router.post('/tasks', (request, response) => {
    try {
      const body = request.body as CreateTaskRequestBody;
      const task = service.createTask({
        sourceId: requiredBodyString(body.sourceId, 'sourceId'),
        novelId: requiredBodyString(body.novelId, 'novelId'),
        ...(Array.isArray(body.chapterIds) ? { chapterIds: parseChapterIds(body.chapterIds) } : {}),
        ...(typeof body.forceRefetch === 'boolean' ? { forceRefetch: body.forceRefetch } : {}),
        ...(body.chapterConcurrency !== undefined
          ? { chapterConcurrency: positiveInteger(body.chapterConcurrency, 'chapterConcurrency') }
          : {}),
        ...(body.chapterRetryCount !== undefined
          ? { chapterRetryCount: nonNegativeInteger(body.chapterRetryCount, 'chapterRetryCount') }
          : {}),
      });

      const payload: ControlTaskPayload = {
        task: serializeTaskSnapshot(task),
      };

      response.status(202).json(payload);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid task request.',
      });
    }
  });

  router.get('/tasks/:taskId', (request, response) => {
    const task = service.getTask(request.params.taskId);

    if (!task) {
      response.status(404).json({
        message: `Task ${request.params.taskId} was not found.`,
      });
      return;
    }

    const payload: ControlTaskPayload = {
      task: serializeTaskSnapshot(task),
    };

    response.json(payload);
  });

  router.get('/tasks/:taskId/events', (request, response) => {
    const task = service.getTask(request.params.taskId);

    if (!task) {
      response.status(404).json({
        message: `Task ${request.params.taskId} was not found.`,
      });
      return;
    }

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const unsubscribe = service.subscribeToTask(request.params.taskId, (event) => {
      const payload =
        event.type === 'task_updated'
          ? {
              type: event.type,
              task: serializeTaskSnapshot(event.task),
            }
          : {
              type: event.type,
              taskId: event.taskId,
              event: serializeLogEvent(event.event),
            };

      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    if (!unsubscribe) {
      response.end();
      return;
    }

    const keepAlive = setInterval(() => {
      response.write(': keepalive\n\n');
    }, 15000);

    request.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      response.end();
    });
  });

  return router;
}

function serializePreview(preview: PreviewNovelResult): ControlPreviewPayload {
  return {
    source: preview.source,
    metadata: preview.metadata,
    chapters: preview.chapters,
    snapshotSummary: preview.snapshotSummary,
    activeTask: preview.activeTask ? serializeTaskSnapshot(preview.activeTask) : null,
  };
}

export function serializeTaskSnapshot(task: CrawlTaskSnapshot): ApiTaskSnapshot {
  return {
    id: task.id,
    sourceId: task.sourceId,
    novelId: task.novelId,
    status: task.status,
    runId: task.runId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    errorMessage: task.errorMessage,
    options: task.options,
    progress: task.progress,
    metadata: task.metadata,
    chapters: task.chapters,
    failures: task.failures,
    snapshotSummary: task.snapshotSummary,
    events: task.events.map(serializeLogEvent),
  };
}

function serializeLogEvent(event: SpiderLogEvent): ApiLogEvent {
  return {
    type: event.type,
    level: event.level,
    message: event.message,
    context: event.context,
    ...(event.payload ? { payload: event.payload } : {}),
    errorMessage: event.error?.message ?? null,
    timestamp: event.timestamp,
  };
}

function serializeNetworkProxyState(state: {
  config: NetworkProxyConfig;
  validation: NetworkProxyValidationResult | null;
}): ControlNetworkProxyPayload {
  return {
    config: state.config,
    validation: state.validation,
  };
}

function requiredQueryString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Query parameter ${key} is required.`);
  }

  return value.trim();
}

function requiredBodyString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Request field ${key} is required.`);
  }

  return value.trim();
}

function parseChapterIds(chapterIds: unknown[]): string[] {
  return chapterIds.map((value, index) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`chapterIds[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function parseNetworkProxyBody(body: UpdateNetworkProxyRequestBody): NetworkProxyConfigInput {
  const enabled = requiredBoolean(body.enabled, 'enabled');
  const protocol = optionalProtocol(body.protocol);
  const host = optionalBodyString(body.host);
  const port = optionalPort(body.port);
  const username = optionalBodyString(body.username);
  const password = optionalBodyString(body.password);
  const bypassHosts = parseStringArray(body.bypassHosts, 'bypassHosts');

  if (enabled && (!host || port === null)) {
    throw new Error('Enabled proxy requires both host and port.');
  }

  return {
    enabled,
    ...(protocol ? { protocol } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(bypassHosts !== undefined ? { bypassHosts } : {}),
  };
}

function positiveInteger(value: unknown, key: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Request field ${key} must be a positive integer.`);
  }

  return parsed;
}

function nonNegativeInteger(value: unknown, key: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Request field ${key} must be a non-negative integer.`);
  }

  return parsed;
}

function optionalPort(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return positiveInteger(value, 'port');
}

function optionalPositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  return positiveInteger(value, 'limit');
}

function requiredBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Request field ${key} must be a boolean.`);
  }

  return value;
}

function optionalProtocol(value: unknown): 'http' | 'https' | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === 'http' || value === 'https') {
    return value;
  }

  throw new Error('Request field protocol must be either http or https.');
}

function optionalBodyString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error('Expected a string field.');
  }

  return value.trim();
}

function parseStringArray(value: unknown, key: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Request field ${key} must be an array of strings.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`Request field ${key}[${index}] must be a string.`);
    }

    return entry.trim();
  });
}

function optionalUrlString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error('Request field targetUrl must be a string.');
  }

  return value.trim();
}