import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LlmInteractionLogger } from './llm-logger';

test('interaction logs are durable before returning, retain raw responses and full model IDs, and isolate task context', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-'));
  try {
    const logger = new LlmInteractionLogger(directory);
    const old = path.join(directory, '2000-01-01.log');
    fs.writeFileSync(old, 'expired');
    const params = { provider: 'test', model: 'model:variant', systemPrompt: '', userPrompt: '原文', response: '  原始响应\n', durationMs: 1 };
    logger.withContext({ novelId: 'one', chapterId: 'chapter-one' }).logCall({ ...params, error: '段落编号无效' });
    logger.withContext({ novelId: 'two', chapterId: 'chapter-two' }).logCall(params);
    const text = fs.readFileSync(path.join(directory, `${new Date().toISOString().slice(0, 10)}.log`), 'utf8');
    assert.ok(text.includes('--- RESPONSE ---\n  原始响应\n'));
    assert.match(text, /Model: model:variant/);
    assert.match(text, /ERROR: 段落编号无效/);
    assert.match(text, /"chapterId":"chapter-one"/);
    assert.match(text, /"chapterId":"chapter-two"/);
    assert.equal(fs.existsSync(old), false);
    const disabledPath = path.join(directory, 'disabled');
    new LlmInteractionLogger(disabledPath, false).logCall(params);
    assert.equal(fs.existsSync(disabledPath), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('log write failures are reported without throwing or creating unhandled stream errors', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-error-'));
  try {
    const file = path.join(directory, 'not-a-directory');
    fs.writeFileSync(file, 'test');
    const warnings = t.mock.method(console, 'warn', () => {});
    assert.doesNotThrow(() => new LlmInteractionLogger(file).logCall({ provider: 'test', model: 'test', systemPrompt: '', userPrompt: '', response: '', durationMs: 0 }));
    assert.equal(warnings.mock.callCount(), 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
