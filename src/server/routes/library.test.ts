import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';
import { MockHtmlSpiderAdapter } from '../adapters/spider/mock-html-spider-adapter';
import type { SpiderRegistryEntry } from '../core/control-center';

import {
  closeServer,
  createLibraryServer,
  waitForServerListening,
} from './library-test-helpers';

function createSyosetuMockRegistry(input: { metadataHtml: string; chapterHtml: string }): SpiderRegistryEntry[] {
  return [{
    descriptor: { sourceId: 'syosetu', label: '测试来源', description: '测试用', defaultNovelId: 'n1000lib' },
    spider: new MockHtmlSpiderAdapter({
      metadataHtml: input.metadataHtml,
      catalogHtml: '<ol data-testid="catalog"><li data-chapter-id="chapter-1" data-volume="第一卷"><a href="/n1000lib/1">第一章</a></li></ol>',
      chapterHtmlById: { 'chapter-1': input.chapterHtml },
    }),
  }];
}

test('library routes expose stored novels, detail stats and chapter reading data', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const listResponse = await fetch(`${baseUrl}/api/library/novels`);
    const listPayload = await listResponse.json() as {
      novels: Array<{ metadata: { title: string }; downloadedChapters: number; indexedChapters: number }>;
    };

    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.novels.length, 1);
    assert.equal(listPayload.novels[0]?.metadata.title, '离线书库样例');
    assert.equal(listPayload.novels[0]?.downloadedChapters, 2);
    assert.equal(listPayload.novels[0]?.indexedChapters, 1);

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = await detailResponse.json() as {
      novel: {
        aliases: unknown[];
        bookmarks: unknown[];
        readingProgress: unknown;
        stats: { total: number; downloaded: number; pending: number };
        media: { total: number; pending: number };
        chapters: Array<{ id: string; hasContent: boolean; media: { total: number } }>;
      };
      knowledgeGraph: {
        build: { status: string };
      };
    };

    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.novel.stats.total, 3);
    assert.equal(detailPayload.novel.stats.downloaded, 2);
    assert.equal(detailPayload.novel.stats.pending, 1);
    assert.equal(detailPayload.novel.media.total, 1);
    assert.equal(detailPayload.novel.media.pending, 1);
    assert.equal(detailPayload.novel.chapters[0]?.media.total, 1);
    assert.equal(detailPayload.novel.chapters[2]?.hasContent, false);
    assert.equal(detailPayload.knowledgeGraph.build.status, 'idle');
    assert.deepEqual(detailPayload.novel.aliases, []);
    assert.equal(detailPayload.novel.readingProgress, null);
    assert.deepEqual(detailPayload.novel.bookmarks, []);

    const chapterResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1`);
    const chapterPayload = await chapterResponse.json() as {
      chapter: {
        previousChapterId: string | null;
        nextChapterId: string | null;
        chapter: { content: string; title: string };
        mediaAssets: Array<{ sourceUrl: string; cached: boolean }>;
      };
    };

    assert.equal(chapterResponse.status, 200);
    assert.equal(chapterPayload.chapter.previousChapterId, null);
    assert.equal(chapterPayload.chapter.nextChapterId, 'chapter-2');
    assert.equal(chapterPayload.chapter.chapter.title, '第一章');
    assert.match(chapterPayload.chapter.chapter.content, /艾琳和莱昂在晨雾城相遇/);
    assert.equal(chapterPayload.chapter.mediaAssets[0]?.cached, false);
    assert.equal(chapterPayload.chapter.mediaAssets[0]?.sourceUrl, 'https://cdn.example.com/cover/chapter-1.png');
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library routes support advanced search, aliases, progress watermark and bookmarks', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const aliasCreateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias: '样例别名' }),
    });
    const aliasCreatePayload = await aliasCreateResponse.json() as {
      alias: { id: string; alias: string };
    };

    assert.equal(aliasCreateResponse.status, 201);
    assert.equal(aliasCreatePayload.alias.alias, '样例别名');

    const searchByAliasResponse = await fetch(`${baseUrl}/api/library/novels?q=alias:%E6%A0%B7%E4%BE%8B%E5%88%AB%E5%90%8D`);
    const searchByAliasPayload = await searchByAliasResponse.json() as {
      novels: Array<{ metadata: { novelId: string } }>;
    };
    assert.equal(searchByAliasResponse.status, 200);
    assert.equal(searchByAliasPayload.novels.length, 1);
    assert.equal(searchByAliasPayload.novels[0]?.metadata.novelId, 'n1000lib');

    const searchByBooleanResponse = await fetch(`${baseUrl}/api/library/novels?q=name:%E7%A6%BB%E7%BA%BF+tag:%E4%B9%A6%E5%BA%93+-site:other`);
    const searchByBooleanPayload = await searchByBooleanResponse.json() as {
      novels: Array<{ metadata: { novelId: string } }>;
    };
    assert.equal(searchByBooleanResponse.status, 200);
    assert.equal(searchByBooleanPayload.novels.length, 1);

    const bookmarkCreateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/bookmarks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapterId: 'chapter-1', note: '这里开始进入主线。' }),
    });
    const bookmarkCreatePayload = await bookmarkCreateResponse.json() as {
      bookmark: { id: string; note: string; chapterId: string };
    };
    assert.equal(bookmarkCreateResponse.status, 201);
    assert.equal(bookmarkCreatePayload.bookmark.chapterId, 'chapter-1');

    const progressChapter2Response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/progress`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapterId: 'chapter-2' }),
    });
    const progressChapter2Payload = await progressChapter2Response.json() as {
      progress: { currentChapterId: string; highestChapterId: string; highestChapterIndex: number };
    };
    assert.equal(progressChapter2Response.status, 200);
    assert.equal(progressChapter2Payload.progress.currentChapterId, 'chapter-2');
    assert.equal(progressChapter2Payload.progress.highestChapterId, 'chapter-2');
    assert.equal(progressChapter2Payload.progress.highestChapterIndex, 2);

    const progressChapter1Response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/progress`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapterId: 'chapter-1' }),
    });
    const progressChapter1Payload = await progressChapter1Response.json() as {
      progress: { currentChapterId: string; highestChapterId: string; highestChapterIndex: number };
    };
    assert.equal(progressChapter1Response.status, 200);
    assert.equal(progressChapter1Payload.progress.currentChapterId, 'chapter-1');
    assert.equal(progressChapter1Payload.progress.highestChapterId, 'chapter-2');
    assert.equal(progressChapter1Payload.progress.highestChapterIndex, 2);

    const bookmarkUpdateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/bookmarks/${bookmarkCreatePayload.bookmark.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: '已更新备注。' }),
    });
    const bookmarkUpdatePayload = await bookmarkUpdateResponse.json() as {
      bookmark: { note: string };
    };
    assert.equal(bookmarkUpdateResponse.status, 200);
    assert.equal(bookmarkUpdatePayload.bookmark.note, '已更新备注。');

    const aliasUpdateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases/${aliasCreatePayload.alias.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias: '更新后的别名' }),
    });
    const aliasUpdatePayload = await aliasUpdateResponse.json() as {
      alias: { alias: string };
    };
    assert.equal(aliasUpdateResponse.status, 200);
    assert.equal(aliasUpdatePayload.alias.alias, '更新后的别名');

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = await detailResponse.json() as {
      novel: {
        aliases: Array<{ alias: string }>;
        readingProgress: { currentChapterId: string; highestChapterId: string } | null;
        bookmarks: Array<{ id: string; note: string }>;
      };
    };
    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.novel.aliases[0]?.alias, '更新后的别名');
    assert.equal(detailPayload.novel.readingProgress?.currentChapterId, 'chapter-1');
    assert.equal(detailPayload.novel.readingProgress?.highestChapterId, 'chapter-2');
    assert.equal(detailPayload.novel.bookmarks[0]?.note, '已更新备注。');

    const bookmarkDeleteResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/bookmarks/${bookmarkCreatePayload.bookmark.id}`, {
      method: 'DELETE',
    });
    assert.equal(bookmarkDeleteResponse.status, 204);

    const aliasDeleteResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases/${aliasCreatePayload.alias.id}`, {
      method: 'DELETE',
    });
    assert.equal(aliasDeleteResponse.status, 204);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library routes cache all pending media assets for a stored novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const cacheResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, {
      method: 'POST',
    });
    const cachePayload = await cacheResponse.json() as {
      result: { total: number; cached: number; skipped: number };
    };

    assert.equal(cacheResponse.status, 200);
    assert.deepEqual(cachePayload.result, { total: 1, cached: 1, skipped: 0 });

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = await detailResponse.json() as {
      novel: {
        media: { total: number; cached: number; pending: number };
      };
    };

    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailPayload.novel.media, { total: 1, cached: 1, pending: 0 });
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library scheduling routes expose auto summary settings and summary flag', async () => {
  const { app, cleanup } = createLibraryServer({
    beforeControlCenter: (repository) => {
      repository.upsertScheduledNovel(
        'syosetu',
        'n1000lib',
        true,
        true,
        true,
        { providerId: 'provider-chat', modelId: 'model-summary' },
      );
      repository.updateScheduledNovelCheckResult('syosetu', 'n1000lib', 'new_chapters', '发现 1 个新章节');
      repository.createScheduledSummary({
        runId: 'run-1',
        sourceId: 'syosetu',
        novelId: 'n1000lib',
        chapterIds: ['chapter-2'],
        summary: '第二章：联手调查黑塔。',
        providerId: 'provider-chat',
        modelId: 'model-summary',
      });
    },
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const listResponse = await fetch(`${baseUrl}/api/library/scheduling/novels`);
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      novels: Array<{
        novelId: string;
        enabled: boolean;
        autoTranslate: boolean;
        autoSummarize: boolean;
        summarizeModel: { providerId: string; modelId: string } | null;
        lastCheckResult: string | null;
        lastCheckMessage: string | null;
        hasSummary: boolean;
      }>;
    };

    const target = listPayload.novels.find((novel) => novel.novelId === 'n1000lib');
    assert.ok(target);
    assert.equal(target.autoTranslate, true);
    assert.equal(target.autoSummarize, true);
    assert.deepEqual(target.summarizeModel, { providerId: 'provider-chat', modelId: 'model-summary' });
    assert.equal(target.lastCheckResult, 'new_chapters');
    assert.equal(target.lastCheckMessage, '发现 1 个新章节');
    assert.equal(target.hasSummary, true);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library routes export markdown, txt and epub packages for a stored novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const markdownResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/exports/markdown/download`);
    assert.equal(markdownResponse.status, 200);
    assert.match(markdownResponse.headers.get('content-type') ?? '', /application\/zip/);
    assert.match(markdownResponse.headers.get('content-disposition') ?? '', /n1000lib/);
    const markdownZip = await JSZip.loadAsync(Buffer.from(await markdownResponse.arrayBuffer()));
    const markdownEntryName = Object.keys(markdownZip.files).find((entry) => entry.endsWith('.md'));
    assert.ok(markdownEntryName);
    const markdown = await markdownZip.file(markdownEntryName!)?.async('string');
    assert.match(markdown ?? '', /^# 离线书库样例/m);
    assert.match(markdown ?? '', /## 第1卷/m);
    assert.match(markdown ?? '', /### 第1章 第一章/m);
    assert.match(markdown ?? '', /!\[插图\]\(https:\/\/cdn\.example\.com\/cover\/chapter-1\.png\)/);

    const textResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/exports/txt/download`);
    assert.equal(textResponse.status, 200);
    assert.match(textResponse.headers.get('content-type') ?? '', /text\/plain/);
    const text = await textResponse.text();
    assert.match(text, /^离线书库样例/m);
    assert.match(text, /第1章 第一章/);
    assert.match(text, /第1章 第一章\n艾琳和莱昂在晨雾城相遇/);
    assert.doesNotMatch(text, /第1章 第一章\n\n艾琳和莱昂在晨雾城相遇/);
    assert.doesNotMatch(text, /第一卷/);

    const epubResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/exports/epub/download`);
    assert.equal(epubResponse.status, 200);
    assert.match(epubResponse.headers.get('content-type') ?? '', /application\/epub\+zip/);
    const epubZip = await JSZip.loadAsync(Buffer.from(await epubResponse.arrayBuffer()));
    assert.equal(await epubZip.file('mimetype')?.async('string'), 'application/epub+zip');
    const nav = await epubZip.file('OEBPS/nav.xhtml')?.async('string');
    assert.match(nav ?? '', /<a href="volume-0001\.xhtml">第1卷<\/a>/);
    assert.match(nav ?? '', /第1章 第一章/);
    const intro = await epubZip.file('OEBPS/intro.xhtml')?.async('string');
    assert.match(intro ?? '', /离线书库样例/);
    const volume1 = await epubZip.file('OEBPS/volume-0001.xhtml')?.async('string');
    assert.match(volume1 ?? '', /第1卷/);
    assert.match(volume1 ?? '', /chapter-0001.xhtml/);
    const chapter1 = await epubZip.file('OEBPS/chapter-0001.xhtml')?.async('string');
    assert.match(chapter1 ?? '', /第1章 第一章/);
    assert.match(chapter1 ?? '', /第1卷/);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library reader typography routes resolve global defaults and novel override lifecycle', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    // — GET 应返回全局默认
    const getResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/reader-typography`);
    assert.equal(getResponse.status, 200);
    const getPayload = (await getResponse.json()) as { typography: { source: string; fontSize: number } };
    assert.equal(getPayload.typography.source, 'global');
    assert.ok(getPayload.typography.fontSize > 0);

    // — PUT 单书覆盖
    const putResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/reader-typography`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fontSize: 1.2,
        fontSizePreset: 'large',
        lineHeight: 2.4,
        paragraphSpacing: 1.2,
        fontFamilyPreset: 'serif',
      }),
    });
    assert.equal(putResponse.status, 200);
    const putPayload = (await putResponse.json()) as { typography: { source: string; fontSize: number } };
    assert.equal(putPayload.typography.source, 'novel');
    assert.equal(putPayload.typography.fontSize, 1.2);

    // — GET 应返回单书覆盖
    const getAgainResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/reader-typography`);
    const getAgainPayload = (await getAgainResponse.json()) as { typography: { source: string } };
    assert.equal(getAgainPayload.typography.source, 'novel');

    // — DELETE 恢复全局
    const deleteResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/reader-typography`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 200);
    const deletePayload = (await deleteResponse.json()) as { typography: { source: string } };
    assert.equal(deletePayload.typography.source, 'global');
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS visibility API — GET returns 404 for missing novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/api/library/novels/syosetu/missing/opds`);
    assert.equal(response.status, 404);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS visibility API — PUT updates visibility', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/opds`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visible: true }),
    });
    assert.equal(response.status, 200);

    const payload = await response.json() as { opdsVisible: boolean };
    assert.equal(payload.opdsVisible, true);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS visibility API — GET returns all novels with opds state', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/api/library/opds/novels`);
    assert.equal(response.status, 200);

    const payload = await response.json() as { novels: Array<{ novelId: string }> };
    assert.ok(Array.isArray(payload.novels));
    assert.ok(payload.novels.some((n) => n.novelId === 'n1000lib'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS visibility API — PUT bulk updates visibility', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/api/library/opds/novels`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novels: [{ sourceId: 'syosetu', novelId: 'n1000lib', visible: true }] }),
    });
    assert.equal(response.status, 200);

    const payload = await response.json() as { ok: boolean };
    assert.equal(payload.ok, true);

    const row = repository.getOpdsNovel('syosetu', 'n1000lib');
    assert.equal(row?.opdsVisible, true);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('browser-captured novels keep remote media uncached in v1', async () => {
  const { app, cleanup } = createLibraryServer({
    beforeControlCenter: (repository) => repository.markNovelCaptureTransport('syosetu', 'n1000lib', 'browser'),
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const cacheResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, {
      method: 'POST',
    });
    const payload = await cacheResponse.json() as { message: string };

    assert.equal(cacheResponse.status, 502);
    assert.match(payload.message, /浏览器采集小说.*不支持缓存远端媒体/);
    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detail = await detailResponse.json() as { novel: { media: { cached: number; pending: number } } };
    assert.deepEqual(detail.novel.media, { total: 1, cached: 0, pending: 1 });
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('manual novel routes create, save versioned Markdown chapters and refuse scheduling', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const created = await fetch(`${baseUrl}/api/library/manual-novels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '我的手动小说' }) });
    assert.equal(created.status, 201);
    const novel = (await created.json() as { novel: { sourceId: string; metadata: { novelId: string } } }).novel;
    assert.equal(novel.sourceId, 'manual');
    const emptyMetadataHistory = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/versions/metadata`);
    assert.deepEqual((await emptyMetadataHistory.json() as { versions: Array<{ version: number }> }).versions, []);
    const blankChapterResponse = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/chapters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '空正文第一章', content: '' }) });
    assert.equal(blankChapterResponse.status, 201);
    const blankChapterId = ((await blankChapterResponse.json()) as { chapter: { chapter: { id: string } } }).chapter.chapter.id;
    const blankChapterVersions = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/chapters/${blankChapterId}/versions`);
    assert.deepEqual((await blankChapterVersions.json() as { versions: Array<{ version: number }> }).versions, []);
    const firstContentSave = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/chapters/${blankChapterId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '空正文第一章', content: '首次填写正文。' }) });
    assert.equal(firstContentSave.status, 200);
    const firstContentVersions = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/chapters/${blankChapterId}/versions`);
    assert.equal((await firstContentVersions.json() as { versions: Array<{ version: number }> }).versions[0]?.version, 0);
    const chapterResponse = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/chapters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '第一章', content: '# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |' }) });
    assert.equal(chapterResponse.status, 201);
    const chapter = (await chapterResponse.json() as { chapter: { chapter: { id: string } } }).chapter;
    const versions = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/chapters/${chapter.chapter.id}/versions`);
    assert.equal((await versions.json() as { versions: Array<{ version: number }> }).versions[0]?.version, 0);
    const scheduling = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/scheduling`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.equal(scheduling.status, 400);
    const metadata = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/metadata`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '我的手动小说', author: '', description: '', tags: ['alpha', 'beta'] }) });
    assert.equal((await metadata.json() as { changed: boolean }).changed, true);
    const metadataHistory = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/versions/metadata`);
    assert.equal((await metadataHistory.json() as { versions: Array<{ version: number }> }).versions[0]?.version, 0);
    const reorderedTags = await fetch(`${baseUrl}/api/library/novels/manual/${novel.metadata.novelId}/metadata`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '我的手动小说', author: '', description: '', tags: ['beta', 'alpha'] }) });
    assert.equal((await reorderedTags.json() as { changed: boolean }).changed, false);
    const schedulingList = await fetch(`${baseUrl}/api/library/scheduling/novels`);
    const schedulingPayload = await schedulingList.json() as { novels: Array<{ sourceId: string; novelId: string }> };
    assert.ok(!schedulingPayload.novels.some((entry) => entry.sourceId === 'manual' && entry.novelId === novel.metadata.novelId));
    const bulkScheduling = await fetch(`${baseUrl}/api/library/scheduling/novels`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novels: [{ sourceId: 'manual', novelId: novel.metadata.novelId, enabled: true }] }) });
    assert.equal(bulkScheduling.status, 400);
  } finally { await closeServer(server); cleanup(); }
});

test('library trash blocks mutations, restores distribution state, and purges after retention', async () => {
  const { app, cleanup, repository } = createLibraryServer({
    beforeControlCenter: (repo) => {
      repo.upsertScheduledNovel('syosetu', 'n1000lib', true, true, false);
      repo.updateOpdsVisible('syosetu', 'n1000lib', true);
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    assert.equal((await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/trash`, { method: 'POST' })).status, 204);
    assert.equal((await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alias: '不应写入' }) })).status, 409);
    assert.equal((await fetch(`${baseUrl}/api/library/trash`)).status, 200);
    assert.equal(repository.getScheduledNovel('syosetu', 'n1000lib'), undefined);
    assert.equal(repository.getOpdsNovel('syosetu', 'n1000lib')?.opdsVisible, false);
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    assert.ok(!repository.listVisibleOpdsNovels().some((novel) => novel.sourceId === 'syosetu' && novel.novelId === 'n1000lib'));
    assert.equal((await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/restore`, { method: 'POST' })).status, 204);
    assert.equal(repository.getScheduledNovel('syosetu', 'n1000lib')?.enabled, true);
    assert.equal(repository.getOpdsNovel('syosetu', 'n1000lib')?.opdsVisible, true);

    await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/trash`, { method: 'POST' });
    const deletedAt = repository.getNovelPurgeStatus('syosetu', 'n1000lib')?.deletedAt;
    assert.ok(deletedAt);
    const originalNow = Date.now;
    Date.now = () => Date.parse(deletedAt!) + 16 * 24 * 60 * 60 * 1000;
    try {
      assert.equal((await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/purge`, { method: 'DELETE' })).status, 204);
    } finally {
      Date.now = originalNow;
    }
    assert.equal(repository.getSnapshot('syosetu', 'n1000lib'), null);
    assert.equal(repository.getChapter('syosetu', 'n1000lib', 'chapter-1'), null);
  } finally { await closeServer(server); cleanup(); }
});

test('metadata sync previews remote differences and writes only selected fields', async () => {
  const { app, cleanup } = createLibraryServer({
    spiders: createSyosetuMockRegistry({
      metadataHtml: '<article><h1 data-testid="title">远端新标题</h1><div data-testid="author">远端作者</div><div data-testid="description">远端简介</div><ul data-testid="tags"><li>书库</li><li>新标签</li></ul><div data-testid="chapter-count">3</div></article>',
      chapterHtml: '<article><h1 data-testid="chapter-title">第一章</h1><section data-testid="content"><p>艾琳和莱昂在晨雾城相遇。艾琳决定帮助莱昂寻找失踪的星图。</p><p>![插图](https://cdn.example.com/cover/chapter-1.png)</p></section></article>',
    }),
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const previewResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/metadata-sync`, { method: 'POST' });
    const preview = await previewResponse.json() as { changedFields: string[] };
    assert.equal(previewResponse.status, 200);
    assert.deepEqual(preview.changedFields, ['title', 'author', 'description', 'tags']);
    const applyResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/metadata-sync`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '远端新标题', tags: ['书库', '新标签'] }) });
    const applied = await applyResponse.json() as { novel: { metadata: { title: string; author: string; tags: string[] } } };
    assert.equal(applyResponse.status, 200);
    assert.equal(applied.novel.metadata.title, '远端新标题');
    assert.equal(applied.novel.metadata.author, '测试作者');
    assert.deepEqual(applied.novel.metadata.tags, ['书库', '新标签']);
  } finally { await closeServer(server); cleanup(); }
});

test('chapter refetch avoids unchanged writes and versions changed remote content', async () => {
  const { app, cleanup } = createLibraryServer({
    spiders: createSyosetuMockRegistry({
      metadataHtml: '<article><h1 data-testid="title">离线书库样例</h1><div data-testid="author">测试作者</div><div data-testid="description">用于验证书库路由与阅读器。</div><ul data-testid="tags"><li>离线</li><li>书库</li></ul><div data-testid="chapter-count">3</div></article>',
      chapterHtml: '<article><h1 data-testid="chapter-title">远端第一章</h1><section data-testid="content"><p>新的远端正文。</p></section></article>',
    }),
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const changedResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1/refetch`, { method: 'POST' });
    const changed = await changedResponse.json() as { changed: boolean; chapter: { chapter: { title: string; content: string } } };
    assert.equal(changedResponse.status, 200);
    assert.equal(changed.changed, true);
    assert.equal(changed.chapter.chapter.title, '远端第一章');
    assert.equal(changed.chapter.chapter.content, '新的远端正文。');
    const unchanged = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1/refetch`, { method: 'POST' });
    assert.equal((await unchanged.json() as { changed: boolean }).changed, false);
    const versions = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1/versions`);
    assert.deepEqual((await versions.json() as { versions: Array<{ version: number }> }).versions.map((version) => version.version), [1, 0]);
  } finally { await closeServer(server); cleanup(); }
});

test('manual novel routes manage volumes and restore metadata and chapter snapshots', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const novel = (await (await fetch(`${baseUrl}/api/library/manual-novels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '初版标题' }) })).json() as { novel: { metadata: { novelId: string } } }).novel;
    const id = novel.metadata.novelId;
    assert.equal((await fetch(`${baseUrl}/api/library/novels/manual/${id}/volumes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '第一卷' }) })).status, 201);
    const createdChapter = await fetch(`${baseUrl}/api/library/novels/manual/${id}/chapters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '第一章', volumeTitle: '第一卷', content: 'v0' }) });
    const chapterId = ((await createdChapter.json()) as { chapter: { chapter: { id: string } } }).chapter.chapter.id;
    await fetch(`${baseUrl}/api/library/novels/manual/${id}/chapters/${chapterId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '第一章', volumeTitle: '第一卷', content: 'v1' }) });
    const restored = await fetch(`${baseUrl}/api/library/novels/manual/${id}/chapters/${chapterId}/versions/0/restore`, { method: 'POST' });
    assert.equal(restored.status, 200);
    assert.equal(((await restored.json()) as { chapter: { chapter: { content: string } } }).chapter.chapter.content, 'v0');
    await fetch(`${baseUrl}/api/library/novels/manual/${id}/metadata`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '首个保存标题', author: '', description: '', tags: [] }) });
    await fetch(`${baseUrl}/api/library/novels/manual/${id}/metadata`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '新标题', author: '', description: '', tags: [] }) });
    const metadataRestore = await fetch(`${baseUrl}/api/library/novels/manual/${id}/versions/metadata/0/restore`, { method: 'POST' });
    assert.equal(((await metadataRestore.json()) as { novel: { metadata: { title: string } } }).novel.metadata.title, '首个保存标题');
    const deletedVolume = await fetch(`${baseUrl}/api/library/novels/manual/${id}/volumes/${encodeURIComponent('第一卷')}`, { method: 'DELETE' });
    assert.equal(((await deletedVolume.json()) as { deletedChapters: number }).deletedChapters, 1);
  } finally { await closeServer(server); cleanup(); }
});

test('manual chapter assets are stored atomically and exposed through the regular media pipeline', async () => {
  const { app, cleanup } = createLibraryServer(); const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const novelId = ((await (await fetch(`${baseUrl}/api/library/manual-novels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '素材小说' }) })).json()) as { novel: { metadata: { novelId: string } } }).novel.metadata.novelId;
    const assetId = '11111111-1111-4111-8111-111111111111';
    const response = await fetch(`${baseUrl}/api/library/novels/manual/${novelId}/chapters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '插图章', content: `![图](manual://${assetId})`, assets: [{ id: assetId, mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==' }] }) });
    assert.equal(response.status, 201);
    const chapter = ((await response.json()) as { chapter: { mediaAssets: Array<{ cached: boolean; publicUrl: string | null }> } }).chapter;
    assert.equal(chapter.mediaAssets[0]?.cached, true);
    assert.equal((await fetch(`${baseUrl}${chapter.mediaAssets[0]?.publicUrl ?? ''}`)).status, 200);
  } finally { await closeServer(server); cleanup(); }
});

test('manual chapter save accepts JSON payloads larger than the Express default limit', async () => {
  const { app, cleanup } = createLibraryServer(); const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const novelId = ((await (await fetch(`${baseUrl}/api/library/manual-novels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '大正文小说' }) })).json()) as { novel: { metadata: { novelId: string } } }).novel.metadata.novelId;
    const response = await fetch(`${baseUrl}/api/library/novels/manual/${novelId}/chapters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '大正文第一章', content: '图'.repeat(110_000) }),
    });
    assert.equal(response.status, 201);
  } finally { await closeServer(server); cleanup(); }
});
