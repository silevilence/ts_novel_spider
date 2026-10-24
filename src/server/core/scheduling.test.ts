import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLogAdapter } from '../adapters/log/in-memory-log-adapter';
import { type SpiderRegistryEntry } from './control-center';
import { SpiderLogDispatcher } from './logging';
import { SqliteNovelRepository } from './novel-repository';
import { SchedulingService, calculateNextTriggerTime } from './scheduling';

describe('calculateNextTriggerTime', () => {
  it('interval mode: returns now + intervalHours', () => {
    const now = 1700000000000;
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'interval',
      intervalHours: 6,
      cronExpression: '0 */6 * * *',
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    // Use a time-based assertion
    const baseTime = Date.now();
    const result2 = calculateNextTriggerTime({
      enabled: true,
      mode: 'interval',
      intervalHours: 2,
      cronExpression: '',
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.ok(result2 > baseTime);
    assert.ok(result2 - baseTime >= 2 * 3600 * 1000 - 100); // allow small timing diff
  });

  it('cron mode: parses valid expression', () => {
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'cron',
      intervalHours: 6,
      cronExpression: '0 8 * * *', // 每天 08:00
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });

  it('cron mode: falls back on invalid expression', () => {
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'cron',
      intervalHours: 6,
      cronExpression: 'invalid',
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });

  it('weekly mode: finds next matching day', () => {
    // Use a fixed reference: 2024-01-01 = Monday (getDay=1)
    const referenceMs = new Date('2024-01-01T10:00:00Z').getTime();
    const originalNow = Date.now;

    try {
      // Mock Date.now to return our reference time
      Date.now = () => referenceMs;

      const result = calculateNextTriggerTime({
        enabled: true,
        mode: 'weekly',
        intervalHours: 6,
        cronExpression: '',
        weeklyDays: [3], // Wednesday
        weeklyTime: '08:00',
        updatedAt: null,
      });

      const resultDate = new Date(result);
      assert.equal(resultDate.getDay(), 3, 'Should be Wednesday');
      assert.equal(resultDate.getHours(), 8, 'Should be 08:00 local time');
      assert.equal(resultDate.getMinutes(), 0);
    } finally {
      Date.now = originalNow;
    }
  });

  it('weekly mode: handles multiple days', () => {
    const referenceMs = new Date('2024-01-05T10:00:00Z').getTime(); // Friday
    const originalNow = Date.now;

    try {
      Date.now = () => referenceMs;
      const result = calculateNextTriggerTime({
        enabled: true,
        mode: 'weekly',
        intervalHours: 6,
        cronExpression: '',
        weeklyDays: [1, 3, 5], // Mon, Wed, Fri
        weeklyTime: '20:00',
        updatedAt: null,
      });

      // After Friday 10:00, next is Friday 20:00 same day
      const resultDate = new Date(result);
      assert.equal(resultDate.getDay(), 5, 'Should be Friday');
      assert.equal(resultDate.getHours(), 20);
    } finally {
      Date.now = originalNow;
    }
  });

  it('defaults to 6 hours for unknown mode', () => {
    const baseTime = Date.now();
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'interval', // valid mode, will produce a real result
      intervalHours: 6,
      cronExpression: '',
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.ok(result > baseTime);
  });
});

describe('SqliteNovelRepository - scheduled novels CRUD', () => {
  function createTestRepo(): SqliteNovelRepository {
    const repo = new SqliteNovelRepository(':memory:');
    // 预置 novels 父行以满足 scheduled_novels 的外键约束
    const novels = [
      { sourceId: 'syosetu', novelId: 'n123' },
      { sourceId: 'syosetu', novelId: 'n1' },
      { sourceId: 'syosetu', novelId: 'n2' },
      { sourceId: 'syosetu18', novelId: 'n3' },
    ];
    for (const { sourceId, novelId } of novels) {
      repo.saveMetadata(sourceId, {
        novelId,
        title: 'Test Novel',
        author: 'Test Author',
        description: '',
        tags: [],
        chapterCount: 0,
        infoPageUrl: `https://example.com/${sourceId}/${novelId}`,
      });
    }
    return repo;
  }

  it('upsertScheduledNovel creates and updates a record', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true, true);
    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.ok(row);
    assert.equal(row.enabled, true);
    assert.equal(row.autoTranslate, true);
    assert.ok(row.updatedAt);

    repo.upsertScheduledNovel('syosetu', 'n123', false, false);
    const updated = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(updated?.enabled, false);
    assert.equal(updated?.autoTranslate, false);
  });

  it('getEnabledScheduledNovels filters correctly', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n1', true);
    repo.upsertScheduledNovel('syosetu', 'n2', false);
    repo.upsertScheduledNovel('syosetu18', 'n3', true);

    const enabled = repo.getEnabledScheduledNovels();
    assert.equal(enabled.length, 2);
  });

  it('getScheduledNovel returns undefined for non-existent', () => {
    const repo = createTestRepo();
    const row = repo.getScheduledNovel('syosetu', 'nonexistent');
    assert.equal(row, undefined);
  });

  it('updateScheduledNovelCheckResult sets check state', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    repo.updateScheduledNovelCheckResult('syosetu', 'n123', 'new_chapters', '发现 3 章');

    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(row?.lastCheckResult, 'new_chapters');
    assert.equal(row?.lastCheckMessage, '发现 3 章');
    assert.ok(row?.lastCheckedAt);
  });

  it('updateScheduledNovelCheckResult accepts null message', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    repo.updateScheduledNovelCheckResult('syosetu', 'n123', 'up_to_date', null);

    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(row?.lastCheckResult, 'up_to_date');
    assert.equal(row?.lastCheckMessage, null);
  });

  it('bulkUpsertScheduledNovels batch updates', () => {
    const repo = createTestRepo();
    repo.bulkUpsertScheduledNovels([
      { sourceId: 'syosetu', novelId: 'n1', enabled: true, autoTranslate: true },
      { sourceId: 'syosetu', novelId: 'n2', enabled: false, autoTranslate: false },
    ]);

    assert.equal(repo.getScheduledNovel('syosetu', 'n1')?.enabled, true);
    assert.equal(repo.getScheduledNovel('syosetu', 'n1')?.autoTranslate, true);
    assert.equal(repo.getScheduledNovel('syosetu', 'n2')?.enabled, false);
    assert.equal(repo.getScheduledNovel('syosetu', 'n2')?.autoTranslate, false);
  });

  it('deleteScheduledNovel removes record', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    repo.deleteScheduledNovel('syosetu', 'n123');

    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(row, undefined);
  });

  it('upsertScheduledNovel stores auto summarize config', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel(
      'syosetu',
      'n123',
      true,
      false,
      true,
      { providerId: 'provider-chat', modelId: 'model-summary' },
    );

    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.ok(row);
    assert.equal(row.autoSummarize, true);
    assert.deepEqual(row.summarizeModel, { providerId: 'provider-chat', modelId: 'model-summary' });
    assert.equal(row.hasSummary, false);
  });
});

describe('SchedulingService - auto translation', () => {
  function createAutoTranslateRepo(): SqliteNovelRepository {
    const repo = new SqliteNovelRepository(':memory:');
    repo.saveMetadata('syosetu', {
      novelId: 'n123',
      title: '定时更新测试',
      author: '测试作者',
      description: '',
      tags: [],
      chapterCount: 2,
      infoPageUrl: 'https://example.com/syosetu/n123',
    });
    repo.saveChapterIndex('syosetu', 'n123', [
      { id: 'chapter-1', index: 1, title: '第一章', volumeTitle: null, url: 'https://example.com/syosetu/n123/1' },
    ]);
    repo.saveChapterContent('syosetu', 'n123', {
      chapterId: 'chapter-1',
      index: 1,
      title: '第一章',
      volumeTitle: null,
      url: 'https://example.com/syosetu/n123/1',
      content: '已下载章节',
    });
    return repo;
  }

  async function flushAsyncWork(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  function createSpiderRegistryEntry(): SpiderRegistryEntry {
    const metadata = {
      novelId: 'n123',
      title: '定时更新测试',
      author: '测试作者',
      description: '',
      tags: [],
      chapterCount: 2,
      infoPageUrl: 'https://example.com/syosetu/n123',
    };
    const chapters = [
      { id: 'chapter-1', index: 1, title: '第一章', volumeTitle: undefined, url: 'https://example.com/syosetu/n123/1' },
      { id: 'chapter-2', index: 2, title: '第二章', volumeTitle: undefined, url: 'https://example.com/syosetu/n123/2' },
    ];

    return {
      descriptor: {
        sourceId: 'syosetu',
        label: 'Syosetu',
        description: 'test spider',
        defaultNovelId: 'n123',
      },
      spider: {
        sourceId: 'syosetu',
        buildInfoPageUrl: (novelId: string) => `https://example.com/syosetu/${novelId}`,
        fetchMetadata: async () => metadata,
        fetchChapterIndex: async () => chapters,
        fetchChapter: async (_context, chapter) => ({
          chapterId: chapter.id,
          index: chapter.index,
          title: chapter.title,
          volumeTitle: chapter.volumeTitle,
          url: chapter.url,
          content: `${chapter.title} 内容`,
        }),
        fetchChapters: async (_context, selectedChapters, options) => {
          const results = selectedChapters.map((chapter) => ({
            chapter,
            content: {
              chapterId: chapter.id,
              index: chapter.index,
              title: chapter.title,
              volumeTitle: chapter.volumeTitle,
              url: chapter.url,
              content: `${chapter.title} 内容`,
            },
            attempts: 1,
          }));

          for (const result of results) {
            await options?.onResult?.(result);
          }

          return results;
        },
      },
    };
  }

  it('starts translation automatically after scheduled incremental download', async () => {
    const repo = createAutoTranslateRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true, true);

    const logAdapter = new InMemoryLogAdapter();
    const logger = new SpiderLogDispatcher([logAdapter]);
    const translationCalls: Array<{ sourceId: string; novelId: string }> = [];

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const callbacks: Array<() => void> = [];

    globalThis.setInterval = (((callback: Parameters<typeof setInterval>[0]) => {
      callbacks.push(callback as () => void);
      return { hasRef: () => false } as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval>) => undefined) as typeof clearInterval);

    try {
      const service = new SchedulingService({
        repository: repo,
        preferences: {
          getScheduling: () => ({
            enabled: true,
            mode: 'interval',
            intervalHours: 0,
            cronExpression: '',
            weeklyDays: [],
            weeklyTime: '08:00',
            updatedAt: null,
          }),
        },
        spiderRegistry: [createSpiderRegistryEntry()],
        controlCenter: {
          getActiveTaskNovelKeys: () => [],
        },
        logger,
        translation: {
          getAutoTranslationReadiness: () => ({ ready: true }),
          startTranslation: (sourceId: string, novelId: string) => {
            translationCalls.push({ sourceId, novelId });
            return {
              status: 'running',
              stage: 'translating',
              progressPercent: 0,
              message: '准备翻译',
              errorMessage: null,
              startedAt: new Date().toISOString(),
              completedAt: null,
              translatedChapters: 0,
              failedChapters: 0,
              currentChapterParagraphs: 0,
              currentChapterTranslatedParagraphs: 0,
              totalTranslatedParagraphs: 0,
              glossaryVersion: 1,
              profileVersion: 1,
              updatedAt: new Date().toISOString(),
            };
          },
        },
        summary: {
          getAutoSummaryReadiness: () => ({ ready: false, reason: 'disabled for test' }),
          summarizeNewChapters: async () => {
            throw new Error('should not be called');
          },
        },
      });

      service.start();
      callbacks[0]?.();
      await flushAsyncWork();
      service.stop();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }

    assert.deepEqual(translationCalls, [{ sourceId: 'syosetu', novelId: 'n123' }]);
    assert.equal(repo.getSnapshot('syosetu', 'n123')?.chapters.length, 2);
    assert.ok(logAdapter.events.some((event) => event.message.includes('自动触发翻译')));
    const run = repo.listScheduledCheckRuns(1, 0)[0]!;
    assert.equal(run.results?.[0]?.title, '定时更新测试', 'run history identifies the updated book without an AI summary');
    assert.deepEqual(run.results?.[0]?.chapters, [{ id: 'chapter-2', title: '第二章', downloaded: true }]);
    assert.equal(run.results?.[0]?.result, 'new_chapters');
    repo.updateScheduledNovelCheckResult('syosetu', 'n123', 'up_to_date', '已是最新');
    assert.deepEqual(repo.listScheduledCheckRuns(1, 0)[0]?.results, run.results, 'later checks do not overwrite historical book results');
  });

  it('persists skipped and failed books independently of summaries', async (t) => {
    const repo = createAutoTranslateRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    repo.saveMetadata('missing', { novelId: 'broken', title: '失败的作品', author: '', description: '', tags: [], chapterCount: 0, infoPageUrl: '' });
    repo.upsertScheduledNovel('missing', 'broken', true);
    let tick: () => void = () => {};
    t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; return 1; });
    t.mock.method(globalThis, 'clearInterval', () => {});
    const service = new SchedulingService({
      repository: repo,
      preferences: { getScheduling: () => ({ enabled: true, mode: 'interval', intervalHours: 0, cronExpression: '', weeklyDays: [], weeklyTime: '08:00', updatedAt: null }) },
      spiderRegistry: [], controlCenter: { getActiveTaskNovelKeys: () => [{ sourceId: 'syosetu', novelId: 'n123' }] },
      logger: new SpiderLogDispatcher([new InMemoryLogAdapter()]),
      translation: { getAutoTranslationReadiness: () => ({ ready: false }), startTranslation: () => { throw new Error('unexpected translation'); } },
      summary: { getAutoSummaryReadiness: () => ({ ready: false }), summarizeNewChapters: async () => { throw new Error('unexpected summary'); } },
    });
    try {
      service.start(); tick(); await flushAsyncWork();
      const run = repo.listScheduledCheckRuns(1, 0)[0]!;
      assert.equal(run.skipped, 1); assert.equal(run.errored, 1);
      assert.equal(run.results?.find((result) => result.novelId === 'n123')?.result, 'skipped');
      const failed = run.results?.find((result) => result.novelId === 'broken');
      assert.equal(failed?.title, '失败的作品');
      assert.equal(failed?.result, 'error');
      assert.match(failed?.message ?? '', /未找到数据源/);
    } finally { service.stop(); repo.close(); }
  });

  it('logs a warning and skips auto translation when readiness check fails', async () => {
    const repo = createAutoTranslateRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true, true);

    const logAdapter = new InMemoryLogAdapter();
    const logger = new SpiderLogDispatcher([logAdapter]);
    const translationCalls: Array<{ sourceId: string; novelId: string }> = [];

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const callbacks: Array<() => void> = [];

    globalThis.setInterval = (((callback: Parameters<typeof setInterval>[0]) => {
      callbacks.push(callback as () => void);
      return { hasRef: () => false } as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval>) => undefined) as typeof clearInterval);

    try {
      const service = new SchedulingService({
        repository: repo,
        preferences: {
          getScheduling: () => ({
            enabled: true,
            mode: 'interval',
            intervalHours: 0,
            cronExpression: '',
            weeklyDays: [],
            weeklyTime: '08:00',
            updatedAt: null,
          }),
        },
        spiderRegistry: [createSpiderRegistryEntry()],
        controlCenter: {
          getActiveTaskNovelKeys: () => [],
        },
        logger,
        translation: {
          getAutoTranslationReadiness: () => ({ ready: false, reason: '模型网关未配置默认对话模型。' }),
          startTranslation: (sourceId: string, novelId: string) => {
            translationCalls.push({ sourceId, novelId });
            throw new Error('should not be called');
          },
        },
        summary: {
          getAutoSummaryReadiness: () => ({ ready: false, reason: 'disabled for test' }),
          summarizeNewChapters: async () => {
            throw new Error('should not be called');
          },
        },
      });

      service.start();
      callbacks[0]?.();
      await flushAsyncWork();
      service.stop();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }

    assert.equal(translationCalls.length, 0);
    assert.ok(logAdapter.events.some((event) => event.level === 'warn' && event.message.includes('模型网关未配置默认对话模型')));
  });
});

describe('SchedulingService - auto summary', () => {
  function createAutoSummaryRepo(): SqliteNovelRepository {
    const repo = new SqliteNovelRepository(':memory:');
    repo.saveMetadata('syosetu', {
      novelId: 'n123',
      title: '定时更新测试',
      author: '测试作者',
      description: '',
      tags: [],
      chapterCount: 2,
      infoPageUrl: 'https://example.com/syosetu/n123',
    });
    repo.saveChapterIndex('syosetu', 'n123', [
      { id: 'chapter-1', index: 1, title: '第一章', volumeTitle: null, url: 'https://example.com/syosetu/n123/1' },
    ]);
    repo.saveChapterContent('syosetu', 'n123', {
      chapterId: 'chapter-1',
      index: 1,
      title: '第一章',
      volumeTitle: null,
      url: 'https://example.com/syosetu/n123/1',
      content: '已下载章节',
    });
    return repo;
  }

  function createSpiderRegistryEntry(): SpiderRegistryEntry {
    const metadata = {
      novelId: 'n123',
      title: '定时更新测试',
      author: '测试作者',
      description: '',
      tags: [],
      chapterCount: 2,
      infoPageUrl: 'https://example.com/syosetu/n123',
    };
    const chapters = [
      { id: 'chapter-1', index: 1, title: '第一章', volumeTitle: undefined, url: 'https://example.com/syosetu/n123/1' },
      { id: 'chapter-2', index: 2, title: '第二章', volumeTitle: undefined, url: 'https://example.com/syosetu/n123/2' },
    ];

    return {
      descriptor: {
        sourceId: 'syosetu',
        label: 'Syosetu',
        description: 'test spider',
        defaultNovelId: 'n123',
      },
      spider: {
        sourceId: 'syosetu',
        buildInfoPageUrl: (novelId: string) => `https://example.com/syosetu/${novelId}`,
        fetchMetadata: async () => metadata,
        fetchChapterIndex: async () => chapters,
        fetchChapter: async (_context, chapter) => ({
          chapterId: chapter.id,
          index: chapter.index,
          title: chapter.title,
          volumeTitle: chapter.volumeTitle,
          url: chapter.url,
          content: `${chapter.title} 内容`,
        }),
        fetchChapters: async (_context, selectedChapters, options) => {
          const results = selectedChapters.map((chapter) => ({
            chapter,
            content: {
              chapterId: chapter.id,
              index: chapter.index,
              title: chapter.title,
              volumeTitle: chapter.volumeTitle,
              url: chapter.url,
              content: `${chapter.title} 内容`,
            },
            attempts: 1,
          }));

          for (const result of results) {
            await options?.onResult?.(result);
          }

          return results;
        },
      },
    };
  }

  async function flushAsyncWork(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('creates scheduled summary after downloading new chapters', async () => {
    const repo = createAutoSummaryRepo();
    repo.upsertScheduledNovel(
      'syosetu',
      'n123',
      true,
      false,
      true,
      { providerId: 'provider-chat', modelId: 'model-summary' },
    );

    const logAdapter = new InMemoryLogAdapter();
    const logger = new SpiderLogDispatcher([logAdapter]);
    const summaryCalls: Array<{ sourceId: string; novelId: string; chapterIds: string[] }> = [];

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const callbacks: Array<() => void> = [];

    globalThis.setInterval = (((callback: Parameters<typeof setInterval>[0]) => {
      callbacks.push(callback as () => void);
      return { hasRef: () => false } as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval>) => undefined) as typeof clearInterval);

    try {
      const service = new SchedulingService({
        repository: repo,
        preferences: {
          getScheduling: () => ({
            enabled: true,
            mode: 'interval',
            intervalHours: 0,
            cronExpression: '',
            weeklyDays: [],
            weeklyTime: '08:00',
            summaryModel: { providerId: 'provider-chat', modelId: 'model-summary' },
            updatedAt: null,
          }),
        },
        spiderRegistry: [createSpiderRegistryEntry()],
        controlCenter: {
          getActiveTaskNovelKeys: () => [],
        },
        logger,
        translation: {
          getAutoTranslationReadiness: () => ({ ready: false, reason: 'translation disabled in test' }),
          startTranslation: () => {
            throw new Error('should not be called');
          },
        },
        summary: {
          getAutoSummaryReadiness: () => ({ ready: true }),
          summarizeNewChapters: async ({ sourceId, novelId, chapters }) => {
            summaryCalls.push({ sourceId, novelId, chapterIds: chapters.map((chapter) => chapter.id) });
            return {
              providerId: 'provider-chat',
              modelId: 'model-summary',
              summary: '第二章：主角决定联手调查黑塔，并与守卫发生冲突。',
            };
          },
        },
      });

      service.start();
      callbacks[0]?.();
      await flushAsyncWork();
      service.stop();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }

    assert.deepEqual(summaryCalls, [{ sourceId: 'syosetu', novelId: 'n123', chapterIds: ['chapter-2'] }]);
    const latestRun = repo.listScheduledCheckRuns(1, 0)[0];
    assert.ok(latestRun);
    const summaries = repo.listScheduledSummariesByRunIds([latestRun.id]);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.summary, '第二章：主角决定联手调查黑塔，并与守卫发生冲突。');
    assert.deepEqual(summaries[0]?.chapterIds, ['chapter-2']);
    assert.ok(logAdapter.events.some((event) => event.message.includes('已生成更新总结')));
  });

  it('logs a warning and skips auto summary when readiness check fails', async () => {
    const repo = createAutoSummaryRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true, false, true);

    const logAdapter = new InMemoryLogAdapter();
    const logger = new SpiderLogDispatcher([logAdapter]);

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const callbacks: Array<() => void> = [];

    globalThis.setInterval = (((callback: Parameters<typeof setInterval>[0]) => {
      callbacks.push(callback as () => void);
      return { hasRef: () => false } as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval>) => undefined) as typeof clearInterval);

    try {
      const service = new SchedulingService({
        repository: repo,
        preferences: {
          getScheduling: () => ({
            enabled: true,
            mode: 'interval',
            intervalHours: 0,
            cronExpression: '',
            weeklyDays: [],
            weeklyTime: '08:00',
            summaryModel: null,
            updatedAt: null,
          }),
        },
        spiderRegistry: [createSpiderRegistryEntry()],
        controlCenter: {
          getActiveTaskNovelKeys: () => [],
        },
        logger,
        translation: {
          getAutoTranslationReadiness: () => ({ ready: false, reason: 'translation disabled in test' }),
          startTranslation: () => {
            throw new Error('should not be called');
          },
        },
        summary: {
          getAutoSummaryReadiness: () => ({ ready: false, reason: '没有可用的更新总结模型。' }),
          summarizeNewChapters: async () => {
            throw new Error('should not be called');
          },
        },
      });

      service.start();
      callbacks[0]?.();
      await flushAsyncWork();
      service.stop();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }

    const latestRun = repo.listScheduledCheckRuns(1, 0)[0];
    assert.ok(latestRun);
    const summaries = repo.listScheduledSummariesByRunIds([latestRun.id]);
    assert.equal(summaries.length, 0);
    assert.ok(logAdapter.events.some((event) => event.level === 'warn' && event.message.includes('没有可用的更新总结模型')));
  });
});

describe('SqliteNovelRepository - scheduled check runs', () => {
  function createTestRepo(): SqliteNovelRepository {
    const repo = new SqliteNovelRepository(':memory:');
    for (const novelId of ['n1', 'n2']) {
      repo.saveMetadata('syosetu', {
        novelId,
        title: 'Test Novel',
        author: 'Test Author',
        description: '',
        tags: [],
        chapterCount: 0,
        infoPageUrl: `https://example.com/syosetu/${novelId}`,
      });
    }
    return repo;
  }

  it('create + complete check run lifecycle', () => {
    const repo = createTestRepo();
    repo.createScheduledCheckRun('run-1', '2024-01-01T00:00:00Z');
    repo.completeScheduledCheckRun('run-1', '2024-01-01T00:05:00Z', 10, 3, 2, 1);

    const latest = repo.getLatestCompletedCheckRun();
    assert.ok(latest, 'should find completed run');
    assert.equal(latest.id, 'run-1');
    assert.equal(latest.totalChecked, 10);
    assert.equal(latest.newChaptersFound, 3);
    assert.equal(latest.skipped, 2);
    assert.equal(latest.errored, 1);
  });

  it('getLatestCompletedCheckRun returns undefined when no runs', () => {
    const repo = createTestRepo();
    const latest = repo.getLatestCompletedCheckRun();
    assert.equal(latest, undefined);
  });

  it('recoverIncompleteCheckRuns marks running as completed', () => {
    const repo = createTestRepo();
    repo.createScheduledCheckRun('run-1', '2024-01-01T00:00:00Z');
    repo.recoverIncompleteCheckRuns();

    const latest = repo.getLatestCompletedCheckRun();
    assert.ok(latest);
    assert.equal(latest.status, 'completed');
  });

  it('keeps persisted per-book counts consistent when a round is interrupted', () => {
    const repo = createTestRepo();
    try {
      repo.createScheduledCheckRun('interrupted', '2026-10-24T00:00:00Z');
      for (const result of ['new_chapters', 'up_to_date', 'skipped', 'error'] as const) {
        repo.appendScheduledCheckResult('interrupted', {
          sourceId: 'syosetu', novelId: result, title: result, result, message: result,
          checkedAt: '2026-10-24T00:01:00Z', chapters: [],
        });
      }
      const running = repo.listScheduledCheckRuns(1, 0)[0]!;
      assert.equal(running.totalChecked, 2);
      assert.equal(running.newChaptersFound, 1);
      assert.equal(running.skipped, 1);
      assert.equal(running.errored, 1);
      repo.recoverIncompleteCheckRuns();
      const recovered = repo.getLatestCompletedCheckRun()!;
      assert.deepEqual(recovered.results, running.results);
      assert.equal(recovered.totalChecked, 2);
      assert.equal(recovered.newChaptersFound, 1);
      assert.equal(recovered.skipped, 1);
      assert.equal(recovered.errored, 1);
    } finally { repo.close(); }
  });

  it('listScheduledCheckRuns returns completed runs by newest completion first with pagination', () => {
    const repo = createTestRepo();
    repo.createScheduledCheckRun('run-1', '2024-01-01T00:00:00Z');
    repo.completeScheduledCheckRun('run-1', '2024-01-01T00:05:00Z', 1, 0, 0, 0);
    repo.createScheduledCheckRun('run-2', '2024-01-02T00:00:00Z');
    repo.completeScheduledCheckRun('run-2', '2024-01-02T00:05:00Z', 2, 1, 0, 0);
    repo.createScheduledCheckRun('run-3', '2024-01-03T00:00:00Z');
    repo.completeScheduledCheckRun('run-3', '2024-01-03T00:05:00Z', 3, 2, 0, 0);

    const firstPage = repo.listScheduledCheckRuns(2, 0);
    const secondPage = repo.listScheduledCheckRuns(2, 2);

    assert.deepEqual(firstPage.map((run) => run.id), ['run-3', 'run-2']);
    assert.deepEqual(secondPage.map((run) => run.id), ['run-1']);
    assert.equal(firstPage[0]?.newChaptersFound, 2);
  });

  it('listScheduledSummariesByRunIds returns summaries for selected runs', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n2', true);
    repo.createScheduledSummary({
      runId: 'run-1',
      sourceId: 'syosetu',
      novelId: 'n1',
      chapterIds: ['chapter-1'],
      summary: 'run 1 summary',
      providerId: 'provider-a',
      modelId: 'model-a',
    });
    repo.createScheduledSummary({
      runId: 'run-2',
      sourceId: 'syosetu',
      novelId: 'n2',
      chapterIds: ['chapter-2', 'chapter-3'],
      summary: 'run 2 summary',
      providerId: 'provider-b',
      modelId: 'model-b',
    });

    const summaries = repo.listScheduledSummariesByRunIds(['run-2']);

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.runId, 'run-2');
    assert.deepEqual(summaries[0]?.chapterIds, ['chapter-2', 'chapter-3']);
    assert.equal(repo.getScheduledNovel('syosetu', 'n2')?.hasSummary, true);
  });
});
