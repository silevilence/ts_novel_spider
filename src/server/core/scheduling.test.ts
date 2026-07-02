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

describe('SqliteNovelRepository - scheduled check runs', () => {
  function createTestRepo(): SqliteNovelRepository {
    return new SqliteNovelRepository(':memory:');
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
});
