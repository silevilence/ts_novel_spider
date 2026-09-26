import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLibraryServer, waitForServerListening, closeServer } from './library-test-helpers';
import { SystemPreferencesService } from '../core/system-preferences';
import type { StoredTermTranslationRun } from '../core/novel-repository';

test('term translation API starts background generation, reports progress and cancels requests', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'library-term-translation-api-'));
  let finish: (() => void) | undefined;
  const llm = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const messages = (JSON.parse(body) as { messages: Array<{ role: string; content: string }> }).messages;
    const input = JSON.parse(messages.find((message) => message.role === 'user')!.content) as { terms: Array<{ id: string }> };
    finish = () => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ id: 'fake', object: 'chat.completion', created: 1, model: 'fake', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ terms: input.terms.map((term) => ({ id: term.id, targetTerm: '艾琳' })) }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    };
  });
  llm.listen(0, '127.0.0.1');
  const llmUrl = await waitForServerListening(llm);
  const preferences = new SystemPreferencesService({ storageFilePath: path.join(temp, 'preferences.json') });
  preferences.updateLlmProviders([{ id: 'fake', type: 'openai-compatible', enabled: true, baseUrl: `${llmUrl}/v1`, apiKey: 'fake', models: [{ id: 'fake', modelId: 'fake', enabled: true, capabilityMode: 'manual', capabilities: ['chat'] }] }]);
  preferences.updateModelGateway({ chat: { providerId: 'fake', modelId: 'fake' } });
  const { app, repository, cleanup } = createLibraryServer({ systemPreferences: preferences });
  const server = app.listen(0, '127.0.0.1');
  try {
    const base = `${await waitForServerListening(server)}/api/library/novels/syosetu/n1000lib/translate/term-translation`;
    const term = repository.createTranslationTerm({ sourceId: 'syosetu', novelId: 'n1000lib', sourceTerm: 'エリン' });
    for (const cancel of [false, true]) {
      finish = undefined;
      const response = await fetch(base, { method: 'POST' });
      assert.equal(response.status, 202);
      const initial = await response.json() as { run: StoredTermTranslationRun };
      assert.equal(initial.run.totalTerms, 1);
      assert.equal(initial.run.status, 'running');
      assert.equal((await fetch(base, { method: 'POST' })).status, 422);
      for (let i = 0; i < 500 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(finish, 'fake model should receive the request');
      if (cancel) {
        const cancelled = await fetch(`${base}/cancel`, { method: 'POST' }).then((r) => r.json()) as { run: StoredTermTranslationRun };
        assert.equal(cancelled.run.status, 'cancelled');
      }
      finish();
      let run: StoredTermTranslationRun | undefined;
      for (let i = 0; i < 500; i++) {
        run = (await fetch(base).then((r) => r.json()) as { run: StoredTermTranslationRun }).run;
        if (run.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(run?.status, cancel ? 'cancelled' : 'completed');
      assert.equal(repository.listTranslationTerms('syosetu', 'n1000lib')[0]?.targetTerm, cancel ? null : '艾琳');
      repository.updateTranslationTerm('syosetu', 'n1000lib', term.id, { targetTerm: null });
    }
  } finally {
    await closeServer(server);
    llm.closeAllConnections();
    await closeServer(llm);
    cleanup();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

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
    assert.equal((await fetch(`${base}/term-translation`, { method: 'POST' })).status, 422);
    assert.deepEqual(await fetch(`${base}/term-translation`).then((r) => r.json()), { run: null });
    assert.deepEqual(await fetch(`${base}/term-translation/cancel`, { method: 'POST' }).then((r) => r.json()), { run: null });
    repository.createTranslationTerm({ sourceId: 'syosetu', novelId: 'n1000lib', sourceTerm: '缺译' });
    const unavailable = await fetch(`${base}/term-translation`, { method: 'POST' });
    assert.equal(unavailable.status, 422);
    assert.match((await unavailable.json() as { message: string }).message, /模型不可用/);
    const profile = await fetch(`${base}/profile`).then((r) => r.json()) as { translation: { termExtractionModel: unknown; termExtractionThinkingEnabled: boolean } };
    assert.equal(profile.translation.termExtractionModel, null);
    assert.equal(profile.translation.termExtractionThinkingEnabled, false);
    for (const enabled of [true, false]) {
      const saved = await fetch(`${base}/profile`, json({ termExtractionThinkingEnabled: enabled }, 'PUT'));
      assert.equal(saved.status, 200);
      const read = await fetch(`${base}/profile`).then((r) => r.json()) as { translation: { termExtractionThinkingEnabled: boolean } };
      assert.equal(read.translation.termExtractionThinkingEnabled, enabled);
    }
    assert.equal((await fetch(`${base}/profile`, json({ termExtractionThinkingEnabled: 'false' }, 'PUT'))).status, 422);
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
      db.saveTermTranslationRun({
        id: 'interrupted-translation', sourceId: 'syosetu', novelId: 'n1000lib', status: 'running',
        totalTerms: 40, processedTerms: 20, translatedTerms: 18, skippedTerms: 2,
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
    const translation = repository.getTermTranslationRun('syosetu', 'n1000lib');
    assert.equal(translation?.status, 'failed');
    assert.equal(translation?.translatedTerms, 18);
    assert.equal(translation?.skippedTerms, 2);
    assert.match(translation?.errorMessage ?? '', /服务重启/);
  } finally { cleanup(); fs.rmSync(temp, { recursive: true, force: true }); }
});
