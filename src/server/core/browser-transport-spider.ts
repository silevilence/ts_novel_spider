import {
  BaseHtmlSpiderAdapter,
  type ChapterContent,
  type ChapterIndexEntry,
  type NovelMetadata,
  type SpiderAdapter,
  type SpiderBatchOptions,
  type ChapterFetchResult,
  type SpiderRunContext,
} from './spider';
import {
  BrowserCaptureService,
  BrowserTransportError,
  type BrowserCapturePhase,
  type BrowserHtmlRequest,
} from './browser-capture';

export interface BrowserTransportSpiderContext {
  taskId: string | null;
  sourceId: string;
  novelId: string;
}

export type BrowserTransportSpiderFactory = (
  fetchHtml: (request: BrowserHtmlRequest) => Promise<string>,
) => SpiderAdapter;

/**
 * Keeps every site parser on the server while replacing only its injected HTML
 * fetcher with the user-authorized browser transport.
 */
export class BrowserTransportSpiderAdapter extends BaseHtmlSpiderAdapter {
  readonly sourceId: string;
  readonly #capture: BrowserCaptureService;
  readonly #createSpider: BrowserTransportSpiderFactory;
  readonly #captureContext: BrowserTransportSpiderContext;

  constructor(
    capture: BrowserCaptureService,
    createSpider: BrowserTransportSpiderFactory,
    context: BrowserTransportSpiderContext,
  ) {
    super();
    this.#capture = capture;
    this.#createSpider = createSpider;
    this.#captureContext = context;
    this.sourceId = context.sourceId;
  }

  buildInfoPageUrl(novelId: string): string {
    return this.createDelegate('metadata').buildInfoPageUrl(novelId);
  }

  async fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata> {
    while (true) {
      try {
        return await this.createDelegate('metadata').fetchMetadata(context);
      } catch (error) {
        if (!await this.waitForParseRecovery(error)) throw error;
      }
    }
  }

  async fetchChapterIndex(context: SpiderRunContext, metadata: NovelMetadata): Promise<ChapterIndexEntry[]> {
    while (true) {
      try {
        return await this.createDelegate('catalog').fetchChapterIndex(context, metadata);
      } catch (error) {
        if (!await this.waitForParseRecovery(error)) throw error;
      }
    }
  }

  fetchChapter(context: SpiderRunContext, chapter: ChapterIndexEntry): Promise<ChapterContent> {
    return this.createDelegate('chapter').fetchChapter(context, chapter);
  }

  async fetchChapters(
    context: SpiderRunContext,
    chapters: ChapterIndexEntry[],
    options: SpiderBatchOptions = {},
  ): Promise<ChapterFetchResult[]> {
    const results: ChapterFetchResult[] = [];
    for (const chapter of chapters) {
      let attempts = 0;
      while (true) {
        attempts += 1;
        try {
          const content = await this.fetchChapter(context, chapter);
          const result: ChapterFetchResult = { chapter, content, attempts };
          results.push(result);
          await options.onResult?.(result);
          break;
        } catch (error) {
          const failureError = error instanceof Error ? error : new Error(String(error));
          if (await this.waitForParseRecovery(failureError)) continue;
          const failure: ChapterFetchResult = { chapter, error: failureError, attempts };
          results.push(failure);
          await options.onResult?.(failure);
          throw failure.error;
        }
      }
    }
    return results;
  }

  private createDelegate(phase: BrowserCapturePhase): SpiderAdapter {
    return this.#createSpider((request) => this.#capture.fetchHtml(request, {
      taskId: this.#captureContext.taskId,
      sourceId: this.#captureContext.sourceId,
      novelId: this.#captureContext.novelId,
      phase,
    }));
  }

  private async waitForParseRecovery(error: unknown): Promise<boolean> {
    const failureError = error instanceof Error ? error : new Error(String(error));
    const recoverable = !(failureError instanceof BrowserTransportError) || failureError.code === 'parse_error';
    if (!recoverable || !this.#captureContext.taskId) return false;
    await this.#capture.waitForUser(
      this.#captureContext.taskId,
      'parse_error',
      `页面解析失败：${failureError.message}。请检查当前页面，处理后继续重试。`,
    );
    return true;
  }
}
