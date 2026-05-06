import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { MockHtmlSpiderAdapter } from '../adapters/spider/mock-html-spider-adapter';
import { Syosetu18SpiderAdapter } from '../adapters/spider/syosetu-18-spider-adapter';
import { SyosetuSpiderAdapter } from '../adapters/spider/syosetu-spider-adapter';
import { SpiderLogDispatcher, type SpiderLogAdapter, type SpiderLogEvent } from './logging';
import { SqliteNovelRepository } from './novel-repository';
import { SpiderRunner } from './spider-runner';
import {
  type ChapterIndexEntry,
  toError,
  type CrawlNovelOptions,
  type NovelMetadata,
  type ResolvedChapterState,
  type SpiderAdapter,
  type SpiderRunFailure,
  type StoredNovelSnapshot,
} from './spider';

export interface SpiderSourceDescriptor {
  sourceId: string;
  label: string;
  description: string;
  defaultNovelId: string;
}

export interface SpiderRegistryEntry {
  descriptor: SpiderSourceDescriptor;
  spider: SpiderAdapter;
}

export interface PreviewNovelInput {
  sourceId: string;
  novelId: string;
}

export interface TaskExecutionInput extends PreviewNovelInput {
  chapterIds?: string[];
  forceRefetch?: boolean;
  chapterConcurrency?: number;
  chapterRetryCount?: number;
}

export type CrawlTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CrawlTaskProgress {
  catalogChapters: number;
  queuedChapters: number;
  completedChapters: number;
  failedChapters: number;
  percent: number;
}

export interface CrawlTaskSnapshot {
  id: string;
  sourceId: string;
  novelId: string;
  status: CrawlTaskStatus;
  runId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  options: Required<TaskExecutionOptionsSnapshot>;
  progress: CrawlTaskProgress;
  metadata: NovelMetadata | null;
  chapters: ResolvedChapterState[];
  failures: SpiderRunFailure[];
  snapshotSummary: SnapshotSummary | null;
  events: SpiderLogEvent[];
}

export interface PreviewNovelResult {
  source: SpiderSourceDescriptor;
  metadata: NovelMetadata;
  chapters: ResolvedChapterState[];
  snapshotSummary: SnapshotSummary | null;
  activeTask: CrawlTaskSnapshot | null;
}

export interface SnapshotSummary {
  downloadedChapters: number;
  failedChapters: number;
  indexedChapters: number;
  newChapters: number;
  updatedAt: string;
}

interface TaskExecutionOptionsSnapshot {
  chapterIds?: string[];
  chapterConcurrency?: number;
  chapterRetryCount?: number;
  forceRefetch?: boolean;
}

interface CrawlTaskState {
  id: string;
  sourceId: string;
  novelId: string;
  status: CrawlTaskStatus;
  runId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  options: Required<TaskExecutionOptionsSnapshot>;
  progress: CrawlTaskProgress;
  metadata: NovelMetadata | null;
  chapters: ResolvedChapterState[];
  failures: SpiderRunFailure[];
  snapshotSummary: SnapshotSummary | null;
  events: SpiderLogEvent[];
  listeners: Set<(event: ControlCenterStreamEvent) => void>;
}

export type ControlCenterStreamEvent =
  | {
      type: 'task_updated';
      task: CrawlTaskSnapshot;
    }
  | {
      type: 'task_log';
      taskId: string;
      event: SpiderLogEvent;
    };

export interface ControlCenterServiceOptions {
  databasePath?: string;
  repository?: SqliteNovelRepository;
  spiders?: SpiderRegistryEntry[];
}

const MAX_STORED_EVENTS = 200;

export class ControlCenterService {
  readonly #repository: SqliteNovelRepository;
  readonly #ownsRepository: boolean;
  readonly #registry: Map<string, SpiderRegistryEntry>;
  readonly #tasks = new Map<string, CrawlTaskState>();

  constructor(options: ControlCenterServiceOptions = {}) {
    const databasePath = options.databasePath ?? defaultDatabasePath();
    this.#ownsRepository = options.repository === undefined;
    this.#repository = options.repository ?? new SqliteNovelRepository(databasePath);
    this.#registry = new Map(
      (options.spiders ?? createDefaultSpiderRegistry()).map((entry) => [entry.descriptor.sourceId, entry]),
    );
  }

  close(): void {
    for (const task of this.#tasks.values()) {
      task.listeners.clear();
    }

    if (this.#ownsRepository) {
      this.#repository.close();
    }
  }

  listSources(): SpiderSourceDescriptor[] {
    return [...this.#registry.values()].map((entry) => entry.descriptor);
  }

  async previewNovel(input: PreviewNovelInput): Promise<PreviewNovelResult> {
    const source = this.getSource(input.sourceId);
    const previousSnapshot = this.#repository.getSnapshot(source.descriptor.sourceId, input.novelId);
    const metadata = await source.spider.fetchMetadata({ novelId: input.novelId });
    const chapterIndex = await source.spider.fetchChapterIndex({ novelId: input.novelId }, metadata);
    const chapters = resolveChapterStates(chapterIndex, previousSnapshot);

    return {
      source: source.descriptor,
      metadata,
      chapters,
      snapshotSummary: summarizeSnapshot(previousSnapshot, chapters),
      activeTask: this.findActiveTask(input.sourceId, input.novelId),
    };
  }

  createTask(input: TaskExecutionInput): CrawlTaskSnapshot {
    const source = this.getSource(input.sourceId);
    const task = createTaskState(source.descriptor.sourceId, input);
    this.#tasks.set(task.id, task);
    this.emitTaskUpdate(task);

    queueMicrotask(() => {
      void this.runTask(task);
    });

    return serializeTask(task);
  }

  listTasks(limit = 20): CrawlTaskSnapshot[] {
    return [...this.#tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((task) => serializeTask(task));
  }

  getTask(taskId: string): CrawlTaskSnapshot | null {
    const task = this.#tasks.get(taskId);
    return task ? serializeTask(task) : null;
  }

  subscribeToTask(
    taskId: string,
    listener: (event: ControlCenterStreamEvent) => void,
  ): (() => void) | null {
    const task = this.#tasks.get(taskId);

    if (!task) {
      return null;
    }

    task.listeners.add(listener);
    listener({
      type: 'task_updated',
      task: serializeTask(task),
    });

    return () => {
      task.listeners.delete(listener);
    };
  }

  private findActiveTask(sourceId: string, novelId: string): CrawlTaskSnapshot | null {
    const task = [...this.#tasks.values()]
      .filter((candidate) => candidate.sourceId === sourceId && candidate.novelId === novelId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .find((candidate) => candidate.status === 'queued' || candidate.status === 'running');

    return task ? serializeTask(task) : null;
  }

  private async runTask(task: CrawlTaskState): Promise<void> {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    this.emitTaskUpdate(task);

    const source = this.getSource(task.sourceId);
    const logAdapter: SpiderLogAdapter = {
      log: async (event) => {
        this.handleTaskLog(task, event);
      },
    };

    const runner = new SpiderRunner({
      spider: source.spider,
      repository: this.#repository,
      logger: new SpiderLogDispatcher([logAdapter]),
    });

    const options: CrawlNovelOptions = {
      novelId: task.novelId,
      forceRefetch: task.options.forceRefetch,
      chapterConcurrency: task.options.chapterConcurrency,
      chapterRetryCount: task.options.chapterRetryCount,
      ...(task.options.chapterIds.length > 0 ? { chapterIds: task.options.chapterIds } : {}),
    };

    try {
      const result = await runner.crawlNovel(options);
      const currentSnapshot = this.#repository.getSnapshot(task.sourceId, task.novelId);

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.metadata = result.metadata;
      task.chapters = result.chapters;
      task.failures = result.failures;
      task.snapshotSummary = summarizeSnapshot(currentSnapshot, result.chapters);
      task.progress.catalogChapters = result.chapters.length;
      task.progress.percent = 100;
      this.emitTaskUpdate(task);
    } catch (error) {
      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      task.errorMessage = toError(error).message;
      this.emitTaskUpdate(task);
    }
  }

  private handleTaskLog(task: CrawlTaskState, event: SpiderLogEvent): void {
    task.runId = event.context.runId;
    task.events.push(event);

    if (task.events.length > MAX_STORED_EVENTS) {
      task.events.splice(0, task.events.length - MAX_STORED_EVENTS);
    }

    if (event.type === 'catalog_fetched') {
      const totalChapters = readNumericPayload(event.payload, 'totalChapters');
      if (totalChapters !== null) {
        task.progress.catalogChapters = totalChapters;
      }
    }

    if (event.type === 'chapter_started') {
      task.progress.queuedChapters += 1;
    }

    if (event.type === 'chapter_persisted') {
      task.progress.completedChapters += 1;
    }

    if (event.type === 'chapter_failed') {
      task.progress.failedChapters += 1;
    }

    task.progress.percent = calculateProgress(task.progress);

    for (const listener of task.listeners) {
      listener({
        type: 'task_log',
        taskId: task.id,
        event,
      });
    }

    this.emitTaskUpdate(task);
  }

  private emitTaskUpdate(task: CrawlTaskState): void {
    const snapshot = serializeTask(task);

    for (const listener of task.listeners) {
      listener({
        type: 'task_updated',
        task: snapshot,
      });
    }
  }

  private getSource(sourceId: string): SpiderRegistryEntry {
    const source = this.#registry.get(sourceId);

    if (!source) {
      throw new Error(`Unsupported spider source: ${sourceId}`);
    }

    return source;
  }
}

export function createDefaultSpiderRegistry(): SpiderRegistryEntry[] {
  return [
    {
      descriptor: {
        sourceId: 'mock-html',
        label: 'Mock HTML Demo',
        description: '本地演示源，可稳定验证目录 Diff、失败重试与日志桥接。',
        defaultNovelId: 'demo',
      },
      spider: new MockHtmlSpiderAdapter(createDemoFixture()),
    },
    {
      descriptor: {
        sourceId: 'syosetu',
        label: 'Syosetu',
        description: '小説家になろう 正式站点。',
        defaultNovelId: 'n9669bk',
      },
      spider: new SyosetuSpiderAdapter(),
    },
    {
      descriptor: {
        sourceId: 'syosetu18',
        label: 'Syosetu18',
        description: 'ノクターンノベルズ 成人站点。',
        defaultNovelId: 'n1557gm',
      },
      spider: new Syosetu18SpiderAdapter(),
    },
  ];
}

function createTaskState(sourceId: string, input: TaskExecutionInput): CrawlTaskState {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sourceId,
    novelId: input.novelId,
    status: 'queued',
    runId: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    options: {
      chapterIds: dedupeChapterIds(input.chapterIds),
      chapterConcurrency: input.chapterConcurrency ?? 4,
      chapterRetryCount: input.chapterRetryCount ?? 1,
      forceRefetch: input.forceRefetch ?? false,
    },
    progress: {
      catalogChapters: 0,
      queuedChapters: 0,
      completedChapters: 0,
      failedChapters: 0,
      percent: 0,
    },
    metadata: null,
    chapters: [],
    failures: [],
    snapshotSummary: null,
    events: [],
    listeners: new Set(),
  };
}

function resolveChapterStates(
  chapterIndex: ChapterIndexEntry[],
  previousSnapshot: StoredNovelSnapshot | null,
): ResolvedChapterState[] {
  const snapshotMap = new Map(previousSnapshot?.chapters.map((chapter) => [chapter.id, chapter]));

  return mapChapterIndex(chapterIndex).map((chapter) => {
    const storedChapter = snapshotMap.get(chapter.id);

    return {
      ...chapter,
      wasDownloaded: storedChapter?.status === 'downloaded',
      isNew: storedChapter === undefined,
      status: storedChapter?.status ?? 'indexed',
    } satisfies ResolvedChapterState;
  });
}

function mapChapterIndex(chapterIndex: ChapterIndexEntry[]): ChapterIndexEntry[] {
  return chapterIndex;
}

function summarizeSnapshot(
  snapshot: StoredNovelSnapshot | null,
  chapters: ResolvedChapterState[],
): SnapshotSummary | null {
  if (!snapshot) {
    return chapters.length > 0
      ? {
          downloadedChapters: 0,
          failedChapters: 0,
          indexedChapters: chapters.length,
          newChapters: chapters.filter((chapter) => chapter.isNew).length,
          updatedAt: '',
        }
      : null;
  }

  return {
    downloadedChapters: snapshot.chapters.filter((chapter) => chapter.status === 'downloaded').length,
    failedChapters: snapshot.chapters.filter((chapter) => chapter.status === 'failed').length,
    indexedChapters: snapshot.chapters.filter((chapter) => chapter.status === 'indexed').length,
    newChapters: chapters.filter((chapter) => chapter.isNew).length,
    updatedAt: snapshot.updatedAt,
  };
}

function calculateProgress(progress: CrawlTaskProgress): number {
  if (progress.queuedChapters === 0) {
    return progress.catalogChapters === 0 ? 0 : 5;
  }

  const settledChapters = progress.completedChapters + progress.failedChapters;
  return Math.min(100, Math.round((settledChapters / progress.queuedChapters) * 100));
}

function readNumericPayload(
  payload: SpiderLogEvent['payload'],
  key: string,
): number | null {
  if (!payload) {
    return null;
  }

  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

function dedupeChapterIds(chapterIds: string[] | undefined): string[] {
  return chapterIds ? [...new Set(chapterIds.filter((chapterId) => chapterId.trim().length > 0))] : [];
}

function serializeTask(task: CrawlTaskState): CrawlTaskSnapshot {
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
    options: {
      chapterIds: [...task.options.chapterIds],
      chapterConcurrency: task.options.chapterConcurrency,
      chapterRetryCount: task.options.chapterRetryCount,
      forceRefetch: task.options.forceRefetch,
    },
    progress: {
      ...task.progress,
    },
    metadata: task.metadata,
    chapters: [...task.chapters],
    failures: [...task.failures],
    snapshotSummary: task.snapshotSummary,
    events: [...task.events],
  };
}

function defaultDatabasePath(): string {
  const databaseDir = path.resolve(process.cwd(), '.data');
  fs.mkdirSync(databaseDir, { recursive: true });
  return path.join(databaseDir, 'novels.db');
}

function createDemoFixture() {
  const chapterHtmlById: Record<string, string> = {};
  const catalogEntries: string[] = [];

  for (let index = 1; index <= 6; index += 1) {
    const chapterId = `chapter-${index}`;
    const volumeTitle = `卷 ${Math.ceil(index / 2)}`;

    catalogEntries.push(
      `<li data-chapter-id="${chapterId}" data-volume="${volumeTitle}"><a href="/novels/demo/${index}">第 ${index} 章</a></li>`,
    );

    chapterHtmlById[chapterId] = `
      <article>
        <h1 data-testid="chapter-title">第 ${index} 章</h1>
        <div data-testid="volume-title">${volumeTitle}</div>
        <section data-testid="content">
          <p>这是第 ${index} 章的第一段。</p>
          <p>这是第 ${index} 章的第二段。</p>
        </section>
      </article>
    `;
  }

  return {
    metadataHtml: `
      <article>
        <h1 data-testid="title">演示小说：风与铁的巡夜人</h1>
        <div data-testid="author">控制台演示源</div>
        <div data-testid="description">用于联调前端控制中心的本地 Mock 小说，包含卷分组、增量对比与可重试章节。</div>
        <ul data-testid="tags"><li>演示</li><li>冒险</li><li>任务调度</li></ul>
        <div data-testid="chapter-count">6</div>
      </article>
    `,
    catalogHtml: `<ol data-testid="catalog">${catalogEntries.join('')}</ol>`,
    chapterHtmlById,
    transientFailuresByChapterId: {
      'chapter-4': 1,
    },
  };
}