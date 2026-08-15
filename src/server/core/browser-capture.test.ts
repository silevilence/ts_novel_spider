import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BrowserCaptureService,
  BrowserTransportError,
  type BrowserCaptureAudit,
  type BrowserCapturePairing,
  type BrowserCaptureStore,
  type BrowserCaptureWireMessage,
} from './browser-capture';
import { SqliteNovelRepository } from './novel-repository';

class MemoryBrowserCaptureStore implements BrowserCaptureStore {
  pairings: BrowserCapturePairing[] = [];
  audits: BrowserCaptureAudit[] = [];

  savePairing(pairing: BrowserCapturePairing): void {
    this.pairings = [...this.pairings.filter((entry) => entry.id !== pairing.id), pairing];
  }

  findActivePairingByKeyHash(keyHash: string): BrowserCapturePairing | null {
    return this.pairings.find((entry) => entry.keyHash === keyHash && entry.revokedAt === null) ?? null;
  }

  listPairings(): BrowserCapturePairing[] {
    return [...this.pairings];
  }

  revokePairing(pairingId: string, revokedAt: string): boolean {
    const pairing = this.pairings.find((entry) => entry.id === pairingId);
    if (!pairing || pairing.revokedAt) return false;
    pairing.revokedAt = revokedAt;
    return true;
  }

  touchPairing(pairingId: string, connectedAt: string): void {
    const pairing = this.pairings.find((entry) => entry.id === pairingId);
    if (pairing) pairing.lastConnectedAt = connectedAt;
  }

  saveAudit(audit: BrowserCaptureAudit): void {
    this.audits.push(audit);
  }

  listAudits(): BrowserCaptureAudit[] {
    return [...this.audits].reverse();
  }
}

test('pairing token is short lived, one time, and exchanges for a scoped persistent key', () => {
  let now = Date.parse('2026-08-15T00:00:00.000Z');
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store, now: () => now, pairingTokenTtlMs: 30_000 });

  const token = service.createPairingToken();
  const paired = service.exchangePairingToken(token.token, 'Edge on Surface');

  assert.equal(paired.pairing.name, 'Edge on Surface');
  assert.equal(service.authenticateKey(paired.key)?.id, paired.pairing.id);
  assert.throws(() => service.exchangePairingToken(token.token, 'again'), /invalid or expired/i);

  const expired = service.createPairingToken();
  now += 30_001;
  assert.throws(() => service.exchangePairingToken(expired.token, 'late'), /invalid or expired/i);

  assert.equal(service.revokePairing(paired.pairing.id), true);
  assert.equal(service.authenticateKey(paired.key), null);
});

test('browser fetch dispatches rendered DOM through the connected peer and records an audit', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'test extension');
  const sent: BrowserCaptureWireMessage[] = [];
  const connection = service.connectPeer(paired.key, {
    send(message) {
      sent.push(message);
      if (message.type === 'capture_request') {
        queueMicrotask(() => service.receivePeerMessage(connection.id, {
          type: 'capture_result',
          requestId: message.requestId,
          url: message.url,
          html: '<html><body>rendered</body></html>',
        }));
      }
    },
    close() {},
  });

  const html = await service.fetchHtml(
    { url: 'https://example.test/chapter/1', headers: { 'User-Agent': 'ignored' } },
    { taskId: 'task-1', sourceId: 'example', novelId: 'novel-1', phase: 'chapter' },
  );

  assert.equal(html, '<html><body>rendered</body></html>');
  assert.equal(sent.find((message) => message.type === 'capture_request')?.type, 'capture_request');
  assert.deepEqual(store.listAudits().map(({ taskId, sourceId, status }) => ({ taskId, sourceId, status })), [
    { taskId: 'task-1', sourceId: 'example', status: 'succeeded' },
  ]);
});

test('challenge signal waits for an explicit continue and retries the same page', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'test extension');
  let attempts = 0;
  let connectionId = '';
  const waitingStates: string[] = [];
  service.onTransportState((event) => waitingStates.push(event.state));
  const connection = service.connectPeer(paired.key, {
    send(message) {
      if (message.type !== 'capture_request') return;
      attempts += 1;
      queueMicrotask(() => service.receivePeerMessage(connectionId, attempts === 1
        ? { type: 'capture_signal', requestId: message.requestId, signal: 'challenge', message: 'Cloudflare challenge' }
        : { type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>ok</html>' }));
    },
    close() {},
  });
  connectionId = connection.id;

  const result = service.fetchHtml(
    { url: 'https://example.test/protected' },
    { taskId: 'task-2', sourceId: 'example', novelId: 'novel-2', phase: 'metadata' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(waitingStates, ['waiting_user']);

  service.controlTask('task-2', 'continue');
  assert.equal(await result, '<html>ok</html>');
  assert.equal(attempts, 2);
});

test('disconnect fails pending work with the typed transport_disconnected reason', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'test extension');
  const connection = service.connectPeer(paired.key, { send() {}, close() {} });

  const pending = service.fetchHtml(
    { url: 'https://example.test/chapter/2' },
    { taskId: 'task-3', sourceId: 'example', novelId: 'novel-3', phase: 'chapter' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  service.disconnectPeer(connection.id);

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof BrowserTransportError);
    assert.equal(error.code, 'transport_disconnected');
    return true;
  });
});

test('pairing keys and capture audits survive a service restart without storing the plaintext key', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-capture-store-'));
  const databasePath = path.join(tempDir, 'novels.db');
  try {
    let repository = new SqliteNovelRepository(databasePath);
    let service = new BrowserCaptureService({ store: repository });
    const paired = service.exchangePairingToken(service.createPairingToken().token, 'persistent extension');
    const connection = service.connectPeer(paired.key, {
      send(message) {
        if (message.type === 'capture_request') queueMicrotask(() => service.receivePeerMessage(connection.id, {
          type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>persisted</html>',
        }));
      },
      close() {},
    });
    await service.fetchHtml(
      { url: 'https://example.test/persisted' },
      { taskId: 'persistent-task', sourceId: 'example', novelId: 'persisted', phase: 'chapter' },
    );
    assert.notEqual(repository.listPairings()[0]?.keyHash, paired.key);
    repository.close();

    repository = new SqliteNovelRepository(databasePath);
    service = new BrowserCaptureService({ store: repository });
    assert.equal(service.authenticateKey(paired.key)?.name, 'persistent extension');
    assert.equal(service.listAudits()[0]?.taskId, 'persistent-task');
    repository.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('browser-captured novels cannot enter automatic scheduling', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-capture-schedule-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.saveMetadata('example', {
      novelId: 'browser-only', title: 'Browser only', author: '', description: '', tags: [],
      chapterCount: 0, infoPageUrl: 'https://example.test/browser-only',
    });
    repository.markNovelCaptureTransport('example', 'browser-only', 'browser');
    assert.throws(() => repository.upsertScheduledNovel('example', 'browser-only', true), /浏览器采集小说/);
    assert.deepEqual(repository.getScheduledNovels(), []);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pause defers returned HTML until continue and task audit keeps the requested chapter scope', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'pause test');
  let connectionId = '';
  const connection = service.connectPeer(paired.key, {
    send(message) {
      if (message.type !== 'capture_request') return;
      service.controlTask('task-pause', 'pause');
      service.receivePeerMessage(connectionId, {
        type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>deferred</html>',
      });
    },
    close() {},
  });
  connectionId = connection.id;
  service.registerTaskScope('task-pause', 'example', 'paused', ['chapter-7']);
  let settled = false;
  const pending = service.fetchHtml(
    { url: 'https://example.test/paused' },
    { taskId: 'task-pause', sourceId: 'example', novelId: 'paused', phase: 'chapter' },
  ).finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  service.controlTask('task-pause', 'continue');
  assert.match(await pending, /deferred/);
  service.completeTaskAudit('task-pause', 'succeeded', null);
  const taskAudit = service.listAudits().find((audit) => audit.phase === 'task');
  assert.deepEqual(taskAudit?.chapterIds, ['chapter-7']);
  assert.equal(taskAudit?.status, 'succeeded');
});

test('disconnect between page requests remains a transport_disconnected task failure', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'disconnect test');
  let connectionId = '';
  const connection = service.connectPeer(paired.key, {
    send(message) {
      if (message.type === 'capture_request') service.receivePeerMessage(connectionId, {
        type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>first</html>',
      });
    },
    close() {},
  });
  connectionId = connection.id;
  await service.fetchHtml(
    { url: 'https://example.test/first' },
    { taskId: 'task-between', sourceId: 'example', novelId: 'between', phase: 'metadata' },
  );
  service.disconnectPeer(connection.id);
  await assert.rejects(
    service.fetchHtml(
      { url: 'https://example.test/second' },
      { taskId: 'task-between', sourceId: 'example', novelId: 'between', phase: 'catalog' },
    ),
    (error: unknown) => error instanceof BrowserTransportError && error.code === 'transport_disconnected',
  );
});

test('taskless preview signals remain retryable until the extension returns the corrected page', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'preview signal test');
  let connectionId = '';
  let requestId = '';
  const connection = service.connectPeer(paired.key, {
    send(message) {
      if (message.type !== 'capture_request') return;
      requestId = message.requestId;
      queueMicrotask(() => service.receivePeerMessage(connectionId, {
        type: 'capture_signal',
        requestId: message.requestId,
        signal: 'challenge',
        message: 'Complete the browser challenge.',
      }));
    },
    close() {},
  });
  connectionId = connection.id;

  let settled = false;
  const preview = service.fetchHtml(
    { url: 'https://example.test/preview' },
    { taskId: null, sourceId: 'example', novelId: 'preview', phase: 'metadata' },
  ).finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  service.receivePeerMessage(connectionId, {
    type: 'capture_result', requestId, url: 'https://example.test/preview', html: '<html>verified</html>',
  });
  assert.equal(await preview, '<html>verified</html>');
  assert.deepEqual(store.listAudits().map(({ taskId, status, failureReason }) => ({ taskId, status, failureReason })), [
    { taskId: null, status: 'succeeded', failureReason: null },
  ]);
});

test('taskless preview signals still time out and persist the typed failure', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store, requestTimeoutMs: 10 });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'preview timeout test');
  let connectionId = '';
  const connection = service.connectPeer(paired.key, {
    send(message) {
      if (message.type !== 'capture_request') return;
      queueMicrotask(() => service.receivePeerMessage(connectionId, {
        type: 'capture_signal', requestId: message.requestId, signal: 'challenge', message: 'Complete the challenge.',
      }));
    },
    close() {},
  });
  connectionId = connection.id;

  await assert.rejects(
    service.fetchHtml(
      { url: 'https://example.test/preview-timeout' },
      { taskId: null, sourceId: 'example', novelId: 'preview-timeout', phase: 'metadata' },
    ),
    (error: unknown) => error instanceof BrowserTransportError && error.code === 'challenge',
  );
  assert.equal(store.listAudits()[0]?.failureReason, 'Complete the challenge.');
});

test('disconnect rejects a task that is waiting between browser requests', async () => {
  const store = new MemoryBrowserCaptureStore();
  const service = new BrowserCaptureService({ store });
  const paired = service.exchangePairingToken(service.createPairingToken().token, 'waiting disconnect test');
  let connectionId = '';
  const states: string[] = [];
  service.onTransportState((event) => states.push(event.state));
  const connection = service.connectPeer(paired.key, {
    send(message) {
      if (message.type === 'capture_request') service.receivePeerMessage(connectionId, {
        type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>first</html>',
      });
    },
    close() {},
  });
  connectionId = connection.id;
  service.registerTaskScope('task-waiting', 'example', 'waiting', ['chapter-1']);
  await service.fetchHtml(
    { url: 'https://example.test/first' },
    { taskId: 'task-waiting', sourceId: 'example', novelId: 'waiting', phase: 'metadata' },
  );
  const waiting = service.waitForUser('task-waiting', 'parse_error', 'Fix the page.');

  service.disconnectPeer(connection.id);

  await assert.rejects(
    waiting,
    (error: unknown) => error instanceof BrowserTransportError && error.code === 'transport_disconnected',
  );
  assert.deepEqual(states, ['waiting_user', 'failed']);
});
