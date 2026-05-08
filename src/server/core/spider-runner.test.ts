import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { InMemoryLogAdapter } from '../adapters/log/in-memory-log-adapter';
import { MockHtmlSpiderAdapter, type MockHtmlSpiderFixture } from '../adapters/spider/mock-html-spider-adapter';
import { SpiderLogDispatcher } from './logging';
import { SqliteNovelRepository } from './novel-repository';
import { SpiderRunner } from './spider-runner';

class DelayedMockHtmlSpiderAdapter extends MockHtmlSpiderAdapter {
  readonly #delayByChapterId: Record<string, number>;

  constructor(fixture: MockHtmlSpiderFixture, delayByChapterId: Record<string, number>) {
    super(fixture);
    this.#delayByChapterId = delayByChapterId;
  }

  override async fetchChapter(context: { novelId: string }, chapter: { id: string }) {
    const waitMs = this.#delayByChapterId[chapter.id] ?? 0;
    if (waitMs > 0) {
      await delay(waitMs);
    }

    return super.fetchChapter(context, chapter);
  }
}

function createFixture(chapterCount = 2): MockHtmlSpiderFixture {
  const catalogItems: string[] = [];
  const chapterHtmlById: Record<string, string> = {};

  for (let index = 1; index <= chapterCount; index += 1) {
    const chapterId = `chapter-${index}`;
    catalogItems.push(
      `<li data-chapter-id="${chapterId}" data-volume="卷 ${Math.ceil(index / 2)}"><a href="/novels/demo/${index}">第 ${index} 章</a></li>`,
    );
    chapterHtmlById[chapterId] = `
      <article>
        <h1 data-testid="chapter-title">第 ${index} 章</h1>
        <div data-testid="volume-title">卷 ${Math.ceil(index / 2)}</div>
        <section data-testid="content">
          <p>第 ${index} 章第一段</p>
          <p>第 ${index} 章第二段</p>
        </section>
      </article>
    `;
  }

  return {
    metadataHtml: `
      <article>
        <h1 data-testid="title">测试小说</h1>
        <div data-testid="author">测试作者</div>
        <div data-testid="description">这里是一段简介。</div>
        <ul data-testid="tags"><li>奇幻</li><li>冒险</li></ul>
        <div data-testid="chapter-count">${chapterCount}</div>
      </article>
    `,
    catalogHtml: `<ol data-testid="catalog">${catalogItems.join('')}</ol>`,
    chapterHtmlById,
  };
}

function createRepository() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-'));
  const databasePath = path.join(tempDir, 'novels.db');
  const repository = new SqliteNovelRepository(databasePath);

  return {
    repository,
    cleanup: () => {
      repository.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('SpiderRunner persists metadata, catalog and chapter content', async () => {
  const { repository, cleanup } = createRepository();

  try {
    const logAdapter = new InMemoryLogAdapter();
    const runner = new SpiderRunner({
      spider: new MockHtmlSpiderAdapter(createFixture()),
      repository,
      logger: new SpiderLogDispatcher([logAdapter]),
    });

    const result = await runner.crawlNovel({
      novelId: 'demo',
      chapterConcurrency: 2,
      chapterRetryCount: 0,
    });

    assert.equal(result.previousSnapshot, null);
    assert.equal(result.metadata.title, '测试小说');
    assert.equal(result.currentSnapshot.chapters.length, 2);
    assert.deepEqual(
      result.currentSnapshot.chapters.map((chapter) => chapter.status),
      ['downloaded', 'downloaded'],
    );
    assert.deepEqual(
      result.chapters.map((chapter) => ({ wasDownloaded: chapter.wasDownloaded, isNew: chapter.isNew, status: chapter.status })),
      [
        { wasDownloaded: false, isNew: true, status: 'downloaded' },
        { wasDownloaded: false, isNew: true, status: 'downloaded' },
      ],
    );
    assert.deepEqual(
      logAdapter.events.map((event) => event.type),
      [
        'task_started',
        'metadata_fetched',
        'catalog_fetched',
        'chapter_started',
        'chapter_started',
        'chapter_fetched',
        'chapter_fetched',
        'chapter_persisted',
        'chapter_persisted',
        'task_completed',
      ],
    );
  } finally {
    cleanup();
  }
});

test('SpiderRunner isolates chapter failures and keeps successful chapters', async () => {
  const { repository, cleanup } = createRepository();

  try {
    const runner = new SpiderRunner({
      spider: new MockHtmlSpiderAdapter({
        ...createFixture(3),
        failChapterIds: ['chapter-2'],
      }),
      repository,
    });

    const result = await runner.crawlNovel({
      novelId: 'demo',
      chapterConcurrency: 3,
    });

    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.chapterId, 'chapter-2');
    assert.deepEqual(
      result.currentSnapshot.chapters.map((chapter) => ({ id: chapter.id, status: chapter.status })),
      [
        { id: 'chapter-1', status: 'downloaded' },
        { id: 'chapter-2', status: 'failed' },
        { id: 'chapter-3', status: 'downloaded' },
      ],
    );
  } finally {
    cleanup();
  }
});

test('SpiderRunner retries transient chapter failures before succeeding', async () => {
  const { repository, cleanup } = createRepository();

  try {
    const spider = new MockHtmlSpiderAdapter({
      ...createFixture(2),
      transientFailuresByChapterId: {
        'chapter-2': 1,
      },
    });
    const runner = new SpiderRunner({
      spider,
      repository,
    });

    const result = await runner.crawlNovel({
      novelId: 'demo',
      chapterRetryCount: 1,
    });

    assert.equal(result.failures.length, 0);
    assert.equal(spider.attemptsByChapterId.get('chapter-2'), 2);
    assert.deepEqual(
      result.currentSnapshot.chapters.map((chapter) => chapter.status),
      ['downloaded', 'downloaded'],
    );
  } finally {
    cleanup();
  }
});

test('SpiderRunner persists completed chapters before the whole batch finishes', async () => {
  const { repository, cleanup } = createRepository();

  try {
    const logAdapter = new InMemoryLogAdapter();
    const runner = new SpiderRunner({
      spider: new DelayedMockHtmlSpiderAdapter(createFixture(2), {
        'chapter-1': 80,
      }),
      repository,
      logger: new SpiderLogDispatcher([logAdapter]),
    });

    const crawlPromise = runner.crawlNovel({
      novelId: 'demo',
      chapterConcurrency: 2,
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const snapshot = repository.getSnapshot('mock-html', 'demo');
      const chapter1 = snapshot?.chapters.find((chapter) => chapter.id === 'chapter-1');
      const chapter2 = snapshot?.chapters.find((chapter) => chapter.id === 'chapter-2');

      if (chapter1?.status === 'indexed' && chapter2?.status === 'downloaded') {
        break;
      }

      await delay(10);
    }

    const snapshot = repository.getSnapshot('mock-html', 'demo');
    assert.equal(snapshot?.chapters.find((chapter) => chapter.id === 'chapter-1')?.status, 'indexed');
    assert.equal(snapshot?.chapters.find((chapter) => chapter.id === 'chapter-2')?.status, 'downloaded');
    assert.ok(logAdapter.events.some((event) => event.type === 'chapter_persisted' && event.payload?.chapterId === 'chapter-2'));

    await crawlPromise;
  } finally {
    cleanup();
  }
});

test('SpiderRunner marks incremental chapters against existing snapshot', async () => {
  const { repository, cleanup } = createRepository();

  try {
    const firstRunner = new SpiderRunner({
      spider: new MockHtmlSpiderAdapter(createFixture(2)),
      repository,
    });
    await firstRunner.crawlNovel({ novelId: 'demo' });

    const secondRunner = new SpiderRunner({
      spider: new MockHtmlSpiderAdapter(createFixture(3)),
      repository,
    });
    const result = await secondRunner.crawlNovel({ novelId: 'demo' });

    assert.equal(result.previousSnapshot?.chapters.length, 2);
    assert.deepEqual(
      result.chapters.map((chapter) => ({ id: chapter.id, wasDownloaded: chapter.wasDownloaded, isNew: chapter.isNew, status: chapter.status })),
      [
        { id: 'chapter-1', wasDownloaded: true, isNew: false, status: 'downloaded' },
        { id: 'chapter-2', wasDownloaded: true, isNew: false, status: 'downloaded' },
        { id: 'chapter-3', wasDownloaded: false, isNew: true, status: 'downloaded' },
      ],
    );
  } finally {
    cleanup();
  }
});