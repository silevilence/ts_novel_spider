import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText, stepCountIs, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import type { ContextCallOptions } from './llm-context-budget';
import { batchForContext, ContextBudgetExceededError, fitContextRequest, requestContextTokens, splitTextForContext, textRequestFits, withContextBudget } from './llm-context-budget';

const result = {
  content: [{ type: 'text' as const, text: 'ok' }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } },
  warnings: [],
};

test('SDK request retains system and current source, drops whole old turns and reserves output', async () => {
  const model = new MockLanguageModelV3({ doGenerate: result });
  await generateText({ model: withContextBudget(model, 1500), system: '术语：アリス=爱丽丝', maxOutputTokens: 300,
    messages: [
      { role: 'user', content: '旧原文'.repeat(300) }, { role: 'assistant', content: '旧译文'.repeat(300) },
      { role: 'user', content: '当前原文' },
    ],
  });
  const sent = model.doGenerateCalls[0]!;
  assert.equal(sent.prompt.length, 2);
  assert.match(JSON.stringify(sent.prompt), /当前原文/);
  assert.match(JSON.stringify(sent.prompt), /爱丽丝/);
  assert.equal(sent.maxOutputTokens, 300);
  assert.ok(requestContextTokens(sent) + sent.maxOutputTokens! <= 1500);
});

test('tools, schemas and results count toward the budget on every agent step', async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({ doGenerate: async () => calls++ === 0
    ? { ...result, content: [{ type: 'tool-call', toolCallId: 'read-1', toolName: 'read', input: '{}' }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' } }
    : result });
  await assert.rejects(generateText({ model: withContextBudget(model, 1800), prompt: '读取材料', maxOutputTokens: 300, maxRetries: 0,
    tools: { read: tool({ inputSchema: z.object({}), execute: async () => '小说原文'.repeat(1000) }) }, stopWhen: stepCountIs(2),
  }), ContextBudgetExceededError);
  assert.equal(model.doGenerateCalls.length, 1, 'oversized tool result must never reach the provider');
  const params: ContextCallOptions = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'ok' }] }], responseFormat: { type: 'json', schema: { description: 'schema'.repeat(500) } }, maxOutputTokens: 200 };
  assert.throws(() => fitContextRequest(params, 1500), ContextBudgetExceededError);
});

test('splitting covers Japanese, emoji and escaped JSON losslessly under the entire request budget', () => {
  const source = ('日本語😀\n"quoted"\\\t'.repeat(300));
  const fits = (text: string) => textRequestFits(1800, '系统提示与术语'.repeat(10), text, 400);
  const parts = splitTextForContext(source, fits);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(''), source);
  assert.ok(parts.every(fits));
  assert.ok(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part)));
  const records = Array.from({ length: 20 }, (_, id) => ({ id, source: '术语'.repeat(12) }));
  const batches = batchForContext(records, (batch) => fits(JSON.stringify(batch)));
  assert.deepEqual(batches.flat(), records);
  assert.ok(batches.every((batch) => fits(JSON.stringify(batch))));
});

test('mandatory content cannot be silently truncated and zero leaves existing requests untouched', () => {
  const params: ContextCallOptions = { prompt: [{ role: 'system', content: '不可删规则'.repeat(500) }, { role: 'user', content: [{ type: 'text', text: '正文' }] }] };
  assert.throws(() => fitContextRequest(params, 1000), ContextBudgetExceededError);
  assert.equal(fitContextRequest(params, 0), params);
});
