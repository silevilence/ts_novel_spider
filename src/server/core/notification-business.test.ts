import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MockHtmlSpiderAdapter } from '../adapters/spider/mock-html-spider-adapter';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { NotificationService } from './notification-service';
import { SchedulingService } from './scheduling';
import { SpiderLogDispatcher } from './logging';
import { ControlCenterService, type SpiderRegistryEntry } from './control-center';
import type { NotificationEvent } from '../contracts/notification';

function fixture(failChapterIds: string[] = [], transient = false): SpiderRegistryEntry {
  return { descriptor: { sourceId: 'mock-html', label: 'mock', description: 'mock', defaultNovelId: 'n1' }, spider: new MockHtmlSpiderAdapter({
    metadataHtml: '<h1 data-testid="title">小说</h1><div data-testid="author">作者</div><div data-testid="description">简介</div><div data-testid="chapter-count">2</div>',
    catalogHtml: '<ol data-testid="catalog"><li data-chapter-id="c1"><a href="/1">第一章</a></li><li data-chapter-id="c2"><a href="/2">第二章</a></li></ol>',
    chapterHtmlById: Object.fromEntries(['c1', 'c2'].map((id) => [id, `<h1 data-testid="chapter-title">${id}</h1><div data-testid="content"><p>正文</p></div>`])),
    failChapterIds, ...(transient ? { transientFailuresByChapterId: { c1: 1 } } : {}),
  }) };
}
function preferences() {
  const prefs = new SystemPreferencesService();
  prefs.updateNotification({ enabled: true, errorEnabled: true, channel: 'astrbot', baseUrl: 'http://localhost:6185', target: { umo: 'qq:GroupMessage:123' }, keyAction: 'replace', apiKey: 'abk_test' });
  return prefs;
}
function seed(repo: SqliteNovelRepository, id = 'n1') {
  repo.saveMetadata('mock-html', { novelId: id, title: '小说', author: '作者', description: '', tags: [], chapterCount: 2, infoPageUrl: 'https://mock.example/novels/n1' });
}

test('scheduled notifications default off, survive partial saves/trash/restore and migrate old databases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-db-')); const file = path.join(dir, 'novels.db');
  let repo = new SqliteNovelRepository(file);
  try {
    seed(repo); repo.upsertScheduledNovel('mock-html', 'n1', true);
    assert.equal(repo.getScheduledNovel('mock-html', 'n1')?.notifyOnUpdate, false);
    repo.bulkUpsertScheduledNovels([{ sourceId: 'mock-html', novelId: 'n1', enabled: true, notifyOnUpdate: true }]);
    repo.upsertScheduledNovel('mock-html', 'n1', false);
    assert.equal(repo.getScheduledNovel('mock-html', 'n1')?.notifyOnUpdate, true);
    repo.moveNovelToTrash('mock-html', 'n1'); repo.restoreNovelFromTrash('mock-html', 'n1');
    assert.equal(repo.getScheduledNovel('mock-html', 'n1')?.notifyOnUpdate, true);
    assert.equal(repo.getScheduledNovel('mock-html', 'n1')?.enabled, false);
    repo.close(); repo = new SqliteNovelRepository(file);
    assert.equal(repo.getScheduledNovel('mock-html', 'n1')?.notifyOnUpdate, true);
    repo.close();
    const db = new Database(file); db.exec('ALTER TABLE scheduled_novels DROP COLUMN notify_on_update'); db.close();
    repo = new SqliteNovelRepository(file);
    assert.equal(repo.getScheduledNovel('mock-html', 'n1')?.notifyOnUpdate, false);
  } finally { repo.close(); fs.rmSync(dir, { recursive: true }); }
});

test('scheduled downloads notify successes before translation and report partial or total failures at round end', async (t) => {
  for (const failed of [[], ['c2'], ['c1', 'c2']]) {
    const repo = new SqliteNovelRepository(':memory:'); const prefs = preferences(); const texts: string[] = [];
    seed(repo); repo.upsertScheduledNovel('mock-html', 'n1', true, true, false, null, true);
    const notifications = new NotificationService(repo, prefs, new Map([['astrbot', { send: async (_config, text: string) => { texts.push(text); return { status: 'accepted' as const, category: 'accepted' as const, message: 'ok', retryable: false }; } }]]));
    const callbacks: Array<() => void> = [];
    t.mock.method(globalThis, 'setInterval', (callback: () => void) => { callbacks.push(callback); return 0; });
    t.mock.method(globalThis, 'clearInterval', () => {});
    let complete = () => {};
    let notificationsBeforeTranslation: number | undefined;
    prefs.updateScheduling({ enabled: true });
    const scheduler = new SchedulingService({ repository: repo, preferences: prefs, spiderRegistry: [fixture(failed)], controlCenter: { getActiveTaskNovelKeys: () => [] },
      notifications, logger: new SpiderLogDispatcher([{ log: async (event) => { if (event.type === 'scheduling_round_completed') complete(); } }]),
      translation: { getAutoTranslationReadiness: () => {
        notificationsBeforeTranslation = repo.listNotifications().length;
        return { ready: false, reason: 'not configured' };
      }, startTranslation: () => { throw new Error('unused'); } },
      summary: { getAutoSummaryReadiness: () => ({ ready: false }), summarizeNewChapters: async () => { throw new Error('unused'); } },
    });
    async function run() {
      const done = new Promise<void>((resolve) => { complete = resolve; });
      scheduler.scheduleNextTick({ ...prefs.getScheduling(), intervalHours: 0 });
      callbacks[0]!(); await done; await new Promise<void>((resolve) => setImmediate(resolve));
    }
    try {
      scheduler.start(); await run(); await notifications.drain();
      assert.equal(texts.length, 1);
      assert.equal(notificationsBeforeTranslation, failed.length ? 0 : 1);
      assert.match(texts[0]!, new RegExp(`发现 2 章，成功下载 ${2 - failed.length} 章，失败 ${failed.length} 章`));
      for (const chapterId of failed) assert.ok(texts[0]!.includes(`Permanent failure for ${chapterId}`));
      await run(); await notifications.drain(); assert.equal(texts.length, 1, 'no new chapters sends nothing');
      const entry = repo.listNotifications()[0]!;
      assert.equal(notifications.submit(entry.event), false);
    } finally { scheduler.stop(); notifications.close(); repo.close(); t.mock.restoreAll(); }
  }
});

test('one scan collects check and download failures for all books even when the notifier throws', async (t) => {
  const repo = new SqliteNovelRepository(':memory:'); const prefs = preferences(); prefs.updateScheduling({ enabled: true });
  seed(repo, 'n1'); seed(repo, 'n2'); repo.upsertScheduledNovel('mock-html', 'n1', true); repo.upsertScheduledNovel('mock-html', 'n2', true);
  seed(repo, 'n3'); repo.upsertScheduledNovel('mock-html', 'n3', true, false, false, null, true);
  const source = fixture(['c2']);
  const metadata = source.spider.fetchMetadata.bind(source.spider);
  source.spider.fetchMetadata = async (context) => {
    if (context.novelId === 'n1') throw new Error('目录服务不可用');
    if (context.novelId === 'n2' && fetchingDownload) throw new Error('下载连接中断');
    if (context.novelId === 'n2') fetchingDownload = true;
    return metadata(context);
  };
  let fetchingDownload = false;
  const events: NotificationEvent[] = [];
  let tick = () => {}; let complete = () => {};
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; return 0; }); t.mock.method(globalThis, 'clearInterval', () => {});
  const scheduler = new SchedulingService({ repository: repo, preferences: prefs, spiderRegistry: [source], controlCenter: { getActiveTaskNovelKeys: () => [] },
    notifications: { submit: (event) => { events.push(event); throw new Error('notification broken'); } },
    logger: new SpiderLogDispatcher([{ log: async (event) => { if (event.type === 'scheduling_round_completed') complete(); } }]),
    translation: { getAutoTranslationReadiness: () => ({ ready: false }), startTranslation: () => { throw new Error('unused'); } },
    summary: { getAutoSummaryReadiness: () => ({ ready: false }), summarizeNewChapters: async () => { throw new Error('unused'); } },
  });
  try {
    const done = new Promise<void>((resolve) => { complete = resolve; }); scheduler.start(); scheduler.scheduleNextTick({ ...prefs.getScheduling(), intervalHours: 0 }); tick(); await done;
    assert.equal(events.length, 1);
    const failures = events[0]?.scanFailures;
    assert.equal(failures?.length, 3);
    for (const [id, reason, subscribed] of [
      ['n1', '目录服务不可用', false], ['n2', '下载连接中断', false], ['n3', 'Permanent failure for c2', true],
    ] as const) {
      const failure = failures?.find((item) => item.description.includes(`mock-html/${id}`));
      assert.ok(failure?.description.includes(reason));
      assert.equal(failure.notifyOnUpdate, subscribed);
    }
  } finally { scheduler.stop(); repo.close(); }
});

test('crawl final failures are notified once, while successful retry and user cancellation produce no alert', async () => {
  for (const scenario of ['partial', 'all', 'fatal', 'retry', 'cancel'] as const) {
    const repo = new SqliteNovelRepository(':memory:'); const texts: string[] = [];
    const source = fixture(scenario === 'all' ? ['c1', 'c2'] : scenario === 'partial' ? ['c2'] : [], scenario === 'retry');
    if (scenario === 'fatal') source.spider.fetchMetadata = async () => { throw new Error('metadata fetch failed'); };
    if (scenario === 'cancel') {
      const { BrowserTransportError } = await import('./browser-capture');
      source.spider.fetchMetadata = async () => { throw new BrowserTransportError('capture_aborted', 'user cancelled'); };
    }
    const service = new ControlCenterService({ repository: repo, systemPreferences: preferences(), spiders: [source], notificationChannel: { send: async (_config, text) => { texts.push(text); return { status: 'accepted', category: 'accepted', message: 'ok', retryable: false }; } } });
    try {
      const task = service.createTask({ sourceId: 'mock-html', novelId: 'n1', chapterRetryCount: scenario === 'retry' ? 1 : 0 });
      for (let i = 0; i < 500; i++) {
        if (['completed', 'failed', 'aborted'].includes(service.getTask(task.id)!.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(['completed', 'failed', 'aborted'].includes(service.getTask(task.id)!.status));
      await service.drainNotifications();
      assert.equal(texts.length, scenario === 'partial' || scenario === 'all' || scenario === 'fatal' ? 1 : 0);
    } finally { service.close(); repo.close(); }
  }
});
