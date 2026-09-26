import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService, type TranslationMessageFormat } from './system-preferences';
import { createTranslationPipelineGraph, resolveTranslationModel } from './translation-pipeline';
import { TranslationHistoryManager } from './translation/nodes/history-manager';
import { batchHyMt2Segments, buildHyMt2Prompt, hasHyMt2GlossaryEcho, HY_MT2_TEXT_BUDGET } from './translation/nodes/hy-mt2-messages';
import type { TranslationTermEntry } from './translation-state';
import { LlmInteractionLogger } from './translation/nodes/llm-logger';

test('HY-MT2 includes only glossary entries occurring in the current source, never background-only terms', () => {
  const terms = [...glossary, { ...glossary[0]!, id: 'other', sourceTerm: '犬', targetTerm: '狗狗' }];
  const prompt = buildHyMt2Prompt([{ sourceText: '猫が来た' }], 'zh-CN', terms, []);
  assert.match(prompt, /猫 → 猫咪/);
  assert.doesNotMatch(prompt, /犬|狗狗/);
});

test('translation logging defaults on, persists explicit off and survives unrelated preference saves', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-log-preferences-'));
  const storageFilePath = path.join(directory, 'preferences.json');
  try {
    fs.writeFileSync(storageFilePath, JSON.stringify({ translation: { sourceLang: 'ja' } }));
    const prefs = new SystemPreferencesService({ storageFilePath });
    assert.equal(prefs.getTranslationState().config.enableLlmInteractionLog, true);
    prefs.updateTranslationPreferences({ enableLlmInteractionLog: false });
    prefs.updateTranslationPreferences({ translationConcurrency: 2 });
    assert.equal(new SystemPreferencesService({ storageFilePath }).getTranslationState().config.enableLlmInteractionLog, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('general translation logs requests before network errors and filters terms in batch and fallback', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-network-logs-'));
  const logger = new LlmInteractionLogger(directory);
  const readLogs = () => fs.readdirSync(directory).map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    calls++;
    const request = JSON.parse(String(init.body)) as ModelRequest;
    assert.match(request.messages[0]!.content, /猫 → 猫咪/);
    assert.doesNotMatch(request.messages[0]!.content, /犬|狗狗/);
    assert.equal((readLogs().match(/Event: request /g) ?? []).length, calls);
    throw new Error('test network unavailable');
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'network', title: 'test', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'network', 'chapter', 'test', 1);
    const graph = createTranslationPipelineGraph({ preferences: preferences('general'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1, llmLogger: logger });
    await graph.invoke({ sourceId: 'manual', novelId: 'network', chapterId: 'chapter', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '猫が来た', glossary: [...glossary, { ...glossary[0]!, id: 'other', sourceTerm: '犬', targetTerm: '狗狗' }] });
    assert.equal(calls, 5);
    assert.equal((readLogs().match(/Event: response /g) ?? []).length, 5);
    assert.equal((readLogs().match(/ERROR: test network unavailable/g) ?? []).length, 5);
  } finally { logger.close(); repository.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('HY-MT2 rejects unlabelled background replay and logs the rejected raw response', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-logs-'));
  const logger = new LlmInteractionLogger(directory, true);
  const prompts: string[] = [];
  const previous = ['「诶！我说我可爱啊？」', '「没错，千晶很可爱嘛……可千万别被奇怪的男人袭击啊。」'];
  const correct = '「嘿嘿～～那就得让哥哥保护我啦～～！」';
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as ModelRequest;
    prompts.push(request.messages.at(-1)!.content);
    const content = prompts.length <= 2 ? previous[prompts.length - 1]! : prompts.length === 3 ? previous.join('\n') : correct;
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'context', title: 'test', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'context', 'chapter', 'test', 1);
    const graph = createTranslationPipelineGraph({ preferences: preferences('hy-mt2'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1, llmLogger: logger });
    await graph.invoke({ sourceId: 'manual', novelId: 'context', chapterId: 'chapter', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '「え！あたしが可愛いってこと？」\n\n「そうだ、千晶は可愛いんだから……変な男に襲われるぞ全く」\n\n「えへへ～～じゃあお兄ちゃんに守ってもらわなきゃね～～！」', glossary: [{ ...glossary[0]!, sourceTerm: 'お兄ちゃん', targetTerm: '哥哥' }] });
    assert.equal(repository.listChapterTranslationParagraphs('manual', 'context', 'chapter').at(-1)!.translatedText, correct);
    assert.equal(prompts.length, 4);
    assert.doesNotMatch(prompts[3]!, /【背景信息】/);
    const logs = fs.readdirSync(directory).map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
    assert.ok(logs.includes(previous.join('\n')));
    assert.match(logs, /ERROR:.*背景/);
    assert.match(logs, /translation-model:small/);
    assert.match(logs, /chapter/);
  } finally { logger.close(); repository.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('HY-MT2 rejects background replay in one numbered paragraph of a batch', async (t) => {
  const prompts: string[] = [];
  const background = '猫咪沿着安静的小路慢慢走回自己的家。';
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as ModelRequest;
    prompts.push(request.messages.at(-1)!.content);
    const content = prompts.length === 1 ? `【1】猫的故事\n【2】${background}`
      : prompts.length === 2 ? `【1】${background}\n【2】猫咪醒了`
      : '【1】猫咪睡了\n【2】猫咪醒了';
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'partial', title: '猫', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'partial', 'chapter', '猫', 1);
    const graph = createTranslationPipelineGraph({ preferences: preferences('hy-mt2'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2 });
    await graph.invoke({ sourceId: 'manual', novelId: 'partial', chapterId: 'chapter', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '猫の物語\n\n猫が帰った\n\n猫が寝た\n\n猫が起きた', glossary });
    assert.deepEqual(repository.listChapterTranslationParagraphs('manual', 'partial', 'chapter').map((p) => p.translatedText), [background, '猫咪睡了', '猫咪醒了']);
    assert.equal(prompts.length, 3);
    assert.doesNotMatch(prompts[2]!, /【背景信息】/);
  } finally { repository.close(); }
});

const glossary: TranslationTermEntry[] = [{ id: 'term', sourceTerm: '猫', targetTerm: '猫咪', priority: 1, entityType: null }];
interface ModelRequest { model: string; messages: Array<{ role: string; content: string }> }

test('HY-MT2 rejects glossary pairs echoed without a heading instead of saving them as translation', async (t) => {
  const terms: TranslationTermEntry[] = [
    { id: 'name', sourceTerm: '千晶', targetTerm: '千晶', priority: 1, entityType: null },
    { id: 'brother', sourceTerm: '兄', targetTerm: '哥哥', priority: 1, entityType: null },
    { id: 'drive', sourceTerm: 'USB', targetTerm: 'U盘', priority: 1, entityType: null },
  ];
  const prompts: string[] = [];
  const translated = '哥哥拼命呼唤，千晶终于睁开了眼睛……';
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as ModelRequest;
    prompts.push(request.messages.at(-1)!.content);
    const content = prompts.length === 1 ? '千晶 → 千晶 哥哥 → 哥哥 U盘 → U盘' : translated;
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'echo', title: 'test', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'echo', 'chapter', 'test', 1);
    const graph = createTranslationPipelineGraph({ preferences: preferences('hy-mt2'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1 });
    await graph.invoke({ sourceId: 'manual', novelId: 'echo', chapterId: 'chapter', unitKind: 'volume', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '兄が必死に呼びかけると、ようやく千晶は目を開き……', glossary: terms });
    assert.equal(repository.getChapterTranslation('manual', 'echo', 'chapter', 'ja', 'zh-CN')?.translatedTitle, translated);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0]!, /参考下面的翻译/);
    assert.doesNotMatch(prompts[1]!, /参考下面的翻译|【背景信息】|USB/);
    assert.match(prompts[1]!, /兄が必死に呼びかけると、ようやく千晶は目を開き……$/);
  } finally { repository.close(); }
});

test('HY-MT2 glossary echo detection handles flattened, numbered and translated pairs without rejecting narrative or source arrows', () => {
  const terms: TranslationTermEntry[] = [{ id: 'brother', sourceTerm: '兄', targetTerm: '哥哥', priority: 1, entityType: null }];
  for (const response of ['兄 → 哥哥', '【1】哥哥 → 哥哥', '哥哥 -> 哥哥', '哥哥 ⇒ 哥哥', '正确译文。\n兄 → 哥哥']) {
    assert.equal(hasHyMt2GlossaryEcho(response, '兄が来た', terms), true, response);
  }
  assert.equal(hasHyMt2GlossaryEcho('哥哥来了。', '兄が来た', terms), false);
  assert.equal(hasHyMt2GlossaryEcho('向左 → 向右，哥哥指着路。', '左 → 右、兄が道を指した', terms), false);
  assert.equal(hasHyMt2GlossaryEcho('哥哥 → 哥哥', '兄 → 兄', terms), false);
  assert.equal(hasHyMt2GlossaryEcho('兄 → 哥哥', '兄 → 哥哥', terms), false);
});

test('HY-MT2 rejects glossary echoes in aligned batches and never persists them after retry exhaustion', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as ModelRequest;
    calls++;
    assert.deepEqual(request.messages.map((message) => message.role), ['user']);
    const content = calls <= 4 ? '【1】猫 → 猫咪\n【2】猫咪 → 猫咪' : '猫咪 → 猫咪';
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'echo', title: 'test', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'echo', 'chapter', 'test', 1);
    const graph = createTranslationPipelineGraph({ preferences: preferences('hy-mt2'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 2 });
    const result = await graph.invoke({ sourceId: 'manual', novelId: 'echo', chapterId: 'chapter', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '猫の物語\n\n猫が来た', glossary });
    assert.equal(calls, 12);
    assert.ok(result.errorMessage);
    assert.equal(repository.getChapterTranslation('manual', 'echo', 'chapter', 'ja', 'zh-CN'), null);
    assert.deepEqual(repository.listChapterTranslationParagraphs('manual', 'echo', 'chapter'), []);
  } finally { repository.close(); }
});

function preferences(format: TranslationMessageFormat) {
  const prefs = new SystemPreferencesService();
  prefs.updateLlmProviders([{
    id: 'provider', type: 'openai-compatible', apiKey: 'fake-key', baseUrl: 'http://fake.invalid/v1',
    models: [{ id: 'configured-id', modelId: 'translation-model:small', capabilities: ['chat'], translationMessageFormat: format }],
  }]);
  return prefs;
}

test('translation format defaults, migration and persisted switches', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-format-'));
  const storageFilePath = path.join(directory, 'preferences.json');
  try {
    fs.writeFileSync(storageFilePath, JSON.stringify({ llmProviders: [{ id: 'p', models: [{ id: 'old', modelId: 'hy-mt2' }] }] }));
    let prefs = new SystemPreferencesService({ storageFilePath });
    assert.equal(prefs.getLlmState().providers[0]!.models[0]!.translationMessageFormat, 'general');
    for (const format of ['hy-mt2', 'general'] as const) {
      prefs.updateLlmProviders([{ id: 'p', models: [{ id: 'old', modelId: 'hy-mt2', translationMessageFormat: format }, { id: 'new' }] }]);
      prefs = new SystemPreferencesService({ storageFilePath });
      assert.equal(prefs.getLlmState().providers[0]!.models[0]!.translationMessageFormat, format);
      assert.equal(prefs.getLlmState().providers[0]!.models[1]!.translationMessageFormat, 'general');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('translation routing resolves config IDs and colon-containing wire IDs, preferring translation defaults', () => {
  const prefs = preferences('hy-mt2');
  const expected = { providerId: 'provider', modelId: 'translation-model:small' };
  assert.deepEqual(resolveTranslationModel(prefs, 'provider:configured-id'), expected);
  assert.deepEqual(resolveTranslationModel(prefs, 'provider:translation-model:small'), expected);
  assert.equal(resolveTranslationModel(prefs, 'provider:missing'), null);
  prefs.updateLlmProviders([...prefs.getLlmState().providers, { id: 'other', type: 'ollama', models: [{ id: 'general-id', modelId: 'general' }] }]);
  prefs.updateModelGateway({ chat: { providerId: 'other', modelId: 'general' } });
  prefs.updateTranslationPreferences({ preferredTranslationModelKey: 'provider:configured-id' });
  assert.deepEqual(resolveTranslationModel(prefs), expected);
});

test('HY-MT2 templates use language names and omit empty glossary/background sections', () => {
  assert.equal(buildHyMt2Prompt([{ sourceText: '猫' }], 'ja', [], []), '将以下文本翻译为日语，注意只需要输出翻译后的结果，不要额外解释：\n\n猫');
  const prompt = buildHyMt2Prompt([{ sourceText: '猫' }], 'zh-CN', glossary, []);
  assert.match(prompt, /参考下面的翻译：\n猫 → 猫咪/);
  assert.match(prompt, /【待翻译文本】\n猫/);
  assert.doesNotMatch(prompt, /【背景信息】/);
  assert.match(buildHyMt2Prompt([{ sourceText: '猫' }], 'fr', [], []), /^将以下文本翻译为法语/);
  assert.match(buildHyMt2Prompt([{ sourceText: '猫' }], '法语', [], []), /^将以下文本翻译为法语/);
  assert.throws(() => buildHyMt2Prompt([{ sourceText: '猫' }], 'invalid-code', [], []), /不支持目标语言/);
});

for (const format of ['hy-mt2', 'general'] as const) {
  test(`${format}: real pipeline with fake model persists aligned chapter, metadata and volume`, async (t) => {
    const requests: ModelRequest[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as ModelRequest;
      requests.push(request);
      const prompt = request.messages.at(-1)!.content;
      const text = prompt.includes('【待翻译文本】') ? prompt.split('【待翻译文本】\n').at(-1)! : prompt;
      const numbers = [...text.matchAll(/【(\d+)】/g)];
      const content = numbers.length ? numbers.map((match) => `【${match[1]}】译文猫咪${requests.length}-${match[1]}`).join('\n') : `译文猫咪${requests.length}`;
      return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
    });
    const repository = new SqliteNovelRepository(':memory:');
    try {
      repository.saveMetadata('manual', { novelId: 'test', title: '猫', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
      const history = new TranslationHistoryManager();
      history.addEntry('OLD-CHAPTER-SOURCE', 'OLD-CHAPTER-TRANSLATION');
      const graph = createTranslationPipelineGraph({ preferences: preferences(format), repository, historyManager: history, paragraphsPerBatch: 1 });
      for (const unitKind of ['chapter', 'meta', 'volume'] as const) {
        repository.ensureSyntheticChapter('manual', 'test', unitKind, '猫', 1);
        const before = requests.length;
        const result = await graph.invoke({ sourceId: 'manual', novelId: 'test', chapterId: unitKind, unitKind, sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '猫の物語\n\n猫が来た\n\n猫が寝た\n\n猫が起きた', glossary });
        assert.equal(result.errorMessage, null);
        const saved = repository.getChapterTranslation('manual', 'test', unitKind, 'ja', 'zh-CN');
        assert.equal(saved?.status, 'completed');
        const paragraphs = repository.listChapterTranslationParagraphs('manual', 'test', unitKind);
        assert.equal(paragraphs.length, 3);
        assert.deepEqual(paragraphs.map((p) => p.sourceText), ['猫が来た', '猫が寝た', '猫が起きた']);
        assert.ok(paragraphs.every((p) => p.translatedText.includes('译文猫咪')));
        const calls = requests.slice(before);
        assert.ok(calls.every((r) => r.model === 'translation-model:small'));
        if (format === 'hy-mt2') {
          assert.ok(calls.every((r) => r.messages.length === 1 && r.messages[0]!.role === 'user'));
          assert.doesNotMatch(calls[0]!.messages[0]!.content, /【背景信息】|OLD-CHAPTER/);
          assert.match(calls[1]!.messages[0]!.content, /【背景信息】/);
          assert.doesNotMatch(calls[3]!.messages[0]!.content, new RegExp(`译文猫咪${before + 1}(?!\\d)`));
        } else {
          assert.equal(calls[0]!.messages[0]!.role, 'system');
          assert.match(calls[0]!.messages[0]!.content, /【核心翻译规则】/);
          assert.equal(calls[0]!.messages.at(-1)!.content, '【1】猫の物語');
          assert.ok(calls[1]!.messages.length > calls[0]!.messages.length);
        }
      }
    } finally { repository.close(); }
  });
}

test('HY-MT2 bounds batches, splits long Unicode paragraphs and preserves tables', () => {
  const text = 'あ'.repeat(HY_MT2_TEXT_BUDGET - 1) + '🌙' + 'い'.repeat(HY_MT2_TEXT_BUDGET);
  const segments = [{ id: 'p', paragraphIndex: 0, sourceText: text }];
  const batches = batchHyMt2Segments(segments, 10);
  assert.ok(batches.every((b) => b.reduce((sum, p) => sum + p.sourceText.length, 0) <= HY_MT2_TEXT_BUDGET));
  assert.equal(batches.flat().map((p) => p.sourceText).join(''), text);
  assert.ok(batches.flat().every((p) => !/[\uD800-\uDBFF]$/.test(p.sourceText)));
  const table = '| 原文 | 译文 |\n| --- | --- |\n| 猫 | 猫咪 |';
  assert.deepEqual(batchHyMt2Segments([{ id: 'table', paragraphIndex: 0, sourceText: table }], 2)[0]![0]!.sourceText, table);
  assert.throws(() => batchHyMt2Segments([{ id: 'table', paragraphIndex: 0, sourceText: table.repeat(100) }], 2), /表格超过字符预算/);
});

test('HY-MT2 drops optional background on prompt echo and retries only the current text', async (t) => {
  const prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as ModelRequest;
    assert.deepEqual(request.messages.map((message) => message.role), ['user']);
    prompts.push(request.messages[0]!.content);
    const content = prompts.length === 2 ? '【背景信息】猫的故事' : prompts.length === 1 ? '猫的故事' : '猫咪来了';
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'test', title: '猫', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'test', 'chapter', '猫', 1);
    const graph = createTranslationPipelineGraph({ preferences: preferences('hy-mt2'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 1 });
    await graph.invoke({ sourceId: 'manual', novelId: 'test', chapterId: 'chapter', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: '猫の物語\n\n猫が来た', glossary });
    assert.equal(prompts.length, 3);
    assert.match(prompts[1]!, /【背景信息】/);
    assert.doesNotMatch(prompts[2]!, /【背景信息】|猫的故事/);
    assert.match(prompts[2]!, /参考下面的翻译：[\s\S]*【待翻译文本】\n猫が来た$/);
    assert.equal(repository.listChapterTranslationParagraphs('manual', 'test', 'chapter')[0]!.translatedText, '猫咪来了');
  } finally { repository.close(); }
});

test('HY-MT2 retries and single-segment fallback stay single-user and merge long paragraphs before persistence', async (t) => {
  const requests: ModelRequest[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as ModelRequest;
    requests.push(request);
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0]!.role, 'user');
    assert.match(request.messages[0]!.content, /^将以下文本翻译为简体中文/);
    // 前四次故意丢失编号，触发批量重试以及逐段回退。
    const content = requests.length <= 4 ? '未对齐' : requests.length === 5 ? '【背景信息】旧译文' : `猫咪译文${requests.length}`;
    return Response.json({ id: 'fake', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('manual', { novelId: 'test', title: '猫', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.ensureSyntheticChapter('manual', 'test', 'chapter', '猫', 1);
    const long = '猫'.repeat(3500);
    const graph = createTranslationPipelineGraph({ preferences: preferences('hy-mt2'), repository, historyManager: new TranslationHistoryManager(), paragraphsPerBatch: 3 });
    const result = await graph.invoke({ sourceId: 'manual', novelId: 'test', chapterId: 'chapter', unitKind: 'chapter', sourceLang: 'ja', targetLang: 'zh-CN', sourceContent: `猫\n\n猫です\n\n${long}`, glossary });
    assert.equal(result.errorMessage, null);
    const paragraphs = repository.listChapterTranslationParagraphs('manual', 'test', 'chapter');
    assert.equal(paragraphs.length, 2);
    assert.equal(paragraphs[1]!.sourceText, long);
    assert.equal(paragraphs[1]!.translatedText, '猫咪译文8猫咪译文9猫咪译文10');
    assert.equal(requests.length, 10);
  } finally { repository.close(); }
});
