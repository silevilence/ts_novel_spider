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

const EPISODE_BODY_SELECTOR = '.widget-episodeBody.js-episode-body';
const EPISODE_TITLE_SELECTOR = 'h2, .widget-episodeTitle';

export interface SpiderHtmlRequest {
  url: string;
  headers: Record<string, string>;
}

export type SpiderHtmlFetcher = (request: SpiderHtmlRequest) => Promise<string>;

export interface KakuyomuSpiderAdapterOptions {
  fetchHtml?: SpiderHtmlFetcher;
}

export class KakuyomuSpiderAdapter extends BaseHtmlSpiderAdapter {
  readonly sourceId: string = 'kakuyomu';

  readonly #fetchHtml: SpiderHtmlFetcher;

  constructor(options: KakuyomuSpiderAdapterOptions = {}) {
    super();
    this.#fetchHtml = options.fetchHtml ?? defaultFetchHtml;
  }

  buildInfoPageUrl(novelId: string): string {
    return `https://kakuyomu.jp/works/${normalizeNovelId(novelId)}`;
  }

  async fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata> {
    const html = await this.loadHtml(this.buildInfoPageUrl(context.novelId));
    const document = this.parseHtml(html);

    const nextData = extractNextDataState(html);
    if (nextData) {
      const workKey = `Work:${context.novelId}`;
      const work = nextData[workKey] as Record<string, unknown> | undefined;
      if (work) {
        const authorRef = (work.author as { __ref?: string } | undefined)?.__ref;
        const author =
          authorRef && nextData[authorRef]
            ? (nextData[authorRef] as { name?: string }).name ?? ''
            : '';

        return {
          novelId: context.novelId,
          title: String(work.title ?? ''),
          author,
          description: String(work.introduction ?? ''),
          tags: Array.isArray(work.tagLabels) ? (work.tagLabels as string[]) : [],
          chapterCount: typeof work.publicEpisodeCount === 'number' ? work.publicEpisodeCount : 0,
          infoPageUrl: this.buildInfoPageUrl(context.novelId),
        };
      }
    }

    // HTML fallback
    const fallback = fallbackParseMetadata(document, this.buildInfoPageUrl(context.novelId));
    return {
      ...fallback,
      novelId: context.novelId,
    };
  }

  async fetchChapterIndex(
    context: SpiderRunContext,
    _metadata: NovelMetadata,
  ): Promise<ChapterIndexEntry[]> {
    const html = await this.loadHtml(this.buildInfoPageUrl(context.novelId));
    const document = this.parseHtml(html);

    const nextData = extractNextDataState(html);
    if (nextData) {
      const workKey = `Work:${context.novelId}`;
      const work = nextData[workKey] as Record<string, unknown> | undefined;
      if (work && Array.isArray(work.tableOfContentsV2)) {
        return parseApolloToc(
          nextData,
          work.tableOfContentsV2 as Array<{ __ref: string }>,
          (episodeId) => `https://kakuyomu.jp/works/${context.novelId}/episodes/${episodeId}`,
        );
      }
    }

    // HTML fallback
    return fallbackParseChapterIndex(document, (episodeId) =>
      `https://kakuyomu.jp/works/${context.novelId}/episodes/${episodeId}`,
    );
  }

  async fetchChapter(
    _context: SpiderRunContext,
    chapter: ChapterIndexEntry,
  ): Promise<ChapterContent> {
    const document = this.parseHtml(await this.loadHtml(chapter.url));
    const body = document(EPISODE_BODY_SELECTOR);

    if (body.length === 0) {
      throw new Error(`No chapter content found for ${chapter.url}`);
    }

    const paragraphs: string[] = [];
    body.children('p').each((_i, el) => {
      const p = document(el);
      if (p.hasClass('blank')) return; // skip blank separators
      const text = p.text().trim();
      if (text.length > 0) {
        paragraphs.push(text);
      }
    });

    if (paragraphs.length === 0) {
      throw new Error(`No chapter content found for ${chapter.url}`);
    }

    const title =
      readText(document(EPISODE_TITLE_SELECTOR).first()) ?? chapter.title;

    return {
      chapterId: chapter.id,
      index: chapter.index,
      title,
      url: chapter.url,
      content: paragraphs.join('\n\n'),
      ...(chapter.volumeTitle ? { volumeTitle: chapter.volumeTitle } : {}),
    };
  }

  protected async loadHtml(url: string): Promise<string> {
    return this.#fetchHtml({
      url,
      headers: buildRequestHeaders(),
    });
  }
}

function normalizeNovelId(novelId: string): string {
  return novelId.trim();
}

function buildRequestHeaders(): Record<string, string> {
  return {
    Accept: DEFAULT_ACCEPT,
    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
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

function extractNextDataState(html: string): Record<string, unknown> | undefined {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match || !match[1]) {
    return undefined;
  }

  try {
    const data: { props?: { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } } } =
      JSON.parse(match[1]);
    return data.props?.pageProps?.__APOLLO_STATE__;
  } catch {
    return undefined;
  }
}

function fallbackParseMetadata(document: CheerioAPI, infoPageUrl: string): NovelMetadata {
  const title = document('h1').first().text().trim();

  const author =
    readText(document('a[href^="/users/"]').first()) ?? '';

  const tags = document('a[href^="/tags/"]')
    .toArray()
    .map((el) => document(el).text().trim())
    .filter((t) => t.length > 0);

  const description =
    document('meta[property="og:description"]').attr('content') ??
    document('meta[name="description"]').attr('content') ??
    '';

  const bodyText = document('body').text();

  const chapterCountMatch = bodyText.match(/全(\d+)話/);
  const chapterCount = chapterCountMatch?.[1] ? Number.parseInt(chapterCountMatch[1], 10) : 0;

  return {
    novelId: '',
    title,
    author,
    description,
    tags,
    chapterCount,
    infoPageUrl,
  };
}

function readText(element: ReturnType<CheerioAPI>): string | undefined {
  const text = element.text().trim();
  return text.length > 0 ? text : undefined;
}

interface ApolloRef {
  __ref: string;
}

function parseApolloToc(
  apolloState: Record<string, unknown>,
  tocRefs: ApolloRef[],
  buildEpisodeUrl: (episodeId: string) => string,
): ChapterIndexEntry[] {
  const chapters: ChapterIndexEntry[] = [];

  for (const tocRef of tocRefs) {
    const tocEntry = apolloState[tocRef.__ref] as Record<string, unknown> | undefined;
    if (!tocEntry) continue;

    const chapterRef = (tocEntry.chapter as ApolloRef | null | undefined)?.__ref;
    const volumeTitle = chapterRef
      ? ((apolloState[chapterRef] as { title?: string } | undefined)?.title ?? undefined)
      : undefined;

    const episodeRefs = Array.isArray(tocEntry.episodeUnions)
      ? (tocEntry.episodeUnions as ApolloRef[])
      : [];

    for (const epRef of episodeRefs) {
      const ep = apolloState[epRef.__ref] as Record<string, unknown> | undefined;
      if (!ep) continue;

      const id = String(ep.id ?? '');
      const title = String(ep.title ?? '');
      if (!id) continue;
      const url = buildEpisodeUrl(id);

      chapters.push({
        id,
        index: chapters.length + 1,
        title,
        url,
        ...(volumeTitle ? { volumeTitle } : {}),
      });
    }
  }

  return chapters;
}

function fallbackParseChapterIndex(
  document: CheerioAPI,
  buildEpisodeUrl: (episodeId: string) => string,
): ChapterIndexEntry[] {
  const chapters: ChapterIndexEntry[] = [];
  let currentVolumeTitle: string | undefined;

  // Find candidate elements: links to episodes and volume header h3s
  const tocContainer = document('[class*="WorkToc"], body').first();
  if (tocContainer.length === 0) return chapters;

  tocContainer.find('h3, a[href*="/episodes/"]').each((_i, el) => {
    const tagName = document(el).prop('tagName')?.toLowerCase();
    if (tagName === 'h3') {
      const h3Text = document(el).text().trim();
      // Skip non-volume h3 headers
      if (
        h3Text &&
        !h3Text.includes('レビュー') &&
        !h3Text.includes('関連') &&
        !h3Text.includes('おすすめ')
      ) {
        currentVolumeTitle = h3Text;
      }
      return;
    }

    // a tag with episode path
    const href = document(el).attr('href');
    if (!href) return;

    const text = document(el).text().trim();
    // Skip "1話目から読む" and similar navigation links
    if (text.includes('話目から読む') || text === '') return;

    const idMatch = href.match(/\/episodes\/(\d+)/);
    if (!idMatch?.[1]) return;

    const id = idMatch[1];
    chapters.push({
      id,
      index: chapters.length + 1,
      title: text,
      url: buildEpisodeUrl(id),
      ...(currentVolumeTitle ? { volumeTitle: currentVolumeTitle } : {}),
    });
  });

  return chapters;
}
