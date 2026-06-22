import { SpiderLogDispatcher, type SpiderLogContext } from './logging';
import { SqliteNovelRepository } from './novel-repository';
import {
  isChapterFetchFailure,
  toError,
  type ChapterIndexEntry,
  type CrawlNovelOptions,
  type CrawlNovelResult,
  type ResolvedChapterState,
  type SpiderAdapter,
  type SpiderRunFailure,
  type StoredNovelSnapshot,
} from './spider';

export interface SpiderRunnerDependencies {
  spider: SpiderAdapter;
  repository: SqliteNovelRepository;
  logger?: SpiderLogDispatcher;
}

export class SpiderRunner {
  readonly #spider: SpiderAdapter;
  readonly #repository: SqliteNovelRepository;
  readonly #logger: SpiderLogDispatcher;

  constructor({ spider, repository, logger }: SpiderRunnerDependencies) {
    this.#spider = spider;
    this.#repository = repository;
    this.#logger = logger ?? new SpiderLogDispatcher();
  }

  async crawlNovel(options: CrawlNovelOptions): Promise<CrawlNovelResult> {
    const context = {
      sourceId: this.#spider.sourceId,
      novelId: options.novelId,
      runId: `${this.#spider.sourceId}:${options.novelId}:${Date.now()}`,
    } satisfies SpiderLogContext;

    await this.#logger.dispatch({
      type: 'task_started',
      level: 'info',
      message: 'Spider task started.',
      context,
      payload: {
        chapterIds: options.chapterIds ?? null,
        forceRefetch: options.forceRefetch ?? false,
      },
      timestamp: new Date().toISOString(),
    });

    const previousSnapshot = this.#repository.getSnapshot(this.#spider.sourceId, options.novelId);

    try {
      const metadata = await this.#spider.fetchMetadata({ novelId: options.novelId });
      this.#repository.saveMetadata(this.#spider.sourceId, metadata);

      await this.#logger.dispatch({
        type: 'metadata_fetched',
        level: 'info',
        message: 'Novel metadata fetched.',
        context,
        payload: {
          title: metadata.title,
          chapterCount: metadata.chapterCount,
        },
        timestamp: new Date().toISOString(),
      });

      const chapterIndex = await this.#spider.fetchChapterIndex({ novelId: options.novelId }, metadata);
      this.#repository.saveChapterIndex(this.#spider.sourceId, options.novelId, chapterIndex);

      await this.#logger.dispatch({
        type: 'catalog_fetched',
        level: 'info',
        message: 'Novel chapter catalog fetched.',
        context,
        payload: {
          totalChapters: chapterIndex.length,
        },
        timestamp: new Date().toISOString(),
      });

      const chapters = buildResolvedChapterStates(chapterIndex, previousSnapshot);
      const selectedChapters = selectChaptersForFetch(chapterIndex, chapters, options);

      for (const chapter of selectedChapters) {
        await this.#logger.dispatch({
          type: 'chapter_started',
          level: 'info',
          message: `Chapter queued: ${chapter.title}`,
          context,
          payload: {
            chapterId: chapter.id,
            title: chapter.title,
          },
          timestamp: new Date().toISOString(),
        });
      }

      const batchOptions = {
        ...(options.chapterConcurrency !== undefined
          ? { concurrency: options.chapterConcurrency }
          : {}),
        ...(options.chapterRetryCount !== undefined
          ? { retryCount: options.chapterRetryCount }
          : {}),
      };

      const failures: SpiderRunFailure[] = [];
      const handledChapterIds = new Set<string>();

      const handleFetchResult = async (result: Awaited<ReturnType<SpiderAdapter['fetchChapters']>>[number]): Promise<void> => {
        if (handledChapterIds.has(result.chapter.id)) {
          return;
        }

        handledChapterIds.add(result.chapter.id);

        if (isChapterFetchFailure(result)) {
          this.#repository.markChapterFailure(
            this.#spider.sourceId,
            options.novelId,
            result.chapter.id,
            result.error,
          );

          failures.push({
            chapterId: result.chapter.id,
            title: result.chapter.title,
            attempts: result.attempts,
            errorMessage: result.error.message,
          });

          await this.#logger.dispatch({
            type: 'chapter_failed',
            level: 'error',
            message: `Chapter failed: ${result.chapter.title}`,
            context,
            payload: {
              chapterId: result.chapter.id,
              attempts: result.attempts,
            },
            error: result.error,
            timestamp: new Date().toISOString(),
          });

          return;
        }

        this.#repository.saveChapterContent(this.#spider.sourceId, options.novelId, result.content);
        this.#repository.bumpNovelContentUpdatedAt(this.#spider.sourceId, options.novelId);

        await this.#logger.dispatch({
          type: 'chapter_fetched',
          level: 'info',
          message: `Chapter fetched: ${result.content.title}`,
          context,
          payload: {
            chapterId: result.content.chapterId,
            attempts: result.attempts,
          },
          timestamp: new Date().toISOString(),
        });

        await this.#logger.dispatch({
          type: 'chapter_persisted',
          level: 'info',
          message: `Chapter persisted: ${result.content.title}`,
          context,
          payload: {
            chapterId: result.content.chapterId,
          },
          timestamp: new Date().toISOString(),
        });
      };

      const fetchResults = await this.#spider.fetchChapters(
        { novelId: options.novelId },
        selectedChapters,
        {
          ...batchOptions,
          onResult: handleFetchResult,
        },
      );

      for (const result of fetchResults) {
        await handleFetchResult(result);
      }

      const currentSnapshot = this.#repository.getSnapshot(this.#spider.sourceId, options.novelId);
      if (!currentSnapshot) {
        throw new Error('Snapshot missing after crawl completion.');
      }

      const resolvedChapters = mergeStatuses(chapters, currentSnapshot);

      await this.#logger.dispatch({
        type: 'task_completed',
        level: failures.length > 0 ? 'warn' : 'info',
        message: 'Spider task completed.',
        context,
        payload: {
          totalChapters: chapterIndex.length,
          failures: failures.length,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        metadata,
        chapters: resolvedChapters,
        failures,
        previousSnapshot,
        currentSnapshot,
      };
    } catch (error) {
      const taskError = toError(error);

      await this.#logger.dispatch({
        type: 'task_failed',
        level: 'error',
        message: 'Spider task failed.',
        context,
        error: taskError,
        timestamp: new Date().toISOString(),
      });

      throw taskError;
    }
  }
}

function buildResolvedChapterStates(
  chapterIndex: ChapterIndexEntry[],
  previousSnapshot: StoredNovelSnapshot | null,
): ResolvedChapterState[] {
  const snapshotMap = new Map(previousSnapshot?.chapters.map((chapter) => [chapter.id, chapter]));

  return chapterIndex.map((chapter) => {
    const storedChapter = snapshotMap.get(chapter.id);

    return {
      ...chapter,
      wasDownloaded: storedChapter?.status === 'downloaded',
      isNew: storedChapter === undefined,
      status: storedChapter?.status ?? 'indexed',
    };
  });
}

function selectChaptersForFetch(
  chapterIndex: ChapterIndexEntry[],
  chapters: ResolvedChapterState[],
  options: CrawlNovelOptions,
): ChapterIndexEntry[] {
  const selectedIds = options.chapterIds ? new Set(options.chapterIds) : null;

  return chapterIndex.filter((chapter, index) => {
    if (selectedIds && !selectedIds.has(chapter.id)) {
      return false;
    }

    const state = chapters[index];
    if (!state) {
      return false;
    }

    if (options.forceRefetch) {
      return true;
    }

    return state.status !== 'downloaded';
  });
}

function mergeStatuses(
  chapters: ResolvedChapterState[],
  snapshot: StoredNovelSnapshot,
): ResolvedChapterState[] {
  const snapshotMap = new Map(snapshot.chapters.map((chapter) => [chapter.id, chapter.status]));

  return chapters.map((chapter) => ({
    ...chapter,
    status: snapshotMap.get(chapter.id) ?? chapter.status,
  }));
}