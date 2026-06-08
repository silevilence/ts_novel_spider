# Kakuyomu Spider Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Kakuyomu spider adapter that extracts novel metadata, chapter index, and chapter content from `kakuyomu.jp` using dual-path parsing (Apollo State primary, HTML fallback).

**Architecture:** Single adapter class `KakuyomuSpiderAdapter` extends `BaseHtmlSpiderAdapter`, injecting `SpiderHtmlFetcher`. Metadata and catalog use `__NEXT_DATA__` Apollo State as primary path, with Cheerio HTML selectors as fallback. Chapter body is pure HTML extraction. Registered via `createDefaultSpiderRegistry()` alongside existing Syosetu adapters.

**Tech Stack:** Node.js ≥20, TypeScript strict, `cheerio`, `node:test` + `node:assert/strict`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/server/adapters/spider/kakuyomu-spider-adapter.ts` | **Create** | Core adapter: class + private parsing helpers |
| `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts` | **Create** | Unit tests with HTML fixture injection |
| `src/server/core/control-center.ts` | **Modify** | Register `kakuyomu` in registry (import + append entry) |
| `src/server/core/control-center.test.ts` | **Modify** | Add `kakuyomu` to expected registry sourceIds |

---

## Task 1: Create test file with fixture utilities

**Files:**
- Create: `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`

- [ ] **Step 1: Write the test skeleton with fixture utilities**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KakuyomuSpiderAdapter,
  type SpiderHtmlFetcher,
  type SpiderHtmlRequest,
} from './kakuyomu-spider-adapter';

function createFixtureFetch(
  htmlByUrl: Record<string, string>,
  requests: SpiderHtmlRequest[] = [],
): SpiderHtmlFetcher {
  return async (request) => {
    requests.push(request);
    const html = htmlByUrl[request.url];
    if (!html) {
      throw new Error(`Unexpected URL: ${request.url}`);
    }
    return html;
  };
}

const WORKS_URL = 'https://kakuyomu.jp/works/822139839856110454';
const EPISODE_BASE = 'https://kakuyomu.jp/works/822139839856110454/episodes';

// Fixture: works page with __NEXT_DATA__ and HTML fallback markers
const WORKS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="description" content="ブラック企業から逃げ出した社畜男が…">
  <meta property="og:description" content="og 简介内容更完整">
</head>
<body>
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        __APOLLO_STATE__: {
          'Work:822139839856110454': {
            __typename: 'Work',
            id: '822139839856110454',
            title: '鎖編みのミスティカ ～会社に縛られていた社畜が鎖のTS魔法少女になる話～',
            introduction: 'ブラック企業から逃げ出した社畜男が、\\n気づいたら路地裏で少女になっていた。',
            tagLabels: ['TS', '魔法少女', 'ガールズラブ'],
            serialStatus: 'RUNNING',
            publicEpisodeCount: 3,
            totalCharacterCount: 121207,
            isCruel: true,
            isViolent: true,
            isSexual: false,
            author: { __ref: 'UserAccount:1177354054892236859' },
            tableOfContentsV2: [
              { __ref: 'TableOfContentsChapter:ch001' },
              { __ref: 'TableOfContentsChapter:ch002' },
            ],
          },
          'UserAccount:1177354054892236859': {
            __typename: 'UserAccount',
            id: '1177354054892236859',
            name: 'topazrf',
            activityName: '@topazrf',
            screenName: '@topazrf',
          },
          'TableOfContentsChapter:ch001': {
            __typename: 'TableOfContentsChapter',
            id: 'ch001',
            episodeUnions: [
              { __ref: 'Episode:ep001' },
              { __ref: 'Episode:ep002' },
            ],
            chapter: { __ref: 'Chapter:ch001' },
          },
          'TableOfContentsChapter:ch002': {
            __typename: 'TableOfContentsChapter',
            id: 'ch002',
            episodeUnions: [
              { __ref: 'Episode:ep003' },
            ],
            chapter: { __ref: 'Chapter:ch002' },
          },
          'Chapter:ch001': {
            __typename: 'Chapter',
            id: 'ch001',
            level: 1,
            title: '前編',
          },
          'Chapter:ch002': {
            __typename: 'Chapter',
            id: 'ch002',
            level: 1,
            title: '後編',
          },
          'Episode:ep001': {
            __typename: 'Episode',
            id: '822139839856134658',
            title: '第1話　路地裏で目覚めて(1)',
            publishedAt: '2025-11-20T23:22:56.000Z',
          },
          'Episode:ep002': {
            __typename: 'Episode',
            id: '822139839876728241',
            title: '第2話　路地裏で目覚めて(2)',
            publishedAt: '2025-11-21T06:43:39.000Z',
          },
          'Episode:ep003': {
            __typename: 'Episode',
            id: '822139840212455534',
            title: '第3話　魔災獣(1)',
            publishedAt: '2025-11-26T10:17:10.000Z',
          },
        },
      },
    },
  }).replace(/</g, '\\u003c')}</script>
  <h1>鎖編みのミスティカ ～会社に縛られていた社畜が鎖のTS魔法少女になる話～</h1>
  <a href="/users/topazrf">@topazrf</a>
  <a href="/tags/TS">TS</a>
  <a href="/tags/魔法少女">魔法少女</a>
  <a href="/tags/ガールズラブ">ガールズラブ</a>
  <h3>前編</h3>
  <a href="/works/822139839856110454/episodes/822139839856134658">第1話　路地裏で目覚めて(1)</a>
  <a href="/works/822139839856110454/episodes/822139839876728241">第2話　路地裏で目覚めて(2)</a>
  <h3>後編</h3>
  <a href="/works/822139839856110454/episodes/822139840212455534">第3話　魔災獣(1)</a>
</body>
</html>`;

// Fixture: works page WITHOUT __NEXT_DATA__ (HTML fallback path)
const WORKS_HTML_NO_NEXT_DATA = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:description" content="og 简介内容更完整">
  <meta name="description" content="短简介">
</head>
<body>
  <h1>鎖編みのミスティカ</h1>
  <a href="/users/topazrf">@topazrf</a>
  <a href="/tags/TS">TS</a>
  <a href="/tags/魔法少女">魔法少女</a>
  <a href="/tags/ガールズラブ">ガールズラブ</a>
  連載中 全3話
  121,207文字
  <h3>前編</h3>
  <a href="/works/822139839856110454/episodes/822139839856134658">第1話　路地裏で目覚めて(1)</a>
  <a href="/works/822139839856110454/episodes/822139839876728241">第2話　路地裏で目覚めて(2)</a>
  <h3>後編</h3>
  <a href="/works/822139839856110454/episodes/822139840212455534">第3話　魔災獣(1)</a>
</body>
</html>`;

// Fixture: episode page (chapter body)
const CHAPTER_1_URL = `${EPISODE_BASE}/822139839856134658`;
const CHAPTER_1_HTML = `<!DOCTYPE html>
<html>
<body>
  <div class="widget-episodeTitle js-vertical-composition-item">第1話　路地裏で目覚めて(1)</div>
  <div class="widget-episodeBody js-episode-body">
    <p id="p1">「なぁ、聞いたか？　魔法少女ラピスの噂」</p>
    <p id="p2" class="blank"><br></p>
    <p id="p3">暗い会議室に、囁くような声。</p>
    <p id="p4" class="blank"><br></p>
    <p id="p5">「そうだ。裏切ってコチラ側に来たらしい。」</p>
  </div>
</body>
</html>`;

const CHAPTER_2_URL = `${EPISODE_BASE}/822139839876728241`;
const CHAPTER_2_HTML = `<!DOCTYPE html>
<html>
<body>
  <h2>第2話　路地裏で目覚めて(2)</h2>
  <div class="widget-episodeBody js-episode-body">
    <p id="p1">二章の一段落目。</p>
    <p id="p2" class="blank"><br></p>
    <p id="p3">二章の二段落目。</p>
  </div>
</body>
</html>`;

// Fixture: works page with NO volume grouping (flat chapters)
const WORKS_URL_FLAT = 'https://kakuyomu.jp/works/999999999999999999';
const WORKS_HTML_NO_VOLUMES = `<!DOCTYPE html>
<html>
<body>
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        __APOLLO_STATE__: {
          'Work:999999999999999999': {
            __typename: 'Work',
            id: '999999999999999999',
            title: 'Flat Novel',
            introduction: 'No volumes.',
            tagLabels: [],
            serialStatus: 'COMPLETED',
            publicEpisodeCount: 2,
            totalCharacterCount: 1000,
            isCruel: false,
            isViolent: false,
            isSexual: false,
            author: { __ref: 'UserAccount:ua_flat' },
            tableOfContentsV2: [
              { __ref: 'TableOfContentsChapter:toc_flat' },
            ],
          },
          'UserAccount:ua_flat': {
            __typename: 'UserAccount',
            id: 'ua_flat',
            name: 'flatauthor',
          },
          'TableOfContentsChapter:toc_flat': {
            __typename: 'TableOfContentsChapter',
            id: 'toc_flat',
            episodeUnions: [
              { __ref: 'Episode:ep_flat1' },
              { __ref: 'Episode:ep_flat2' },
            ],
            chapter: null,
          },
          'Episode:ep_flat1': {
            __typename: 'Episode',
            id: '111111111111111111',
            title: '第1話　始まり',
            publishedAt: '2025-01-01T00:00:00.000Z',
          },
          'Episode:ep_flat2': {
            __typename: 'Episode',
            id: '222222222222222222',
            title: '第2話　終わり',
            publishedAt: '2025-01-02T00:00:00.000Z',
          },
        },
      },
    },
  }).replace(/</g, '\\u003c')}</script>
  <h1>Flat Novel</h1>
  <a href="/users/flatauthor">flatauthor</a>
  完結済 全2話
  1,000文字
  <a href="/works/999999999999999999/episodes/111111111111111111">第1話　始まり</a>
  <a href="/works/999999999999999999/episodes/222222222222222222">第2話　終わり</a>
</body>
</html>`;
```

- [ ] **Step 2: Run test to verify it loads without errors (no tests yet)**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: 0 tests, no errors (file parses successfully, imports will fail until adapter file exists)

- [ ] **Step 3: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.test.ts
git commit -m "test: add kakuyomu spider adapter test skeleton with fixtures"
```

---

## Task 2: Create adapter skeleton (minimal to pass imports)

**Files:**
- Create: `src/server/adapters/spider/kakuyomu-spider-adapter.ts`

- [ ] **Step 1: Write the minimal adapter class**

```typescript
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
    throw new Error('Not implemented');
  }

  async fetchChapterIndex(
    context: SpiderRunContext,
    metadata: NovelMetadata,
  ): Promise<ChapterIndexEntry[]> {
    throw new Error('Not implemented');
  }

  async fetchChapter(
    context: SpiderRunContext,
    chapter: ChapterIndexEntry,
  ): Promise<ChapterContent> {
    throw new Error('Not implemented');
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
```

- [ ] **Step 2: Run the test file to verify it compiles**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: 0 tests run (no test cases written yet), no import errors

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: No errors related to the new file

- [ ] **Step 4: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.ts
git commit -m "feat: add kakuyomu spider adapter skeleton"
```

---

## Task 3: Implement fetchMetadata with __NEXT_DATA__ primary path

**Files:**
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.ts`
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`

- [ ] **Step 1: Add the test case for fetchMetadata (__NEXT_DATA__ path)**

Append to test file:

```typescript
test('KakuyomuSpiderAdapter parses metadata from __NEXT_DATA__', async () => {
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [WORKS_URL]: WORKS_HTML,
      },
      requests,
    ),
  });

  const metadata = await adapter.fetchMetadata({ novelId: '822139839856110454' });

  assert.equal(adapter.sourceId, 'kakuyomu');
  assert.deepEqual(metadata, {
    novelId: '822139839856110454',
    title: '鎖編みのミスティカ ～会社に縛られていた社畜が鎖のTS魔法少女になる話～',
    author: 'topazrf',
    description: 'ブラック企業から逃げ出した社畜男が、\n気づいたら路地裏で少女になっていた。',
    tags: ['TS', '魔法少女', 'ガールズラブ'],
    chapterCount: 3,
    infoPageUrl: WORKS_URL,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: FAIL — `fetchMetadata` throws "Not implemented"

- [ ] **Step 3: Implement fetchMetadata with __NEXT_DATA__ parsing**

Replace `fetchMetadata` in adapter:

```typescript
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

    // HTML fallback (implemented in Task 4)
    return fallbackParseMetadata(document, this.buildInfoPageUrl(context.novelId));
  }
```

Add the helper function at file scope (before the class):

```typescript
function extractNextDataState(html: string): Record<string, unknown> | undefined {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match || !match[1]) {
    return undefined;
  }

  try {
    const data = JSON.parse(match[1]);
    return (data as Record<string, unknown>).props?.pageProps?.__APOLLO_STATE__ as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}
```

For now, stub the HTML fallback (to be replaced in Task 4):

```typescript
function fallbackParseMetadata(document: CheerioAPI, infoPageUrl: string): NovelMetadata {
  // Will be implemented in Task 4
  return {
    novelId: '',
    title: '',
    author: '',
    description: '',
    tags: [],
    chapterCount: 0,
    infoPageUrl,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: PASS — metadata test passes

- [ ] **Step 5: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.ts src/server/adapters/spider/kakuyomu-spider-adapter.test.ts
git commit -m "feat: implement kakuyomu fetchMetadata with __NEXT_DATA__ parsing"
```

---

## Task 4: Implement fetchMetadata HTML fallback path

**Files:**
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.ts`
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`

- [ ] **Step 1: Add the test case for HTML fallback metadata**

Append to test file:

```typescript
test('KakuyomuSpiderAdapter falls back to HTML when __NEXT_DATA__ is missing', async () => {
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [WORKS_URL]: WORKS_HTML_NO_NEXT_DATA,
      },
      requests,
    ),
  });

  const metadata = await adapter.fetchMetadata({ novelId: '822139839856110454' });

  assert.equal(metadata.title, '鎖編みのミスティカ');
  assert.equal(metadata.author, '@topazrf');
  assert.deepEqual(metadata.tags, ['TS', '魔法少女', 'ガールズラブ']);
  assert.equal(metadata.description, 'og 简介内容更完整');
  assert.equal(metadata.chapterCount, 3);
  assert.equal(metadata.infoPageUrl, WORKS_URL);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: FAIL — HTML fallback returns empty metadata

- [ ] **Step 3: Implement fallbackParseMetadata**

Replace the stub `fallbackParseMetadata` function with full implementation:

```typescript
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
  const chapterCount = chapterCountMatch ? Number.parseInt(chapterCountMatch[1], 10) : 0;

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
```

Note: `novelId` will be set by the calling method (`fetchMetadata`).

- [ ] **Step 4: Update fetchMetadata to populate novelId from context**

Update the HTML fallback path in `fetchMetadata` to set the novelId:

```typescript
    // HTML fallback
    const fallback = fallbackParseMetadata(document, this.buildInfoPageUrl(context.novelId));
    return {
      ...fallback,
      novelId: context.novelId,
    };
```

- [ ] **Step 5: Run all tests**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: Both metadata tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.ts src/server/adapters/spider/kakuyomu-spider-adapter.test.ts
git commit -m "feat: add kakuyomu fetchMetadata HTML fallback path"
```

---

## Task 5: Implement fetchChapterIndex with Apollo State primary path

**Files:**
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.ts`
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`

- [ ] **Step 1: Add test cases for fetchChapterIndex**

Append to test file:

```typescript
test('KakuyomuSpiderAdapter parses chapter index with volumes from Apollo State', async () => {
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [WORKS_URL]: WORKS_HTML,
      },
      requests,
    ),
  });

  const metadata = await adapter.fetchMetadata({ novelId: '822139839856110454' });
  const chapters = await adapter.fetchChapterIndex({ novelId: '822139839856110454' }, metadata);

  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters, [
    {
      id: '822139839856134658',
      index: 1,
      title: '第1話　路地裏で目覚めて(1)',
      volumeTitle: '前編',
      url: `${EPISODE_BASE}/822139839856134658`,
    },
    {
      id: '822139839876728241',
      index: 2,
      title: '第2話　路地裏で目覚めて(2)',
      volumeTitle: '前編',
      url: `${EPISODE_BASE}/822139839876728241`,
    },
    {
      id: '822139840212455534',
      index: 3,
      title: '第3話　魔災獣(1)',
      volumeTitle: '後編',
      url: `${EPISODE_BASE}/822139840212455534`,
    },
  ]);
});

test('KakuyomuSpiderAdapter parses chapter index without volumes (chapter: null)', async () => {
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [WORKS_URL_FLAT]: WORKS_HTML_NO_VOLUMES,
      },
      requests,
    ),
  });

  const metadata = await adapter.fetchMetadata({ novelId: '999999999999999999' });
  const chapters = await adapter.fetchChapterIndex({ novelId: '999999999999999999' }, metadata);

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0]!.volumeTitle, undefined);
  assert.equal(chapters[1]!.volumeTitle, undefined);
  assert.equal(chapters[0]!.title, '第1話　始まり');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: Both chapter index tests FAIL — "Not implemented"

- [ ] **Step 3: Implement fetchChapterIndex**

Replace `fetchChapterIndex` in adapter:

```typescript
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

    // HTML fallback (implemented in Task 6)
    return fallbackParseChapterIndex(document, (episodeId) =>
      `https://kakuyomu.jp/works/${context.novelId}/episodes/${episodeId}`,
    );
  }
```

Add the helper function at file scope:

```typescript
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
```

For now, stub the HTML fallback (to be replaced in Task 6):

```typescript
function fallbackParseChapterIndex(
  _document: CheerioAPI,
  _buildEpisodeUrl: (episodeId: string) => string,
): ChapterIndexEntry[] {
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: All tests including chapter index tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.ts src/server/adapters/spider/kakuyomu-spider-adapter.test.ts
git commit -m "feat: implement kakuyomu fetchChapterIndex with Apollo State parsing"
```

---

## Task 6: Implement fetchChapterIndex HTML fallback

**Files:**
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.ts`
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`

- [ ] **Step 1: Add HTML fallback test case**

Append to test file:

```typescript
test('KakuyomuSpiderAdapter falls back to HTML for chapter index when no __NEXT_DATA__', async () => {
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [WORKS_URL]: WORKS_HTML_NO_NEXT_DATA,
      },
      requests,
    ),
  });

  const chapters = await adapter.fetchChapterIndex({ novelId: '822139839856110454' }, {
    novelId: '822139839856110454',
    title: '',
    author: '',
    description: '',
    tags: [],
    chapterCount: 3,
    infoPageUrl: WORKS_URL,
  });

  assert.equal(chapters.length, 3);
  assert.equal(chapters[0]!.volumeTitle, '前編');
  assert.equal(chapters[0]!.title, '第1話　路地裏で目覚めて(1)');
  assert.equal(chapters[2]!.volumeTitle, '後編');
  assert.equal(chapters[2]!.title, '第3話　魔災獣(1)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: FAIL — HTML fallback returns empty array

- [ ] **Step 3: Implement fallbackParseChapterIndex**

Replace the stub with full implementation:

```typescript
function fallbackParseChapterIndex(
  document: CheerioAPI,
  buildEpisodeUrl: (episodeId: string) => string,
): ChapterIndexEntry[] {
  const chapters: ChapterIndexEntry[] = [];
  let currentVolumeTitle: string | undefined;

  // Find candidate elements: links to episodes and volume header h3s
  // Kakuyomu renders the TOC as a flat sequence where h3 marks volume boundaries
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
    if (!idMatch) return;

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
```

- [ ] **Step 4: Run all tests**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.ts src/server/adapters/spider/kakuyomu-spider-adapter.test.ts
git commit -m "feat: add kakuyomu fetchChapterIndex HTML fallback path"
```

---

## Task 7: Implement fetchChapter

**Files:**
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.ts`
- Modify: `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`

- [ ] **Step 1: Add test cases for fetchChapter**

Append to test file:

```typescript
test('KakuyomuSpiderAdapter parses chapter content from episode page', async () => {
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [CHAPTER_1_URL]: CHAPTER_1_HTML,
        [CHAPTER_2_URL]: CHAPTER_2_HTML,
      },
      requests,
    ),
  });

  const chapter1 = await adapter.fetchChapter(
    { novelId: '822139839856110454' },
    {
      id: '822139839856134658',
      index: 1,
      title: '第1話　路地裏で目覚めて(1)',
      url: CHAPTER_1_URL,
    },
  );

  assert.deepEqual(chapter1, {
    chapterId: '822139839856134658',
    index: 1,
    title: '第1話　路地裏で目覚めて(1)',
    url: CHAPTER_1_URL,
    content: '「なぁ、聞いたか？　魔法少女ラピスの噂」\n\n暗い会議室に、囁くような声。\n\n「そうだ。裏切ってコチラ側に来たらしい。」',
  });

  const chapter2 = await adapter.fetchChapter(
    { novelId: '822139839856110454' },
    {
      id: '822139839876728241',
      index: 2,
      title: '第2話　路地裏で目覚めて(2)',
      url: CHAPTER_2_URL,
    },
  );

  assert.equal(chapter2.title, '第2話　路地裏で目覚めて(2)');
  assert.equal(chapter2.content, '二章の一段落目。\n\n二章の二段落目。');
});

test('KakuyomuSpiderAdapter throws when episode body is missing', async () => {
  const emptyUrl = 'https://kakuyomu.jp/works/822139839856110454/episodes/000000000000000000';
  const requests: SpiderHtmlRequest[] = [];
  const adapter = new KakuyomuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [emptyUrl]: '<html><body><p>no episode body here</p></body></html>',
      },
      requests,
    ),
  });

  await assert.rejects(
    adapter.fetchChapter(
      { novelId: '822139839856110454' },
      { id: '000000000000000000', index: 1, title: 'Empty', url: emptyUrl },
    ),
    /No chapter content found/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: Both fetchChapter tests FAIL — "Not implemented"

- [ ] **Step 3: Implement fetchChapter**

Replace `fetchChapter` in adapter:

```typescript
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
```

The `readText` helper already exists from Task 4. Ensure it's imported/available.

- [ ] **Step 4: Run all tests**

Run: `npx tsx --test src/server/adapters/spider/kakuyomu-spider-adapter.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/adapters/spider/kakuyomu-spider-adapter.ts src/server/adapters/spider/kakuyomu-spider-adapter.test.ts
git commit -m "feat: implement kakuyomu fetchChapter content extraction"
```

---

## Task 8: Register Kakuyomu adapter in ControlCenterService

**Files:**
- Modify: `src/server/core/control-center.ts`
- Modify: `src/server/core/control-center.test.ts`

- [ ] **Step 1: Update createDefaultSpiderRegistry**

Add the import at the top of `control-center.ts`:

```typescript
import { KakuyomuSpiderAdapter } from '../adapters/spider/kakuyomu-spider-adapter';
```

Add the kakuyomu entry to `createDefaultSpiderRegistry` return array, after the syosetu18 entry:

```typescript
    {
      descriptor: {
        sourceId: 'kakuyomu',
        label: 'カクヨム',
        description: 'KADOKAWA 旗下的 Web 小说平台。请输入作品 ID（19 位数字），例如 822139839856110454。',
        defaultNovelId: '822139839856110454',
      },
      spider: new KakuyomuSpiderAdapter({ fetchHtml }),
    },
```

- [ ] **Step 2: Update control-center test to expect kakuyomu**

Add `'kakuyomu'` to both expected arrays in the `createDefaultSpiderRegistry exposes only user-facing real sources` test:

```typescript
    assert.deepEqual(
      registry.map((entry) => entry.descriptor.sourceId),
      ['syosetu', 'syosetu18', 'kakuyomu'],
    );
    assert.deepEqual(
      registry.map((entry) => entry.descriptor.label),
      ['小説家になろう（全年龄）', 'ノクターンノベルズ（成人向）', 'カクヨム'],
    );
```

- [ ] **Step 3: Run typecheck and all server tests**

Run: `npx tsx --test src/server/core/control-center.test.ts`
Expected: Registry test PASS (includes kakuyomu)

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: No errors

- [ ] **Step 4: Run the full server test suite**

Run: `npm run test:server`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/core/control-center.ts src/server/core/control-center.test.ts
git commit -m "feat: register kakuyomu spider adapter in control center"
```

---

## Task 9: Build verification

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: No errors

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds without errors

- [ ] **Step 3: Run all tests (server + web + ci)**

Run: `npm run test:server`
Run: `npm run test:web`
Run: `npm run test:ci`
Expected: All pass

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] `fetchMetadata` with __NEXT_DATA__ → Task 3
   - [x] `fetchMetadata` HTML fallback → Task 4
   - [x] `fetchChapterIndex` with Apollo State → Task 5
   - [x] `fetchChapterIndex` HTML fallback → Task 6
   - [x] `fetchChapter` HTML extraction → Task 7
   - [x] Registry registration → Task 8
   - [x] Tests with realistic fixtures → Tasks 1, 3-7
   - [x] Build verification → Task 9

2. **Placeholder scan:** No TBD/TODO. All functions have complete implementations.

3. **Type consistency:**
   - `extractNextDataState` returns `Record<string, unknown> | undefined` — consistent across Tasks 3, 5
   - `readText` defined in Task 4, reused in Task 7 — consistent
   - `ChapterIndexEntry` interface from `spider.ts` — all fields matched
   - URL construction `https://kakuyomu.jp/works/${novelId}/episodes/${episodeId}` — consistent across Tasks 5, 6, 7
   - `SpiderHtmlFetcher` / `SpiderHtmlRequest` exported from adapter file — consistent with Syosetu18 pattern
