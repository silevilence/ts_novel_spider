import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MockHtmlSpiderAdapter } from '../adapters/spider/mock-html-spider-adapter';
import { createServerApp } from '../app';
import { ControlCenterService } from '../core/control-center';
import { NetworkProxyService } from '../core/network-proxy';
import { SqliteNovelRepository } from '../core/novel-repository';
import { SystemPreferencesService } from '../core/system-preferences';

function createTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-routes-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  const networkProxy = new NetworkProxyService({
    fetchImpl: async () => new Response('proxy-ok', { status: 200 }),
  });
  const systemPreferences = new SystemPreferencesService({
    fetchImpl: async (input, init) => {
      const url = String(input);

      if (url.includes('/chat/completions')) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl_mock',
            object: 'chat.completion',
            created: 1,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: 'PONG',
                },
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.endsWith('/v1/models') || url.includes('/v1/models?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'deepseek-chat',
              },
              {
                id: 'text-embedding-3-small',
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.includes('/messages')) {
        return new Response(
          JSON.stringify({
            id: 'msg_mock',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [
              {
                type: 'text',
                text: 'PONG',
              },
            ],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 1,
              output_tokens: 1,
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.includes('/api/chat')) {
        return new Response(
          JSON.stringify({
            model: 'llama3.2',
            created_at: '2026-05-11T00:00:00.000Z',
            message: {
              role: 'assistant',
              content: 'PONG',
            },
            done: true,
            done_reason: 'stop',
            total_duration: 2,
            load_duration: 1,
            prompt_eval_count: 1,
            prompt_eval_duration: 1,
            eval_count: 1,
            eval_duration: 1,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.includes(':generateContent')) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      text: 'PONG',
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.includes('/embeddings') || url.includes(':embedContent')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                embedding: [0.1, 0.2, 0.3],
                index: 0,
              },
            ],
            usage: {
              prompt_tokens: 1,
              total_tokens: 1,
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.includes('/api/embed')) {
        const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) as { input?: unknown } : null;
        const inputValues = Array.isArray(parsedBody?.input) ? parsedBody.input : ['ping'];
        return new Response(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: inputValues.map((_, index) => [0.1 + index, 0.2 + index, 0.3 + index]),
            prompt_eval_count: 1,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (url.includes('/rerank')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                index: 1,
                relevance_score: 0.98,
                document: 'A rainy afternoon in the city.',
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      return new Response('not-found', { status: 404 });
    },
    validateNeo4jImpl: async (config) => ({
      database: config.database || 'neo4j',
      serverAgent: 'Neo4j/5.x',
      message: 'Neo4j connectivity check succeeded.',
    }),
  });
  const controlCenter = new ControlCenterService({
    repository,
    networkProxy,
    systemPreferences,
    spiders: [
      {
        descriptor: {
          sourceId: 'mock-html',
          label: 'Mock HTML Demo',
          description: 'Route test source',
          defaultNovelId: 'demo',
        },
        spider: new MockHtmlSpiderAdapter({
          metadataHtml: `
            <article>
              <h1 data-testid="title">路由测试小说</h1>
              <div data-testid="author">测试作者</div>
              <div data-testid="description">测试描述</div>
              <ul data-testid="tags"><li>测试</li></ul>
              <div data-testid="chapter-count">2</div>
            </article>
          `,
          catalogHtml: `
            <ol data-testid="catalog">
              <li data-chapter-id="chapter-1"><a href="/demo/1">第 1 章</a></li>
              <li data-chapter-id="chapter-2"><a href="/demo/2">第 2 章</a></li>
            </ol>
          `,
          chapterHtmlById: {
            'chapter-1': `<article><h1 data-testid="chapter-title">第 1 章</h1><section data-testid="content"><p>a</p></section></article>`,
            'chapter-2': `<article><h1 data-testid="chapter-title">第 2 章</h1><section data-testid="content"><p>b</p></section></article>`,
          },
        }),
      },
    ],
  });
  const app = createServerApp({ controlCenter });

  return {
    app,
    controlCenter,
    repository,
    cleanup: () => {
      controlCenter.close();
      networkProxy.close();
      repository.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('control-center routes expose sources, preview and task lifecycle', async () => {
  const { app, cleanup } = createTestServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const sourcesResponse = await fetch(`${baseUrl}/api/control/sources`);
    const sourcesPayload = (await sourcesResponse.json()) as { sources: Array<{ sourceId: string }> };
    assert.equal(sourcesResponse.status, 200);
    assert.deepEqual(sourcesPayload.sources.map((source) => source.sourceId), ['mock-html']);

    const previewResponse = await fetch(
      `${baseUrl}/api/control/preview?sourceId=mock-html&novelId=demo`,
    );
    const previewPayload = (await previewResponse.json()) as { metadata: { title: string } };
    assert.equal(previewResponse.status, 200);
    assert.equal(previewPayload.metadata.title, '路由测试小说');

    const proxyStateResponse = await fetch(`${baseUrl}/api/control/network-proxy`);
    const proxyStatePayload = (await proxyStateResponse.json()) as {
      config: {
        enabled: boolean;
        isConfigured: boolean;
      };
    };
    assert.equal(proxyStateResponse.status, 200);
    assert.equal(proxyStatePayload.config.enabled, false);
    assert.equal(proxyStatePayload.config.isConfigured, false);

    const updateProxyResponse = await fetch(`${baseUrl}/api/control/network-proxy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
        username: 'demo',
        password: 'secret',
        bypassHosts: ['localhost'],
      }),
    });
    const updateProxyPayload = (await updateProxyResponse.json()) as {
      config: {
        enabled: boolean;
        host: string;
        port: number;
      };
      validation: null;
    };
    assert.equal(updateProxyResponse.status, 200);
    assert.equal(updateProxyPayload.config.enabled, true);
    assert.equal(updateProxyPayload.config.host, '127.0.0.1');
    assert.equal(updateProxyPayload.config.port, 7890);
    assert.equal(updateProxyPayload.validation, null);

    const validateProxyResponse = await fetch(`${baseUrl}/api/control/network-proxy/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetUrl: 'https://example.com/probe',
      }),
    });
    const validateProxyPayload = (await validateProxyResponse.json()) as {
      validation: {
        ok: boolean;
        usingProxy: boolean;
        targetUrl: string;
      } | null;
    };
    assert.equal(validateProxyResponse.status, 200);
    assert.equal(validateProxyPayload.validation?.ok, true);
    assert.equal(validateProxyPayload.validation?.usingProxy, true);
    assert.equal(validateProxyPayload.validation?.targetUrl, 'https://example.com/probe');

    const llmResponse = await fetch(`${baseUrl}/api/control/preferences/llm-providers`);
    const llmPayload = (await llmResponse.json()) as {
      providers: unknown[];
      validations: unknown[];
    };
    assert.equal(llmResponse.status, 200);
    assert.equal(llmPayload.providers.length, 0);
    assert.equal(llmPayload.validations.length, 0);

    const updateLlmResponse = await fetch(`${baseUrl}/api/control/preferences/llm-providers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providers: [
          {
            id: 'provider-1',
            label: 'Claude Official',
            type: 'anthropic',
            enabled: true,
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: 'demo-key',
            organization: '',
            models: [
              {
                id: 'model-1',
                label: '默认对话模型',
                modelId: 'claude-sonnet-4-5',
                enabled: true,
                capabilityMode: 'auto',
                defaultFor: ['chat'],
              },
            ],
          },
        ],
      }),
    });
    const updateLlmPayload = (await updateLlmResponse.json()) as {
      providers: Array<{
        id: string;
        isConfigured?: boolean;
        models: Array<{ modelId: string }>;
      }>;
    };
    assert.equal(updateLlmResponse.status, 200);
    assert.equal(updateLlmPayload.providers[0]?.id, 'provider-1');
    assert.equal(updateLlmPayload.providers[0]?.models[0]?.modelId, 'claude-sonnet-4-5');

    const validateLlmResponse = await fetch(
      `${baseUrl}/api/control/preferences/llm-providers/provider-1/models/model-1/validate`,
      {
        method: 'POST',
      },
    );
    const validateLlmPayload = (await validateLlmResponse.json()) as {
      validations: Array<{
        ok: boolean;
        providerId: string;
        modelId: string;
        detectedCapabilities: string[];
      }>;
    };
    assert.equal(validateLlmResponse.status, 200);
    assert.equal(validateLlmPayload.validations[0]?.ok, true);
    assert.equal(validateLlmPayload.validations[0]?.providerId, 'provider-1');
    assert.equal(validateLlmPayload.validations[0]?.modelId, 'model-1');
    assert.deepEqual(validateLlmPayload.validations[0]?.detectedCapabilities, ['chat']);

    const discoverModelsResponse = await fetch(`${baseUrl}/api/control/preferences/llm-providers/discover-models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: {
          label: 'DeepSeek',
          type: 'openai-compatible',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'demo-key',
          organization: '',
        },
      }),
    });
    const discoverModelsPayload = (await discoverModelsResponse.json()) as {
      models: Array<{
        modelId: string;
        detectedCapabilities: string[];
      }>;
    };
    assert.equal(discoverModelsResponse.status, 200);
    assert.equal(discoverModelsPayload.models.length, 2);
    assert.equal(discoverModelsPayload.models[0]?.modelId, 'deepseek-chat');
    assert.deepEqual(discoverModelsPayload.models[1]?.detectedCapabilities, ['embedding']);

    const updateOllamaResponse = await fetch(`${baseUrl}/api/control/preferences/llm-providers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providers: [
          {
            id: 'provider-2',
            label: 'Local Ollama',
            type: 'ollama',
            enabled: true,
            baseUrl: 'http://127.0.0.1:11434',
            apiKey: '',
            organization: '',
            models: [
              {
                id: 'model-2',
                label: '默认重排模型',
                modelId: 'bge-reranker-v2-m3',
                enabled: true,
                capabilityMode: 'manual',
                capabilities: ['rerank'],
                defaultFor: ['rerank'],
              },
            ],
          },
        ],
      }),
    });
    const updateOllamaPayload = (await updateOllamaResponse.json()) as {
      providers: Array<{
        id: string;
        isConfigured: boolean;
        models: Array<{ modelId: string }>;
      }>;
    };
    assert.equal(updateOllamaResponse.status, 200);
    assert.equal(updateOllamaPayload.providers[0]?.id, 'provider-2');
    assert.equal(updateOllamaPayload.providers[0]?.isConfigured, true);
    assert.equal(updateOllamaPayload.providers[0]?.models[0]?.modelId, 'bge-reranker-v2-m3');

    const validateOllamaResponse = await fetch(
      `${baseUrl}/api/control/preferences/llm-providers/provider-2/models/model-2/validate`,
      {
        method: 'POST',
      },
    );
    const validateOllamaPayload = (await validateOllamaResponse.json()) as {
      validations: Array<{
        ok: boolean;
        providerId: string;
        modelId: string;
        detectedCapabilities: string[];
      }>;
    };
    assert.equal(validateOllamaResponse.status, 200);
    assert.equal(validateOllamaPayload.validations[0]?.ok, true);
    assert.equal(validateOllamaPayload.validations[0]?.providerId, 'provider-2');
    assert.equal(validateOllamaPayload.validations[0]?.modelId, 'model-2');
    assert.deepEqual(validateOllamaPayload.validations[0]?.detectedCapabilities, ['rerank']);

    const neo4jResponse = await fetch(`${baseUrl}/api/control/preferences/neo4j`);
    const neo4jPayload = (await neo4jResponse.json()) as {
      config: {
        enabled: boolean;
      };
    };
    assert.equal(neo4jResponse.status, 200);
    assert.equal(neo4jPayload.config.enabled, false);

    const updateNeo4jResponse = await fetch(`${baseUrl}/api/control/preferences/neo4j`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        uri: 'neo4j://127.0.0.1:7687',
        username: 'neo4j',
        password: 'secret',
        database: 'library',
      }),
    });
    const updateNeo4jPayload = (await updateNeo4jResponse.json()) as {
      config: {
        enabled: boolean;
        uri: string;
        database: string;
      };
    };
    assert.equal(updateNeo4jResponse.status, 200);
    assert.equal(updateNeo4jPayload.config.enabled, true);
    assert.equal(updateNeo4jPayload.config.uri, 'neo4j://127.0.0.1:7687');
    assert.equal(updateNeo4jPayload.config.database, 'library');

    const validateNeo4jResponse = await fetch(`${baseUrl}/api/control/preferences/neo4j/validate`, {
      method: 'POST',
    });
    const validateNeo4jPayload = (await validateNeo4jResponse.json()) as {
      validation: {
        ok: boolean;
        database: string | null;
      } | null;
    };
    assert.equal(validateNeo4jResponse.status, 200);
    assert.equal(validateNeo4jPayload.validation?.ok, true);
    assert.equal(validateNeo4jPayload.validation?.database, 'library');

    const createTaskResponse = await fetch(`${baseUrl}/api/control/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceId: 'mock-html',
        novelId: 'demo',
      }),
    });
    const createTaskPayload = (await createTaskResponse.json()) as { task: { id: string } };
    assert.equal(createTaskResponse.status, 202);

    const completedTask = await waitForCompletedTask(baseUrl, createTaskPayload.task.id);
    assert.equal(completedTask.status, 'completed');
    assert.equal(completedTask.chapters.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});

test('task events endpoint sends SSE headers before the initial snapshot event', async () => {
  const { app, cleanup } = createTestServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const createTaskResponse = await fetch(`${baseUrl}/api/control/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceId: 'mock-html',
        novelId: 'demo',
      }),
    });
    const createTaskPayload = (await createTaskResponse.json()) as { task: { id: string } };

    const eventsResponse = await fetch(
      `${baseUrl}/api/control/tasks/${createTaskPayload.task.id}/events`,
    );
    assert.equal(eventsResponse.status, 200);
    assert.match(eventsResponse.headers.get('content-type') ?? '', /text\/event-stream/i);

    const reader = eventsResponse.body?.getReader();
    assert.ok(reader, 'Expected an SSE response body reader.');

    const firstChunk = await reader.read();
    assert.equal(firstChunk.done, false);

    const firstPayload = new TextDecoder().decode(firstChunk.value);
    assert.match(firstPayload, /"type":"task_updated"/);
    assert.match(firstPayload, /"id":"/);

    await reader.cancel();

    const completedTask = await waitForCompletedTask(baseUrl, createTaskPayload.task.id);
    assert.equal(completedTask.status, 'completed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});

test('task events endpoint returns 404 for unknown tasks', async () => {
  const { app, cleanup } = createTestServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/control/tasks/missing/events`);
    const payload = (await response.json()) as { message: string };

    assert.equal(response.status, 404);
    assert.equal(payload.message, 'Task missing was not found.');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});

test('reader typography preferences routes load defaults and persist updates', async () => {
  const systemPreferences = new SystemPreferencesService();
  const { app, cleanup } = createTestServer({ systemPreferences });
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    // — GET 默认值
    const getResponse = await fetch(`${baseUrl}/api/control/preferences/reader-typography`);
    assert.equal(getResponse.status, 200);
    const getPayload = (await getResponse.json()) as { config: { fontSize: number; lineHeight: number; fontFamilyPreset: string }; updatedAt: string | null };
    assert.ok(getPayload.config.fontSize > 0);
    assert.ok(getPayload.config.lineHeight > 1);
    assert.match(getPayload.config.fontFamilyPreset, /sans|serif|monospace|custom/);
    assert.equal(getPayload.updatedAt, null);

    // — PUT 更新值
    const putResponse = await fetch(`${baseUrl}/api/control/preferences/reader-typography`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fontSize: 1.12,
        fontSizePreset: 'large',
        lineHeight: 2.2,
        paragraphSpacing: 0.8,
        fontFamilyPreset: 'serif',
      }),
    });
    assert.equal(putResponse.status, 200);
    const putPayload = (await putResponse.json()) as { config: { fontSize: number; fontSizePreset: string; lineHeight: number; paragraphSpacing: number; fontFamilyPreset: string }; updatedAt: string | null };
    assert.equal(putPayload.config.fontSize, 1.12);
    assert.equal(putPayload.config.fontSizePreset, 'large');
    assert.equal(putPayload.config.lineHeight, 2.2);
    assert.equal(putPayload.config.paragraphSpacing, 0.8);
    assert.equal(putPayload.config.fontFamilyPreset, 'serif');
    assert.ok(putPayload.updatedAt);

    // — GET 确认持久化
    const getAgainResponse = await fetch(`${baseUrl}/api/control/preferences/reader-typography`);
    const getAgainPayload = (await getAgainResponse.json()) as { config: { fontSize: number } };
    assert.equal(getAgainPayload.config.fontSize, 1.12);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) { reject(error); return; }
        resolve();
      });
    });
    cleanup();
  }
});

test('OPDS preferences and compilation runs API', async () => {
  const { app, cleanup } = createTestServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    // — GET 默认配置
    const getResponse = await fetch(`${baseUrl}/api/control/preferences/opds`);
    assert.equal(getResponse.status, 200);
    const getPayload = (await getResponse.json()) as { enabled: boolean; scanCronExpression: string; lastRun: unknown };
    assert.equal(getPayload.enabled, false);
    assert.ok(typeof getPayload.scanCronExpression === 'string');

    // — PUT 更新配置
    const putResponse = await fetch(`${baseUrl}/api/control/preferences/opds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, scanCronExpression: '0 4 * * *' }),
    });
    assert.equal(putResponse.status, 200);
    const putPayload = (await putResponse.json()) as { enabled: boolean; scanCronExpression: string };
    assert.equal(putPayload.enabled, true);
    assert.equal(putPayload.scanCronExpression, '0 4 * * *');

    // — PUT 无效 cron 返回 400
    const invalidResponse = await fetch(`${baseUrl}/api/control/preferences/opds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanCronExpression: 'invalid cron' }),
    });
    assert.equal(invalidResponse.status, 400);
    const invalidPayload = (await invalidResponse.json()) as { message: string };
    assert.ok(invalidPayload.message.includes('Cron'));

    // — GET /opds/runs 返回分页结果
    const runsResponse = await fetch(`${baseUrl}/api/control/opds/runs?limit=5&offset=0`);
    assert.equal(runsResponse.status, 200);
    const runsPayload = (await runsResponse.json()) as { runs: unknown[] };
    assert.ok(Array.isArray(runsPayload.runs));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});

test('scheduling preferences and run history API', async () => {
  const { app, repository, cleanup } = createTestServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const schedulingResponse = await fetch(`${baseUrl}/api/control/scheduling`);
    assert.equal(schedulingResponse.status, 200);
    const schedulingPayload = (await schedulingResponse.json()) as { enabled: boolean; lastCheckRun: unknown };
    assert.equal(schedulingPayload.enabled, false);
    assert.equal(schedulingPayload.lastCheckRun, null);

    repository.createScheduledCheckRun('run-1', '2024-01-01T00:00:00Z');
    repository.completeScheduledCheckRun('run-1', '2024-01-01T00:05:00Z', 1, 0, 0, 0);
    repository.createScheduledCheckRun('run-2', '2024-01-02T00:00:00Z');
    repository.completeScheduledCheckRun('run-2', '2024-01-02T00:05:00Z', 2, 1, 0, 0);
    repository.saveMetadata('mock-html', {
      novelId: 'demo',
      title: '路由测试小说',
      author: '测试作者',
      description: '测试描述',
      tags: ['测试'],
      chapterCount: 2,
      infoPageUrl: 'https://example.com/mock-html/demo',
    });
    repository.createScheduledSummary({
      runId: 'run-2',
      sourceId: 'mock-html',
      novelId: 'demo',
      chapterIds: ['chapter-2'],
      summary: '第二章：测试摘要',
      providerId: 'provider-chat',
      modelId: 'model-summary',
    });

    const runsResponse = await fetch(`${baseUrl}/api/control/scheduling/runs?limit=1&offset=0`);
    assert.equal(runsResponse.status, 200);
    const runsPayload = (await runsResponse.json()) as {
      runs: Array<{
        id: string;
        totalChecked: number;
        newChaptersFound: number;
        summaries: Array<{ novelId: string; chapterIds: string[]; summary: string }>;
      }>;
    };
    assert.deepEqual(runsPayload.runs.map((run) => run.id), ['run-2']);
    assert.equal(runsPayload.runs[0]?.totalChecked, 2);
    assert.equal(runsPayload.runs[0]?.newChaptersFound, 1);
    assert.equal(runsPayload.runs[0]?.summaries.length, 1);
    assert.equal(runsPayload.runs[0]?.summaries[0]?.novelId, 'demo');
    assert.deepEqual(runsPayload.runs[0]?.summaries[0]?.chapterIds, ['chapter-2']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});

async function waitForCompletedTask(baseUrl: string, taskId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/control/tasks/${taskId}`);
    const payload = (await response.json()) as {
      task: {
        status: string;
        chapters: unknown[];
      };
    };

    if (payload.task.status === 'completed' || payload.task.status === 'failed') {
      return payload.task;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Task ${taskId} did not finish in time.`);
}