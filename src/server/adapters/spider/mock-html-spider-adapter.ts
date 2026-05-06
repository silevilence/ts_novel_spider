import type { CheerioAPI } from 'cheerio';

import {
  BaseHtmlSpiderAdapter,
  type ChapterContent,
  type ChapterIndexEntry,
  type NovelMetadata,
  type SpiderRunContext,
} from '../../core/spider';

export interface MockHtmlSpiderFixture {
  metadataHtml: string;
  catalogHtml: string;
  chapterHtmlById: Record<string, string>;
  failChapterIds?: string[];
  transientFailuresByChapterId?: Record<string, number>;
}

/**
 * 供测试与调度链路验证使用的 Mock Spider。
 *
 * DOM 结构保持最小但完整，确保后续接入真实站点时可以直接替换为具体站点适配器。
 */
export class MockHtmlSpiderAdapter extends BaseHtmlSpiderAdapter {
  readonly sourceId = 'mock-html';
  readonly #fixture: MockHtmlSpiderFixture;
  readonly attemptsByChapterId = new Map<string, number>();

  constructor(fixture: MockHtmlSpiderFixture) {
    super();
    this.#fixture = fixture;
  }

  buildInfoPageUrl(novelId: string): string {
    return `https://mock.example/novels/${novelId}`;
  }

  async fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata> {
    const document = this.parseHtml(this.#fixture.metadataHtml);

    return {
      novelId: context.novelId,
      title: requiredText(document, '[data-testid="title"]'),
      author: requiredText(document, '[data-testid="author"]'),
      description: requiredText(document, '[data-testid="description"]'),
      tags: document('[data-testid="tags"] li')
        .toArray()
        .map((element) => document(element).text().trim())
        .filter((value) => value.length > 0),
      chapterCount: Number(requiredText(document, '[data-testid="chapter-count"]')),
      infoPageUrl: this.buildInfoPageUrl(context.novelId),
    };
  }

  async fetchChapterIndex(
    _context: SpiderRunContext,
    _metadata: NovelMetadata,
  ): Promise<ChapterIndexEntry[]> {
    const document = this.parseHtml(this.#fixture.catalogHtml);

    return document('[data-testid="catalog"] li')
      .toArray()
      .map((element, index) => {
        const chapter = document(element);
        const link = chapter.find('a').first();
        const id = chapter.attr('data-chapter-id');

        if (!id) {
          throw new Error('Catalog entry missing data-chapter-id attribute.');
        }

        const href = link.attr('href');
        if (!href) {
          throw new Error(`Catalog entry ${id} missing link href.`);
        }

        const volumeTitle = chapter.attr('data-volume')?.trim();

        return {
          id,
          index: index + 1,
          title: link.text().trim(),
          url: `https://mock.example${href}`,
          ...(volumeTitle ? { volumeTitle } : {}),
        } satisfies ChapterIndexEntry;
      });
  }

  async fetchChapter(
    _context: SpiderRunContext,
    chapter: ChapterIndexEntry,
  ): Promise<ChapterContent> {
    const attempts = (this.attemptsByChapterId.get(chapter.id) ?? 0) + 1;
    this.attemptsByChapterId.set(chapter.id, attempts);

    const transientFailures = this.#fixture.transientFailuresByChapterId?.[chapter.id] ?? 0;
    if (attempts <= transientFailures) {
      throw new Error(`Transient failure for ${chapter.id} on attempt ${attempts}`);
    }

    if (this.#fixture.failChapterIds?.includes(chapter.id)) {
      throw new Error(`Permanent failure for ${chapter.id}`);
    }

    const html = this.#fixture.chapterHtmlById[chapter.id];
    if (!html) {
      throw new Error(`Missing chapter fixture for ${chapter.id}`);
    }

    const document = this.parseHtml(html);
    const paragraphs = document('[data-testid="content"] p')
      .toArray()
      .map((element) => document(element).text().trim())
      .filter((value) => value.length > 0);

    const volumeTitle = optionalText(document, '[data-testid="volume-title"]') ?? chapter.volumeTitle;

    return {
      chapterId: chapter.id,
      index: chapter.index,
      title: requiredText(document, '[data-testid="chapter-title"]'),
      url: chapter.url,
      content: paragraphs.join('\n\n'),
      ...(volumeTitle ? { volumeTitle } : {}),
    };
  }
}

function requiredText(document: CheerioAPI, selector: string): string {
  const value = document(selector).first().text().trim();

  if (!value) {
    throw new Error(`Missing required text for selector ${selector}`);
  }

  return value;
}

function optionalText(document: CheerioAPI, selector: string): string | undefined {
  const value = document(selector).first().text().trim();
  return value.length > 0 ? value : undefined;
}