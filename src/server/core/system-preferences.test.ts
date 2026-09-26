import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SystemPreferencesService } from './system-preferences.js';
import type { LlmModelConfigInput, LlmProviderConfigInput, ModelCapability } from './system-preferences.js';

function createService(): SystemPreferencesService {
  const storageFilePath = path.join(os.tmpdir(), `prefs-caps-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const service = new SystemPreferencesService({ storageFilePath });
  fs.rmSync(storageFilePath, { force: true });
  return service;
}

function providerInput(overrides: Partial<LlmProviderConfigInput> = {}): LlmProviderConfigInput {
  return {
    id: 'p1',
    label: 'Ollama',
    type: 'ollama',
    enabled: true,
    baseUrl: 'http://127.0.0.1:11434',
    apiKey: '',
    organization: '',
    models: [],
    ...overrides,
  };
}

function modelInput(modelId: string, capabilityMode: 'auto' | 'manual', capabilities: ModelCapability[] = []): LlmModelConfigInput {
  return {
    id: `m-${modelId}`,
    label: modelId,
    modelId,
    enabled: true,
    capabilityMode,
    capabilities,
    defaultFor: [],
    contextWindowTokens: 0,
    translationMessageFormat: 'general' as const,
  };
}

test('auto capability detection does not treat the provider type as a model capability hint', () => {
  const service = createService();
  service.updateLlmProviders([
    providerInput({
      models: [
        modelInput('nomic-embed-text:latest', 'auto', ['embedding']),
        modelInput('kaelri/hy-mt2:1.8b', 'auto', ['chat']),
      ],
    }),
  ]);

  const resolved = Object.fromEntries(
    service.getLlmState().providers[0].models.map((model) => [model.modelId, model.resolvedCapabilities]),
  );

  // "ollama" 含 "llama"，嵌入模型此前被误判为同时具备对话能力
  assert.deepEqual(resolved['nomic-embed-text:latest'], ['embedding']);
  // 无关键词的模型回退为对话模型
  assert.deepEqual(resolved['kaelri/hy-mt2:1.8b'], ['chat']);
});

test('resolved capabilities follow the current config after it changes', () => {
  const service = createService();
  service.updateLlmProviders([
    providerInput({
      models: [modelInput('custom-embed', 'auto', ['embedding'])],
    }),
  ]);

  assert.deepEqual(service.getLlmState().providers[0].models[0].resolvedCapabilities, ['embedding']);

  // 手动改为对话后，即使没有重新验证，能力解析也必须反映新配置
  service.updateLlmProviders([
    providerInput({
      models: [modelInput('custom-embed', 'manual', ['chat'])],
    }),
  ]);

  assert.deepEqual(service.getLlmState().providers[0].models[0].resolvedCapabilities, ['chat']);
});
