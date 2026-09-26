import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService, type TranslationMessageFormat } from './system-preferences';
import { createTranslationPipelineGraph, resolveTranslationModel } from './translation-pipeline';
import { TranslationHistoryManager } from './translation/nodes/history-manager';
import { batchHyMt2Segments, buildHyMt2Prompt, HY_MT2_TEXT_BUDGET } from './translation/nodes/hy-mt2-messages';
import type { TranslationTermEntry } from './translation-state';

const glossary: TranslationTermEntry[] = [{ id: 'term', sourceTerm: '猫', targetTerm: '猫咪', priority: 1, entityType: null }];
interface ModelRequest { model: string; messages: Array<{ role: string; content: string }> }

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
