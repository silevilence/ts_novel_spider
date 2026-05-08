import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createServerApp } from '../app';
import { ControlCenterService } from '../core/control-center';
import { SqliteNovelRepository } from '../core/novel-repository';

function createLibraryServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-library-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  const controlCenter = new ControlCenterService({
    repository,
    spiders: [],
    offlineAssetStoragePath: path.join(tempDir, 'assets'),
  });

  repository.saveMetadata('syosetu', {
    novelId: 'n1000lib',
    title: '离线书库样例',
    author: '测试作者',
    description: '用于验证书库路由与阅读器。',
    tags: ['离线', '书库'],
    chapterCount: 3,
    infoPageUrl: 'https://example.com/n1000lib',
  });
  repository.saveChapterIndex('syosetu', 'n1000lib', [
    {
      id: 'chapter-1',
      index: 1,
      title: '第一章',
      volumeTitle: '第一卷',
      url: 'https://example.com/n1000lib/1',
    },
    {
      id: 'chapter-2',
      index: 2,
      title: '第二章',
      volumeTitle: '第一卷',
      url: 'https://example.com/n1000lib/2',
    },
    {
      id: 'chapter-3',
      index: 3,
      title: '第三章',
      volumeTitle: '第二卷',
      url: 'https://example.com/n1000lib/3',
    },
  ]);
  repository.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'chapter-1',
    index: 1,
    title: '第一章',
    volumeTitle: '第一卷',
    url: 'https://example.com/n1000lib/1',
    content: '第一段。\n\n插图 https://cdn.example.com/cover/chapter-1.png',
  });
  repository.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'chapter-2',
    index: 2,
    title: '第二章',
    volumeTitle: '第一卷',
    url: 'https://example.com/n1000lib/2',
    content: '第二章正文。',
  });

  const app = createServerApp({ controlCenter });

  return {
    app,
    cleanup: () => {
      controlCenter.close();
      repository.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('library routes expose stored novels, detail stats and chapter reading data', async () => {
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

    const listResponse = await fetch(`${baseUrl}/api/library/novels`);
    const listPayload = (await listResponse.json()) as {
      novels: Array<{ metadata: { title: string }; downloadedChapters: number; indexedChapters: number }>;
    };

    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.novels.length, 1);
    assert.equal(listPayload.novels[0]?.metadata.title, '离线书库样例');
    assert.equal(listPayload.novels[0]?.downloadedChapters, 2);
    assert.equal(listPayload.novels[0]?.indexedChapters, 1);

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = (await detailResponse.json()) as {
      novel: {
        stats: { total: number; downloaded: number; pending: number };
        media: { total: number; pending: number };
        chapters: Array<{ id: string; hasContent: boolean; media: { total: number } }>;
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

    const chapterResponse = await fetch(
      `${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1`,
    );
    const chapterPayload = (await chapterResponse.json()) as {
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
    assert.match(chapterPayload.chapter.chapter.content, /第一段/);
    assert.equal(chapterPayload.chapter.mediaAssets[0]?.cached, false);
    assert.equal(
      chapterPayload.chapter.mediaAssets[0]?.sourceUrl,
      'https://cdn.example.com/cover/chapter-1.png',
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});