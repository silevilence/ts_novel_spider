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

test('KakuyomuSpiderAdapter parses chapter index without volumes', async () => {
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
    description: 'ブラック企業から逃げ出した社畜男が、\\n気づいたら路地裏で少女になっていた。',
    tags: ['TS', '魔法少女', 'ガールズラブ'],
    chapterCount: 3,
    infoPageUrl: WORKS_URL,
  });
});

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
