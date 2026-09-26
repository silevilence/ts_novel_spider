import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SystemPreferencesService, type LlmProviderConfig } from './system-preferences';
import { generateRefinedTranslationText } from './translation/nodes/translate-node';

const providers: Array<{ type: LlmProviderConfig['type']; response: unknown; check: (body: Record<string, unknown>, enabled: boolean | undefined) => void }> = [
  {
    type: 'openai-compatible',
    response: { id: 'fake', object: 'chat.completion', created: 1, model: 'fake', choices: [{ index: 0, message: { role: 'assistant', content: '{"terms":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    check: (body, enabled) => assert.equal(body.reasoning_effort, enabled === undefined ? undefined : enabled ? 'medium' : 'none'),
  },
  {
    type: 'anthropic',
    response: { id: 'fake', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: '{"terms":[]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
    check: (body, enabled) => assert.deepEqual(body.thinking, enabled === undefined ? undefined : enabled ? { type: 'enabled', budget_tokens: 2048 } : { type: 'disabled' }),
  },
  {
    type: 'google-generative-ai',
    response: { candidates: [{ content: { role: 'model', parts: [{ text: '{"terms":[]}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } },
    check: (body, enabled) => assert.deepEqual((body.generationConfig as Record<string, unknown>).thinkingConfig, enabled === undefined ? undefined : { thinkingBudget: enabled ? 2048 : 0, includeThoughts: false }),
  },
  {
    type: 'ollama',
    response: { model: 'fake', created_at: '2026-01-01T00:00:00Z', message: { role: 'assistant', content: '{"terms":[]}' }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 },
    check: (body, enabled) => assert.equal(body.think, enabled),
  },
];

for (const provider of providers) {
  test(`${provider.type} serializes explicit thinking on/off and preserves unspecified defaults`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-thinking-'));
    const requests: Array<Record<string, unknown>> = [];
    const server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(provider.response));
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address() as { port: number };
      const preferences = new SystemPreferencesService({ storageFilePath: path.join(directory, 'preferences.json') });
      preferences.updateLlmProviders([{ id: 'fake', type: provider.type, enabled: true, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fake', models: [{ id: 'fake', modelId: 'fake', enabled: true, capabilityMode: 'manual', capabilities: ['chat'] }] }]);
      for (const thinkingEnabled of [true, false, undefined]) {
        const result = await generateRefinedTranslationText(preferences, { providerId: 'fake', modelId: 'fake', ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}) }, 'Extract terms.', 'Source text.');
        assert.equal(result, '{"terms":[]}');
        provider.check(requests.at(-1)!, thinkingEnabled);
      }
      assert.equal(requests.length, 3);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
