import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MockHtmlSpiderAdapter } from '../adapters/spider/mock-html-spider-adapter';
import { SyosetuSpiderAdapter } from '../adapters/spider/syosetu-spider-adapter';
import { SqliteNovelRepository } from './novel-repository';
import { ControlCenterService, createDefaultSpiderRegistry, type ControlCenterStreamEvent } from './control-center';
import { NetworkProxyService } from './network-proxy';
import type { ChapterIndexEntry, NovelMetadata } from './spider';

function createMockSpiderRegistry() {
  return [
    {
      descriptor: {
        sourceId: 'mock-html',
        label: 'Mock HTML Demo',
        description: 'Test-only mock source',
        defaultNovelId: 'demo',
        transports: ['direct', 'browser'] as const,
      },
      spider: new MockHtmlSpiderAdapter({
        metadataHtml: `
          <article>
            <h1 data-testid="title">测试控制台小说</h1>
            <div data-testid="author">测试作者</div>
            <div data-testid="description">用于验证控制中心服务。</div>
            <ul data-testid="tags"><li>测试</li><li>控制台</li></ul>
            <div data-testid="chapter-count">4</div>
          </article>
        `,
        catalogHtml: `
          <ol data-testid="catalog">
            <li data-chapter-id="chapter-1" data-volume="卷 1"><a href="/demo/1">第 1 章</a></li>
            <li data-chapter-id="chapter-2" data-volume="卷 1"><a href="/demo/2">第 2 章</a></li>
            <li data-chapter-id="chapter-3" data-volume="卷 2"><a href="/demo/3">第 3 章</a></li>
            <li data-chapter-id="chapter-4" data-volume="卷 2"><a href="/demo/4">第 4 章</a></li>
          </ol>
        `,
        chapterHtmlById: {
          'chapter-1': `<article><h1 data-testid="chapter-title">第 1 章</h1><section data-testid="content"><p>a</p><p>b</p></section></article>`,
          'chapter-2': `<article><h1 data-testid="chapter-title">第 2 章</h1><section data-testid="content"><p>a</p><p>b</p></section></article>`,
          'chapter-3': `<article><h1 data-testid="chapter-title">第 3 章</h1><section data-testid="content"><p>a</p><p>b</p></section></article>`,
          'chapter-4': `<article><h1 data-testid="chapter-title">第 4 章</h1><section data-testid="content"><p>a</p><p>b</p></section></article>`,
        },
        transientFailuresByChapterId: {
          'chapter-3': 1,
        },
      }),
      createBrowserSpider: (fetchHtml) => new SyosetuSpiderAdapter({ fetchHtml }),
    },
  ];
}

function createService(databasePath?: string) {
  const tempDir = databasePath ? path.dirname(databasePath) : fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-control-'));
  const resolvedDatabasePath = databasePath ?? path.join(tempDir, 'novels.db');
  const repository = new SqliteNovelRepository(resolvedDatabasePath);
  const service = new ControlCenterService({
    repository,
    spiders: createMockSpiderRegistry(),
  });

  return {
    service,
    repository,
    databasePath: resolvedDatabasePath,
    cleanup: () => {
      service.close();
      repository.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('ControlCenterService previews novels and tracks retryable background tasks', async () => {
  const { service, repository, databasePath, cleanup } = createService();

  try {
    const preview = await service.previewNovel({
      sourceId: 'mock-html',
      novelId: 'demo',
    });

    assert.equal(preview.metadata.title, '测试控制台小说');
    assert.equal(preview.chapters.length, 4);
    assert.equal(preview.snapshotSummary?.newChapters, 4);
    assert.equal(preview.activeTask, null);

    const initialTask = service.createTask({
      sourceId: 'mock-html',
      novelId: 'demo',
      chapterRetryCount: 0,
    });

    const completedTask = await waitForTask(service, initialTask.id);
    assert.equal(completedTask.status, 'completed');
    assert.equal(completedTask.failures.length, 1);
    assert.equal(completedTask.failures[0]?.chapterId, 'chapter-3');
    assert.equal(completedTask.progress.failedChapters, 1);
    assert.ok(completedTask.events.some((event) => event.type === 'chapter_failed'));

    const secondPreview = await service.previewNovel({
      sourceId: 'mock-html',
      novelId: 'demo',
    });

    assert.equal(secondPreview.snapshotSummary?.downloadedChapters, 3);
    assert.equal(secondPreview.snapshotSummary?.failedChapters, 1);
    assert.equal(secondPreview.chapters.find((chapter) => chapter.id === 'chapter-3')?.status, 'failed');

    const retryTask = service.createTask({
      sourceId: 'mock-html',
      novelId: 'demo',
      chapterIds: ['chapter-3'],
      chapterRetryCount: 1,
    });

    const recoveredTask = await waitForTask(service, retryTask.id);
    assert.equal(recoveredTask.failures.length, 0);
    assert.equal(recoveredTask.status, 'completed');
    assert.equal(recoveredTask.chapters.find((chapter) => chapter.id === 'chapter-3')?.status, 'downloaded');

    service.close();
    repository.close();

    const restored = createService(databasePath);

    try {
      const recentTasks = restored.service.listTasks();
      assert.equal(recentTasks.length, 2);
      assert.deepEqual(recentTasks.map((task) => task.id), [retryTask.id, initialTask.id]);
      assert.equal(recentTasks[0]?.status, 'completed');
      assert.equal(recentTasks[1]?.status, 'completed');
    } finally {
      restored.cleanup();
    }
  } finally {
    if (fs.existsSync(path.dirname(databasePath))) {
      cleanup();
    }
  }
});

test('ControlCenterService backfills recent tasks from existing library snapshots', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-control-history-'));
  const databasePath = path.join(tempDir, 'novels.db');
  const repository = new SqliteNovelRepository(databasePath);

  try {
    const metadata: NovelMetadata = {
      novelId: 'demo',
      title: '旧书库记录',
      author: '测试作者',
      description: '用于验证旧书库历史补全。',
      tags: ['测试'],
      chapterCount: 2,
      infoPageUrl: 'https://example.com/demo',
    };
    const chapterIndex: ChapterIndexEntry[] = [
      {
        id: 'chapter-1',
        index: 1,
        title: '第 1 章',
        url: 'https://example.com/demo/1',
      },
      {
        id: 'chapter-2',
        index: 2,
        title: '第 2 章',
        url: 'https://example.com/demo/2',
      },
    ];

    repository.saveMetadata('mock-html', metadata);
    repository.saveChapterIndex('mock-html', metadata.novelId, chapterIndex);
    repository.saveChapterContent('mock-html', metadata.novelId, {
      chapterId: 'chapter-1',
      index: 1,
      title: '第 1 章',
      url: 'https://example.com/demo/1',
      content: '<p>正文</p>',
    });
    repository.markChapterFailure('mock-html', metadata.novelId, 'chapter-2', new Error('下载失败'));
  } finally {
    repository.close();
  }

  const restored = createService(databasePath);

  try {
    const recentTasks = restored.service.listTasks();
    assert.equal(recentTasks.length, 1);
    assert.equal(recentTasks[0]?.sourceId, 'mock-html');
    assert.equal(recentTasks[0]?.novelId, 'demo');
    assert.equal(recentTasks[0]?.status, 'failed');
    assert.equal(recentTasks[0]?.progress.completedChapters, 1);
    assert.equal(recentTasks[0]?.progress.failedChapters, 1);
    assert.equal(recentTasks[0]?.events.length, 0);
  } finally {
    restored.cleanup();
  }
});

test('createDefaultSpiderRegistry exposes only user-facing real sources', () => {
  const networkProxy = new NetworkProxyService();

  try {
    const registry = createDefaultSpiderRegistry(networkProxy);

    assert.deepEqual(
      registry.map((entry) => entry.descriptor.sourceId),
      ['syosetu', 'syosetu18', 'kakuyomu'],
    );
    assert.deepEqual(
      registry.map((entry) => entry.descriptor.label),
      ['小説家になろう（全年龄）', 'ノクターンノベルズ（成人向）', 'カクヨム'],
    );
  } finally {
    networkProxy.close();
  }
});

function waitForTask(service: ControlCenterService, taskId: string): Promise<ReturnType<ControlCenterService['getTask']> extends infer TResult ? Exclude<TResult, null> : never> {
  return new Promise((resolve, reject) => {
    const unsubscribe = service.subscribeToTask(taskId, (event: ControlCenterStreamEvent) => {
      if (event.type !== 'task_updated') {
        return;
      }

      if (event.task.status === 'completed' || event.task.status === 'failed') {
        unsubscribe?.();
        resolve(event.task);
      }
    });

    if (!unsubscribe) {
      reject(new Error(`Task ${taskId} was not found.`));
    }
  });
}

test('queued browser tasks can be aborted before their serialized run starts', async () => {
  const { service, cleanup } = createService();
  try {
    const first = service.createTask({ sourceId: 'mock-html', novelId: 'first', kind: 'browser' });
    const queued = service.createTask({ sourceId: 'mock-html', novelId: 'queued', kind: 'browser' });

    const aborted = service.controlBrowserTask(queued.id, 'abort');

    assert.equal(aborted?.status, 'aborted');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(service.getTask(queued.id)?.status, 'aborted');
    assert.equal(service.getTask(first.id)?.status, 'failed');
  } finally {
    cleanup();
  }
});
