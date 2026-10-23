import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { LibraryTermExtractionService } from './library-term-extraction';
import { TranslationService } from './translation-service';
import { LibraryProcessingService } from './library-processing';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'processing-'));
  const repository = new SqliteNovelRepository(':memory:');
  repository.saveMetadata('test', { novelId: 'n', title: 'Book', author: '', description: '', tags: [], chapterCount: 2, infoPageUrl: '' });
  repository.saveChapterIndex('test', 'n', [{ id: 'a', index: 1, title: 'A', url: '' }, { id: 'b', index: 2, title: 'B', url: '' }]);
  for (const [chapterId, index] of [['a', 1], ['b', 2]] as const) repository.saveChapterContent('test', 'n', { chapterId, index, title: chapterId, url: '', content: 'アリスは来た。' });
  const preferences = new SystemPreferencesService({ storageFilePath: path.join(dir, 'prefs.json') });
  preferences.updateTranslationPreferences({ enableLlmInteractionLog: false });
  preferences.updateLlmProviders([{ id: 'fake', type: 'openai-compatible', enabled: true, apiKey: 'fake', baseUrl: 'http://fake.invalid/v1', models: [{ id: 'm', modelId: 'm', enabled: true, capabilityMode: 'manual', capabilities: ['chat'], translationMessageFormat: 'bilibili-index-translate' }, { id: 'general', modelId: 'general', enabled: true, capabilityMode: 'manual', capabilities: ['chat'] }] }]);
  preferences.updateTranslationPreferences({ termExtractionModel: { providerId: 'fake', modelId: 'general' } });
  preferences.updateModelGateway({ chat: { providerId: 'fake', modelId: 'm' } });
  const extraction = new LibraryTermExtractionService(repository, preferences, async () => '{"terms":[{"sourceTerm":"アリス"}]}');
  const translation = new TranslationService(repository, preferences);
  const service = new LibraryProcessingService(repository, extraction, translation);
  return { repository, preferences, extraction, translation, service, cleanup: () => { service.stop(); repository.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

async function until(predicate: () => boolean, tick: () => void = () => {}) {
  for (let i = 0; i < 500; i++) { tick(); if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail('processing timeout');
}

for (const policy of ['manual', 'automatic'] as const) test(`update pipeline ${policy} confirms only new candidates and translates only its scope`, async (t) => {
  const f = fixture(); const { repository, service } = f;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages.map((message) => message.content).join('\n'); calls.push(prompt);
    const content = prompt.includes('必须逐条返回') ? JSON.stringify({ terms: [{ id: repository.listMissingTranslationTerms('test', 'n').find((term) => term.sourceTerm === 'アリス')!.id, targetTerm: '爱丽丝' }] }) : '【1】标题译文\n【2】爱丽丝来了。';
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
  });
  const job = () => repository.listProcessingJobs('test', 'n')[0]!;
  try {
    const old = repository.createTranslationTerm({ sourceId: 'test', novelId: 'n', sourceTerm: '旧候选', status: 'pending' });
    service.configure('test', 'n', { extractTerms: true, translate: true, candidatePolicy: policy });
    service.enqueue('test', 'n', 'scheduled', {}, ['a']);
    await until(() => job().stage === 'confirmation', () => service.tick());
    if (policy === 'manual') {
      service.tick(); assert.equal(job().status, 'waiting'); assert.match(job().message, /等待确认/); assert.equal(calls.length, 0);
      repository.bulkUpdateTranslationTermStatus('test', 'n', job().candidateIds, 'confirmed');
    }
    await until(() => ['completed', 'failed'].includes(job().status), () => service.tick());
    assert.equal(job().status, 'completed', job().message);
    assert.equal(repository.listTranslationTerms('test', 'n').find((term) => term.id === old.id)?.status, 'pending');
    assert.equal(repository.getChapterTranslation('test', 'n', 'b', 'ja', 'zh-CN'), null);
    assert.equal(repository.getChapterTranslation('test', 'n', 'a', 'ja', 'zh-CN')?.status, 'completed');
    assert(calls.some((prompt) => prompt.includes('爱丽丝')));
    service.enqueue('test', 'n', 'capture', {}, ['a']);
    assert.equal(repository.listProcessingJobs('test', 'n').length, 1);
    service.enqueue('test', 'n', 'refetch', service.hashes('test', 'n'), ['b']);
    assert.equal(repository.listProcessingJobs('test', 'n').length, 1);
  } finally { f.cleanup(); }
});

test('queued updates survive service recreation, paused work resumes and source conflicts do not advance', async () => {
  const f = fixture(); const { repository, service, extraction, translation } = f;
  try {
    service.configure('test', 'n', { extractTerms: true, translate: false, candidatePolicy: 'manual' });
    service.enqueue('test', 'n', 'capture', {}, ['a']);
    const job = () => repository.listProcessingJobs('test', 'n')[0]!;
    await until(() => job().stage === 'confirmation', () => service.tick());
    service.control('test', 'n', job().id, 'pause');
    const restored = new LibraryProcessingService(repository, extraction, translation);
    restored.tick(); assert.equal(job().status, 'paused');
    repository.bulkUpdateTranslationTermStatus('test', 'n', job().candidateIds, 'confirmed');
    restored.control('test', 'n', job().id, 'resume'); restored.tick();
    assert.equal(job().status, 'completed');
    restored.enqueue('test', 'n', 'refetch', {}, ['b']);
    repository.saveChapterContent('test', 'n', { chapterId: 'b', index: 2, title: 'b', url: '', content: 'changed' });
    restored.tick();
    assert.equal(repository.listProcessingJobs('test', 'n')[1]?.status, 'failed');
    assert.equal(repository.listTranslationTerms('test', 'n').length, 1);
  } finally { f.cleanup(); }
});

test('cancelled extraction cannot advance after a late reply; a busy book waits without dropping its update', async () => {
  const f = fixture(); const { repository, service, extraction } = f;
  try {
    service.configure('test', 'n', { extractTerms: true, translate: false, candidatePolicy: 'automatic' });
    extraction.start('test', 'n');
    service.enqueue('test', 'n', 'capture', {}, ['a']); service.tick();
    const job = () => repository.listProcessingJobs('test', 'n')[0]!;
    assert.equal(job().status, 'waiting'); assert.equal(job().extractionRunId, null);
    await until(() => extraction.getRun('test', 'n')?.status !== 'running');
    service.tick(); service.control('test', 'n', job().id, 'cancel');
    await new Promise((resolve) => setTimeout(resolve, 20)); service.tick();
    assert.equal(job().status, 'cancelled');
    assert.throws(() => service.control('test', 'other', job().id, 'resume'), /不存在/);
  } finally { f.cleanup(); }
});

test('pausing an in-flight extraction ignores its late response and resumes without approving old candidates', async () => {
  const f = fixture();
  let release!: (value: string) => void;
  let calls = 0;
  const extraction = new LibraryTermExtractionService(f.repository, f.preferences, async () => {
    if (++calls === 1) return new Promise<string>((resolve) => { release = resolve; });
    return '{"terms":[{"sourceTerm":"アリス"}]}';
  });
  const service = new LibraryProcessingService(f.repository, extraction, f.translation);
  const job = () => f.repository.listProcessingJobs('test', 'n')[0]!;
  try {
    service.configure('test', 'n', { extractTerms: true, translate: false, candidatePolicy: 'automatic' });
    service.enqueue('test', 'n', 'capture', {}, ['a']); service.tick();
    service.control('test', 'n', job().id, 'pause');
    release('{"terms":[{"sourceTerm":"迟到候选"}]}');
    await new Promise((resolve) => setTimeout(resolve, 10)); service.tick();
    assert.equal(f.repository.listTranslationTerms('test', 'n').length, 0);
    service.control('test', 'n', job().id, 'resume');
    await until(() => job().status === 'completed', () => service.tick());
    assert.equal(f.repository.listTranslationTerms('test', 'n')[0]?.sourceTerm, 'アリス');
    assert.equal(calls, 2);
  } finally { f.cleanup(); }
});

test('persisted confirmation survives database reopening and settings are preserved through trash', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'processing-reopen-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let db = new SqliteNovelRepository(databasePath);
  try {
    db.saveMetadata('test', { novelId: 'n', title: 'Book', author: '', description: '', tags: [], chapterCount: 0, infoPageUrl: '' });
    const settings = { extractTerms: true, translate: false, candidatePolicy: 'manual' as const };
    db.saveProcessingSettings('test', 'n', settings);
    db.saveProcessingJob({ id: 'job', sourceId: 'test', novelId: 'n', origin: 'capture', chapterHashes: {}, settings, status: 'waiting', stage: 'confirmation', message: '等待确认', createdAt: '2026-10-23', updatedAt: '2026-10-23', candidateIds: ['term'], extractionRunId: null, termRunId: null, translationStartedAt: null });
    db.close(); db = new SqliteNovelRepository(databasePath);
    assert.deepEqual(db.getProcessingSettings('test', 'n'), settings);
    assert.deepEqual(db.listProcessingJobs('test', 'n')[0]?.candidateIds, ['term']);
    assert.equal(db.listProcessingJobs('test', 'n')[0]?.stage, 'confirmation');
    db.moveNovelToTrash('test', 'n'); db.restoreNovelFromTrash('test', 'n');
    assert.deepEqual(db.getProcessingSettings('test', 'n'), settings);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
