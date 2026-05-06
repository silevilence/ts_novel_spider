import { load, type CheerioAPI } from 'cheerio';

import {
  BaseHtmlSpiderAdapter,
  type ChapterContent,
  type ChapterIndexEntry,
  type NovelMetadata,
  type SpiderRunContext,
} from '../../core/spider';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_ACCEPT_LANGUAGE = 'ja,en-US;q=0.9,en;q=0.8';
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const PREPEND_PATTERN = /^Lp\d+$/;
const BODY_PATTERN = /^L\d+$/;
const APPEND_PATTERN = /^La\d+$/;

const AUTHOR_LABEL = '作者名';
const DESCRIPTION_LABEL = 'あらすじ';
const KEYWORDS_LABEL = 'キーワード';

export interface SpiderHtmlRequest {
  url: string;
  headers: Record<string, string>;
}

export type SpiderHtmlFetcher = (request: SpiderHtmlRequest) => Promise<string>;

export interface Syosetu18SpiderAdapterOptions {
  fetchHtml?: SpiderHtmlFetcher;
}

/**
 * Syosetu18 站点业务爬虫。
 *
 * 解析逻辑直接对应站点现有的 infotop / eplist / novel 页面结构，
 * 通过注入 fetch 实现测试与线上请求解耦。
 */
export class Syosetu18SpiderAdapter extends BaseHtmlSpiderAdapter {
  readonly sourceId: string = 'syosetu18';

  readonly #fetchHtml: SpiderHtmlFetcher;

  constructor(options: Syosetu18SpiderAdapterOptions = {}) {
    super();
    this.#fetchHtml = options.fetchHtml ?? defaultFetchHtml;
  }

  protected get infoPageBaseUrl(): string {
    return 'https://novel18.syosetu.com/novelview/infotop/ncode/';
  }

  protected get novelPageBaseUrl(): string {
    return 'https://novel18.syosetu.com';
  }

  protected get cookieHeader(): string | undefined {
    return 'over18=yes';
  }

  buildInfoPageUrl(novelId: string): string {
    return `${this.infoPageBaseUrl}${normalizeNovelId(novelId)}/`;
  }

  async fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata> {
    const document = this.parseHtml(await this.loadHtml(this.buildInfoPageUrl(context.novelId)));
    const infoMap = readInfoDefinitionList(document);
    const chapterCount =
      readChapterCount(document) ??
      readChapterCountFromLatestLink(document) ??
      0;

    return {
      novelId: context.novelId,
      title: requiredText(document, 'h1.p-infotop-title > a, h1.p-infotop-title'),
      author: infoMap.get(AUTHOR_LABEL) ?? '',
      description: infoMap.get(DESCRIPTION_LABEL) ?? '',
      tags: splitTags(infoMap.get(KEYWORDS_LABEL)),
      chapterCount,
      infoPageUrl: this.buildInfoPageUrl(context.novelId),
    };
  }

  async fetchChapterIndex(
    context: SpiderRunContext,
    _metadata: NovelMetadata,
  ): Promise<ChapterIndexEntry[]> {
    const document = this.parseHtml(await this.loadHtml(this.buildNovelPageUrl(context.novelId)));
    const chapterNodes = document('dl.p-eplist__sublist, dl.novel_sublist2').toArray();

    if (chapterNodes.length === 0) {
      throw new Error(`No catalog entries found for novel ${context.novelId}`);
    }

    return chapterNodes.map((element, index) => {
      const entry = document(element);
      const link = entry
        .find('dd.p-eplist__subtitle a, dd.subtitle a, a.p-eplist__subtitle, a.subtitle')
        .first();
      const href = link.attr('href');

      if (!href) {
        throw new Error(`Catalog entry ${index + 1} is missing href.`);
      }

      const url = this.buildAbsoluteUrl(href);
      const id = extractChapterId(url) ?? String(index + 1);
      const volumeTitle =
        readText(entry.prevAll('.p-eplist__chapter-title, .chapter_title').first()) ?? undefined;

      return {
        id,
        index: index + 1,
        title: requiredTextFromNode(link),
        url,
        ...(volumeTitle ? { volumeTitle } : {}),
      } satisfies ChapterIndexEntry;
    });
  }

  async fetchChapter(
    _context: SpiderRunContext,
    chapter: ChapterIndexEntry,
  ): Promise<ChapterContent> {
    const document = this.parseHtml(await this.loadHtml(chapter.url));
    const contentSegments = readChapterParagraphs(document)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (contentSegments.length === 0) {
      throw new Error(`No chapter content found for ${chapter.url}`);
    }

    const volumeTitle =
      readText(document('.c-announce > span:not([class])').first()) ?? chapter.volumeTitle;

    return {
      chapterId: chapter.id,
      index: chapter.index,
      title:
        readText(document('article.p-novel h1.p-novel__title').first()) ??
        readText(document('.p-novel__title').first()) ??
        chapter.title,
      url: chapter.url,
      content: contentSegments.join('\n\n'),
      ...(volumeTitle ? { volumeTitle } : {}),
    };
  }

  protected buildNovelPageUrl(novelId: string): string {
    return `${this.novelPageBaseUrl}/${normalizeNovelId(novelId)}/`;
  }

  protected buildAbsoluteUrl(urlOrPath: string): string {
    return new URL(urlOrPath, `${this.novelPageBaseUrl}/`).toString();
  }

  protected async loadHtml(url: string): Promise<string> {
    return this.#fetchHtml({
      url,
      headers: buildRequestHeaders(this.cookieHeader),
    });
  }
}

function normalizeNovelId(novelId: string): string {
  return novelId.trim().toLowerCase();
}

function buildRequestHeaders(cookieHeader: string | undefined): Record<string, string> {
  return {
    Accept: DEFAULT_ACCEPT,
    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    'User-Agent': DEFAULT_USER_AGENT,
  };
}

async function defaultFetchHtml(request: SpiderHtmlRequest): Promise<string> {
  const response = await fetch(request.url, {
    headers: request.headers,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${request.url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function readInfoDefinitionList(document: CheerioAPI): Map<string, string> {
  const entries = new Map<string, string>();
  const titles = document('dl.p-infotop-data > dt, dl.p-infotop-data__table > dt').toArray();
  const values = document('dl.p-infotop-data > dd, dl.p-infotop-data__table > dd').toArray();

  titles.forEach((titleNode, index) => {
    const key = readText(document(titleNode));
    const valueNode = values[index];
    const value = valueNode ? readText(document(valueNode)) : undefined;

    if (key && value !== undefined) {
      entries.set(key, value);
    }
  });

  return entries;
}

function readChapterCount(document: CheerioAPI): number | undefined {
  return parseFirstInteger(readText(document('.p-infotop-type__allep').first()));
}

function readChapterCountFromLatestLink(document: CheerioAPI): number | undefined {
  const href = document('div.p-infotop-type__left > a:last-child').attr('href');

  if (!href) {
    return undefined;
  }

  const match = href.match(/\/(\d+)\/?$/);
  if (!match) {
    return undefined;
  }

  const chapterNumber = match[1];
  if (!chapterNumber) {
    return undefined;
  }

  return Number.parseInt(chapterNumber, 10);
}

function splitTags(tagText: string | undefined): string[] {
  if (!tagText) {
    return [];
  }

  return tagText
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function extractChapterId(url: string): string | undefined {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\/(\d+)\/?$/);

  return match?.[1];
}

/**
 * 章节正文由前言、本体、后记三类段落组成，需按页面自然顺序合并为单一正文串。
 */
function readChapterParagraphs(document: CheerioAPI): string[] {
  const paragraphs = document('p[id]').toArray();

  return paragraphs
    .filter((element) => {
      const id = document(element).attr('id');
      return isContentParagraphId(id);
    })
    .map((element) => readParagraphContent(document, element));
}

function isContentParagraphId(paragraphId: string | undefined): boolean {
  if (!paragraphId) {
    return false;
  }

  return (
    PREPEND_PATTERN.test(paragraphId) ||
    BODY_PATTERN.test(paragraphId) ||
    APPEND_PATTERN.test(paragraphId)
  );
}

function readParagraphContent(document: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
  const paragraph = document(element);
  const image = paragraph.find('a img, img').first();

  if (image.length > 0) {
    const src = image.attr('src');
    if (!src) {
      return '';
    }

    const alt = image.attr('alt')?.trim() || 'image';
    return `![${alt}](${normalizeImageUrl(src)})`;
  }

  const html = paragraph.html();
  if (!html) {
    return paragraph.text().trim();
  }

  const fragment = load(`<div>${html.replace(/<br\s*\/?>/gi, '\n')}</div>`);
  return normalizeMultilineText(fragment.root().text());
}

function normalizeImageUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }

  if (src.startsWith('//')) {
    return `https:${src}`;
  }

  return src;
}

function normalizeMultilineText(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function parseFirstInteger(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const match = text.match(/(\d+)/);
  if (!match) {
    return undefined;
  }

  const parsedNumber = match[1];
  if (!parsedNumber) {
    return undefined;
  }

  return Number.parseInt(parsedNumber, 10);
}

function requiredText(document: CheerioAPI, selector: string): string {
  const value = readText(document(selector).first());

  if (!value) {
    throw new Error(`Missing required text for selector ${selector}`);
  }

  return value;
}

function requiredTextFromNode(node: ReturnType<CheerioAPI>): string {
  const value = readText(node);

  if (!value) {
    throw new Error('Missing required text from node.');
  }

  return value;
}

function readText(node: ReturnType<CheerioAPI>): string | undefined {
  const value = node.text().trim();
  return value.length > 0 ? value : undefined;
}