import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { NotificationService } from './notification-service';
import type { NotificationChannel } from './notification-channel';
import type { NotificationConfigInput, NotificationEvent, NotificationResult } from '../contracts/notification';

const config: NotificationConfigInput = { enabled: true, errorEnabled: true, channel: 'astrbot', baseUrl: 'http://localhost:6185', target: { umo: 'qq:GroupMessage:123' }, keyAction: 'replace', apiKey: 'secret-test' };
const event: NotificationEvent = { id: 'task:1', kind: '采集', sourceId: 'mock', novelId: 'n1', runId: '1', title: '测试小说', summary: 'secret-test failed', error: true, occurredAt: '2026-10-23T00:00:00Z' };
const accepted: NotificationResult = { status: 'accepted', category: 'accepted', message: 'accepted', retryable: false };

test('notification preferences migrate, persist across other saves, mask and preserve/replace/clear keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-prefs-'));
  const file = path.join(dir, 'prefs.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ llmProviders: [], neo4j: { enabled: false } }));
    const prefs = new SystemPreferencesService({ storageFilePath: file });
    assert.equal(prefs.getNotification().enabled, false);
    prefs.updateNotification(config);
    assert.ok(!JSON.stringify(prefs.getNotification()).includes('secret-test'));
    prefs.updateScheduling({ enabled: false });
    const restored = new SystemPreferencesService({ storageFilePath: file });
    assert.equal(restored.resolveNotification().apiKey, 'secret-test');
    restored.updateNotification({ ...config, keyAction: 'keep', apiKey: 'ignored' });
    assert.equal(restored.resolveNotification().apiKey, 'secret-test');
    restored.updateNotification({ ...config, apiKey: 'replacement' });
    assert.equal(restored.resolveNotification().apiKey, 'replacement');
    assert.throws(() => restored.updateNotification({ ...config, keyAction: 'clear' }));
    restored.updateNotification({ ...config, enabled: false, keyAction: 'clear' });
    assert.equal(new SystemPreferencesService({ storageFilePath: file }).getNotification().keyConfigured, false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('backend sends asynchronously, deduplicates across service restarts, and redacts records and payloads', async () => {
  const repo = new SqliteNovelRepository(':memory:');
  const prefs = new SystemPreferencesService(); prefs.updateNotification(config);
  const texts: string[] = [];
  const channels = new Map<string, NotificationChannel>([['astrbot', { send: async (_config, text) => { texts.push(text); return accepted; } }]]);
  const service = new NotificationService(repo, prefs, channels);
  try {
    assert.equal(service.submit(event), true);
    assert.equal(texts.length, 0);
    assert.equal(service.submit(event), false);
    await service.drain();
    assert.equal(texts.length, 1);
    assert.ok(!texts[0]!.includes('secret-test'));
    assert.ok(!JSON.stringify(repo.listNotifications()).includes('secret-test'));
    assert.equal(repo.listNotifications()[0]?.status, 'accepted');
    service.close();
    const restarted = new NotificationService(repo, prefs, channels);
    assert.equal(restarted.submit(event), false);
    restarted.close();
  } finally { service.close(); repo.close(); }
});

test('retry is bounded; authentication failure, timeout and exceptions never loop or generate alerts', async () => {
  for (const scenario of ['retry', 'auth', 'timeout', 'throw'] as const) {
    const repo = new SqliteNovelRepository(':memory:'); const prefs = new SystemPreferencesService(); prefs.updateNotification(config);
    let calls = 0; const logs: string[] = [];
    const channel: NotificationChannel = { send: async () => {
      calls++;
      if (scenario === 'timeout') return new Promise(() => {});
      if (scenario === 'throw') throw new Error('secret-test');
      return { status: 'failed', category: scenario === 'auth' ? 'authentication' : 'unavailable', retryable: scenario === 'retry', message: 'secret-test rejected' };
    } };
    const service = new NotificationService(repo, prefs, new Map([['astrbot', channel]]), { timeoutMs: 5, retryDelayMs: 1, localLog: (message) => logs.push(message) });
    try {
      service.submit(event); await service.drain();
      assert.equal(calls, scenario === 'retry' ? 3 : 1);
      assert.equal(repo.listNotifications().length, 1);
      assert.equal(repo.listNotifications()[0]?.status, scenario === 'timeout' || scenario === 'throw' ? 'unknown' : 'failed');
      assert.ok(!JSON.stringify([logs, repo.listNotifications()]).includes('secret-test'));
    } finally { service.close(); repo.close(); }
  }
});

test('global/error/update switches combine into one send and explicit tests work while disabled', async () => {
  const repo = new SqliteNovelRepository(':memory:'); const prefs = new SystemPreferencesService();
  let calls = 0;
  const service = new NotificationService(repo, prefs, new Map([['astrbot', { send: async () => { calls++; return accepted; } }]]));
  try {
    let id = 0;
    for (const enabled of [false, true]) for (const errorEnabled of [false, true]) for (const updateEnabled of [false, true]) for (const error of [false, true]) {
      prefs.updateNotification({ ...config, enabled, errorEnabled });
      const before = calls;
      service.submit({ ...event, id: String(id++), error, update: { discovered: 2, downloaded: error ? 1 : 2, failed: error ? 1 : 0, enabled: updateEnabled } });
      await service.drain();
      assert.equal(calls - before, enabled && (updateEnabled || error && errorEnabled) ? 1 : 0);
    }
    const result = await service.test({ ...prefs.resolveNotification(), enabled: false });
    assert.equal(result.status, 'accepted');
    const shortKeyResult = await service.test({ ...prefs.resolveNotification(), enabled: false, apiKey: 'test' });
    assert.equal(shortKeyResult.status, 'accepted', 'redaction must not change the stable lookup ID');
  } finally { service.close(); repo.close(); }
});

test('notification persistence failure is isolated and in-flight shutdown is recorded without resending', async () => {
  const repo = new SqliteNovelRepository(':memory:'); const prefs = new SystemPreferencesService(); prefs.updateNotification(config);
  const service = new NotificationService(repo, prefs, new Map([['astrbot', { send: async () => new Promise(() => {}) }]]), { timeoutMs: 5, localLog: () => {} });
  service.submit(event); await Promise.resolve(); service.close();
  assert.equal(repo.listNotifications()[0]?.status, 'unknown');
  await service.drain(); repo.close();
  assert.equal(service.submit(event), false);
  const broken = new NotificationService({ recoverNotifications() {}, insertNotification() { throw new Error('disk'); }, saveNotification() {}, getNotification() { return null; }, listNotifications() { return []; } }, prefs, new Map(), { localLog: () => {} });
  assert.equal(broken.submit(event), false); broken.close();
});

test('queued background events honor disabling and connection changes before sending', async () => {
  for (const change of [{ enabled: false }, { errorEnabled: false }, { baseUrl: 'http://changed:6185' }, { target: { umo: 'qq:GroupMessage:other' } }]) {
    const repo = new SqliteNovelRepository(':memory:'); const prefs = new SystemPreferencesService(); prefs.updateNotification(config);
    let calls = 0;
    const service = new NotificationService(repo, prefs, new Map([['astrbot', { send: async () => { calls++; return accepted; } }]]));
    try {
      service.submit(event); prefs.updateNotification({ ...config, ...change }); await service.drain();
      assert.equal(calls, 0); assert.equal(repo.listNotifications()[0]?.status, 'skipped');
    } finally { service.close(); repo.close(); }
  }
});
