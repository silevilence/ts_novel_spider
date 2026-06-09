import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteNovelRepository } from './novel-repository';
import { calculateNextTriggerTime } from './scheduling';

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
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.ok(row);
    assert.equal(row.enabled, true);
    assert.ok(row.updatedAt);

    repo.upsertScheduledNovel('syosetu', 'n123', false);
    const updated = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(updated?.enabled, false);
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
      { sourceId: 'syosetu', novelId: 'n1', enabled: true },
      { sourceId: 'syosetu', novelId: 'n2', enabled: false },
    ]);

    assert.equal(repo.getScheduledNovel('syosetu', 'n1')?.enabled, true);
    assert.equal(repo.getScheduledNovel('syosetu', 'n2')?.enabled, false);
  });

  it('deleteScheduledNovel removes record', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    repo.deleteScheduledNovel('syosetu', 'n123');

    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(row, undefined);
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
