import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askLibraryAssistant,
  buildLibraryKnowledgeGraph,
  buildLibraryExportDownloadUrl,
  cacheLibraryNovelMedia,
  createLibraryAlias,
  createLibraryBookmark,
  deleteLibraryKnowledgeGraph,
  deleteLibraryBookmark,
  discoverLlmProviderModels,
  fetchLibraryKnowledgeGraph,
  fetchLibraryNovels,
  updateLibraryKnowledgeGraphProfile,
  updateLibraryReadingProgress,
  updateNeo4jPreferences,
  validateLlmProviderModel,
} from './api';

test('buildLibraryExportDownloadUrl encodes source, novel and format for export downloads', () => {
  assert.equal(
    buildLibraryExportDownloadUrl('syosetu 18', 'n1000/lib', 'markdown'),
    '/api/library/novels/syosetu%2018/n1000%2Flib/exports/markdown/download',
  );
});

test('cacheLibraryNovelMedia targets the batch cache endpoint', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), '/api/library/novels/syosetu%2018/n1000%2Flib/media/cache');
      assert.equal(init?.method, 'POST');

      return new Response(JSON.stringify({
        result: {
          total: 3,
          cached: 2,
          skipped: 1,
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const payload = await cacheLibraryNovelMedia('syosetu 18', 'n1000/lib');
    assert.deepEqual(payload.result, {
      total: 3,
      cached: 2,
      skipped: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('knowledge graph APIs target the expected endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ? { input: String(input), init } : { input: String(input) });

      if (String(input).endsWith('/assistant/chat')) {
        return new Response(JSON.stringify({
          reply: {
            mode: 'local',
            message: '回答',
            model: null,
            sources: [],
            trace: {
              usedEmbedding: false,
              usedRerank: false,
              graphHits: [],
              chunkHits: [],
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (String(input).endsWith('/graph/build')) {
        return new Response(JSON.stringify({
          build: {
            status: 'queued',
            stage: 'idle',
            progressPercent: 0,
            message: 'queued',
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            lastBuiltAt: null,
            syncedToNeo4jAt: null,
            entityCount: 0,
            relationCount: 0,
            updatedAt: null,
          },
        }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (init?.method === 'DELETE' && String(input).endsWith('/graph')) {
        return new Response(JSON.stringify({
          knowledgeGraph: {
            profile: {
              chatModel: null,
              embeddingModel: null,
              rerankModel: null,
              neo4j: {
                enabled: false,
                source: 'none',
                uri: '',
                username: '',
                database: '',
                isConfigured: false,
              },
              configLocked: false,
              lockedAt: null,
              updatedAt: null,
            },
            build: {
              status: 'idle',
              stage: 'idle',
              progressPercent: 0,
              message: 'cleared',
              errorMessage: null,
              startedAt: null,
              completedAt: null,
              lastBuiltAt: null,
              syncedToNeo4jAt: null,
              entityCount: 0,
              relationCount: 0,
              updatedAt: null,
            },
            buildLogs: [],
            namespace: 'syosetu:n1000',
            entities: [],
            relations: [],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({
          profile: {
            chatModel: null,
            embeddingModel: null,
            rerankModel: null,
            neo4j: {
              enabled: false,
              source: 'none',
              uri: '',
              username: '',
              database: '',
              isConfigured: false,
            },
            configLocked: false,
            lockedAt: null,
            updatedAt: null,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        knowledgeGraph: {
          profile: {
            chatModel: null,
            embeddingModel: null,
            rerankModel: null,
            neo4j: {
              enabled: false,
              source: 'none',
              uri: '',
              username: '',
              database: '',
              isConfigured: false,
            },
            configLocked: false,
            lockedAt: null,
            updatedAt: null,
          },
          build: {
            status: 'idle',
            stage: 'idle',
            progressPercent: 0,
            message: 'idle',
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            lastBuiltAt: null,
            syncedToNeo4jAt: null,
            entityCount: 0,
            relationCount: 0,
            updatedAt: null,
          },
          buildLogs: [],
          namespace: 'syosetu:n1000',
          entities: [],
          relations: [],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await fetchLibraryKnowledgeGraph('syosetu 18', 'n1000/lib');
    await updateLibraryKnowledgeGraphProfile('syosetu 18', 'n1000/lib', {
      chatModel: {
        providerId: 'provider-1',
        modelId: 'model-1',
      },
    });
    await buildLibraryKnowledgeGraph('syosetu 18', 'n1000/lib');
    await deleteLibraryKnowledgeGraph('syosetu 18', 'n1000/lib');
    await askLibraryAssistant('syosetu 18', 'n1000/lib', '现在发生了什么？', 'chapter/1');

    assert.equal(calls[0]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/graph');
    assert.equal(calls[1]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/graph/profile');
    assert.equal(calls[1]?.init?.method, 'PUT');
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
      chatModel: {
        providerId: 'provider-1',
        modelId: 'model-1',
      },
    });
    assert.equal(calls[2]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/graph/build');
    assert.equal(calls[2]?.init?.method, 'POST');
    assert.equal(calls[3]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/graph');
    assert.equal(calls[3]?.init?.method, 'DELETE');
    assert.equal(calls[4]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/assistant/chat');
    assert.equal(calls[4]?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[4]?.init?.body)), {
      message: '现在发生了什么？',
      chapterId: 'chapter/1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchLibraryNovels appends the advanced search query string', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.equal(String(input), '/api/library/novels?q=name%3A%E6%A0%B7%E4%BE%8B%20-tag%3A%E5%BA%9F%E5%BC%83');

      return new Response(JSON.stringify({ novels: [] }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const payload = await fetchLibraryNovels('name:样例 -tag:废弃');
    assert.deepEqual(payload.novels, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('library alias and bookmark APIs target the expected endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ? { input: String(input), init } : { input: String(input) });

      if (String(input).endsWith('/progress')) {
        return new Response(JSON.stringify({
          progress: {
            currentChapterId: 'chapter-1',
            currentChapterIndex: 1,
            currentChapterTitle: '第一章',
            currentUpdatedAt: '2026-05-11T00:00:00.000Z',
            highestChapterId: 'chapter-2',
            highestChapterIndex: 2,
            highestChapterTitle: '第二章',
            highestUpdatedAt: '2026-05-11T00:00:00.000Z',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({
        alias: {
          id: 'alias-1',
          alias: '样例别名',
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
        },
        bookmark: {
          id: 'bookmark-1',
          chapterId: 'chapter-1',
          chapterIndex: 1,
          chapterTitle: '第一章',
          volumeTitle: '第一卷',
          note: '备注',
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await createLibraryAlias('syosetu 18', 'n1000/lib', '样例别名');
    await createLibraryBookmark('syosetu 18', 'n1000/lib', 'chapter/1', '备注');
    await updateLibraryReadingProgress('syosetu 18', 'n1000/lib', 'chapter/1');
    await deleteLibraryBookmark('syosetu 18', 'n1000/lib', 'bookmark/1');

    assert.equal(calls[0]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/aliases');
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal(calls[1]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/bookmarks');
    assert.equal(calls[1]?.init?.method, 'POST');
    assert.equal(calls[2]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/progress');
    assert.equal(calls[2]?.init?.method, 'PUT');
    assert.equal(calls[3]?.input, '/api/library/novels/syosetu%2018/n1000%2Flib/bookmarks/bookmark%2F1');
    assert.equal(calls[3]?.init?.method, 'DELETE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('validateLlmProviderModel targets the model validation endpoint', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        '/api/control/preferences/llm-providers/provider%201/models/model%2F1/validate',
      );
      assert.equal(init?.method, 'POST');

      return new Response(JSON.stringify({
        providers: [],
        validations: [],
        updatedAt: null,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const payload = await validateLlmProviderModel('provider 1', 'model/1');
    assert.deepEqual(payload.providers, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discoverLlmProviderModels posts the current provider draft for model listing', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), '/api/control/preferences/llm-providers/discover-models');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        provider: {
          label: 'DeepSeek',
          type: 'openai-compatible',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'demo-key',
          organization: '',
        },
      });

      return new Response(JSON.stringify({
        models: [
          {
            modelId: 'deepseek-chat',
            label: 'DeepSeek Chat',
            description: null,
            detectedCapabilities: ['chat'],
          },
        ],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const payload = await discoverLlmProviderModels({
      label: 'DeepSeek',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'demo-key',
      organization: '',
    });

    assert.equal(payload.models[0]?.modelId, 'deepseek-chat');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateNeo4jPreferences sends the configuration payload to the server', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), '/api/control/preferences/neo4j');
      assert.equal(init?.method, 'PUT');
      assert.equal(init?.headers ? JSON.stringify(init.headers) : '', JSON.stringify({ 'Content-Type': 'application/json' }));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        enabled: true,
        uri: 'neo4j://127.0.0.1:7687',
        username: 'neo4j',
        password: 'secret',
        database: 'library',
      });

      return new Response(JSON.stringify({
        config: {
          enabled: true,
          uri: 'neo4j://127.0.0.1:7687',
          username: 'neo4j',
          password: 'secret',
          database: 'library',
          isConfigured: true,
          updatedAt: null,
        },
        validation: null,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const payload = await updateNeo4jPreferences({
      enabled: true,
      uri: 'neo4j://127.0.0.1:7687',
      username: 'neo4j',
      password: 'secret',
      database: 'library',
    });
    assert.equal(payload.config.database, 'library');
  } finally {
    globalThis.fetch = originalFetch;
  }
});