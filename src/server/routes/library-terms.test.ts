import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLibraryServer, waitForServerListening, closeServer } from './library-test-helpers';
import { SystemPreferencesService } from '../core/system-preferences';

test('library term APIs validate statuses, scope bulk writes and expose extraction failures without starting a run', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'library-terms-api-'));
  const { app, cleanup, repository } = createLibraryServer({ systemPreferences: new SystemPreferencesService({ storageFilePath: path.join(temp, 'preferences.json') }) });
  const server = app.listen(0, '127.0.0.1');
  try {
    const base = `${await waitForServerListening(server)}/api/library/novels/syosetu/n1000lib/translate`;
    const pending = repository.createTranslationTerm({ sourceId: 'syosetu', novelId: 'n1000lib', sourceTerm: '艾琳', status: 'pending' });
    const json = (body: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await fetch(`${base}/terms/bulk-status`, json({ termIds: [pending.id, 'unrelated-id'], status: 'confirmed' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { terms: unknown[] }).terms.length, 1);
    assert.equal((await fetch(`${base}/terms?status=pending`).then((r) => r.json()) as { terms: unknown[] }).terms.length, 0);
    assert.equal((await fetch(`${base}/terms?status=invalid`)).status, 422);
    assert.equal((await fetch(`${base}/terms?status=pending&status=confirmed`)).status, 422);
    assert.equal((await fetch(`${base}/terms/${pending.id}`, json({ status: 'invalid' }, 'PUT'))).status, 422);
    assert.equal((await fetch(`${base}/terms/bulk-status`, json({ termIds: [pending.id], status: 'invalid' }))).status, 422);
    assert.equal((await fetch(`${base}/terms/${pending.id}`, json({ status: 'excluded' }, 'PUT'))).status, 200);
    assert.equal(repository.listTranslationTerms('syosetu', 'n1000lib')[0]?.status, 'excluded');
    assert.equal((await fetch(`${base}/term-extraction`, { method: 'POST' })).status, 422);
    assert.deepEqual(await fetch(`${base}/term-extraction`).then((r) => r.json()), { run: null });
    assert.deepEqual(await fetch(`${base}/term-extraction/cancel`, { method: 'POST' }).then((r) => r.json()), { run: null });
    const profile = await fetch(`${base}/profile`).then((r) => r.json()) as { translation: { termExtractionModel: unknown } };
    assert.equal(profile.translation.termExtractionModel, null);
  } finally { await closeServer(server); cleanup(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('control center bootstrap recovers interrupted extraction runs and preserves completed batches', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'library-terms-recovery-'));
  const { cleanup, repository } = createLibraryServer({
    systemPreferences: new SystemPreferencesService({ storageFilePath: path.join(temp, 'preferences.json') }),
    beforeControlCenter: (db) => {
      db.saveTermExtractionRun({
        id: 'interrupted', sourceId: 'syosetu', novelId: 'n1000lib', status: 'running',
        totalBatches: 3, completedBatches: 1, candidates: 2, added: 2,
        startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', errorMessage: null,
      });
    },
  });
  try {
    const run = repository.getTermExtractionRun('syosetu', 'n1000lib');
    assert.equal(run?.id, 'interrupted');
    assert.equal(run?.status, 'failed');
    assert.equal(run?.completedBatches, 1);
    assert.equal(run?.added, 2);
    assert.match(run?.errorMessage ?? '', /服务重启/);
  } finally { cleanup(); fs.rmSync(temp, { recursive: true, force: true }); }
});
