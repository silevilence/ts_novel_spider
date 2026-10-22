import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createHarness, registerPreferenceRoute, temporaryWorkspace } from './harness.js';
const require = createRequire(import.meta.url);
const { SqliteNovelRepository } = require('../../../src/server/core/novel-repository.ts') as typeof import('../../../src/server/core/novel-repository.ts');
const { RefinedTranslationService } = require('../../../src/server/core/refined-translation.ts') as typeof import('../../../src/server/core/refined-translation.ts');
const { SystemPreferencesService } = require('../../../src/server/core/system-preferences.ts') as typeof import('../../../src/server/core/system-preferences.ts');
const { LocalExportEngine } = require('../../../src/server/core/export-engine.ts') as typeof import('../../../src/server/core/export-engine.ts');
const { OfflineLibraryAssetService } = require('../../../src/server/core/offline-library.ts') as typeof import('../../../src/server/core/offline-library.ts');
const { generateRefinedTranslationText } = require('../../../src/server/core/translation/nodes/translate-node.ts') as typeof import('../../../src/server/core/translation/nodes/translate-node.ts');
const { buildIndexTranslatePrompt } = require('../../../src/server/core/translation/nodes/index-translate-messages.ts') as typeof import('../../../src/server/core/translation/nodes/index-translate-messages.ts');
const { redactSecrets } = require('../../../src/server/core/translation/nodes/redact-secrets.ts') as typeof import('../../../src/server/core/translation/nodes/redact-secrets.ts');

/** Local protocol double: no real model or external credentials. */
async function fakeApi(handler: (body: Record<string, unknown>, response: ServerResponse) => void | Promise<void>) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      let text = '';
      for await (const chunk of request) text += String(chunk);
      const body = JSON.parse(text) as Record<string, unknown>;
      requests.push(body);
      await handler(body, response);
    })().catch((error: unknown) => { response.writeHead(500).end(JSON.stringify({ error: { message: String(error) } })); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}

function preferences(baseUrl: string, apiKey = 'validation-secret-not-real') {
  const prefs = new SystemPreferencesService();
  prefs.updateLlmProviders([{ id: 'local-double', type: 'openai-compatible', baseUrl, apiKey, models: [
    { id: 'controller', modelId: 'controller', capabilities: ['chat'], contextWindowTokens: 32000 },
    { id: 'index', modelId: 'index', capabilities: ['chat'], contextWindowTokens: 16000, translationMessageFormat: 'bilibili-index-translate' },
  ] }]);
  return prefs;
}

function completion(response: ServerResponse, text: string) {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'local-response', object: 'chat.completion', created: 1, model: 'index', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } }));
}

test('actual Pi OpenAI transport calls scoped tools and existing Index translation function', { timeout: 20000 }, async () => {
  const workspace = temporaryWorkspace();
  const repository = new SqliteNovelRepository(':memory:');
  let controllerCalls = 0;
  const api = await fakeApi((body, response) => {
    if (body.model === 'index') return completion(response, '爱丽丝去了王都。');
    controllerCalls++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = controllerCalls === 1
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read-1', type: 'function', function: { name: 'read_source', arguments: '{}' } }] }
      : controllerCalls === 2
        ? { role: 'assistant', tool_calls: [{ index: 0, id: 'translate-1', type: 'function', function: { name: 'translate_segment', arguments: '{"paragraphIndex":0}' } }] }
        : { role: 'assistant', content: 'Translated; review still required.' };
    const chunk = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);
    chunk({ id: 'pi-double', object: 'chat.completion.chunk', created: 1, model: 'controller', choices: [{ index: 0, delta, finish_reason: null }] });
    chunk({ id: 'pi-double', object: 'chat.completion.chunk', created: 1, model: 'controller', choices: [{ index: 0, delta: {}, finish_reason: controllerCalls < 3 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    response.end('data: [DONE]\n\n');
  });
  const prefs = preferences(api.baseUrl);
  for (const taskId of ['owned', 'other']) repository.createRefinedTranslationTask({ id: taskId, sourceId: 'test', novelId: 'novel', name: taskId, novelTitle: '测试', author: '', sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'local-double', modelId: 'index' }], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 }, chapters: [{ id: 'chapter', index: 1, title: '序章', volumeTitle: null, content: 'アリスは王都へ行った。', paragraphs: ['アリスは王都へ行った。'] }], terms: [] });
  const service = new RefinedTranslationService(repository, prefs, new LocalExportEngine({ outputRoot: join(workspace.directory, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: join(workspace.directory, 'assets') }) }));
  let translationUsage: unknown;
  const tools = [
    defineTool({ name: 'read_source', label: 'Read source', description: 'Read bound chapter', parameters: Type.Object({}, { additionalProperties: false }), execute: async () => ({ content: [{ type: 'text', text: JSON.stringify(service.readOriginalChapter('owned', 'chapter')) }], details: {} }) }),
    defineTool({ name: 'translate_segment', label: 'Translate', description: 'Translate one paragraph in the bound chapter', parameters: Type.Object({ paragraphIndex: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }), executionMode: 'sequential', execute: async (_id, input, signal) => {
      signal?.throwIfAborted();
      const segment = repository.listRefinedTranslationSegments('owned', 'chapter').find((row) => row.paragraphIndex === input.paragraphIndex);
      if (!segment) throw new Error('Paragraph is outside task scope');
      const prompt = buildIndexTranslatePrompt([{ sourceText: segment.sourceText }], { sourceLang: 'ja', targetLang: 'zh-CN', glossary: [], previousParagraphs: [] });
      const text = await generateRefinedTranslationText(prefs, { providerId: 'local-double', modelId: 'index', thinkingEnabled: true }, '', prompt, signal, (usage) => { translationUsage = usage; });
      signal?.throwIfAborted();
      service.writeSegment('owned', 'chapter', input.paragraphIndex, { translatedText: text, status: 'translated' });
      return { content: [{ type: 'text', text }], details: {} };
    } }),
  ];
  const harness = await createHarness({ directory: workspace.directory, tools, budget: 32000, configureRuntime: async (runtime) => {
    const route = registerPreferenceRoute(runtime, prefs, { providerId: 'local-double', modelId: 'controller' });
    await runtime.setRuntimeApiKey(route.provider.id, route.provider.apiKey);
    return { provider: route.provider.id, modelId: route.model.modelId };
  } });
  try {
    await harness.session.prompt('Read the source, then translate the first paragraph.');
    assert.equal(controllerCalls, 3);
    assert.equal(repository.listRefinedTranslationSegments('owned', 'chapter')[0]?.translatedText, '爱丽丝去了王都。');
    assert.equal(repository.listRefinedTranslationSegments('other', 'chapter')[0]?.translatedText, null);
    assert.equal(repository.getRefinedTranslationTask('owned')?.status, 'paused');
    const request = api.requests.find((body) => body.model === 'index');
    assert.ok(request);
    const messages = request.messages as Array<{ role: string; content: string }>;
    assert.deepEqual(messages.map((message) => message.role), ['user']);
    assert.match(messages[0]!.content, /日本語|日语|日文/);
    assert.equal((request.chat_template_kwargs as { enable_thinking: boolean }).enable_thinking, false);
    assert.deepEqual(translationUsage, { text: '爱丽丝去了王都。', finishReason: 'stop', inputTokens: 30, outputTokens: 10 });
    assert.ok(harness.session.getSessionStats().tokens.total > 0);
    assert.ok(harness.events.includes('tool_execution_end'));
    assert.deepEqual(harness.session.agent.state.tools.map((tool) => tool.name).sort(), ['read_source', 'translate_segment']);
    assert.doesNotMatch(JSON.stringify(harness.manager.getEntries()), /validation-secret-not-real/);
  } finally { harness.session.dispose(); repository.close(); await api.close(); workspace.close(); }
});

test('schema rejects injected scope, negative indices and missing arguments before writes', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  let writes = 0;
  const tool = defineTool({ name: 'write_bound', label: 'Write', description: 'Bound task only', parameters: Type.Object({ paragraphIndex: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }), execute: async () => { writes++; return { content: [{ type: 'text', text: 'written' }], details: {} }; } });
  const harness = await createHarness({ directory: workspace.directory, tools: [tool] });
  try {
    harness.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write_bound', { paragraphIndex: 0, taskId: 'other' }), fauxToolCall('write_bound', { paragraphIndex: -1 }), fauxToolCall('write_bound', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Invalid requests rejected.'),
    ]);
    await harness.session.prompt('Validate scope');
    assert.equal(writes, 0);
    assert.equal(harness.session.messages.filter((message) => message.role === 'toolResult' && message.isError).length, 3);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('budget guard blocks full tool/message context before any provider call', async () => {
  const workspace = temporaryWorkspace();
  const harness = await createHarness({ directory: workspace.directory, budget: 1000 });
  try {
    await harness.session.prompt('必要材料'.repeat(1000));
    assert.equal(harness.faux.state.callCount, 0);
    assert.match(JSON.stringify(harness.session.messages), /上下文上限/);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('tool results are budgeted again before the next model step', async () => {
  const workspace = temporaryWorkspace();
  const tool = defineTool({ name: 'large_result', label: 'Large result', description: 'Return too much context', parameters: Type.Object({}), execute: async () => ({ content: [{ type: 'text', text: '必要原文'.repeat(3000) }], details: {} }) });
  const harness = await createHarness({ directory: workspace.directory, tools: [tool], budget: 12000 });
  try {
    harness.faux.setResponses([fauxAssistantMessage(fauxToolCall('large_result', {}), { stopReason: 'toolUse' })]);
    await harness.session.prompt('Read material');
    assert.equal(harness.faux.state.callCount, 1);
    assert.match(JSON.stringify(harness.session.messages), /上下文上限/);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('controller mapping rejects specialized, missing and unknown-window models', async () => {
  const workspace = temporaryWorkspace();
  const harness = await createHarness({ directory: workspace.directory });
  const prefs = preferences('http://127.0.0.1:1/v1');
  try {
    assert.throws(() => registerPreferenceRoute(harness.runtime, prefs, { providerId: 'local-double', modelId: 'index' }), /Specialized/);
    assert.throws(() => registerPreferenceRoute(harness.runtime, prefs, { providerId: 'missing', modelId: 'controller' }), /unavailable/);
    prefs.updateLlmProviders([{ id: 'zero', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fake', models: [{ id: 'm', modelId: 'm', capabilities: ['chat'] }] }]);
    assert.throws(() => registerPreferenceRoute(harness.runtime, prefs, { providerId: 'zero', modelId: 'm' }), /explicit context/);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('tool errors must be redacted at the adapter boundary before Pi persists them', async () => {
  const workspace = temporaryWorkspace();
  const secret = 'sk-validation-only';
  const tool = defineTool({ name: 'fails', label: 'Fails', description: 'Failure probe', parameters: Type.Object({}), execute: async () => {
    try { throw new Error(`Provider rejected ${secret}`); }
    catch (error) { throw new Error(redactSecrets(String(error), [secret])); }
  } });
  const harness = await createHarness({ directory: workspace.directory, tools: [tool] });
  try {
    harness.faux.setResponses([fauxAssistantMessage(fauxToolCall('fails', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('Failure retained.')]);
    await harness.session.prompt('Run failure probe');
    const stored = JSON.stringify(harness.manager.getEntries());
    assert.doesNotMatch(stored, new RegExp(secret));
    assert.match(stored, /REDACTED/);
    assert.ok(harness.session.messages.some((message) => message.role === 'toolResult' && message.isError));
  } finally { harness.session.dispose(); workspace.close(); }
});

test('provider error is reported without leaking credentials into the session', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  const secret = 'validation-secret-"\\not-real';
  const api = await fakeApi((_body, response) => { response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `Invalid credential ${secret}`, type: 'authentication_error' } })); });
  const prefs = preferences(api.baseUrl, secret);
  const harness = await createHarness({ directory: workspace.directory, secrets: [secret], configureRuntime: async (runtime) => {
    const route = registerPreferenceRoute(runtime, prefs, { providerId: 'local-double', modelId: 'controller' });
    await runtime.setRuntimeApiKey(route.provider.id, route.provider.apiKey);
    return { provider: route.provider.id, modelId: route.model.modelId };
  } });
  try {
    await harness.session.prompt('Trigger provider failure');
    assert.equal(api.requests.length, 1);
    const stored = JSON.stringify(harness.manager.getEntries());
    assert.equal(stored.includes(JSON.stringify(secret).slice(1, -1)), false);
    assert.doesNotMatch(stored, /validation-secret-/);
    assert.match(stored, /REDACTED/);
    assert.ok(harness.session.messages.some((message) => message.role === 'assistant' && message.stopReason === 'error'));
  } finally { harness.session.dispose(); await api.close(); workspace.close(); }
});

test('existing translation API rejects empty responses and cancellation', { timeout: 10000 }, async () => {
  const api = await fakeApi((_body, response) => completion(response, ''));
  try {
    const prefs = preferences(api.baseUrl);
    await assert.rejects(generateRefinedTranslationText(prefs, { providerId: 'local-double', modelId: 'index' }, '', '原文'), /空文本/);
    const controller = new AbortController();
    controller.abort();
    const before = api.requests.length;
    await assert.rejects(generateRefinedTranslationText(prefs, { providerId: 'local-double', modelId: 'index' }, '', '原文', controller.signal));
    assert.equal(api.requests.length, before);
  } finally { await api.close(); }
});
