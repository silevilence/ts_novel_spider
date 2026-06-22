import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';

import {
  closeServer,
  createLibraryServer,
  waitForServerListening,
} from './library-test-helpers';

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