import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService, type TranslationMessageFormat } from './system-preferences';
import { createTranslationPipelineGraph } from './translation-pipeline';
import { TranslationHistoryManager } from './translation/nodes/history-manager';
import { LlmInteractionLogger } from './translation/nodes/llm-logger';
import { buildHyMt2Prompt } from './translation/nodes/hy-mt2-messages';
import { buildIndexTranslatePrompt } from './translation/nodes/index-translate-messages';
import { TranslationService } from './translation-service';
import type { ParagraphDraft, TranslationTermEntry } from './translation-state';

const glossary: TranslationTermEntry[] = [{ id: 'cat', sourceTerm: '猫', targetTerm: '猫咪', entityType: null, priority: 1 }];
const background: ParagraphDraft[] = [{ paragraphIndex: 0, sourceText: '前の段落', translatedText: '这是同章前一段的有效译文背景。', confidence: 1, appliedTermIds: [], modelId: 'fake' }];
const formats = ['general', 'hy-mt2', 'bilibili-index-translate'] as const;
interface RequestBody { messages: Array<{ role: string; content: string }>; model: string; temperature: number; think?: boolean; chat_template_kwargs?: unknown }
function prefs(format: TranslationMessageFormat, type: 'openai-compatible' | 'ollama' = 'openai-compatible') {
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([{ id: 'p', type, apiKey: 'secret-test-key', baseUrl: 'http://fake.invalid/v1', models: [{ id: 'm', modelId: 'fake:model', capabilities: ['chat'], translationMessageFormat: format }] }]);
  return preferences;
}
function completion(content: string, usage = false) {
  return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: 'fake:model', choices: [{ index: 0, message: { role: 'assistant', content }, ...(usage ? { finish_reason: 'stop' } : {}) }], ...(usage ? { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } } : {}) });
}
function repository() {
  const db = new SqliteNovelRepository(':memory:');
  db.saveMetadata('manual', { novelId: 'n', title: '猫', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
  db.ensureSyntheticChapter('manual', 'n', 'c', '猫', 1);
  return db;
}
const input = { sourceId: 'manual', novelId: 'n', chapterId: 'c', sourceLang: 'ja', targetLang: 'zh-CN', glossary };

test('scoped translation excludes metadata and other chapters, rejects conflicts and preserves old text on failure', async (t) => {
  const db = repository();
  const preferences = prefs('bilibili-index-translate');
  preferences.updateTranslationPreferences({ enableLlmInteractionLog: false, translationConcurrency: 1 });
  const service = new TranslationService(db, preferences);
  let fail = false;
  const prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    prompts.push(String(init.body));
    return completion(fail ? '' : '译文');
  });
  const wait = async () => { for (let i = 0; service.isRunning('manual', 'n'); i++) { assert(i < 500); await new Promise((r) => setTimeout(r, 10)); } };
  try {
    db.saveChapterIndex('manual', 'n', [{ id: 'c', index: 1, title: '章题', url: '' }, { id: 'd', index: 2, title: '未选择章', url: '' }]);
    for (const [chapterId, index] of [['c', 1], ['d', 2]] as const) db.saveChapterContent('manual', 'n', { chapterId, index, title: chapterId, url: '', content: chapterId === 'c' ? '正文' : '未选择正文' });
    assert.throws(() => service.startTranslation('manual', 'n', undefined, false, ['foreign']));
    const started = service.startTranslation('manual', 'n', undefined, false, ['c']);
    assert.equal(started.totalUnits, 1);
    assert.throws(() => service.startTranslation('manual', 'n'), /正在运行/);
    await wait();
    assert.equal(db.getChapterTranslation('manual', 'n', 'd', 'ja', 'zh-CN'), null);
    assert.equal(db.getChapterTranslation('manual', 'n', '__novel_meta__', 'ja', 'zh-CN'), null);
    assert(prompts.every((prompt) => !prompt.includes('未选择正文')));
    assert.throws(() => service.startTranslation('manual', 'n', undefined, false, ['c']), /无需继续/);
    fail = true;
    service.startTranslation('manual', 'n', undefined, true, ['c']);
    await wait();
    assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN')?.translatedTitle, '译文');
    assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c')[0]?.translatedText, '译文');
    assert.equal(db.getTranslationBuild('manual', 'n')?.failedChapters, 1);
  } finally { db.close(); }
});

for (const format of ['hy-mt2', 'bilibili-index-translate'] as const) {
  for (const echoed of ['glossary', 'background'] as const) for (const batchSize of [1, 2]) {
    test(`${format}: ${echoed} echo retries preserve the other material in batches of ${batchSize}`, async (t) => {
      const db = repository();
      const requests: string[] = [];
      const contextText = '这是上一段已经确认有效的背景译文。';
      t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
        requests.push((JSON.parse(String(init.body)) as RequestBody).messages[0]!.content);
        const content = requests.length === 1 ? (batchSize === 1 ? contextText : `【1】章题\n【2】${contextText}`)
          : requests.length === 2 ? (echoed === 'glossary'
            ? batchSize === 1 ? '猫 → 猫咪' : format === 'hy-mt2' ? '参考下面的翻译：猫 翻译成 猫咪' : '【硬性要求】专名/术语对照: 猫→猫咪'
            : batchSize === 1 ? contextText : `${format === 'hy-mt2' ? '〖背景信息〗' : '【注意】'}${contextText}`)
          : batchSize === 1 ? '猫咪来了' : '【1】猫咪来了\n【2】猫咪睡了';
        return completion(content);
      });
      try {
        const graph = createTranslationPipelineGraph({ preferences: prefs(format), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: batchSize });
        const result = await graph.invoke({ ...input, sourceContent: batchSize === 1 ? '章題\n\n猫が来た' : '章題\n\n晴れた\n\n猫が来た\n\n猫が寝た' });
        assert.equal(result.errorMessage, null);
        assert.equal(requests.length, 3);
        const terms = format === 'hy-mt2' ? /参考下面的翻译：/ : /专名\/术语对照:/;
        const background = format === 'hy-mt2' ? /〖背景信息〗/ : /【注意】/;
        assert.match(requests[1]!, terms);
        assert.match(requests[1]!, background);
        assert.match(requests[2]!, echoed === 'glossary' ? background : terms);
        assert.doesNotMatch(requests[2]!, echoed === 'glossary' ? terms : background);
      } finally { db.close(); }
    });
  }
}

test('HY-MT2 accepts aligned unnumbered paragraphs without changing its template or triggering fallback', async (t) => {
  const db = repository();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return completion('猫的故事\n\n天气晴了'); });
  try {
    const graph = createTranslationPipelineGraph({ preferences: prefs('hy-mt2'), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2 });
    const result = await graph.invoke({ ...input, sourceContent: '猫の物語\n\n晴れた' });
    assert.equal(result.errorMessage, null);
    assert.equal(calls, 1);
    assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN')?.translatedTitle, '猫的故事');
    assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c')[0]?.translatedText, '天气晴了');
  } finally { db.close(); }
});

test('Index still rejects unnumbered paragraph responses and falls back to single requests', async (t) => {
  const db = repository();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => completion(++calls === 1 ? '猫的故事\n\n天气晴了' : calls === 2 ? '猫的故事' : '天气晴了'));
  try {
    const graph = createTranslationPipelineGraph({ preferences: prefs('bilibili-index-translate'), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2 });
    const result = await graph.invoke({ ...input, sourceContent: '猫の物語\n\n晴れた' });
    assert.equal(result.errorMessage, null);
    assert.equal(calls, 3);
  } finally { db.close(); }
});

test('cache diagnostics distinguish zero usage from a measured hit rate', async (t) => {
  const db = repository();
  const logs: string[] = [];
  t.mock.method(console, 'log', (line: string) => { logs.push(line); });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const hit = calls++ === 0 ? 0 : 3;
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: 'fake:model', choices: [{ index: 0, message: { role: 'assistant', content: '有效译文' }, finish_reason: 'stop' }], usage: { prompt_tokens: hit ? 4 : 0, completion_tokens: 1, total_tokens: hit ? 5 : 1, prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: hit ? 1 : 0 } });
  });
  try {
    const graph = createTranslationPipelineGraph({ preferences: prefs('general'), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1 });
    await graph.invoke({ ...input, sourceContent: '章題\n\n晴れた' });
    assert.ok(logs.some((line) => line.includes('total=0 rate=unavailable')));
    assert.ok(logs.some((line) => line.includes('total=4 rate=75%')));
  } finally { db.close(); }
});

test('chapter checkpoint lookup is scoped by source, novel and chapter', () => {
  const db = repository();
  try {
    for (const chapterId of ['c', 'other']) db.saveTranslationBuildCheckpoint({ ...input, chapterId, chapterIndex: 1, stage: 'failed', pipelineStateJson: JSON.stringify({ chapterId }), warningMessage: chapterId });
    assert.equal(db.getTranslationBuildCheckpoint('manual', 'n', 'c')?.pipelineStateJson, '{"chapterId":"c"}');
    assert.equal(db.getTranslationBuildCheckpoint('manual', 'n', 'other')?.warningMessage, 'other');
    assert.equal(db.getTranslationBuildCheckpoint('wrong', 'n', 'c'), null);
    assert.equal(db.getTranslationBuildCheckpoint('manual', 'wrong', 'c'), null);
    assert.equal(db.getTranslationBuildCheckpoint('manual', 'n', 'missing'), null);
  } finally { db.close(); }
});

for (const withTerms of [false, true]) for (const withBackground of [false, true]) {
  test(`HY-MT2 exact template: glossary=${withTerms}, background=${withBackground}`, () => {
    const prompt = buildHyMt2Prompt([{ sourceText: '猫が来た' }], 'zh-CN', withTerms ? glossary : [], withBackground ? background : []);
    const reference = withTerms ? '参考下面的翻译：\n猫 翻译成 猫咪\n' : '';
    const expected = withTerms && withBackground
      ? '参考下面的翻译：\n猫 翻译成 猫咪\n\n〖背景信息〗\n这是同章前一段的有效译文背景。\n\n请参考上述术语翻译并结合背景信息，将以下文本翻译为简体中文，注意只需要输出翻译后的结果，不要额外解释：\n〖待翻译文本〗\n猫が来た'
      : reference + (withBackground
      ? '〖背景信息〗\n这是同章前一段的有效译文背景。\n请结合背景信息将以下文本翻译为简体中文。\n〖待翻译文本〗\n猫が来た'
      : '将以下文本翻译为简体中文，注意只需要输出翻译后的结果，不要额外解释：\n猫が来た');
    assert.equal(prompt, expected);
    assert.equal((prompt.match(/将以下文本翻译为/g) ?? []).length, 1);
  });
  for (const batch of [[{ sourceText: '猫が来た' }], [{ sourceText: '猫が来た' }, { sourceText: '晴れた' }]]) {
    test(`Index template materials and boundaries: terms=${withTerms} background=${withBackground} batch=${batch.length}`, () => {
      const prompt = buildIndexTranslatePrompt(batch, { sourceLang: 'ja', targetLang: 'zh-CN', glossary: withTerms ? glossary : [], previousParagraphs: withBackground ? background : [] });
      if (!withTerms && !withBackground && batch.length === 1) {
        assert.equal(prompt, '请将以下日语文本翻译为简体中文，直接输出翻译结果，不要进行任何解释。\n\n猫が来た');
      } else {
        assert.match(prompt, /^请将以下日语文本翻译成简体中文，并且严格遵循所有约束要求。\n\n【源文】\n/);
        const [source, constraints] = prompt.split('【源文】\n')[1]!.split('\n\n【约束要求】\n');
        assert.equal(source, batch.length === 1 ? '猫が来た' : '【1】猫が来た\n\n【2】晴れた');
        assert.equal(constraints!.includes('【硬性要求】专名/术语对照: 猫→猫咪'), withTerms);
        assert.equal(constraints!.includes('【硬性要求】每段前的【数字编号】要求原样保留'), batch.length > 1);
        assert.equal(constraints!.includes('【注意】以下为上下文背景'), withBackground);
        const numbers = [...constraints!.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
        assert.deepEqual(numbers, Array.from({ length: Number(withTerms) + Number(withBackground) + Number(batch.length > 1) }, (_, i) => i + 1));
        assert.match(prompt, /\n\n只输出译文，不要有任何额外说明。$/);
      }
      assert.doesNotMatch(prompt, /〖背景信息〗|〖待翻译文本〗/);
    });
  }
}

test('Index auto language uses bounded adjacent source references when no valid translation exists', () => {
  const prompt = buildIndexTranslatePrompt([{ sourceText: '日差し' }], { sourceLang: 'auto', targetLang: 'en', glossary, previousParagraphs: [
    { ...background[0]!, translatedText: 'OLD' },
    { ...background[0]!, translatedText: 'a'.repeat(600) },
    { ...background[0]!, translatedText: 'b'.repeat(600) },
    { ...background[0]!, translatedText: '', sourceText: 'ORIGINAL_CONTEXT' },
  ] });
  assert.match(prompt, /^请将以下文本翻译成英语/);
  assert.doesNotMatch(prompt, /auto|OLD|专名\/术语/);
  assert.match(prompt, /ORIGINAL_CONTEXT/);
  assert.ok(prompt.length < 1100);
});

for (const format of formats) for (const failureCase of ['empty', 'whitespace', 'api', 'timeout'] as const) {
  test(`${format}: ${failureCase} stops after four attempts, preserves old translation and never reports success`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (failureCase === 'api') throw new Error('test API failure');
      if (failureCase === 'timeout') throw new DOMException('test timeout', 'TimeoutError');
      return completion(failureCase === 'empty' ? '' : '  \n\t');
    });
    const db = repository();
    try {
      db.saveChapterTranslation({ ...input, translatedTitle: '旧标题', status: 'completed', sourceContentHash: 'old', glossaryVersion: 1, profileVersion: 1 });
      db.replaceChapterTranslationParagraphs('manual', 'n', 'c', [{ paragraphIndex: 1, sourceText: '旧正文', translatedText: '有效旧译文', confidence: 1, appliedTermIds: [], modelId: 'old' }]);
      const saved = db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN');
      const progress: number[] = [];
      const graph = createTranslationPipelineGraph({ preferences: prefs(format), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2, onBatchProgress: (_count, total) => progress.push(total) });
      const result = await graph.invoke({ ...input, sourceContent: '猫\n\n晴れた' });
      const category = failureCase === 'api' ? 'api_error' : failureCase === 'timeout' ? 'timeout' : 'empty_response';
      assert.match(result.errorMessage!, new RegExp(category));
      assert.equal(calls, 4);
      assert.deepEqual(progress, []);
      assert.deepEqual(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN'), saved);
      assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c')[0]?.translatedText, '有效旧译文');
    } finally { db.close(); }
  });
}

for (const format of formats) {
  test(`${format}: batch retry, immediate format fallback and single retry logs match actual requests`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-logs-'));
    const logger = new LlmInteractionLogger({ logDir: dir, enabled: true, context: { runId: 'task-test' } });
    const requests: RequestBody[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as RequestBody);
      const n = requests.length;
      return completion(n === 1 || n === 3 ? '' : n === 2 ? '非空但缺少段落编号' : n === 4 ? '猫咪标题' : '天气晴了', n >= 4);
    });
    const db = repository();
    try {
      const graph = createTranslationPipelineGraph({ preferences: prefs(format), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2, llmLogger: logger });
      const result = await graph.invoke({ ...input, sourceContent: '猫\n\n晴れた' });
      assert.equal(result.errorMessage, null);
      assert.equal(requests.length, 5);
      assert.ok(requests.every((request) => request.temperature === (format === 'bilibili-index-translate' ? 0 : 0.3)),
        'batch, retry and fallback must retain the temperature for the selected format');
      const text = fs.readdirSync(dir).map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('');
      const entries = text.split(/^=== .+ ===\n/gm).filter(Boolean);
      const requestLogs = entries.filter((entry) => entry.startsWith('Event: request '));
      assert.deepEqual(requestLogs.map((entry) => entry.match(/^Phase: (.*)$/m)![1]), ['batch', 'batch_retry', 'single', 'single_retry', 'single']);
      assert.deepEqual(requestLogs.map((entry) => JSON.parse(entry.match(/Paragraphs: (.*)/)![1]!)), [[0, 1], [0, 1], [0], [0], [1]]);
      for (const entry of requestLogs) {
        const id = entry.match(/Call: (.*)/)![1]!;
        assert.equal(entries.filter((e) => e.startsWith(`Event: response Call: ${id}\n`)).length, 1);
        assert.match(entry, /"runId":"task-test".*"chapterId":"c".*"unitKind":"chapter"/);
        assert.match(entry, /Attempt: [1-4]\/4/);
      }
      assert.equal(entries.filter((entry) => entry.startsWith('Event: fallback ')).length, 2);
      assert.match(text, /ErrorCategory: format_mismatch/);
      assert.match(text, /FinishReason: unavailable InputTokens: unavailable OutputTokens: unavailable/);
      assert.match(text, /FinishReason: stop InputTokens: 20 OutputTokens: 10/);
      assert.doesNotMatch(text, /secret-test-key|将回退逐段/);
      assert.doesNotMatch(requests[2]!.messages.at(-1)!.content, /晴れた/);
      assert.doesNotMatch(requests[4]!.messages.at(-1)!.content, /【2】/);
      assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN')?.translatedTitle, '猫咪标题');
      assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c')[0]?.translatedText, '天气晴了');
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const format of ['hy-mt2', 'bilibili-index-translate'] as const) for (const badNumbers of ['【1】标题\n【1】正文', '【2】标题\n【1】正文', '【1】标题', '【1】标题\n【3】正文']) {
  test(`${format} rejects invalid numbering immediately: ${badNumbers}`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => completion(++calls === 1 ? badNumbers : '有效译文'));
    const db = repository();
    try {
      const graph = createTranslationPipelineGraph({ preferences: prefs(format), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2 });
      const result = await graph.invoke({ ...input, sourceContent: '猫\n\n晴れた' });
      assert.equal(calls, 3);
      assert.equal(result.errorMessage, null);
      assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c')[0]?.translatedText, '有效译文');
    } finally { db.close(); }
  });
}

for (const type of ['openai-compatible', 'ollama'] as const) {
  test(`Index selects actual override format and native non-thinking controls for ${type}`, async (t) => {
    const requests: RequestBody[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as RequestBody);
      return type === 'ollama' ? Response.json({ model: 'fake:model', created_at: '2026-01-01T00:00:00Z', message: { role: 'assistant', content: '猫咪' }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 }) : completion('猫咪');
    });
    const db = repository();
    try {
      const preferences = prefs('bilibili-index-translate', type);
      preferences.updateLlmProviders([...preferences.getLlmState().providers, { id: 'general', type: 'openai-compatible', apiKey: 'fake', models: [{ id: 'g', modelId: 'g', capabilities: ['chat'] }] }]);
      preferences.updateModelGateway({ chat: { providerId: 'general', modelId: 'g' } });
      const graph = createTranslationPipelineGraph({ preferences, repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1, modelOverride: 'p:m' });
      const result = await graph.invoke({ ...input, unitKind: 'volume', sourceContent: '猫' });
      assert.equal(result.errorMessage, null);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.model, 'fake:model');
      assert.deepEqual(requests[0]!.messages.map((m) => m.role), ['user']);
      assert.match(requests[0]!.messages[0]!.content, /【源文】/);
      assert.equal(requests[0]!.think, type === 'ollama' ? false : undefined);
      assert.deepEqual(requests[0]!.chat_template_kwargs, type === 'openai-compatible' ? { enable_thinking: false } : undefined);
    } finally { db.close(); }
  });
}

test('failed unit preserves previous text, persists reason, continues other units and resumes without double counting', async (t) => {
  const db = repository();
  const preferences = prefs('bilibili-index-translate');
  preferences.updateTranslationPreferences({ enableLlmInteractionLog: false });
  let fail = true;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    calls++;
    const request = JSON.parse(String(init.body)) as RequestBody;
    const prompt = request.messages[0]!.content;
    const source = prompt.includes('【源文】') ? prompt.split('【源文】\n')[1]!.split('\n\n【约束要求】')[0]! : prompt;
    if (fail && source.includes('FAIL_SENTINEL')) return completion('');
    const numbers = [...source.matchAll(/【(\d+)】/g)];
    return completion(numbers.length ? numbers.map((m) => `【${m[1]}】有效译文${calls}-${m[1]}`).join('\n') : `有效译文${calls}`);
  });
  const awaitCompletion = async () => {
    const deadline = Date.now() + 5000;
    while (db.getTranslationBuild('manual', 'n')?.status === 'running') {
      if (Date.now() > deadline) throw new Error('task did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    db.saveChapterIndex('manual', 'n', [
      { id: 'c', index: 1, title: 'FAIL_SENTINEL', volumeTitle: null, url: '' },
      { id: 'd', index: 2, title: '晴れ', volumeTitle: null, url: '' },
    ]);
    for (const [chapterId, title, index] of [['c', 'FAIL_SENTINEL', 1], ['d', '晴れ', 2]] as const) {
      db.saveChapterContent('manual', 'n', { chapterId, index, title, volumeTitle: null, url: '', content: '本文' });
    }
    db.saveChapterTranslation({ ...input, translatedTitle: '有效旧标题', status: 'completed', sourceContentHash: 'old', glossaryVersion: 1, profileVersion: 1 });
    db.replaceChapterTranslationParagraphs('manual', 'n', 'c', [{ paragraphIndex: 1, sourceText: '本文', translatedText: '有效旧正文', confidence: 1, appliedTermIds: [], modelId: 'old' }]);
    const service = new TranslationService(db, preferences);
    const started = service.startTranslation('manual', 'n', undefined, true);
    await awaitCompletion();
    assert.equal(started.totalUnits, 3);
    assert.equal(service.getTranslationBuild('manual', 'n')?.totalUnits, 3);
    const failedBuild = db.getTranslationBuild('manual', 'n')!;
    assert.equal(failedBuild.status, 'failed');
    assert.equal(failedBuild.failedChapters, 1);
    assert.equal(failedBuild.translatedChapters, 2); // 元数据及另一章节
    assert.match(failedBuild.errorMessage!, /empty_response/);
    assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN')?.status, 'failed');
    assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN')?.translatedTitle, '有效旧标题');
    assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c')[0]?.translatedText, '有效旧正文');
    assert.equal(db.getChapterTranslation('manual', 'n', 'd', 'ja', 'zh-CN')?.status, 'completed');
    assert.ok(db.listTranslationBuildLogs('manual', 'n').some((log) => log.message.includes('empty_response')));
    assert.equal(failedBuild.totalTranslatedParagraphs, 1);
    fail = false;
    const before = calls;
    const resumed = service.startTranslation('manual', 'n');
    await awaitCompletion();
    assert.equal(resumed.totalUnits, 3);
    assert.equal(service.getTranslationBuild('manual', 'n')?.totalUnits, 3);
    const complete = db.getTranslationBuild('manual', 'n')!;
    assert.equal(complete.status, 'completed');
    assert.equal(complete.failedChapters, 0);
    assert.equal(complete.translatedChapters, 3);
    assert.equal(complete.totalTranslatedParagraphs, 2);
    assert.equal(calls - before, 1);
  } finally { db.close(); }
});

test('Index background echo is rejected on retry and failed single fallback never counts as success', async (t) => {
  let calls = 0;
  const requests: RequestBody[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as RequestBody);
    calls++;
    // 第一批成功，第二批缺号立即拆分；单段回显背景，继而返回空文本耗尽。
    return completion(calls === 1 ? '【1】标题\n【2】这是同章前一段的有效译文背景。'
      : calls === 2 ? '无编号的非空响应'
      : calls === 3 ? '这是同章前一段的有效译文背景。'
      : calls <= 6 ? '' : '独立段落成功');
  });
  const db = repository();
  try {
    const progress: number[] = [];
    const graph = createTranslationPipelineGraph({ preferences: prefs('bilibili-index-translate'), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2, onBatchProgress: (_n, total) => progress.push(total) });
    const result = await graph.invoke({ ...input, sourceContent: 'タイトル\n\n前の段落\n\n猫\n\n晴れた' });
    assert.equal(calls, 7);
    assert.deepEqual(progress, [2, 3]);
    assert.match(result.errorMessage!, /^\[empty_response\] 段落 2：[^;]+$/);
    assert.match(requests[2]!.messages[0]!.content, /【注意】以下为上下文背景/);
    assert.doesNotMatch(requests[3]!.messages[0]!.content, /【注意】以下为上下文背景/);
    assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN'), null);
  } finally { db.close(); }
});

for (const format of ['hy-mt2', 'bilibili-index-translate'] as const) {
  for (const withTerms of [false, true]) for (const withBackground of [false, true]) {
    test(`${format}: actual batch retry/fallback retains requested materials terms=${withTerms} background=${withBackground}`, async (t) => {
      const db = repository();
      const requests: RequestBody[] = [];
      const prefixCalls = withBackground ? 1 : 0;
      t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as RequestBody;
        requests.push(request);
        if (withBackground && requests.length === 1) return completion('【1】前面的标题\n【2】这是同章前一段的有效译文背景。');
        const n = requests.length - prefixCalls;
        return completion(n === 1 ? '' : n === 2 ? '缺号' : n === 3 ? '猫咪出现了' : '猫咪休息了');
      });
      try {
        const history = new TranslationHistoryManager();
        history.addEntry('OLD_CHAPTER', 'OLD_TRANSLATION');
        const graph = createTranslationPipelineGraph({ preferences: prefs(format), repository: db, historyManager: history, paragraphsPerBatch: 2 });
        const result = await graph.invoke({ ...input, glossary: withTerms ? glossary : [], sourceContent: `${withBackground ? '前の題名\n\n前の内容\n\n' : ''}猫が来た\n\n猫が休んだ` });
        assert.equal(result.errorMessage, null);
        assert.equal(requests.length, 4 + prefixCalls);
        const main = requests.slice(prefixCalls);
        assert.equal(main[0]!.messages[0]!.content, main[1]!.messages[0]!.content);
        for (const request of main) assert.deepEqual(request.messages.map((m) => m.role), ['user']);
        for (const request of main.slice(0, 3)) {
          const prompt = request.messages[0]!.content;
          assert.equal(prompt.includes(format === 'hy-mt2' ? '参考下面的翻译：' : '【硬性要求】专名/术语对照:'), withTerms);
          assert.equal(prompt.includes(format === 'hy-mt2' ? '〖背景信息〗' : '【注意】以下为上下文背景'), withBackground);
          assert.doesNotMatch(prompt, /OLD_CHAPTER|OLD_TRANSLATION/);
        }
        const single = main[2]!.messages[0]!.content;
        assert.doesNotMatch(single, /猫が休んだ|【数字编号】|【2】/);
        const title = db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN')!.translatedTitle;
        assert.doesNotMatch(title!, /【\d+】/);
        assert.ok(db.listChapterTranslationParagraphs('manual', 'n', 'c').every((p) => !/【\d+】/.test(p.translatedText)));
      } finally { db.close(); }
    });
  }
}

test('cancellation aborts the active request without retries, fallback or persistence', async (t) => {
  const db = repository();
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    calls++;
    controller.abort();
    assert.equal(init.signal?.aborted, true);
    throw new DOMException('cancelled', 'AbortError');
  });
  try {
    const graph = createTranslationPipelineGraph({ preferences: prefs('bilibili-index-translate'), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2, abortSignal: controller.signal });
    const result = await graph.invoke({ ...input, sourceContent: '猫\n\n晴れた' });
    assert.equal(result.pauseRequested, true);
    assert.equal(calls, 1);
    assert.equal(db.getChapterTranslation('manual', 'n', 'c', 'ja', 'zh-CN'), null);
  } finally { db.close(); }
});

test('partial unit checkpoints survive service recreation and only failed paragraphs are retried', async (t) => {
  const db = repository();
  const preferences = prefs('bilibili-index-translate');
  preferences.updateTranslationPreferences({ enableLlmInteractionLog: false, translationConcurrency: 1 });
  let fail = true;
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const prompt = (JSON.parse(String(init.body)) as RequestBody).messages[0]!.content;
    const source = prompt.includes('【源文】') ? prompt.split('【源文】\n')[1]!.split('\n\n【约束要求】')[0]! : prompt.split('\n\n').at(-1)!;
    requests.push(source);
    return completion(fail && source === 'FAIL_SOURCE' ? '' : `有效译文-${source}`);
  });
  const waitForBuild = async () => {
    const deadline = Date.now() + 5000;
    while (db.getTranslationBuild('manual', 'n')?.status === 'running') {
      assert.ok(Date.now() < deadline, 'translation did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const writes: Array<{ runId: string; runStartedAt: number }> = [];
  const saveBuild = db.saveTranslationBuild.bind(db);
  t.mock.method(db, 'saveTranslationBuild', (record: Parameters<typeof db.saveTranslationBuild>[0]) => {
    if (record.modelStatsJson) {
      const { runId, runStartedAt } = JSON.parse(record.modelStatsJson) as { runId: string; runStartedAt: number };
      writes.push({ runId, runStartedAt });
    }
    return saveBuild(record);
  });
  try {
    db.saveChapterIndex('manual', 'n', [{ id: 'c', index: 1, title: '章題', volumeTitle: null, url: '' }]);
    db.saveChapterContent('manual', 'n', { chapterId: 'c', index: 1, title: '章題', volumeTitle: null, url: '', content: '晴れた\n\nFAIL_SOURCE\n\n風が吹いた' });
    new TranslationService(db, preferences).startTranslation('manual', 'n');
    await waitForBuild();
    const checkpoint = db.getTranslationBuildCheckpoint('manual', 'n', 'c')!;
    assert.equal(checkpoint.stage, 'failed');
    const saved = JSON.parse(checkpoint.pipelineStateJson) as { drafts: ParagraphDraft[] };
    assert.deepEqual(saved.drafts.map((draft) => draft.paragraphIndex), [0, 1, 3]);
    assert.match(checkpoint.warningMessage!, /empty_response.*段落 2/);
    assert.deepEqual(db.listChapterTranslationParagraphs('manual', 'n', 'c'), []);
    const preview = new TranslationService(db, preferences).getChapterTranslationDetail('manual', 'n', 'c', 'ja', 'zh-CN');
    assert.equal(preview?.status, 'failed');
    assert.equal(preview?.translatedTitle, '有效译文-章題');
    assert.deepEqual(preview?.paragraphs.map((paragraph) => [paragraph.sourceText, paragraph.translatedText]), [
      ['晴れた', '有效译文-晴れた'], ['FAIL_SOURCE', null], ['風が吹いた', '有效译文-風が吹いた'],
    ]);
    const stats = writes[0]!;
    assert.match(stats.runId, /^[0-9a-f-]{36}$/);
    assert.equal(typeof stats.runStartedAt, 'number');
    assert.ok(writes.length > 1);
    for (const record of writes) assert.deepEqual(record, stats, 'initial, progress and final records must share the same run');
    writes.length = 0;
    fail = false;
    const before = requests.length;
    t.mock.method(db, 'listTranslationBuildCheckpoints', () => { throw new Error('resume must not load every chapter checkpoint'); });
    new TranslationService(db, preferences).startTranslation('manual', 'n');
    await waitForBuild();
    assert.deepEqual(requests.slice(before), ['FAIL_SOURCE']);
    assert.equal(db.getTranslationBuild('manual', 'n')?.status, 'completed');
    assert.equal(db.getTranslationBuild('manual', 'n')?.failedChapters, 0);
    assert.equal(db.listChapterTranslationParagraphs('manual', 'n', 'c').length, 3);
    assert.equal(db.getTranslationBuildCheckpoint('manual', 'n', 'c')!.stage, 'completed');
    const completedPreview = new TranslationService(db, preferences).getChapterTranslationDetail('manual', 'n', 'c', 'ja', 'zh-CN')!;
    assert.equal(completedPreview.status, 'completed');
    assert.equal(completedPreview.translatedTitle, '有效译文-章題');
    assert.deepEqual(completedPreview.readingSummary, { totalParagraphs: 3, translatedParagraphs: 3, draftParagraphs: 0, retainedParagraphs: 0 });
    assert.notEqual(writes[0]!.runId, stats.runId);
    for (const record of writes) assert.deepEqual(record, writes[0]);
  } finally { db.close(); }
});

test('unit details survive restart, distinguish four failed chapters, and resume only their missing paragraphs', async (t) => {
  const db = repository();
  const preferences = prefs('bilibili-index-translate');
  preferences.updateTranslationPreferences({ enableLlmInteractionLog: false, translationConcurrency: 1 });
  let fail = true;
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const prompt = (JSON.parse(String(init.body)) as RequestBody).messages[0]!.content;
    const source = prompt.includes('【源文】') ? prompt.split('【源文】\n')[1]!.split('\n\n【约束要求】')[0]! : prompt.split('\n\n').at(-1)!;
    requests.push(source);
    return completion(fail && source.startsWith('FAIL_') ? '' : `有效译文-${source}`);
  });
  const saveBuild = db.saveTranslationBuild.bind(db);
  t.mock.method(db, 'saveTranslationBuild', (record: Parameters<typeof db.saveTranslationBuild>[0]) => {
    const stats = JSON.parse(record.modelStatsJson ?? '{}') as { totalUnits?: number; units?: Array<{ status: string }> };
    if (stats.units) {
      assert.equal(stats.units.length, stats.totalUnits);
      assert.equal(stats.units.filter((unit) => unit.status === 'translated').length, record.translatedChapters);
      assert.equal(stats.units.filter((unit) => unit.status === 'failed').length, record.failedChapters);
    }
    return saveBuild(record);
  });
  const waitForBuild = async () => {
    const deadline = Date.now() + 5000;
    while (db.getTranslationBuild('manual', 'n')?.status === 'running') {
      assert.ok(Date.now() < deadline, 'translation did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    const chapters = Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, index: index + 1, title: `章題${index}`, volumeTitle: '巻一', url: '' }));
    db.saveChapterIndex('manual', 'n', [...chapters, { id: 'not-downloaded', index: 6, title: '未下载', volumeTitle: '巻二', url: '' }]);
    for (const chapter of chapters) db.saveChapterContent('manual', 'n', {
      ...chapter, chapterId: chapter.id, content: `晴れた${chapter.id}\n\n${chapter.id === 'c0' ? '晴れ続く' : `FAIL_${chapter.id}`}\n\n風が吹いた${chapter.id}`,
    });
    let service = new TranslationService(db, preferences);
    assert.equal(service.getTranslationUnitStatuses('manual', 'missing'), null);
    assert.equal(service.getTranslationUnitStatuses('manual', 'n')?.scope, 'current');
    assert.deepEqual(service.getTranslationUnitStatuses('manual', 'n')?.units.map((unit) => unit.status), Array(7).fill('pending'));
    service.startTranslation('manual', 'n');
    assert.deepEqual(service.getTranslationUnitStatuses('manual', 'n')?.units.map((unit) => unit.status), Array(7).fill('pending'));
    await waitForBuild();
    service = new TranslationService(db, preferences);
    const details = service.getTranslationUnitStatuses('manual', 'n')!;
    assert.equal(details.scope, 'run');
    assert.deepEqual(details.units.filter((unit) => unit.status === 'translated').map((unit) => unit.kind), ['meta', 'volume', 'chapter']);
    assert.deepEqual(details.units.filter((unit) => unit.status === 'failed').map((unit) => unit.id), ['c1', 'c2', 'c3', 'c4']);
    for (const unit of details.units.filter((unit) => unit.status === 'failed')) assert.match(unit.errorMessage!, /empty_response.*段落 2/);
    assert.equal(details.units.some((unit) => unit.id === 'not-downloaded'), false);

    // 旧版构建没有单元快照，仍能找回章节、简介和卷标题的状态及失败原因。
    const build = db.getTranslationBuild('manual', 'n')!;
    saveBuild({ ...build, sourceId: 'manual', novelId: 'n', modelStatsJson: JSON.stringify({ totalUnits: 7 }) });
    const legacy = service.getTranslationUnitStatuses('manual', 'n')!;
    assert.equal(legacy.scope, 'current');
    assert.deepEqual(legacy.units, details.units);
    saveBuild({ ...build, sourceId: 'manual', novelId: 'n', modelStatsJson: '{broken' });
    assert.deepEqual(service.getTranslationUnitStatuses('manual', 'n')?.units, details.units);

    fail = false;
    const before = requests.length;
    service.startTranslation('manual', 'n');
    const resumed = service.getTranslationUnitStatuses('manual', 'n')!;
    assert.equal(resumed.units.filter((unit) => unit.status === 'translated').length, 3);
    assert.equal(resumed.units.filter((unit) => unit.status === 'pending').length, 4);
    await waitForBuild();
    assert.deepEqual(requests.slice(before), ['FAIL_c1', 'FAIL_c2', 'FAIL_c3', 'FAIL_c4']);
    assert.ok(service.getTranslationUnitStatuses('manual', 'n')!.units.every((unit) => unit.status === 'translated'));

    service.startTranslation('manual', 'n', undefined, true);
    assert.ok(service.getTranslationUnitStatuses('manual', 'n')!.units.every((unit) => unit.status === 'pending'), 'old translations must not count as this run\'s completed units');
    await waitForBuild();
    assert.ok(service.getTranslationUnitStatuses('manual', 'n')!.units.every((unit) => unit.status === 'translated'));
  } finally { db.close(); }
});

for (const change of ['source', 'language', 'glossary', 'format', 'model', 'from-scratch'] as const) {
  test(`incomplete checkpoints are not reused after ${change} changes`, async (t) => {
    const db = repository();
    const preferences = prefs('hy-mt2');
    let fail = true;
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return completion(fail && calls > 1 ? '' : `有效译文${calls}`);
    });
    try {
      const runtime = { preferences, repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1 };
      const initial = { ...input, sourceContent: '章題\n\n猫' };
      const failed = await createTranslationPipelineGraph(runtime).invoke(initial);
      assert.ok(failed.errorMessage);
      assert.equal(db.listTranslationBuildCheckpoints('manual', 'n').length, 1);
      if (change === 'format') preferences.updateLlmProviders([{ ...preferences.getLlmState().providers[0]!, models: [{ ...preferences.getLlmState().providers[0]!.models[0]!, translationMessageFormat: 'bilibili-index-translate' }] }]);
      if (change === 'model') preferences.updateLlmProviders([{ ...preferences.getLlmState().providers[0]!, models: [{ ...preferences.getLlmState().providers[0]!.models[0]!, modelId: 'another-model' }] }]);
      fail = false;
      const before = calls;
      const result = await createTranslationPipelineGraph({ ...runtime, resumeIncomplete: change !== 'from-scratch' }).invoke({
        ...initial,
        ...(change === 'source' ? { sourceContent: '別の章題\n\n猫' } : {}),
        ...(change === 'language' ? { targetLang: 'en' } : {}),
        ...(change === 'glossary' ? { glossary: [{ ...glossary[0]!, targetTerm: '小猫' }] } : {}),
      });
      assert.equal(result.errorMessage, null);
      assert.equal(calls - before, 2, 'both paragraphs must be translated under the changed inputs');
    } finally { db.close(); }
  });
}

test('failed response is never background, but its same-chapter original text remains usable', async (t) => {
  const db = repository();
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const prompt = (JSON.parse(String(init.body)) as RequestBody).messages[0]!.content;
    requests.push(prompt);
    return completion(requests.length <= 4 ? '【约束要求】FAILED_RESPONSE' : '后续有效译文');
  });
  try {
    const graph = createTranslationPipelineGraph({ preferences: prefs('bilibili-index-translate'), repository: db, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1 });
    const result = await graph.invoke({ ...input, sourceContent: '原文参考\n\n猫' });
    assert.ok(result.errorMessage);
    assert.equal(requests.length, 5);
    assert.match(requests[4]!, /【注意】以下为上下文背景[^]*原文参考/);
    assert.doesNotMatch(requests[4]!, /FAILED_RESPONSE/);
  } finally { db.close(); }
});
