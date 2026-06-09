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
import type {
  LlmDiscoveredModel,
  LlmModelGatewayConfig,
  LlmModelValidationResult,
  LlmProviderConfig,
  LlmProviderConfigInput,
  Neo4jConfig,
  Neo4jConfigInput,
  Neo4jValidationResult,
  ReaderTypographyConfig,
  ReaderTypographyConfigInput,
  ReaderTypographyState,
  SchedulingConfig,
  SchedulingConfigInput,
  TranslationPreferencesConfig,
  TranslationPreferencesInput,
} from '../core/system-preferences';
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

export interface ControlLlmProvidersPayload {
  providers: LlmProviderConfig[];
  validations: LlmModelValidationResult[];
  updatedAt: string | null;
}

export interface ControlLlmProviderModelsPayload {
  models: LlmDiscoveredModel[];
}

export interface ControlNeo4jPayload {
  config: Neo4jConfig;
  validation: Neo4jValidationResult | null;
}

export interface ControlReaderTypographyPayload {
  config: ReaderTypographyConfig;
  updatedAt: string | null;
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

interface UpdateLlmProvidersRequestBody {
  providers?: unknown;
}

interface DiscoverLlmProviderModelsRequestBody {
  provider?: unknown;
}

interface UpdateNeo4jRequestBody {
  enabled?: unknown;
  uri?: unknown;
  username?: unknown;
  password?: unknown;
  database?: unknown;
}

interface UpdateReaderTypographyRequestBody {
  fontSize?: unknown;
  fontSizePreset?: unknown;
  lineHeight?: unknown;
  paragraphSpacing?: unknown;
  fontFamilyPreset?: unknown;
  fontFamilyCustom?: unknown;
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

  router.get('/preferences/llm-providers', (_request, response) => {
    response.json(serializeLlmPreferences(service.getLlmPreferences()));
  });

  router.put('/preferences/llm-providers', (request, response) => {
    try {
      const body = (request.body ?? {}) as UpdateLlmProvidersRequestBody;
      response.json(serializeLlmPreferences(service.updateLlmPreferences(parseLlmProviders(body.providers))));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid LLM preferences request.',
      });
    }
  });

  router.post('/preferences/llm-providers/discover-models', async (request, response) => {
    try {
      const body = (request.body ?? {}) as DiscoverLlmProviderModelsRequestBody;
      const payload: ControlLlmProviderModelsPayload = {
        models: await service.discoverLlmProviderModels(parseSingleLlmProvider(body.provider)),
      };

      response.json(payload);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid LLM model discovery request.',
      });
    }
  });

  router.post('/preferences/llm-providers/:providerId/models/:modelId/validate', async (request, response) => {
    try {
      response.json(
        serializeLlmPreferences(
          await service.validateLlmPreferenceModel(request.params.providerId, request.params.modelId),
        ),
      );
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid LLM validation request.',
      });
    }
  });

  router.get('/preferences/neo4j', (_request, response) => {
    response.json(serializeNeo4jPreferences(service.getNeo4jPreferences()));
  });

  router.put('/preferences/neo4j', (request, response) => {
    try {
      const body = (request.body ?? {}) as UpdateNeo4jRequestBody;
      response.json(serializeNeo4jPreferences(service.updateNeo4jPreferences(parseNeo4jBody(body))));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid Neo4j preferences request.',
      });
    }
  });

  router.post('/preferences/neo4j/validate', async (_request, response) => {
    try {
      response.json(serializeNeo4jPreferences(await service.validateNeo4jPreferences()));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid Neo4j validation request.',
      });
    }
  });

  router.get('/preferences/reader-typography', (_request, response) => {
    response.json(serializeReaderTypographyPreferences(service.getReaderTypography()));
  });

  router.put('/preferences/reader-typography', (request, response) => {
    try {
      const body = (request.body ?? {}) as UpdateReaderTypographyRequestBody;
      response.json(serializeReaderTypographyPreferences(service.updateReaderTypography(parseReaderTypographyBody(body))));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid reader typography preferences request.',
      });
    }
  });

  router.get('/preferences/translation', (_request, response) => {
    response.json(serializeTranslationPreferences(service.getTranslationPreferences()));
  });

  router.put('/preferences/translation', (request, response) => {
    try {
      const body = (request.body ?? {}) as TranslationPreferencesInput;
      response.json(serializeTranslationPreferences(service.updateTranslationPreferences(body)));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid translation preferences request.',
      });
    }
  });

  router.get('/preferences/model-gateway', (_request, response) => {
    response.json(service.getModelGateway());
  });

  router.put('/preferences/model-gateway', (request, response) => {
    try {
      const body = (request.body ?? {}) as LlmModelGatewayConfig;
      response.json(service.updateModelGateway(body));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid model gateway request.',
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

  // ── 定时更新 ──

  router.get('/scheduling', (_request, response) => {
  const config = service.getSchedulingState();
  const lastCheckRun = service.getLatestCompletedCheckRun();
  response.json({ ...config, lastCheckRun: lastCheckRun ?? null });
});

router.put('/scheduling', (request, response) => {
    try {
      const body = (request.body ?? {}) as SchedulingConfigInput;
      response.json(service.updateSchedulingState(body));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid scheduling request.',
      });
    }
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

function serializeLlmPreferences(state: {
  providers: LlmProviderConfig[];
  validations: LlmModelValidationResult[];
  updatedAt: string | null;
}): ControlLlmProvidersPayload {
  return {
    providers: state.providers,
    validations: state.validations,
    updatedAt: state.updatedAt,
  };
}

function serializeNeo4jPreferences(state: {
  config: Neo4jConfig;
  validation: Neo4jValidationResult | null;
}): ControlNeo4jPayload {
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

function parseLlmProviders(value: unknown): LlmProviderConfigInput[] {
  if (!Array.isArray(value)) {
    throw new Error('Request field providers must be an array.');
  }

  return value.map((entry, providerIndex) => parseLlmProvider(entry, providerIndex));
}

function parseSingleLlmProvider(value: unknown): LlmProviderConfigInput {
  return parseLlmProvider(value, 0);
}

function parseLlmProvider(value: unknown, providerIndex: number): LlmProviderConfigInput {
  if (!isRecord(value)) {
    throw new Error(`providers[${providerIndex}] must be an object.`);
  }

  const id = optionalStringField(value.id);
  const label = optionalStringField(value.label);
  const type = optionalProviderType(value.type);
  const baseUrl = optionalStringField(value.baseUrl);
  const apiKey = optionalStringField(value.apiKey);
  const organization = optionalStringField(value.organization);

  return {
    ...(id !== undefined ? { id } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(organization !== undefined ? { organization } : {}),
    ...(value.models !== undefined ? { models: parseLlmModels(value.models, providerIndex) } : {}),
  };
}

function parseLlmModels(value: unknown, providerIndex: number) {
  if (!Array.isArray(value)) {
    throw new Error(`providers[${providerIndex}].models must be an array.`);
  }

  return value.map((entry, modelIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`providers[${providerIndex}].models[${modelIndex}] must be an object.`);
    }

    const id = optionalStringField(entry.id);
    const label = optionalStringField(entry.label);
    const modelId = optionalStringField(entry.modelId);
    const capabilityMode = optionalCapabilityMode(entry.capabilityMode);

    return {
      ...(id !== undefined ? { id } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(typeof entry.enabled === 'boolean' ? { enabled: entry.enabled } : {}),
      ...(capabilityMode !== undefined ? { capabilityMode } : {}),
      ...(entry.capabilities !== undefined
        ? { capabilities: parseCapabilityArray(entry.capabilities, `providers[${providerIndex}].models[${modelIndex}].capabilities`) }
        : {}),
      ...(entry.defaultFor !== undefined
        ? { defaultFor: parseCapabilityArray(entry.defaultFor, `providers[${providerIndex}].models[${modelIndex}].defaultFor`) }
        : {}),
    };
  });
}

function parseNeo4jBody(body: UpdateNeo4jRequestBody): Neo4jConfigInput {
  const uri = optionalStringField(body.uri);
  const username = optionalStringField(body.username);
  const password = optionalStringField(body.password);
  const database = optionalStringField(body.database);

  return {
    enabled: requiredBoolean(body.enabled, 'enabled'),
    ...(uri !== undefined ? { uri } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(database !== undefined ? { database } : {}),
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

function optionalProviderType(value: unknown): 'openai-compatible' | 'anthropic' | 'google-generative-ai' | 'ollama' | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === 'openai-compatible' || value === 'anthropic' || value === 'google-generative-ai' || value === 'ollama') {
    return value;
  }

  throw new Error('Request field type must be openai-compatible, anthropic, google-generative-ai, or ollama.');
}

function optionalCapabilityMode(value: unknown): 'manual' | 'auto' | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === 'manual' || value === 'auto') {
    return value;
  }

  throw new Error('Capability mode must be manual or auto.');
}

function parseCapabilityArray(value: unknown, key: string): Array<'chat' | 'embedding' | 'rerank'> {
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }

  return value.map((entry, index) => {
    if (entry === 'chat' || entry === 'embedding' || entry === 'rerank') {
      return entry;
    }

    throw new Error(`${key}[${index}] must be chat, embedding or rerank.`);
  });
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

function optionalStringField(value: unknown): string | undefined {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function serializeReaderTypographyPreferences(state: ReaderTypographyState): ControlReaderTypographyPayload {
  return {
    config: state.config,
    updatedAt: state.updatedAt,
  };
}

function parseReaderTypographyBody(body: UpdateReaderTypographyRequestBody): ReaderTypographyConfigInput {
  const input: ReaderTypographyConfigInput = {};

  if (typeof body.fontSize === 'number') {
    input.fontSize = body.fontSize;
  }

  if (body.fontSizePreset === 'small' || body.fontSizePreset === 'medium' || body.fontSizePreset === 'large') {
    input.fontSizePreset = body.fontSizePreset;
  }

  if (typeof body.lineHeight === 'number') {
    input.lineHeight = body.lineHeight;
  }

  if (typeof body.paragraphSpacing === 'number') {
    input.paragraphSpacing = body.paragraphSpacing;
  }

  if (body.fontFamilyPreset === 'sans' || body.fontFamilyPreset === 'serif' || body.fontFamilyPreset === 'monospace' || body.fontFamilyPreset === 'custom') {
    input.fontFamilyPreset = body.fontFamilyPreset;
  }

  if (typeof body.fontFamilyCustom === 'string') {
    input.fontFamilyCustom = body.fontFamilyCustom;
  }

  return input;
}

function serializeTranslationPreferences(state: { config: TranslationPreferencesConfig; updatedAt: string | null }): { config: TranslationPreferencesConfig; updatedAt: string | null } {
  return {
    config: state.config,
    updatedAt: state.updatedAt,
  };
}