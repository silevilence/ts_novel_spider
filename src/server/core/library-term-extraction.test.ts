import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteNovelRepository } from './novel-repository';
import { LibraryTermExtractionService } from './library-term-extraction';
import { TranslationService } from './translation-service';
import { SystemPreferencesService } from './system-preferences';
import { buildGlossaryExtractionPrompt, buildGlossarySourceWindows, parseGlossaryCandidates } from './glossary-extraction';
import { RefinedTranslationService } from './refined-translation';
import { LocalExportEngine } from './export-engine';

function fixture(content = 'アリスは王都に住む。') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'library-terms-'));
  const repository = new SqliteNovelRepository(':memory:');
  repository.saveMetadata('test', { novelId: 'novel', title: '物語', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
  repository.saveChapterIndex('test', 'novel', [{ id: 'c1', index: 1, title: '序章', url: '' }]);
  repository.saveChapterContent('test', 'novel', { chapterId: 'c1', index: 1, title: '序章', url: '', content });
  const preferences = new SystemPreferencesService({ storageFilePath: path.join(directory, 'preferences.json') });
  preferences.updateLlmProviders([{ id: 'fake', type: 'openai-compatible', enabled: true, baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fake', models: ['local', 'global', 'default'].map((id) => ({ id, modelId: id, enabled: true, capabilityMode: 'manual', capabilities: ['chat'] })) }]);
  preferences.updateModelGateway({ chat: { providerId: 'fake', modelId: 'default' } });
  const cleanup = () => { repository.close(); fs.rmSync(directory, { recursive: true, force: true }); };
  return { repository, preferences, directory, cleanup };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('background task timed out');
}

test('shared extraction windows preserve the refined first window and all source provenance', () => {
  const chapters = [{ id: 'c1', index: 1, title: '一', content: 'あ'.repeat(20_000) }, { id: 'c2', index: 2, title: '二', content: '王都' }];
  const full = chapters.map((c) => `【第 ${c.index} 章 ${c.title}】\n${c.content}`).join('\n\n');
  const windows = buildGlossarySourceWindows(chapters);
  assert.equal(windows.map((w) => w.source).join(''), full);
  assert.deepEqual(buildGlossarySourceWindows(chapters, 18_000, 1), [windows[0]]);
  assert.deepEqual(windows[1]?.chapterIds, ['c1', 'c2']);
  assert.match(buildGlossaryExtractionPrompt('ja'), /从ja小说原文/);
  assert.equal(parseGlossaryCandidates('{"terms":[{"sourceTerm":" 王都 "},{"sourceTerm":"王都"}]}').length, 1);
});

test('terms support scoped bulk states, exclude candidates from missing counts, and never revive exclusions', () => {
  const { repository: db, cleanup } = fixture();
  try {
    const legacy = db.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '旧语' });
    const pending = db.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: 'アリス', status: 'pending' });
    const excluded = db.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '王都', status: 'excluded' });
    assert.equal(legacy.status, 'confirmed');
    assert.deepEqual(db.listMissingTranslationTerms('test', 'novel').map((t) => t.id), [legacy.id]);
    const result = db.upsertTranslationTerms('test', 'novel', [{ sourceTerm: '王都', targetTerm: '都城' }, { sourceTerm: '新词', status: 'pending' }, { sourceTerm: ' 新词 ', status: 'pending' }]);
    assert.equal(result.created, 1);
    assert.equal(db.listTranslationTerms('test', 'novel', 'excluded')[0]?.targetTerm, null);
    db.bulkUpdateTranslationTermStatus('test', 'novel', [pending.id, pending.id, 'foreign-id'], 'confirmed');
    assert.equal(db.listTranslationTerms('test', 'novel', 'confirmed').length, 2);
    assert.equal(db.listTranslationTerms('test', 'novel', 'excluded')[0]?.id, excluded.id);
  } finally { cleanup(); }
});

for (const writer of ['graph import', 'AI extraction'] as const) {
  test(`${writer} backfills missing types without changing term decisions or overwriting existing fields`, async () => {
    const { repository, preferences, cleanup } = fixture();
    try {
      const originals = [
        repository.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '候选', status: 'pending', targetTerm: '候选译文' }),
        repository.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '确认', status: 'confirmed', targetTerm: '确认译文' }),
        repository.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '已有类型', status: 'confirmed', entityType: 'location' }),
        repository.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '排除', status: 'excluded' }),
      ];
      const candidates = originals.map((term) => ({ sourceTerm: term.sourceTerm, entityType: 'character' }));
      const translation = new TranslationService(repository, preferences);
      const extraction = new LibraryTermExtractionService(repository, preferences, async () => JSON.stringify({ terms: candidates }));
      for (let attempt = 0; attempt < 2; attempt++) {
        if (writer === 'graph import') {
          const result = translation.batchImportTerms('test', 'novel', [
            ...candidates,
            { sourceTerm: '候选', entityType: 'organization' },
          ]);
          assert.deepEqual(result, { created: 0, updated: attempt === 0 ? 2 : 0, skipped: attempt === 0 ? 3 : 5 });
        } else {
          extraction.start('test', 'novel');
          await waitFor(() => extraction.getRun('test', 'novel')?.status !== 'running');
          assert.equal(extraction.getRun('test', 'novel')?.status, 'completed');
          assert.equal(extraction.getRun('test', 'novel')?.added, 0);
        }
        const terms = repository.listTranslationTerms('test', 'novel');
        assert.equal(terms.length, originals.length);
        for (const original of originals) {
          const actual = terms.find((term) => term.id === original.id)!;
          if (original.sourceTerm === '候选' || original.sourceTerm === '确认') {
            assert.deepEqual({ ...actual, updatedAt: original.updatedAt }, { ...original, entityType: 'character' });
          } else {
            assert.deepEqual(actual, original);
          }
        }
      }
    } finally { cleanup(); }
  });
}

test('legacy database migration marks existing terms confirmed and remains idempotent', () => {
  const { directory, cleanup } = fixture();
  const file = path.join(directory, 'legacy.db');
  try {
    const db = new SqliteNovelRepository(file);
    db.saveMetadata('test', { novelId: 'novel', title: '旧书', author: '', description: '', tags: [], chapterCount: 0, infoPageUrl: '' });
    db.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: '旧术语', targetTerm: '旧译文' });
    db.close();
    const raw = new Database(file);
    raw.exec('ALTER TABLE novel_translation_terms DROP COLUMN status');
    raw.close();
    for (let i = 0; i < 2; i++) {
      const migrated = new SqliteNovelRepository(file);
      const terms = migrated.listTranslationTerms('test', 'novel', 'confirmed');
      assert.equal(terms.length, 1);
      assert.equal(terms[0]?.targetTerm, '旧译文');
      migrated.close();
    }
  } finally { cleanup(); }
});

test('background extraction batches are durable, idempotent and use local/global/default model precedence', async () => {
  const { repository, preferences, cleanup } = fixture('アリス'.repeat(7_000));
  const routes: string[] = [];
  const service = new LibraryTermExtractionService(repository, preferences, async (_p, route) => {
    routes.push(route.modelId);
    return '{"terms":[{"sourceTerm":"アリス","entityType":"character"}]}';
  });
  try {
    const translation = new TranslationService(repository, preferences);
    translation.updateTranslationProfile('test', 'novel', { termExtractionModel: { providerId: 'fake', modelId: 'local' } });
    preferences.updateTranslationPreferences({ termExtractionModel: { providerId: 'fake', modelId: 'global' } });
    for (const expected of ['local', 'global', 'default']) {
      const run = service.start('test', 'novel');
      assert.equal(run.status, 'running');
      assert.throws(() => service.start('test', 'novel'), /正在运行/);
      await waitFor(() => service.getRun('test', 'novel')?.status !== 'running');
      const result = service.getRun('test', 'novel')!;
      assert.equal(result.status, 'completed');
      assert.equal(result.completedBatches, 2);
      assert.equal(result.candidates, 2);
      assert.equal(result.added, expected === 'local' ? 1 : 0);
      assert.equal(routes.at(-1), expected);
      const term = repository.listTranslationTerms('test', 'novel')[0]!;
      assert.equal(term.extractedFromChapterId, 'c1');
      if (expected === 'local') {
        assert.equal(term.status, 'pending');
        repository.bulkUpdateTranslationTermStatus('test', 'novel', [term.id], 'excluded');
        translation.updateTranslationProfile('test', 'novel', { termExtractionModel: null });
      } else {
        assert.equal(term.status, 'excluded');
        preferences.updateTranslationPreferences({ termExtractionModel: null });
      }
    }
  } finally { cleanup(); }
});

test('cancelled late responses cannot write candidates or replace a newer run; restart fails stale running tasks', async () => {
  const { repository, preferences, cleanup } = fixture();
  let finish: ((value: string) => void) | undefined;
  let calls = 0;
  const service = new LibraryTermExtractionService(repository, preferences, async () => {
    calls++;
    if (calls === 1) return new Promise<string>((resolve) => { finish = resolve; });
    return '{"terms":[]}';
  });
  try {
    service.start('test', 'novel');
    assert.equal(service.cancel('test', 'novel')?.status, 'cancelled');
    const next = service.start('test', 'novel');
    finish?.('{"terms":[{"sourceTerm":"晚到词"}]}');
    await waitFor(() => service.getRun('test', 'novel')?.status === 'completed');
    assert.equal(service.getRun('test', 'novel')?.id, next.id);
    assert.equal(repository.listTranslationTerms('test', 'novel').length, 0);
    repository.saveTermExtractionRun({ ...next, completedBatches: 1, added: 2 });
    const restarted = new LibraryTermExtractionService(repository, preferences);
    new TranslationService(repository, preferences);
    assert.deepEqual(service.getRun('test', 'novel'), { ...next, completedBatches: 1, added: 2 });
    restarted.recoverInterruptedRuns();
    assert.equal(service.getRun('test', 'novel')?.status, 'failed');
    assert.equal(service.getRun('test', 'novel')?.added, 2);
  } finally { cleanup(); }
});

test('malformed responses fail visibly and preserve prior completed batches for rerun', async () => {
  const { repository, preferences, cleanup } = fixture('原文'.repeat(10_000));
  let calls = 0;
  const service = new LibraryTermExtractionService(repository, preferences, async () => ++calls === 1 ? '{"terms":[{"sourceTerm":"原文"}]}' : 'bad JSON');
  try {
    service.start('test', 'novel');
    await waitFor(() => service.getRun('test', 'novel')?.status === 'failed');
    assert.equal(service.getRun('test', 'novel')?.completedBatches, 1);
    assert.equal(service.getRun('test', 'novel')?.added, 1);
    assert.ok(service.getRun('test', 'novel')?.errorMessage);
    assert.equal(repository.listTranslationTerms('test', 'novel').length, 1);
    const rerun = new LibraryTermExtractionService(repository, preferences, async () => '{"terms":[{"sourceTerm":"原文"}]}');
    rerun.start('test', 'novel');
    await waitFor(() => rerun.getRun('test', 'novel')?.status === 'completed');
    assert.equal(rerun.getRun('test', 'novel')?.added, 0);
    assert.equal(repository.listTranslationTerms('test', 'novel').length, 1);
  } finally { cleanup(); }
});

test('invalid extraction routes and unavailable source are rejected before a run is saved', () => {
  const { repository, preferences, cleanup } = fixture();
  try {
    const translation = new TranslationService(repository, preferences);
    const extraction = new LibraryTermExtractionService(repository, preferences);
    translation.updateTranslationProfile('test', 'novel', { termExtractionModel: { providerId: 'missing', modelId: 'missing' } });
    assert.throws(() => extraction.start('test', 'novel'), /模型不可用/);
    assert.equal(extraction.getRun('test', 'novel'), null);
    assert.throws(() => extraction.start('test', 'missing'), /小说不存在/);
    repository.moveNovelToTrash('test', 'novel');
    assert.throws(() => extraction.start('test', 'novel'), /回收站/);
  } finally { cleanup(); }
});

test('extraction uses the saved per-novel thinking switch even with an inherited model', async () => {
  const { repository, preferences, cleanup } = fixture();
  const requests: Array<{ modelId: string; thinkingEnabled?: boolean }> = [];
  const extraction = new LibraryTermExtractionService(repository, preferences, async (_preferences, route) => {
    requests.push(route);
    return '{"terms":[]}';
  });
  const translation = new TranslationService(repository, preferences);
  try {
    assert.equal(translation.getTranslationProfile('test', 'novel')?.termExtractionThinkingEnabled, false);
    for (const enabled of [false, true, false]) {
      const saved = translation.updateTranslationProfile('test', 'novel', { termExtractionThinkingEnabled: enabled });
      assert.equal(saved?.termExtractionThinkingEnabled, enabled);
      translation.updateTranslationProfile('test', 'novel', { targetLang: 'en' });
      assert.equal(repository.getTranslationProfile('test', 'novel')?.termExtractionThinkingEnabled, enabled);
      extraction.start('test', 'novel');
      await waitFor(() => extraction.getRun('test', 'novel')?.status !== 'running');
      assert.equal(requests.at(-1)?.modelId, 'default');
      assert.equal(requests.at(-1)?.thinkingEnabled, enabled);
    }
  } finally { cleanup(); }
});

test('legacy profiles migrate thinking to disabled and persist the switch across reopening', () => {
  const { directory, preferences, cleanup } = fixture();
  const file = path.join(directory, 'thinking-migration.db');
  try {
    const old = new SqliteNovelRepository(file);
    old.saveMetadata('test', { novelId: 'novel', title: '物語', author: '', description: '', tags: [], chapterCount: 0, infoPageUrl: '' });
    new TranslationService(old, preferences).updateTranslationProfile('test', 'novel', { targetLang: 'en' });
    old.close();
    const raw = new Database(file);
    raw.exec('ALTER TABLE novel_translation_profiles DROP COLUMN term_extraction_thinking_enabled');
    raw.close();
    for (const expected of [false, true]) {
      const migrated = new SqliteNovelRepository(file);
      try {
        const service = new TranslationService(migrated, preferences);
        assert.equal(service.getTranslationProfile('test', 'novel')?.termExtractionThinkingEnabled, expected);
        assert.equal(service.getTranslationProfile('test', 'novel')?.targetLang, 'en');
        service.updateTranslationProfile('test', 'novel', { termExtractionThinkingEnabled: true });
      } finally { migrated.close(); }
    }
  } finally { cleanup(); }
});

test('only confirmed library terms enter refined snapshots and actual translation prompts', async () => {
  const { repository, preferences, directory, cleanup } = fixture('unique_confirmed unique_pending unique_excluded');
  const prompts: string[] = [];
  const server = http.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text) as { messages: Array<{ role: string; content: string }> };
    prompts.push(body.messages.find((m) => m.role === 'system')?.content ?? '');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'fake', object: 'chat.completion', created: 1, model: 'default', choices: [{ index: 0, message: { role: 'assistant', content: '译文' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    preferences.updateLlmProviders([{ id: 'fake', type: 'openai-compatible', enabled: true, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fake', models: [{ id: 'default', modelId: 'default', enabled: true, capabilityMode: 'manual', capabilities: ['chat'] }] }]);
    preferences.updateTranslationPreferences({ translationConcurrency: 1 });
    for (const status of ['pending', 'confirmed', 'excluded'] as const) repository.createTranslationTerm({ sourceId: 'test', novelId: 'novel', sourceTerm: `unique_${status}`, targetTerm: `target_${status}`, status });
    const refined = new RefinedTranslationService(repository, preferences, new LocalExportEngine({ outputRoot: directory }), async () => '');
    const task = refined.createTask('test', 'novel', {});
    assert.deepEqual(refined.listTerms(task.id).map((term) => term.sourceTerm), ['unique_confirmed']);
    const translation = new TranslationService(repository, preferences);
    translation.startTranslation('test', 'novel');
    await waitFor(() => translation.getTranslationBuild('test', 'novel')?.status !== 'running');
    assert.equal(translation.getTranslationBuild('test', 'novel')?.status, 'completed');
    assert.ok(prompts.length > 0);
    assert.ok(prompts.some((prompt) => prompt.includes('unique_confirmed')));
    for (const prompt of prompts) {
      assert.doesNotMatch(prompt, /unique_pending|unique_excluded|target_pending|target_excluded/);
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); cleanup(); }
});
