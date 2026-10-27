import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { RefinedTranslationService } from './refined-translation';
import { RefinedAgentRuntime } from './refined-agent';
import { LocalExportEngine } from './export-engine';
import { OfflineLibraryAssetService } from './offline-library';
import { agentConfigSchema, defaultAgentSkills, agentOperations } from '../contracts/refined-agent';
import type { generateRefinedAgentTurn, generateRefinedTranslationText } from './translation/nodes/translate-node';

const route = { providerId: 'test', modelId: 'chat' };
function fixture(turn?: typeof generateRefinedAgentTurn, generate?: typeof generateRefinedTranslationText) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'refined-agent-test-'));
  const db = new SqliteNovelRepository(':memory:'); const prefs = new SystemPreferencesService();
  prefs.updateLlmProviders([{ id: 'test', type: 'openai-compatible', apiKey: 'secret-fixture-key', baseUrl: 'http://fixture.invalid/v1', models: [{ id: 'chat', modelId: 'chat', capabilities: ['chat'] }, { id: 'index', modelId: 'index', capabilities: ['chat'], translationMessageFormat: 'bilibili-index-translate' }] }]);
  const exports = new LocalExportEngine({ outputRoot: directory, assetService: new OfflineLibraryAssetService({ storageRoot: directory }) });
  const generateText: typeof generateRefinedTranslationText = generate ?? (async (_p, _r, system, prompt, _signal, onResponse) => {
    const text = system.includes('审核文学翻译') ? '{"score":95,"issues":[]}' : system.includes('判断原文') ? 'NO' : system.includes('提取') ? '[]' : `译文 ${prompt}`;
    onResponse?.({ text, finishReason: 'stop', inputTokens: 10, outputTokens: 10 }); return text;
  });
  const service = new RefinedTranslationService(db, prefs, exports, generateText);
  for (const id of ['task', 'other']) db.createRefinedTranslationTask({ id, sourceId: 'manual', novelId: 'source', name: id, novelTitle: '原书', author: '', sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: { termExtractionModel: route, termTranslationModel: route, translationModels: [route], omissionModel: route, reviewModel: route, concurrency: 1, maxReviewRounds: 5 }, chapters: [1, 2].map((index) => ({ id: `c${index}`, index, title: `章${index}`, volumeTitle: '卷一', content: `原文${index}`, paragraphs: [`原文${index}`] })), terms: [] });
  const runtime = new RefinedAgentRuntime(db, prefs, exports, service, () => {}, turn, generateText);
  const config = agentConfigSchema.parse({ initialCommand: '翻译并审核全部章节', controller: route, skills: defaultAgentSkills, permissions: [...agentOperations], budget: { maxCalls: 100, maxMinutes: 10, maxRevisions: 5, maxNoProgress: 10 } });
  runtime.create('task', config);
  return { db, prefs, runtime, service, config, directory, close() { db.close(); fs.rmSync(directory, { recursive: true }); } };
}
async function settle(runtime: RefinedAgentRuntime) { for (let i = 0; i < 1000; i++) { if (!runtime.isActive('task')) return; await new Promise((resolve) => setTimeout(resolve, 2)); } throw new Error('runtime did not settle'); }
function running(f: ReturnType<typeof fixture>) { const state = f.db.getRefinedAgentState('task')!; state.status = 'running'; f.db.saveRefinedAgentState('task', state); f.db.updateRefinedTranslationTask('task', { status: 'running' }); }
const op = (operation: string, chapterId: string | null, operationId = crypto.randomUUID()) => ({ operation, chapterId, operationId });

test('workflow migration, strict configuration, role validation and scope are explicit', () => {
  const f = fixture(); try {
    assert.equal(f.db.getRefinedTranslationTask('other')!.executionMode, 'workflow'); assert.equal(f.db.getRefinedTranslationTask('task')!.executionMode, 'agent');
    assert.throws(() => f.runtime.validate({ ...f.config, controller: { providerId: 'test', modelId: 'index' } }), /普通对话/);
    assert.throws(() => f.runtime.updateConfig('task', { ...f.config, chapterIds: ['missing'] }), /范围/);
    assert.equal(agentConfigSchema.safeParse({ ...f.config, permissions: [] }).success, false);
    f.runtime.updateConfig('task', { ...f.config, chapterIds: ['c1'] });
    assert.throws(() => f.runtime.readMaterials('task', { chapterId: 'c2' }), /无权/);
    assert.throws(() => f.runtime.readMaterials('task', { chapterId: 'c1', taskId: 'other' }));
    assert.throws(() => f.service.advance('task'), /自主执行/);
    assert.equal(f.runtime.completionIssues('task').length > 0, true);
  } finally { f.close(); }
});

for (const order of [['translate_chapter:c1', 'review_chapter:c1', 'translate_chapter:c2', 'review_chapter:c2'], ['translate_chapter:c2', 'translate_chapter:c1', 'review_chapter:c1', 'review_chapter:c2']]) test(`controller chooses order, exports complete content and passes completion: ${order.join(',')}`, async () => {
  const calls = ['translate_metadata:', ...order, 'export:']; let index = 0;
  const f = fixture(async () => {
    const step = calls[index++];
    return { text: '', inputTokens: 1, outputTokens: 1, calls: step ? [{ id: String(index), name: 'execute', input: { ...op(step.split(':')[0]!, step.split(':')[1] || null, String(index)), format: 'markdown' } }] : [{ id: 'done', name: 'request_completion', input: {} }] };
  });
  try {
    f.runtime.start('task'); assert.throws(() => f.runtime.start('task'), /重复启动/); await settle(f.runtime);
    const state = f.db.getRefinedAgentState('task')!;
    assert.equal(state.status, 'completed', JSON.stringify(state)); assert.deepEqual(f.runtime.completionIssues('task'), []);
    assert.ok(state.usage.calls > calls.length); assert.equal(state.usage.unknownUsage, 0);
    assert.ok(state.volumes['卷一']); assert.equal(state.artifacts.length, 1);
    const artifact = await f.service.exportTask('task', 'markdown', 'translated', true); assert.ok(artifact);
    const archive = await JSZip.loadAsync(fs.readFileSync(artifact.filePath)); const content = await Object.values(archive.files)[0]!.async('string');
    assert.match(content, /译文 原文1/); assert.match(content, /译文 卷一/);
    assert.equal(f.db.listRefinedTranslationSegments('other', 'c1')[0]!.translatedText, null);
    f.service.writeSegment('task', 'c1', 0, { translatedText: '人工新译文' }); assert.ok(f.runtime.completionIssues('task').some((issue) => issue.includes('有效审核证据')));
  } finally { f.close(); }
});

test('idempotent receipts, transaction rollback, stale draft and cross-task isolation', async () => {
  const f = fixture(); try {
    running(f); const input = op('translate_chapter', 'c1', 'same');
    await f.runtime.execute('task', input, new AbortController().signal);
    const before = f.db.refinedAgentFingerprint('task'); const usage = f.db.getRefinedAgentState('task')!.usage.calls;
    await f.runtime.execute('task', input, new AbortController().signal);
    assert.equal(f.db.refinedAgentFingerprint('task'), before); assert.equal(f.db.getRefinedAgentState('task')!.usage.calls, usage);
    await assert.rejects(f.runtime.execute('task', op('review_chapter', 'c1', 'same'), new AbortController().signal), /其他操作/);
    const draft = f.db.createRefinedAgentDraft('task');
    try {
      draft.updateRefinedTranslationSegment('task', 'c1', 0, '草稿', 'translated');
      assert.throws(() => f.db.refinedAgentTransaction(() => { f.db.applyRefinedAgentDraft('task', before, draft); throw new Error('crash'); }), /crash/);
      assert.equal(f.db.refinedAgentFingerprint('task'), before);
      f.service.writeSegment('task', 'c1', 0, { translatedText: '人工' });
      assert.throws(() => f.db.refinedAgentTransaction(() => f.db.applyRefinedAgentDraft('task', before, draft)), /已变化/);
      assert.equal(f.db.listRefinedTranslationSegments('task', 'c1')[0]!.translatedText, '人工');
    } finally { draft.close(); }
  } finally { f.close(); }
});

test('pause aborts in-flight work, waits for settlement, keeps latest manual text and instructions', async () => {
  let release!: () => void; let called!: () => void;
  const started = new Promise<void>((resolve) => { called = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = fixture(async () => ({ text: '', calls: [{ id: '1', name: 'execute', input: op('translate_chapter', 'c1', 'slow') }], inputTokens: 1, outputTokens: 1 }), async () => { called(); await gate; return '晚到译文'; });
  try {
    f.runtime.start('task'); await started;
    f.runtime.appendInstruction('task', '保持专有名词'); assert.equal(f.db.getRefinedAgentState('task')!.instructions[0]!.appliedAt, null);
    const pausing = f.runtime.stop('task'); assert.equal(f.runtime.isActive('task'), true);
    assert.throws(() => f.runtime.updateConfig('task', f.config), /暂停/);
    f.service.writeSegment('task', 'c1', 0, { translatedText: '人工译文' }); release(); await pausing;
    assert.equal(f.db.listRefinedTranslationSegments('task', 'c1')[0]!.translatedText, '人工译文');
    assert.equal(f.db.getRefinedAgentState('task')!.receipts[0]!.status, 'interrupted');
    assert.equal(f.db.getRefinedAgentState('task')!.status, 'paused');
  } finally { release(); f.close(); }
});

test('budget and no-progress loops pause without fabricating completion; recovery preserves charges', async () => {
  const f = fixture(async () => ({ text: '', calls: [{ id: 'r', name: 'read_materials', input: { chapterId: null } }], inputTokens: undefined, outputTokens: undefined }));
  try {
    f.runtime.updateConfig('task', { ...f.config, budget: { ...f.config.budget, maxCalls: 2 } });
    f.runtime.start('task'); await settle(f.runtime); const state = f.db.getRefinedAgentState('task')!;
    assert.equal(state.status, 'paused'); assert.equal(state.usage.calls, 2); assert.equal(state.usage.unknownUsage, 2); assert.match(state.reason, /预算/);
    state.status = 'running'; state.receipts.push({ id: 'crash', operation: '{}', chapterId: null, status: 'running', message: '', at: '', before: '', after: '' }); f.db.saveRefinedAgentState('task', state);
    f.runtime.recover(); assert.equal(f.db.getRefinedAgentState('task')!.receipts.at(-1)!.status, 'interrupted'); assert.equal(f.db.getRefinedAgentState('task')!.usage.calls, 2);
    assert.throws(() => f.runtime.start('task'), /预算/);
  } finally { f.close(); }
});

test('model response ending is waiting, while forged completion and permissions remain blocked', async () => {
  let calls = 0; const f = fixture(async () => ({ text: '我已经完成', calls: calls++ ? [] : [{ id: 'done', name: 'request_completion', input: {} }], inputTokens: 1, outputTokens: 1 }));
  try {
    f.runtime.start('task'); await settle(f.runtime); assert.equal(f.db.getRefinedAgentState('task')!.status, 'waiting'); assert.notEqual(f.db.getRefinedTranslationTask('task')!.status, 'completed');
    running(f); const state = f.db.getRefinedAgentState('task')!; state.config.permissions = []; f.db.saveRefinedAgentState('task', state);
    await assert.rejects(f.runtime.execute('task', op('confirm_terms', null), new AbortController().signal), /未授权/);
  } finally { f.close(); }
});

test('global skill edits never mutate a running snapshot; compaction preserves goals, instructions and references', async () => {
  let turns = 0;
  const f = fixture(async (_prefs, _route, system, prompt) => {
    assert.match(system, /翻译并审核全部章节/); assert.match(system, /关键约束：人名使用原写法/);
    assert.doesNotMatch(system, /GLOBAL_CHANGED/);
    assert.doesNotMatch(prompt, /OBSOLETE_LONG_EXCHANGE/);
    return { text: '等待', calls: turns++ ? [] : [{ id: 's', name: 'read_skill', input: { skillId: 'translation', reference: 'quality' } }], inputTokens: 1, outputTokens: 1 };
  });
  try {
    const changed = structuredClone(f.config.skills); changed[0]!.content = 'GLOBAL_CHANGED'; f.runtime.saveSkills(changed);
    assert.equal(f.runtime.skills()[0]!.content, 'GLOBAL_CHANGED'); assert.notEqual(f.db.getRefinedAgentState('task')!.config.skills[0]!.content, 'GLOBAL_CHANGED');
    f.runtime.appendInstruction('task', '关键约束：人名使用原写法'); const state = f.db.getRefinedAgentState('task')!;
    state.context = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'user' as const : 'assistant' as const, content: index < 2 ? 'OBSOLETE_LONG_EXCHANGE' : 'old exchange' })); f.db.saveRefinedAgentState('task', state);
    f.runtime.start('task'); await settle(f.runtime); const after = f.db.getRefinedAgentState('task')!;
    assert.ok(after.compactions); assert.ok(after.instructions[0]!.appliedAt); assert.ok(after.context.some((message) => message.content.includes('不得省略原文')));
    assert.ok(after.snapshots?.length); assert.equal(after.status, 'waiting');
  } finally { f.close(); }
});

test('unlocatable reviews cannot create completion evidence and provider errors never expose secrets', async () => {
  const f = fixture(undefined, async (_prefs, _route, system) => {
    if (system.includes('审核文学翻译')) return '{"score":95,"issues":[{"paragraphIndex":0,"sourceExcerpt":"不存在","translationExcerpt":"不存在","suggestion":"修改"}]}';
    throw new Error('upstream failed secret-fixture-key');
  });
  try {
    running(f); f.service.writeSegment('task', 'c1', 0, { translatedText: '有效译文' }); f.service.updateChapterTitle('task', 'c1', '译题');
    await f.runtime.execute('task', op('review_chapter', 'c1'), new AbortController().signal);
    assert.equal(f.db.getRefinedAgentState('task')!.evidence.c1, undefined);
    assert.equal(f.db.getRefinedTranslationChapter('task', 'c1')!.status, 'needs_attention');
    await assert.rejects(f.runtime.execute('task', op('translate_chapter', 'c2'), new AbortController().signal), /REDACTED/);
    assert.doesNotMatch(JSON.stringify(f.db.listRefinedTranslationLogs('task')), /secret-fixture-key/);
    assert.doesNotMatch(JSON.stringify(f.db.getRefinedAgentState('task')), /secret-fixture-key/);
    assert.equal(f.db.listRefinedTranslationSegments('task', 'c1')[0]!.translatedText, '有效译文');
  } finally { f.close(); }
});

test('repeated successful operation IDs stop as no progress and keep business writes unique', async () => {
  const f = fixture(async () => ({ text: '', calls: [{ id: 'repeat', name: 'execute', input: op('translate_metadata', null, 'one') }], inputTokens: 1, outputTokens: 1 }));
  try {
    f.runtime.updateConfig('task', { ...f.config, budget: { ...f.config.budget, maxNoProgress: 2 } }); f.runtime.start('task'); await settle(f.runtime);
    const state = f.db.getRefinedAgentState('task')!; assert.equal(state.status, 'paused'); assert.match(state.reason, /没有取得进展/); assert.equal(state.receipts.length, 1); assert.ok(state.usage.calls < 10);
  } finally { f.close(); }
});

test('candidate maintenance respects human decisions and review waivers require reasons', async () => {
  const f = fixture(); try {
    running(f);
    await f.runtime.execute('task', { ...op('update_terms', null), term: { sourceTerm: 'アキ', targetTerm: '秋' } }, new AbortController().signal);
    const term = f.service.listTerms('task')[0]!; assert.equal(term.status, 'pending');
    f.service.updateTerm('task', term.id, { status: 'confirmed' });
    await assert.rejects(f.runtime.execute('task', { ...op('update_terms', null), term: { sourceTerm: 'アキ', targetTerm: '别名' } }, new AbortController().signal), /人工修改/);
    assert.equal(f.service.listTerms('task')[0]!.targetTerm, '秋');
    assert.throws(() => f.service.resolveReview('task', 'missing', 'rejected'), /填写原因/);
    assert.throws(() => f.runtime.waiveReview('task', 'c1', ''));
  } finally { f.close(); }
});

test('HY-MT2 translates using one user prompt and long chapter extraction covers the final window', async () => {
  let hyCalls = 0; const extracted: string[] = [];
  const f = fixture(undefined, async (_prefs, model, system, prompt) => {
    if (model.modelId === 'hy') { hyCalls++; assert.equal(system, ''); assert.match(prompt, /中文/); return '有效译文'; }
    extracted.push(prompt); return '{"terms":[]}';
  });
  try {
    f.prefs.updateLlmProviders(f.prefs.getLlmState().providers.map((provider) => ({ ...provider, models: [...provider.models, { id: 'hy', modelId: 'hy', capabilities: ['chat'], translationMessageFormat: 'hy-mt2' }] })));
    f.service.updateTaskConfiguration('task', { modelConfig: { ...f.db.getRefinedTranslationTask('task')!.modelConfig, translationModels: [{ providerId: 'test', modelId: 'hy' }] } });
    running(f); await f.runtime.execute('task', op('translate_chapter', 'c1'), new AbortController().signal); assert.ok(hyCalls >= 3);
    f.db.createRefinedTranslationTask({ id: 'long', sourceId: 'manual', novelId: 'source', name: 'long', novelTitle: 'long', author: '', sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: f.db.getRefinedTranslationTask('task')!.modelConfig, chapters: [{ id: 'long-c', index: 1, title: '长章', content: '本文'.repeat(10000) + '末尾标记', paragraphs: ['本文'.repeat(10000) + '末尾标记'] }], terms: [] });
    await f.service.extractGlossaryCandidates('long', new AbortController().signal, ['long-c']); assert.ok(extracted.length >= 2); assert.ok(extracted.at(-1)!.includes('末尾标记'));
  } finally { f.close(); }
});

test('accepted review is not resolved until associated revision verification passes', async () => {
  let issueId = '';
  const f = fixture(undefined, async (_prefs, _route, system, prompt) => {
    if (system.includes('约束规划')) return JSON.stringify({ decisions: [{ reviewId: issueId, decision: 'accepted', reason: '保持语气', constraints: [{ kind: 'hard', text: '统一语气', paragraphIndices: [0] }] }] });
    if (system.includes('结果复审')) return '{"resolved":true,"reason":"所有关联段落已复审通过"}';
    if (system.includes('审核文学翻译')) return '{"score":95,"issues":[]}';
    return prompt.includes('旧译文仅作修订参考') ? '修订后的译文' : '有效译文';
  });
  try {
    f.runtime.updateConfig('task', { ...f.config, chapterIds: ['c1'] }); running(f);
    await f.runtime.execute('task', op('translate_metadata', null), new AbortController().signal);
    await f.runtime.execute('task', op('translate_chapter', 'c1'), new AbortController().signal);
    const review = f.service.writeReview('task', { chapterId: 'c1', reviewRound: 1, severity: 'high', paragraphIndices: [0], scores: {}, suggestion: '统一语气', replacementText: null, forceChange: true, resolved: false, resolution: 'open', resolutionNote: null }); issueId = review.id;
    f.service.resolveReview('task', issueId, 'accepted'); assert.equal(f.service.listReviews('task')[0]!.resolved, false);
    assert.ok(f.runtime.completionIssues('task').some((issue) => issue.includes('未解决审核意见')));
    await f.runtime.execute('task', op('revise_chapter', 'c1'), new AbortController().signal);
    assert.equal(f.service.listReviews('task')[0]!.resolved, true);
    assert.equal(f.db.listRefinedRevisions('task').length, 1);
    await f.runtime.execute('task', op('review_chapter', 'c1'), new AbortController().signal);
    assert.deepEqual(f.runtime.completionIssues('task'), []);
  } finally { f.close(); }
});
