import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { LibraryTermTranslationService } from './library-term-translation';
import { TranslationService } from './translation-service';
import { SystemPreferencesService } from './system-preferences';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'term-translation-'));
  const repository = new SqliteNovelRepository(':memory:');
  for (const novelId of ['novel', 'other']) repository.saveMetadata('test', { novelId, title: '物語', author: '', description: '', tags: [], chapterCount: 0, infoPageUrl: '' });
  const preferences = new SystemPreferencesService({ storageFilePath: path.join(directory, 'preferences.json') });
  preferences.updateLlmProviders([{ id: 'fake', type: 'openai-compatible', enabled: true, baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fake', models: ['local', 'global', 'default'].map((id) => ({ id, modelId: id, enabled: true, capabilityMode: 'manual', capabilities: ['chat'] })) }]);
  preferences.updateModelGateway({ chat: { providerId: 'fake', modelId: 'default' } });
  const add = (sourceTerm: string, options: Partial<Parameters<SqliteNovelRepository['createTranslationTerm']>[0]> = {}) => repository.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm, ...options });
  const cleanup = () => { repository.close(); fs.rmSync(directory, { recursive: true, force: true }); };
  return { repository, preferences, add, cleanup };
}

function translatePrompt(prompt: string) {
  const { terms } = JSON.parse(prompt) as { terms: Array<{ id: string; sourceTerm: string }> };
  return JSON.stringify({ terms: terms.map((term) => ({ id: term.id, targetTerm: `译文-${term.sourceTerm}` })) });
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('background translation timed out');
}

test('translates all confirmed gaps in batches and preserves other terms and metadata', async () => {
  const { repository, preferences, add, cleanup } = fixture();
  const submitted: string[] = [];
  const service = new LibraryTermTranslationService(repository, preferences, async (_p, _route, system, prompt) => {
    assert.match(system, /ja.*zh-CN/);
    const batch = (JSON.parse(prompt) as { terms: Array<{ id: string }> }).terms;
    assert.ok(batch.length <= 20);
    submitted.push(...batch.map((term) => term.id));
    return translatePrompt(prompt);
  });
  try {
    const missing = Array.from({ length: 43 }, (_, i) => add(`term-${i}`, { targetTerm: i % 2 ? ' ' : null, entityType: 'character', note: '名字', priority: 5 }));
    const untouched = [add('pending', { status: 'pending' }), add('excluded', { status: 'excluded' }), add('translated', { targetTerm: '人工译文' }), add('other-book', { novelId: 'other' })];
    assert.equal(service.start('test', 'novel').totalTerms, 43);
    assert.throws(() => service.start('test', 'novel'), /正在运行/);
    await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
    const run = service.getRun('test', 'novel')!;
    assert.equal(run.status, 'completed');
    assert.equal(run.processedTerms, 43);
    assert.equal(run.translatedTerms, 43);
    assert.equal(run.skippedTerms, 0);
    assert.deepEqual(new Set(submitted), new Set(missing.map((term) => term.id)));
    const actual = repository.listTranslationTerms('test', 'novel');
    for (const original of missing) {
      const term = actual.find((item) => item.id === original.id)!;
      assert.deepEqual({ ...term, targetTerm: original.targetTerm, updatedAt: original.updatedAt }, original);
      assert.equal(term.targetTerm, `译文-${term.sourceTerm}`);
    }
    for (const original of untouched) assert.deepEqual(repository.listTranslationTerms('test', original.novelId).find((term) => term.id === original.id), original);
    assert.throws(() => service.start('test', 'novel'), /没有已确认/);
  } finally { cleanup(); }
});

test('uses saved local/global/default glossary model precedence and novel languages', async () => {
  const { repository, preferences, add, cleanup } = fixture();
  const routes: string[] = [];
  const service = new LibraryTermTranslationService(repository, preferences, async (_p, route, system, prompt) => {
    routes.push(route.modelId);
    assert.match(system, /从 en 翻译为 fr/);
    return translatePrompt(prompt);
  });
  try {
    const profile = new TranslationService(repository, preferences);
    profile.updateTranslationProfile('test', 'novel', { sourceLang: 'en', targetLang: 'fr', termExtractionModel: { providerId: 'fake', modelId: 'local' } });
    preferences.updateTranslationPreferences({ termExtractionModel: { providerId: 'fake', modelId: 'global' } });
    for (const expected of ['local', 'global', 'default']) {
      add(expected);
      service.start('test', 'novel');
      await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
      assert.equal(service.getRun('test', 'novel')?.status, 'completed');
      assert.equal(routes.at(-1), expected);
      if (expected === 'local') profile.updateTranslationProfile('test', 'novel', { termExtractionModel: null });
      else preferences.updateTranslationPreferences({ termExtractionModel: null });
    }
    add('invalid-model');
    profile.updateTranslationProfile('test', 'novel', { termExtractionModel: { providerId: 'missing', modelId: 'missing' } });
    assert.throws(() => service.start('test', 'novel'), /模型不可用/);
    assert.throws(() => service.start('test', 'missing'), /小说不存在/);
    repository.moveNovelToTrash('test', 'novel');
    assert.throws(() => service.start('test', 'novel'), /回收站/);
  } finally { cleanup(); }
});

test('in-flight results do not overwrite manual translations, excluded terms or deleted terms', async () => {
  const { repository, preferences, add, cleanup } = fixture();
  let finish!: () => void;
  const service = new LibraryTermTranslationService(repository, preferences, async (_p, _r, _s, prompt) => new Promise<string>((resolve) => { finish = () => resolve(translatePrompt(prompt)); }));
  try {
    const manual = add('manual');
    const excluded = add('excluded');
    const deleted = add('deleted');
    add('keep');
    service.start('test', 'novel');
    repository.updateTranslationTerm('test', 'novel', manual.id, { targetTerm: '我的译文' });
    repository.bulkUpdateTranslationTermStatus('test', 'novel', [excluded.id], 'excluded');
    repository.deleteTranslationTerm('test', 'novel', deleted.id);
    finish();
    await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
    assert.equal(service.getRun('test', 'novel')?.translatedTerms, 1);
    assert.equal(service.getRun('test', 'novel')?.skippedTerms, 3);
    const terms = repository.listTranslationTerms('test', 'novel');
    assert.equal(terms.find((term) => term.id === manual.id)?.targetTerm, '我的译文');
    assert.equal(terms.find((term) => term.id === excluded.id)?.targetTerm, null);
    assert.equal(terms.find((term) => term.id === deleted.id), undefined);
  } finally { cleanup(); }
});

test('failed batches retain earlier results and retry processes only remaining gaps', async () => {
  const { repository, preferences, add, cleanup } = fixture();
  let calls = 0;
  const service = new LibraryTermTranslationService(repository, preferences, async (_p, _r, _s, prompt) => ++calls === 2 ? '{"terms":[]}' : translatePrompt(prompt));
  try {
    for (let i = 0; i < 21; i++) add(`term-${i}`);
    service.start('test', 'novel');
    await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
    assert.equal(service.getRun('test', 'novel')?.status, 'failed');
    assert.equal(service.getRun('test', 'novel')?.translatedTerms, 20);
    assert.equal(repository.listMissingTranslationTerms('test', 'novel').length, 1);
    assert.equal(service.start('test', 'novel').totalTerms, 1);
    await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
    assert.equal(service.getRun('test', 'novel')?.status, 'completed');
    assert.equal(repository.listMissingTranslationTerms('test', 'novel').length, 0);
  } finally { cleanup(); }
});

for (const response of ['not JSON', '{"terms":[{"id":"foreign-id","targetTerm":"译文"}]}', '{"terms":[{"id":"foreign-id","targetTerm":" "}]}']) {
  test(`invalid output never writes translations: ${response}`, async () => {
    const { repository, preferences, add, cleanup } = fixture();
    const service = new LibraryTermTranslationService(repository, preferences, async () => response);
    try {
      add('missing');
      service.start('test', 'novel');
      await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
      assert.equal(service.getRun('test', 'novel')?.status, 'failed');
      assert.equal(repository.listMissingTranslationTerms('test', 'novel').length, 1);
    } finally { cleanup(); }
  });
}

test('cancelled late replies cannot write or replace a newer run, and restart recovers progress', async () => {
  const { repository, preferences, add, cleanup } = fixture();
  let finish!: () => void;
  let calls = 0;
  const service = new LibraryTermTranslationService(repository, preferences, async (_p, _r, _s, prompt) => {
    if (++calls === 1) return new Promise<string>((resolve) => { finish = () => resolve(translatePrompt(prompt)); });
    return translatePrompt(prompt);
  });
  try {
    add('missing');
    service.start('test', 'novel');
    assert.equal(service.cancel('test', 'novel')?.status, 'cancelled');
    const next = service.start('test', 'novel');
    finish();
    await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
    assert.equal(service.getRun('test', 'novel')?.id, next.id);
    assert.equal(service.getRun('test', 'novel')?.translatedTerms, 1);
    const completed = service.getRun('test', 'novel')!;
    repository.saveTermTranslationRun({ ...completed, status: 'running' });
    new LibraryTermTranslationService(repository, preferences).recoverInterruptedRuns();
    assert.equal(service.getRun('test', 'novel')?.status, 'failed');
    assert.equal(service.getRun('test', 'novel')?.translatedTerms, 1);
    assert.equal(repository.listMissingTranslationTerms('test', 'novel').length, 0);
  } finally { cleanup(); }
});

test('a novel moved to trash while generation runs cannot receive a late translation', async () => {
  const { repository, preferences, add, cleanup } = fixture();
  let finish!: () => void;
  const service = new LibraryTermTranslationService(repository, preferences, async (_p, _r, _s, prompt) => new Promise<string>((resolve) => { finish = () => resolve(translatePrompt(prompt)); }));
  try {
    add('missing');
    service.start('test', 'novel');
    repository.moveNovelToTrash('test', 'novel');
    finish();
    await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
    assert.equal(service.getRun('test', 'novel')?.status, 'failed');
    assert.equal(repository.listMissingTranslationTerms('test', 'novel').length, 1);
  } finally { cleanup(); }
});
