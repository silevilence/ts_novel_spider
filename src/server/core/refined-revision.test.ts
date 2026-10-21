import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { reviseRefinedChapter, type RevisionGenerator } from './refined-revision';

function fixture(index = true) {
  const repository = new SqliteNovelRepository(':memory:');
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([{ id: 'p', type: 'openai-compatible', apiKey: 'fake', baseUrl: 'http://fake.invalid', models: [
    { id: 'translate', modelId: 'translate', capabilities: ['chat'], translationMessageFormat: index ? 'bilibili-index-translate' : 'general' },
    { id: 'review', modelId: 'review', capabilities: ['chat'] },
  ] }]);
  const task = repository.createRefinedTranslationTask({ id: 't', sourceId: 'manual', novelId: 'n', name: 'test', novelTitle: '', author: '', sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'p', modelId: 'translate' }], omissionModel: null, reviewModel: { providerId: 'p', modelId: 'review' }, concurrency: 1, maxReviewRounds: 5 }, chapters: [{ id: 'c', index: 1, title: '标题', volumeTitle: null, content: '猫が来た\n\n犬が来た\n\n鳥が来た', paragraphs: ['猫が来た', '犬が来た', '鳥が来た'] }], terms: [] });
  for (let i = 0; i < 3; i++) repository.updateRefinedTranslationSegment('t', 'c', i, `旧译文${i}`, 'translated');
  repository.updateRefinedTranslationChapterReview('t', 'c', { reviewRound: 1, reviewScore: 60, status: 'pending' });
  const issue = repository.createRefinedTranslationReview({ taskId: 't', chapterId: 'c', reviewRound: 1, severity: 'high', paragraphIndices: [0, 1], scores: {}, suggestion: '两段应统一语气', replacementText: null, forceChange: true, resolved: false, resolution: 'open', resolutionNote: null });
  const run = (generate: RevisionGenerator, signal = new AbortController().signal) => reviseRefinedChapter({ repository, preferences, task, chapterId: 'c', signal, generate, segmentRoute: () => ({ providerId: 'p', modelId: 'translate' }) });
  const plan = (decision = 'accepted', text = '统一语气') => JSON.stringify({ decisions: [{ reviewId: issue.id, decision, reason: '意见适用', constraints: decision === 'accepted' ? [{ kind: 'hard', text, paragraphIndices: [0] }, { kind: 'soft', text, paragraphIndices: [1] }] : [] }] });
  return { repository, preferences, task, issue, run, plan };
}

for (const index of [true, false]) for (const resolved of [true, false]) test(`revision verifies every linked paragraph; Index=${index}, resolved=${resolved}`, async () => {
  const f = fixture(index); let calls = 0;
  try {
    const result = await f.run(async (_prefs, route, system, prompt) => {
      if (system.includes('约束规划')) { assert.equal(route.modelId, 'review'); return f.plan(); }
      if (system.includes('结果复审')) {
        assert.equal(route.modelId, 'review');
        const material = JSON.parse(prompt) as { paragraphs: Array<{ paragraphIndex: number; translatedText: string }> };
        assert.deepEqual(material.paragraphs.map((row) => row.paragraphIndex), [0, 1]);
        assert.ok(material.paragraphs.every((row) => row.translatedText === '修订译文'));
        return JSON.stringify({ resolved, reason: resolved ? '两个段落均已解决' : '第二段仍需修改' });
      }
      calls++; assert.equal(route.modelId, 'translate');
      if (index) { assert.equal(system, ''); assert.equal(route.thinkingEnabled, false); }
      assert.match(prompt, /【源文】\n(?:猫が来た|犬が来た)\n\n【约束要求】/);
      assert.match(prompt, /旧译文仅作修订参考/);
      return '修订译文';
    });
    assert.equal(result.unresolved, 0); assert.equal(calls, 2);
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolved, resolved);
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolution, 'accepted');
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[2]?.translatedText, '旧译文2');
    assert.equal(f.repository.getRefinedTranslationChapter('t', 'c')?.translatedTitle, null);
    const records = f.repository.listRefinedRevisions('t');
    assert.equal(records.length, 2); assert.ok(records.every((record) => record.status === 'verified'));
    assert.deepEqual(records.map((record) => record.constraints[0]?.kind), ['hard', 'soft']);
  } finally { f.repository.close(); }
});

test('conflicting constraints and rejected opinions do not trigger translation', async () => {
  for (const decision of ['manual', 'rejected']) {
    const f = fixture();
    try {
      let calls = 0;
      const result = await f.run(async () => { calls++; return f.plan(decision); });
      assert.equal(calls, 1); assert.equal(result.unresolved, decision === 'manual' ? 1 : 0);
      assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.translatedText, '旧译文0');
    } finally { f.repository.close(); }
  }
});

test('empty output retries are bounded; a partial cross-paragraph revision never resolves the issue', async () => {
  const f = fixture(); let calls = 0;
  try {
    const result = await f.run(async (_prefs, _route, system, prompt) => {
      if (system.includes('约束规划')) return f.plan();
      assert.doesNotMatch(system, /结果复审/); calls++;
      return prompt.includes('【源文】\n猫') ? '修订译文' : ' ';
    });
    assert.equal(calls, 4); assert.equal(result.unresolved, 1);
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[1]?.translatedText, '旧译文1');
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolved, false);
    assert.equal(f.repository.listRefinedRevisions('t')[1]?.status, 'failed');
  } finally { f.repository.close(); }
});

test('pause after one revision resumes from persisted text without repeating it', async () => {
  const f = fixture(); const abort = new AbortController(); let calls = 0;
  try {
    await f.run(async (_prefs, _route, system, prompt) => {
      if (system.includes('约束规划')) return f.plan();
      calls++;
      if (prompt.includes('【源文】\n犬')) abort.abort();
      return '修订译文';
    }, abort.signal);
    assert.equal(f.repository.listRefinedRevisions('t')[0]?.status, 'revised');
    const before = calls;
    await f.run(async (_prefs, _route, system) => {
      if (system.includes('约束规划')) return f.plan();
      if (system.includes('结果复审')) return '{"resolved":true,"reason":"完整检查"}';
      calls++; return '修订译文';
    });
    assert.equal(calls - before, 1);
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolved, true);
  } finally { f.repository.close(); }
});

test('oversized hard constraints fail visibly without silently trimming them', async () => {
  const f = fixture();
  try {
    const providers = f.preferences.getLlmState().providers;
    f.preferences.updateLlmProviders(providers.map((provider) => ({ ...provider, models: provider.models.map((model) => ({ ...model, contextWindowTokens: model.modelId === 'translate' ? 2048 : 0 })) })));
    const result = await f.run(async (_prefs, _route, system) => { assert.match(system, /约束规划/); return f.plan('accepted', '硬性约束'.repeat(3000)); });
    assert.equal(result.unresolved, 1);
    assert.match(f.repository.listRefinedRevisions('t')[0]?.error ?? '', /预算/);
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.translatedText, '旧译文0');
  } finally { f.repository.close(); }
});

for (const index of [true, false]) for (const threshold of [1, 2]) test(`paragraph limit finalizes with reviewer once: Index=${index}, threshold=${threshold}`, async () => {
  const f = fixture(index); f.task.modelConfig.maxParagraphRevisions = threshold;
  let translations = 0; let finalizations = 0;
  const generator: RevisionGenerator = async (_prefs, route, system, prompt) => {
    if (system.includes('直接定稿')) { assert.equal(route.modelId, 'review'); finalizations++; return '审核最终译文'; }
    if (system.includes('约束规划')) return f.plan();
    if (system.includes('结果复审')) return '{"resolved":false,"reason":"仍需润色"}';
    assert.equal(route.modelId, 'translate'); translations++; return `修订译文${translations}`;
  };
  try {
    for (let round = 1; round <= threshold; round++) {
      f.repository.updateRefinedTranslationChapterReview('t', 'c', { reviewRound: round, reviewScore: 50, status: 'pending' });
      f.repository.updateRefinedTranslationReview('t', f.issue.id, 'open', null);
      await f.run(generator);
      assert.deepEqual(f.repository.listRefinedTranslationSegments('t', 'c').map((row) => row.revisionState?.count), [round, round, 0]);
    }
    f.repository.updateRefinedTranslationChapterReview('t', 'c', { reviewRound: threshold + 1, reviewScore: 50, status: 'pending' });
    f.repository.updateRefinedTranslationReview('t', f.issue.id, 'open', null);
    await f.run(generator);
    assert.equal(translations, threshold * 2); assert.equal(finalizations, 2);
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolved, false, 'direct finalization is not independent review success');
    assert.deepEqual(f.repository.listRefinedTranslationSegments('t', 'c').map((row) => row.revisionState?.status), ['finalized', 'finalized', 'none']);
    f.repository.updateRefinedTranslationReview('t', f.issue.id, 'open', null);
    await f.run(generator); assert.equal(finalizations, 2, 'later opinions must not re-finalize');
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[2]?.translatedText, '旧译文2');
  } finally { f.repository.close(); }
});

test('same round, multiple issues and provider retries count once per paragraph', async () => {
  const f = fixture(); let calls = 0;
  const { id: _id, createdAt: _createdAt, ...issueInput } = f.issue;
  const extra = f.repository.createRefinedTranslationReview({ ...issueInput, suggestion: '另一个意见', paragraphIndices: [0] });
  try {
    await f.run(async (_prefs, _route, system) => {
      if (system.includes('约束规划')) {
        const plan = JSON.parse(f.plan()) as { decisions: unknown[] };
        plan.decisions.push({ reviewId: extra.id, decision: 'accepted', reason: '适用', constraints: [{ kind: 'soft', text: '另一要求', paragraphIndices: [0] }] }); return JSON.stringify(plan);
      }
      if (system.includes('结果复审')) return '{"resolved":false,"reason":"还需修改"}';
      calls++; if (calls === 1) throw new Error('retry'); return '修订';
    });
    assert.equal(calls, 3);
    assert.deepEqual(f.repository.listRefinedTranslationSegments('t', 'c').map((row) => row.revisionState?.count), [1, 1, 0]);
    const records = f.repository.listRefinedRevisions('t');
    const row = f.repository.listRefinedTranslationSegments('t', 'c')[0]!;
    f.repository.completeParagraphRevisionCycle(records[0]!, row.id, '0:1');
    assert.equal(f.repository.getParagraphRevisionState('t', row.id).count, 1);
  } finally { f.repository.close(); }
});

test('failed finalization has bounded attempts, preserves old text and needs explicit reopening', async () => {
  const f = fixture(); f.task.modelConfig.maxParagraphRevisions = 1;
  const row = f.repository.listRefinedTranslationSegments('t', 'c')[0]!;
  f.repository.saveParagraphRevisionState('t', row.id, { ...f.repository.getParagraphRevisionState('t', row.id), count: 1 });
  let calls = 0;
  const generate: RevisionGenerator = async (_prefs, _route, system) => {
    if (system.includes('直接定稿')) { calls++; return ' '; }
    if (system.includes('约束规划')) return f.plan();
    return '普通修订';
  };
  try {
    const result = await f.run(generate);
    assert.equal(calls, 3); assert.equal(result.unresolved, 1);
    assert.equal(f.repository.getParagraphRevisionState('t', row.id).status, 'failed');
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.translatedText, '旧译文0');
    await f.run(generate); assert.equal(calls, 3);
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolved, false);
    f.repository.resetParagraphRevisionState('t', row.id);
    assert.equal(f.repository.getParagraphRevisionState('t', row.id).count, 0);
  } finally { f.repository.close(); }
});

test('cancelling reviewer finalization keeps previous text and can resume safely', async () => {
  const f = fixture(); f.task.modelConfig.maxParagraphRevisions = 1;
  for (const row of f.repository.listRefinedTranslationSegments('t', 'c').slice(0, 2)) f.repository.saveParagraphRevisionState('t', row.id, { ...f.repository.getParagraphRevisionState('t', row.id), count: 1 });
  const abort = new AbortController(); let calls = 0;
  try {
    await f.run(async () => { calls++; abort.abort(); return '不应保存'; }, abort.signal);
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.translatedText, '旧译文0');
    await f.run(async (_prefs, route, system) => { assert.equal(route.modelId, 'review'); assert.match(system, /直接定稿/); calls++; return '最终译文'; });
    assert.equal(calls, 3);
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.revisionState?.status, 'finalized');
  } finally { f.repository.close(); }
});

for (const change of ['translation', 'glossary', 'verification'] as const) test(`in-flight ${change} edits invalidate stale revision materials`, async () => {
  const f = fixture(); let changed = false;
  try {
    const result = await f.run(async (_prefs, _route, system) => {
      if (system.includes('约束规划')) return f.plan();
      if (system.includes('结果复审')) {
        if (change === 'verification') f.repository.updateRefinedTranslationSegment('t', 'c', 0, '用户新译文', 'translated');
        return '{"resolved":true,"reason":"模型已检查"}';
      }
      if (!changed) {
        changed = true;
        if (change === 'translation') f.repository.updateRefinedTranslationSegment('t', 'c', 0, '用户新译文', 'translated');
        if (change === 'glossary') f.repository.createRefinedTranslationTerm('t', { sourceTerm: '猫', targetTerm: '猫咪', status: 'confirmed' });
      }
      return '过期模型译文';
    });
    assert.equal(result.unresolved, 1);
    assert.equal(f.repository.listRefinedTranslationReviews('t')[0]?.resolved, false);
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.translatedText, change === 'glossary' ? '旧译文0' : '用户新译文');
    assert.equal(f.repository.listRefinedTranslationSegments('t', 'c')[0]?.revisionState?.count, 0);
  } finally { f.repository.close(); }
});
