import { load, type CheerioAPI } from 'cheerio';

export type ChapterPersistStatus = 'indexed' | 'downloaded' | 'failed';

export interface NovelMetadata {
  novelId: string;
  title: string;
  author: string;
  description: string;
  tags: string[];
  chapterCount: number;
  infoPageUrl: string;
}

export interface ChapterIndexEntry {
  id: string;
  index: number;
  title: string;
  volumeTitle?: string;
  url: string;
}

export interface ChapterContent {
  chapterId: string;
  index: number;
  title: string;
  volumeTitle?: string;
  url: string;
  content: string;
}

export interface ChapterFetchSuccess {
  chapter: ChapterIndexEntry;
  content: ChapterContent;
  attempts: number;
}

export interface ChapterFetchFailure {
  chapter: ChapterIndexEntry;
  error: Error;
  attempts: number;
}

export type ChapterFetchResult = ChapterFetchSuccess | ChapterFetchFailure;

export interface SpiderBatchOptions {
  concurrency?: number;
  retryCount?: number;
}

export interface SpiderRunContext {
  novelId: string;
}

/**
 * 站点爬虫策略接口。
 *
 * 具体站点需要负责：
 * 1. 生成信息页地址。
 * 2. 解析基础元数据。
 * 3. 解析章节目录。
 * 4. 抓取单章正文。
 * 5. 批量抓取时保持单章异常隔离。
 */
export interface SpiderAdapter {
  readonly sourceId: string;

  buildInfoPageUrl(novelId: string): string;
  fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata>;
  fetchChapterIndex(
    context: SpiderRunContext,
    metadata: NovelMetadata,
  ): Promise<ChapterIndexEntry[]>;
  fetchChapter(
    context: SpiderRunContext,
    chapter: ChapterIndexEntry,
  ): Promise<ChapterContent>;
  fetchChapters(
    context: SpiderRunContext,
    chapters: ChapterIndexEntry[],
    options?: SpiderBatchOptions,
  ): Promise<ChapterFetchResult[]>;
}

export abstract class BaseHtmlSpiderAdapter implements SpiderAdapter {
  abstract readonly sourceId: string;

  abstract buildInfoPageUrl(novelId: string): string;

  abstract fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata>;

  abstract fetchChapterIndex(
    context: SpiderRunContext,
    metadata: NovelMetadata,
  ): Promise<ChapterIndexEntry[]>;

  abstract fetchChapter(
    context: SpiderRunContext,
    chapter: ChapterIndexEntry,
  ): Promise<ChapterContent>;

  protected parseHtml(html: string): CheerioAPI {
    return load(html);
  }

  async fetchChapters(
    context: SpiderRunContext,
    chapters: ChapterIndexEntry[],
    options: SpiderBatchOptions = {},
  ): Promise<ChapterFetchResult[]> {
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const results: ChapterFetchResult[] = new Array(chapters.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= chapters.length) {
          return;
        }

        const chapter = chapters[currentIndex];
        if (!chapter) {
          return;
        }

        results[currentIndex] = await this.fetchChapterWithRetry(
          context,
          chapter,
          options.retryCount ?? 0,
        );
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, chapters.length) }, () => worker()),
    );

    return results;
  }

  private async fetchChapterWithRetry(
    context: SpiderRunContext,
    chapter: ChapterIndexEntry,
    retryCount: number,
  ): Promise<ChapterFetchResult> {
    let attempts = 0;

    while (attempts <= retryCount) {
      attempts += 1;

      try {
        const content = await this.fetchChapter(context, chapter);
        return {
          chapter,
          content,
          attempts,
        };
      } catch (error) {
        if (attempts > retryCount) {
          return {
            chapter,
            error: toError(error),
            attempts,
          };
        }
      }
    }

    return {
      chapter,
      error: new Error(`Unreachable retry branch for chapter ${chapter.id}`),
      attempts,
    };
  }
}

export interface StoredChapterRecord extends ChapterIndexEntry {
  content: string | null;
  status: ChapterPersistStatus;
  errorMessage: string | null;
  downloadedAt: string | null;
  updatedAt: string;
}

export interface StoredNovelSnapshot {
  sourceId: string;
  metadata: NovelMetadata;
  chapters: StoredChapterRecord[];
  updatedAt: string;
}

export interface ResolvedChapterState extends ChapterIndexEntry {
  wasDownloaded: boolean;
  isNew: boolean;
  status: ChapterPersistStatus;
}

export interface SpiderRunFailure {
  chapterId: string;
  title: string;
  attempts: number;
  errorMessage: string;
}

export interface CrawlNovelOptions {
  novelId: string;
  chapterIds?: string[];
  forceRefetch?: boolean;
  chapterConcurrency?: number;
  chapterRetryCount?: number;
}

export interface CrawlNovelResult {
  metadata: NovelMetadata;
  chapters: ResolvedChapterState[];
  failures: SpiderRunFailure[];
  previousSnapshot: StoredNovelSnapshot | null;
  currentSnapshot: StoredNovelSnapshot;
}

export function isChapterFetchFailure(result: ChapterFetchResult): result is ChapterFetchFailure {
  return 'error' in result;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}