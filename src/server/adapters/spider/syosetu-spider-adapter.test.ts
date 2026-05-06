import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Syosetu18SpiderAdapter,
  type SpiderHtmlFetcher,
  type SpiderHtmlRequest,
} from './syosetu-18-spider-adapter';
import { SyosetuSpiderAdapter } from './syosetu-spider-adapter';

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

test('Syosetu18SpiderAdapter parses metadata, catalog and chapter content', async () => {
  const infoUrl = 'https://novel18.syosetu.com/novelview/infotop/ncode/n7777aa/';
  const catalogUrl = 'https://novel18.syosetu.com/n7777aa/';
  const chapter1Url = 'https://novel18.syosetu.com/n7777aa/1/';
  const chapter2Url = 'https://novel18.syosetu.com/n7777aa/2/';
  const requests: SpiderHtmlRequest[] = [];

  const adapter = new Syosetu18SpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [infoUrl]: `
          <article>
            <h1 class="p-infotop-title"><a href="${catalogUrl}">深夜の迷宮</a></h1>
            <div class="p-infotop-type__left">
              <span class="p-infotop-type__allep">全2エピソード</span>
              <a href="${chapter1Url}">1エピソード目を読む</a>
              <a href="${chapter2Url}">最新エピソードを読む</a>
            </div>
            <dl class="p-infotop-data">
              <dt class="p-infotop-data__title">作者名</dt>
              <dd class="p-infotop-data__value">夜狐</dd>
              <dt class="p-infotop-data__title">あらすじ</dt>
              <dd class="p-infotop-data__value">迷宮都市で生き延びる物語。</dd>
              <dt class="p-infotop-data__title">キーワード</dt>
              <dd class="p-infotop-data__value">ダンジョン 冒険 残酷描写あり</dd>
            </dl>
          </article>
        `,
        [catalogUrl]: `
          <div class="p-eplist">
            <div class="p-eplist__chapter-title">第一幕</div>
            <dl class="p-eplist__sublist">
              <dd class="p-eplist__subtitle"><a href="/n7777aa/1/">迷宮へ</a></dd>
            </dl>
            <div class="p-eplist__chapter-title">第二幕</div>
            <dl class="p-eplist__sublist">
              <dd class="p-eplist__subtitle"><a href="/n7777aa/2/">地下二層</a></dd>
            </dl>
          </div>
        `,
        [chapter1Url]: `
          <div class="c-announce"><span>第一幕</span></div>
          <article class="p-novel">
            <h1 class="p-novel__title">迷宮へ</h1>
            <p id="Lp1">前書きです。</p>
            <p id="L1">一段落目です。</p>
            <p id="L2">二段落目です。</p>
            <p id="La1">後書きです。</p>
          </article>
        `,
        [chapter2Url]: `
          <div class="c-announce"><span>第二幕</span></div>
          <article class="p-novel">
            <h1 class="p-novel__title">地下二層</h1>
            <p id="L1"><a href="https://cdn.example/full"><img src="//cdn.example/illust.jpg" alt="挿絵" /></a></p>
            <p id="L2">戦闘開始。</p>
          </article>
        `,
      },
      requests,
    ),
  });

  const metadata = await adapter.fetchMetadata({ novelId: 'N7777AA' });
  const chapters = await adapter.fetchChapterIndex({ novelId: 'N7777AA' }, metadata);
  const chapter1 = await adapter.fetchChapter({ novelId: 'N7777AA' }, chapters[0]!);
  const chapter2 = await adapter.fetchChapter({ novelId: 'N7777AA' }, chapters[1]!);

  assert.equal(adapter.sourceId, 'syosetu18');
  assert.deepEqual(metadata, {
    novelId: 'N7777AA',
    title: '深夜の迷宮',
    author: '夜狐',
    description: '迷宮都市で生き延びる物語。',
    tags: ['ダンジョン', '冒険', '残酷描写あり'],
    chapterCount: 2,
    infoPageUrl: infoUrl,
  });
  assert.deepEqual(chapters, [
    {
      id: '1',
      index: 1,
      title: '迷宮へ',
      volumeTitle: '第一幕',
      url: chapter1Url,
    },
    {
      id: '2',
      index: 2,
      title: '地下二層',
      volumeTitle: '第二幕',
      url: chapter2Url,
    },
  ]);
  assert.deepEqual(chapter1, {
    chapterId: '1',
    index: 1,
    title: '迷宮へ',
    volumeTitle: '第一幕',
    url: chapter1Url,
    content: '前書きです。\n\n一段落目です。\n\n二段落目です。\n\n後書きです。',
  });
  assert.deepEqual(chapter2, {
    chapterId: '2',
    index: 2,
    title: '地下二層',
    volumeTitle: '第二幕',
    url: chapter2Url,
    content: '![挿絵](https://cdn.example/illust.jpg)\n\n戦闘開始。',
  });
  assert.equal(requests[0]?.headers.Cookie, 'over18=yes');
});

test('SyosetuSpiderAdapter reuses parser and switches site endpoints', async () => {
  const infoUrl = 'https://ncode.syosetu.com/novelview/infotop/ncode/n2516ia/';
  const catalogUrl = 'https://ncode.syosetu.com/n2516ia/';
  const chapterUrl = 'https://ncode.syosetu.com/n2516ia/1/';
  const requests: SpiderHtmlRequest[] = [];

  const adapter = new SyosetuSpiderAdapter({
    fetchHtml: createFixtureFetch(
      {
        [infoUrl]: `
          <article>
            <h1 class="p-infotop-title"><a href="${catalogUrl}">街中ダンジョン</a></h1>
            <div class="p-infotop-type__left">
              <a href="${chapterUrl}">最新エピソードを読む</a>
            </div>
            <dl class="p-infotop-data">
              <dt>作者名</dt>
              <dd>昼熊</dd>
              <dt>あらすじ</dt>
              <dd>日常にダンジョンが現れた。</dd>
            </dl>
          </article>
        `,
        [catalogUrl]: `
          <div class="p-eplist">
            <dl class="p-eplist__sublist">
              <dd class="p-eplist__subtitle"><a href="/n2516ia/1/">一話</a></dd>
            </dl>
          </div>
        `,
        [chapterUrl]: `
          <article class="p-novel">
            <h1 class="p-novel__title">一話</h1>
            <p id="L1">ここから始まる。</p>
          </article>
        `,
      },
      requests,
    ),
  });

  const metadata = await adapter.fetchMetadata({ novelId: 'N2516IA' });
  const chapters = await adapter.fetchChapterIndex({ novelId: 'N2516IA' }, metadata);
  const chapter = await adapter.fetchChapter({ novelId: 'N2516IA' }, chapters[0]!);

  assert.equal(adapter.sourceId, 'syosetu');
  assert.equal(metadata.infoPageUrl, infoUrl);
  assert.equal(metadata.chapterCount, 1);
  assert.deepEqual(chapters, [
    {
      id: '1',
      index: 1,
      title: '一話',
      url: chapterUrl,
    },
  ]);
  assert.equal(chapter.content, 'ここから始まる。');
  assert.equal(requests[0]?.headers.Cookie, undefined);
});