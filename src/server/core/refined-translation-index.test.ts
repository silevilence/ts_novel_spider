import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import { OfflineLibraryAssetService } from './offline-library';
import { SqliteNovelRepository } from './novel-repository';
import { RefinedTranslationService } from './refined-translation';
import { SystemPreferencesService } from './system-preferences';
import { LocalExportEngine } from './export-engine';
import { generateRefinedTranslationText } from './translation/nodes/translate-node';
import { resolveRefinedChatRoute, validateRefinedModelRoles } from './refined-translation-models';

function preferences(type: 'openai-compatible' | 'ollama' = 'openai-compatible', chat = true) {
  const result = new SystemPreferencesService();
  result.updateLlmProviders([{ id: 'p', type, apiKey: 'fake', baseUrl: 'http://fake.invalid/v1', models: [
    { id: 'index', modelId: 'index', capabilities: ['chat'], translationMessageFormat: 'bilibili-index-translate' },
    ...(chat ? [{ id: 'chat', modelId: 'chat', capabilities: ['chat' as const] }] : []),
  ] }]);
  return result;
}
const indexRoute = { providerId: 'p', modelId: 'index', thinkingEnabled: true };
const chatRoute = { providerId: 'p', modelId: 'chat' };
const config = { termExtractionModel: null, termTranslationModel: null, translationModels: [indexRoute, chatRoute], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 2 };
async function settle(repository: SqliteNovelRepository, id: string) {
  for (let i = 0; i < 400; i++) { if (repository.getRefinedTranslationTask(id)?.status !== 'running') return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error('workflow did not finish');
}

test('mixed initial model pool translates metadata and paragraphs with Index but uses chat for structured work', async () => {
  const db = new SqliteNovelRepository(':memory:');
  const prefs = preferences();
  const calls: Array<{ model: string; system: string; prompt: string }> = [];
  let first = true;
  let tools = 0;
  const service = new RefinedTranslationService(db, prefs, new LocalExportEngine({ outputRoot: os.tmpdir(), assetService: new OfflineLibraryAssetService({ storageRoot: os.tmpdir() }) }), async (_prefs, route, system, prompt) => {
    calls.push({ model: route.modelId, system, prompt });
    if (route.modelId === 'index') {
      assert.equal(system, ''); assert.equal(route.thinkingEnabled, false); assert.match(prompt, /日语.*中文/);
      if (first) { first = false; return ' '; }
      return '这是有效译文';
    }
    if (system.includes('审核文学翻译')) return '{"score":95,"issues":[]}';
    if (system.includes('章节 Agent')) return '聊天回答';
    return '普通译文';
  }, async (_prefs, route) => { assert.equal(route.modelId, 'chat'); tools++; return { text: '', toolCallCount: 0, toolCalls: [] }; });
  const novel = db.createManualNovel('猫の物語');
  const novelId = novel.metadata.novelId;
  db.saveManualChapter(novelId, { title: '猫の章', content: '猫が来た。\n\n犬が来た。' });
  const task = service.createTask('manual', novelId, { sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: config });
  service.createTerm(task.id, { sourceTerm: '猫', targetTerm: '猫咪', status: 'confirmed' });
  try {
    assert.equal(task.modelConfig.translationModels[0]?.thinkingEnabled, false);
    service.advance(task.id); await settle(db, task.id); service.advance(task.id); await settle(db, task.id);
    const chapter = db.listRefinedTranslationChapters(task.id)[0]!;
    assert.equal(db.getRefinedTranslationTask(task.id)?.status, 'completed');
    assert.ok(calls.filter((c) => c.model === 'index').length >= 4);
    assert.ok(calls.some((c) => c.model === 'index' && c.prompt.includes('猫→猫咪')));
    assert.deepEqual(db.listRefinedTranslationSegments(task.id, chapter.chapterId).map((s) => s.translatedText), ['这是有效译文', '普通译文']);
    await service.chatAboutChapter(task.id, chapter.chapterId, { message: '解释', mode: 'read' });
    assert.ok(tools > 0);
    assert.ok(calls.some((c) => c.system.includes('审核文学翻译') && c.model === 'chat'));
    assert.throws(() => service.updateTaskConfiguration(task.id, { modelConfig: { ...config, reviewModel: indexRoute } }), /普通对话/);
    assert.equal(resolveRefinedChatRoute(prefs, indexRoute)?.modelId, 'chat');
    prefs.updateLlmProviders(preferences('openai-compatible', false).getLlmState().providers);
    assert.throws(() => service.resume(task.id), /普通对话/);
  } finally { db.close(); }
});

for (const type of ['openai-compatible', 'ollama'] as const) test(`refined Index sends one user message with native thinking off: ${type}`, async (t) => {
  const bodies: Array<{ messages: Array<{ role: string }>; think?: boolean; chat_template_kwargs?: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Response.json(type === 'ollama' ? { model: 'index', created_at: '2026-01-01T00:00:00Z', message: { role: 'assistant', content: '猫咪' }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 }
      : { id: 'fake', object: 'chat.completion', created: 0, model: 'index', choices: [{ index: 0, message: { role: 'assistant', content: '猫咪' }, finish_reason: 'stop' }] });
  });
  assert.equal(await generateRefinedTranslationText(preferences(type), indexRoute, '', '请翻译：猫'), '猫咪');
  assert.deepEqual(bodies[0]!.messages.map((m) => m.role), ['user']);
  assert.equal(bodies[0]!.think, type === 'ollama' ? false : undefined);
  assert.deepEqual(bodies[0]!.chat_template_kwargs, type === 'openai-compatible' ? { enable_thinking: false } : undefined);
});

test('Index-only configuration cannot be used for conversation roles', () => {
  const prefs = preferences('openai-compatible', false);
  assert.equal(resolveRefinedChatRoute(prefs, indexRoute), null);
  assert.throws(() => validateRefinedModelRoles(prefs, { ...config, termExtractionModel: indexRoute }), /普通对话/);
});

for (const failure of ['empty', 'echo', 'error'] as const) test(`Index failure ${failure} is bounded and preserves existing translation`, async () => {
  const db = new SqliteNovelRepository(':memory:');
  const prefs = preferences();
  db.createRefinedTranslationTask({ id: 'f', sourceId: 'test', novelId: 'n', name: 'test', novelTitle: '', author: '', sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: { ...config, translationModels: [indexRoute] }, chapters: [{ id: 'c', index: 1, title: '', volumeTitle: null, content: '猫が来た。', paragraphs: ['猫が来た。'] }], terms: [] });
  db.updateRefinedTranslationSegment('f', 'c', 0, '旧有效译文', 'failed');
  db.updateRefinedTranslationTask('f', { stage: 'translating' });
  db.saveRefinedTranslationCheckpoint('f', 'translating', { chapterId: 'c' });
  let calls = 0;
  const service = new RefinedTranslationService(db, prefs, new LocalExportEngine({ outputRoot: os.tmpdir(), assetService: new OfflineLibraryAssetService({ storageRoot: os.tmpdir() }) }), async (_p, route, system) => {
    assert.equal(route.modelId, 'index'); assert.equal(system, ''); calls++;
    if (failure === 'error') throw new Error('接口失败');
    return failure === 'empty' ? ' ' : '【约束要求】回显';
  });
  try {
    service.resume('f'); await settle(db, 'f');
    assert.equal(calls, 3);
    assert.equal(db.listRefinedTranslationSegments('f', 'c')[0]?.translatedText, '旧有效译文');
    assert.equal(db.listRefinedTranslationSegments('f', 'c')[0]?.status, 'failed');
  } finally { db.close(); }
});
