import assert from 'node:assert/strict';
import test from 'node:test';

import { SystemPreferencesService } from '../core/system-preferences';
import {
  closeServer,
  createFakeOpenAiProviderServer,
  createLibraryServer,
  InMemoryNeo4jGraphStore,
  waitForServerListening,
} from './library-test-helpers';

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchGraph(baseUrl: string): Promise<{
  knowledgeGraph: {
    profile: {
      configLocked: boolean;
      extractionConcurrency: number;
      extractionModels: Array<{ modelId: string; maxConcurrency: number }>;
    };
    build: {
      status: string;
      stage?: string;
      message: string;
      errorMessage?: string | null;
      progressPercent?: number;
      entityCount: number;
      relationCount: number;
      modelStats: Array<{
        modelId: string;
        inFlightCount: number;
        throughputPerMinute: number;
        circuitState: string;
        attemptCount: number;
        failureCount: number;
        handoffInCount: number;
        handoffOutCount: number;
        circuitOpenedCount: number;
        cooldownUntil: string | null;
      }>;
    };
    buildLogs: Array<{ level: string; message: string }>;
    entities: Array<{ name: string; aliases: string[] }>;
    relations: Array<{ summary: string; evidence: string[] }>;
  };
}> {
  const response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
  return await response.json() as {
    knowledgeGraph: {
      profile: {
        configLocked: boolean;
        extractionConcurrency: number;
        extractionModels: Array<{ modelId: string; maxConcurrency: number }>;
      };
      build: {
        status: string;
        stage?: string;
        message: string;
        errorMessage?: string | null;
        progressPercent?: number;
        entityCount: number;
        relationCount: number;
        modelStats: Array<{
          modelId: string;
          inFlightCount: number;
          throughputPerMinute: number;
          circuitState: string;
          attemptCount: number;
          failureCount: number;
          handoffInCount: number;
          handoffOutCount: number;
          circuitOpenedCount: number;
          cooldownUntil: string | null;
        }>;
      };
      buildLogs: Array<{ level: string; message: string }>;
      entities: Array<{ name: string; aliases: string[] }>;
      relations: Array<{ summary: string; evidence: string[] }>;
    };
  };
}

async function pollGraph(
  baseUrl: string,
  predicate: (payload: Awaited<ReturnType<typeof fetchGraph>>) => boolean,
  options: { maxAttempts?: number; delayMs?: number } = {},
): Promise<Awaited<ReturnType<typeof fetchGraph>>> {
  const maxAttempts = options.maxAttempts ?? 80;
  const delayMs = options.delayMs ?? 25;
  let lastPayload = await fetchGraph(baseUrl);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate(lastPayload)) {
      return lastPayload;
    }

    await sleep(delayMs);
    lastPayload = await fetchGraph(baseUrl);
  }

  return lastPayload;
}

test('library graph routes recover stale running graph builds when no active task exists', async () => {
  const { app, repository, cleanup } = createLibraryServer();
  repository.saveKnowledgeGraphBuild({
    sourceId: 'syosetu',
    novelId: 'n1000lib',
    status: 'running',
    stage: 'extracting',
    progressPercent: 10,
    message: '正在使用结构化抽取模型解析章节片段。',
    errorMessage: null,
    startedAt: '2026-05-11T06:54:17.734Z',
    completedAt: null,
    lastBuiltAt: null,
    syncedToNeo4jAt: null,
    entityCount: 0,
    relationCount: 0,
    modelStats: [{
      providerId: 'fake-openai',
      modelId: 'fake-chat-a',
      source: 'novel',
      maxConcurrency: 2,
      attemptCount: 10,
      llmSuccessCount: 8,
      failureCount: 2,
      fallbackCount: 0,
      handoffInCount: 1,
      handoffOutCount: 1,
      inFlightCount: 2,
      consecutiveFailures: 1,
      circuitState: 'open',
      circuitOpenedCount: 1,
      cooldownUntil: '2026-05-11T06:55:17.734Z',
      firstAttemptAt: '2026-05-11T06:54:17.734Z',
      lastError: 'Temporary upstream overload',
      lastStartedAt: '2026-05-11T06:54:57.734Z',
      lastCompletedAt: '2026-05-11T06:55:01.734Z',
      recentSuccessAt: ['2026-05-11T06:54:45.734Z', '2026-05-11T06:55:01.734Z'],
      failureRate: 0.2,
      throughputPerMinute: 120,
    }],
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const payload = await fetchGraph(baseUrl);

    assert.equal(payload.knowledgeGraph.build.status, 'failed');
    assert.equal(payload.knowledgeGraph.build.stage, 'failed');
    assert.match(payload.knowledgeGraph.build.message, /已中断|恢复/);
    assert.match(payload.knowledgeGraph.build.errorMessage ?? '', /服务重启|异常退出|当前服务进程/);
    assert.equal(payload.knowledgeGraph.build.modelStats[0]?.inFlightCount, 0);
    assert.equal(payload.knowledgeGraph.build.modelStats[0]?.throughputPerMinute, 0);
    assert.equal(payload.knowledgeGraph.build.modelStats[0]?.circuitState, 'closed');
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /自动恢复为失败状态/.test(entry.message)));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library graph routes can rebuild after stale graph tasks are auto-marked failed', async () => {
  const { app, repository, cleanup } = createLibraryServer();
  repository.saveKnowledgeGraphBuild({
    sourceId: 'syosetu',
    novelId: 'n1000lib',
    status: 'running',
    stage: 'extracting',
    progressPercent: 36,
    message: '正在使用结构化抽取模型解析章节片段。',
    errorMessage: null,
    startedAt: '2026-05-11T06:54:17.734Z',
    completedAt: null,
    lastBuiltAt: null,
    syncedToNeo4jAt: null,
    entityCount: 0,
    relationCount: 0,
    modelStats: [],
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const stalePayload = await fetchGraph(baseUrl);
    assert.equal(stalePayload.knowledgeGraph.build.status, 'failed');

    const rebuildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(rebuildResponse.status, 202);

    const payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed');
    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.ok(payload.knowledgeGraph.build.entityCount >= 2);
    assert.ok(payload.knowledgeGraph.build.relationCount >= 1);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library graph routes resume interrupted graph builds when checkpoints exist', async () => {
  const { app, cleanup } = createLibraryServer({
    beforeControlCenter: (repository) => {
      repository.saveKnowledgeGraphBuild({
        sourceId: 'syosetu',
        novelId: 'n1000lib',
        status: 'running',
        stage: 'extracting',
        progressPercent: 10,
        message: '正在使用结构化抽取模型解析章节片段。',
        errorMessage: null,
        startedAt: '2026-05-11T06:54:17.734Z',
        completedAt: null,
        lastBuiltAt: null,
        syncedToNeo4jAt: null,
        entityCount: 0,
        relationCount: 0,
        modelStats: [],
      });
      repository.saveKnowledgeGraphBuildCheckpoint({
        sourceId: 'syosetu',
        novelId: 'n1000lib',
        chunkId: 'chunk-plan-chapter-1-0',
        chapterId: 'chapter-1',
        chapterIndex: 1,
        chunkIndex: 0,
        chapterTitle: '第一章',
        extractionJson: JSON.stringify({
          summary: '艾琳和莱昂在晨雾城相遇。',
          eventSummary: '艾琳决定帮助莱昂寻找失踪的星图。',
          entities: [
            {
              name: '艾琳',
              entityType: 'character',
              aliases: [],
              summary: '第一章出场的关键角色。',
              evidence: '艾琳和莱昂在晨雾城相遇。',
            },
            {
              name: '莱昂',
              entityType: 'character',
              aliases: [],
              summary: '与艾琳同行的角色。',
              evidence: '艾琳决定帮助莱昂寻找失踪的星图。',
            },
          ],
          relations: [
            {
              from: '艾琳',
              to: '莱昂',
              relationType: 'alliance',
              summary: '艾琳决定帮助莱昂。',
              evidence: '艾琳决定帮助莱昂寻找失踪的星图。',
              chapterScope: '第一章',
            },
          ],
          keywordHints: ['艾琳', '莱昂', '晨雾城'],
          usedLlm: true,
        }),
        warningMessage: null,
      });
    },
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const payload = await pollGraph(
      baseUrl,
      (current) => ['completed', 'failed'].includes(current.knowledgeGraph.build.status),
      { maxAttempts: 160 },
    );

    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.ok(payload.knowledgeGraph.build.entityCount >= 2);
    assert.ok(payload.knowledgeGraph.build.relationCount >= 1);
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /自动恢复图谱构建/.test(entry.message)));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library graph routes pause a running graph build and resume with the latest saved config', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({ extractionDelayMs: 180 });
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([
    {
      id: 'fake-openai',
      label: 'Fake OpenAI',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: fakeProvider.baseUrl,
      apiKey: 'test-key',
      models: [
        {
          id: 'fake-chat-a',
          label: 'Fake Chat A',
          modelId: 'fake-chat-a',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: ['chat'],
        },
        {
          id: 'fake-chat-b',
          label: 'Fake Chat B',
          modelId: 'fake-chat-b',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: [],
        },
      ],
    },
  ]);

  const { app, repository, cleanup } = createLibraryServer({
    systemPreferences: preferences,
    beforeControlCenter: (repo) => {
      repo.saveChapterContent('syosetu', 'n1000lib', {
        chapterId: 'chapter-3',
        index: 3,
        title: '第三章',
        volumeTitle: '第二卷',
        url: 'https://example.com/n1000lib/3',
        content: '艾琳和莱昂继续追查黑塔，在塔下找到新的星图线索。',
      });
    },
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionConcurrency: 1,
        extractionModels: [{ providerId: 'fake-openai', modelId: 'fake-chat-a', maxConcurrency: 1 }],
      }),
    });
    assert.equal(profileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(buildResponse.status, 202);

    let payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'running', { maxAttempts: 120 });
    assert.equal(payload.knowledgeGraph.build.status, 'running');

    const pauseResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/pause`, { method: 'POST' });
    assert.equal(pauseResponse.status, 202);

    payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'paused', { maxAttempts: 200 });
    const pausedCheckpointCount = repository.listKnowledgeGraphBuildCheckpoints('syosetu', 'n1000lib').length;
    assert.equal(payload.knowledgeGraph.build.status, 'paused');
    assert.ok(pausedCheckpointCount >= 1);
    assert.ok(pausedCheckpointCount < 3);

    const updatedProfileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionConcurrency: 2,
        extractionModels: [
          { providerId: 'fake-openai', modelId: 'fake-chat-a', maxConcurrency: 1 },
          { providerId: 'fake-openai', modelId: 'fake-chat-b', maxConcurrency: 1 },
        ],
      }),
    });
    assert.equal(updatedProfileResponse.status, 200);

    const resumeResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/resume`, { method: 'POST' });
    assert.equal(resumeResponse.status, 202);

    payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed', { maxAttempts: 240 });
    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.equal(payload.knowledgeGraph.profile.extractionConcurrency, 2);
    assert.deepEqual(
      payload.knowledgeGraph.profile.extractionModels.map((entry) => [entry.modelId, entry.maxConcurrency]),
      [['fake-chat-a', 1], ['fake-chat-b', 1]],
    );
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /图谱构建已暂停/.test(entry.message)));
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /继续图谱构建/.test(entry.message)));
    assert.deepEqual(fakeProvider.getSeenExtractionModels().sort(), ['fake-chat-a', 'fake-chat-b']);
  } finally {
    await closeServer(server);
    cleanup();
    await fakeProvider.close();
  }
});

test('library graph routes inject current chapter content for assistant chat even before graph chunks exist', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const assistantResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '总结本章的主要内容', chapterId: 'chapter-1' }),
    });
    const assistantPayload = await assistantResponse.json() as {
      reply: {
        mode: string;
        message: string;
        sources: Array<{ type: string; chapterId: string | null; label: string }>;
      };
    };

    assert.equal(assistantResponse.status, 200);
    assert.equal(assistantPayload.reply.mode, 'local');
    assert.ok(assistantPayload.reply.sources.some((source) => source.type === 'chapter' && source.chapterId === 'chapter-1'));
    assert.match(assistantPayload.reply.message, /正文片段|第一章|艾琳和莱昂/);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library graph routes retry transient AI extraction failures before falling back', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({ failExtractionAttempts: 2 });
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([
    {
      id: 'fake-openai',
      label: 'Fake OpenAI',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: fakeProvider.baseUrl,
      apiKey: 'test-key',
      models: [
        {
          id: 'fake-chat',
          label: 'Fake Chat',
          modelId: 'fake-chat',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: ['chat'],
        },
        {
          id: 'fake-embedding',
          label: 'Fake Embedding',
          modelId: 'fake-embedding',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['embedding'],
          defaultFor: ['embedding'],
        },
      ],
    },
  ]);

  const { app, cleanup } = createLibraryServer({ systemPreferences: preferences });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(buildResponse.status, 202);

    const payload = await pollGraph(
      baseUrl,
      (current) => ['completed', 'failed'].includes(current.knowledgeGraph.build.status),
      { maxAttempts: 200, delayMs: 50 },
    );

    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.match(payload.knowledgeGraph.build.message, /AI 图谱|向量索引/);
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /图谱构建完成/.test(entry.message)));
  } finally {
    await closeServer(server);
    cleanup();
    await fakeProvider.close();
  }
});

test('library graph routes repair prompted JSON leaf type mismatches before local fallback', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({ rejectJsonSchema: true, loosePromptedJsonTypes: true });
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([
    {
      id: 'fake-openai',
      label: 'Fake OpenAI',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: fakeProvider.baseUrl,
      apiKey: 'test-key',
      models: [
        {
          id: 'fake-chat',
          label: 'Fake Chat',
          modelId: 'fake-chat',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: ['chat'],
        },
      ],
    },
  ]);

  const { app, cleanup } = createLibraryServer({ systemPreferences: preferences });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(buildResponse.status, 202);

    const payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed', { maxAttempts: 200 });
    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.match(payload.knowledgeGraph.build.message, /AI 图谱/);
    assert.ok(payload.knowledgeGraph.build.entityCount >= 4);
    assert.ok(payload.knowledgeGraph.entities.some((entity) => entity.name === '艾琳' && entity.aliases.includes('女伴')));
    assert.ok(payload.knowledgeGraph.entities.some((entity) => entity.name === '莱昂' && entity.aliases.includes('男主')));
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /回退 0 个/.test(entry.message)));
  } finally {
    await closeServer(server);
    cleanup();
    await fakeProvider.close();
  }
});

test('library graph routes distribute extraction work across the configured model pool', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer();
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([
    {
      id: 'fake-openai',
      label: 'Fake OpenAI',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: fakeProvider.baseUrl,
      apiKey: 'test-key',
      models: [
        {
          id: 'fake-chat-a',
          label: 'Fake Chat A',
          modelId: 'fake-chat-a',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: ['chat'],
        },
        {
          id: 'fake-chat-b',
          label: 'Fake Chat B',
          modelId: 'fake-chat-b',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: [],
        },
      ],
    },
  ]);

  const { app, cleanup } = createLibraryServer({ systemPreferences: preferences });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionConcurrency: 2,
        extractionModels: [
          { providerId: 'fake-openai', modelId: 'fake-chat-a', maxConcurrency: 1 },
          { providerId: 'fake-openai', modelId: 'fake-chat-b', maxConcurrency: 1 },
        ],
      }),
    });
    assert.equal(profileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(buildResponse.status, 202);

    const payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed');
    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.deepEqual(
      payload.knowledgeGraph.profile.extractionModels.map((entry) => [entry.modelId, entry.maxConcurrency]),
      [['fake-chat-a', 1], ['fake-chat-b', 1]],
    );
    assert.deepEqual(fakeProvider.getSeenExtractionModels().sort(), ['fake-chat-a', 'fake-chat-b']);
  } finally {
    await closeServer(server);
    cleanup();
    await fakeProvider.close();
  }
});

test('library graph routes requeue failed chunks onto another extraction model before local fallback', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({
    failExtractionAttemptsByModel: {
      'fake-chat-a': 1,
    },
  });
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([
    {
      id: 'fake-openai',
      label: 'Fake OpenAI',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: fakeProvider.baseUrl,
      apiKey: 'test-key',
      models: [
        {
          id: 'fake-chat-a',
          label: 'Fake Chat A',
          modelId: 'fake-chat-a',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: ['chat'],
        },
        {
          id: 'fake-chat-b',
          label: 'Fake Chat B',
          modelId: 'fake-chat-b',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: [],
        },
      ],
    },
  ]);

  const { app, cleanup } = createLibraryServer({ systemPreferences: preferences });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionConcurrency: 2,
        extractionModels: [
          { providerId: 'fake-openai', modelId: 'fake-chat-a', maxConcurrency: 1 },
          { providerId: 'fake-openai', modelId: 'fake-chat-b', maxConcurrency: 1 },
        ],
      }),
    });
    assert.equal(profileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(buildResponse.status, 202);

    const payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed', { maxAttempts: 200 });
    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /回退 0 个/.test(entry.message)));
    assert.deepEqual(fakeProvider.getSeenExtractionModels().sort(), ['fake-chat-a', 'fake-chat-b']);

    const requestCounts = fakeProvider.getExtractionRequestCounts();
    assert.ok((requestCounts['fake-chat-a'] ?? 0) >= 1);
    assert.ok((requestCounts['fake-chat-b'] ?? 0) >= 1);
    assert.ok((fakeProvider.getExtractionChaptersByModel()['fake-chat-b'] ?? []).includes('第二章'));

    const modelStats = new Map(payload.knowledgeGraph.build.modelStats.map((entry) => [entry.modelId, entry]));
    assert.equal(modelStats.get('fake-chat-a')?.attemptCount, 1);
    assert.ok((modelStats.get('fake-chat-b')?.attemptCount ?? 0) >= 1);
  } finally {
    await closeServer(server);
    cleanup();
    await fakeProvider.close();
  }
});

test('library graph routes build a knowledge graph, lock config and answer assistant chat', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionConcurrency: 4, neo4j: { enabled: false } }),
    });
    const profilePayload = await profileResponse.json() as {
      profile: { configLocked: boolean; neo4j: { enabled: boolean }; extractionConcurrency: number };
    };

    assert.equal(profileResponse.status, 200);
    assert.equal(profilePayload.profile.configLocked, false);
    assert.equal(profilePayload.profile.neo4j.enabled, false);
    assert.equal(profilePayload.profile.extractionConcurrency, 4);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    const buildPayload = await buildResponse.json() as { build: { status: string } };
    assert.equal(buildResponse.status, 202);
    assert.equal(buildPayload.build.status, 'queued');

    const payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed', { maxAttempts: 40, delayMs: 20 });
    assert.equal(payload.knowledgeGraph.build.status, 'completed');
    assert.ok(payload.knowledgeGraph.build.entityCount >= 2);
    assert.ok(payload.knowledgeGraph.build.relationCount >= 1);
    assert.ok(payload.knowledgeGraph.entities.some((entity) => entity.name === '艾琳'));
    assert.ok((payload.knowledgeGraph.relations[0]?.summary ?? '').length > 0);
    assert.equal(payload.knowledgeGraph.profile.configLocked, true);
    assert.equal(payload.knowledgeGraph.profile.extractionConcurrency, 4);

    const lockedResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatModel: { providerId: 'override-provider', modelId: 'override-model' } }),
    });
    assert.equal(lockedResponse.status, 409);

    const assistantResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '艾琳和莱昂现在是什么关系？', chapterId: 'chapter-2' }),
    });
    const assistantPayload = await assistantResponse.json() as {
      reply: {
        mode: string;
        message: string;
        sources: Array<{ type: string; chapterId: string | null }>;
      };
    };

    assert.equal(assistantResponse.status, 200);
    assert.equal(assistantPayload.reply.mode, 'local');
    assert.match(assistantPayload.reply.message, /本地图谱|聊天模型/);
    assert.ok(assistantPayload.reply.sources.some((source) => source.type === 'graph'));
    assert.ok(assistantPayload.reply.sources.some((source) => source.chapterId === 'chapter-2'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('library graph routes use AI extraction fallback, hybrid retrieval, JSON repair and manual graph clearing when models are configured', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({ rejectJsonSchema: true, malformedPromptedJson: true });
  const fakeNeo4j = new InMemoryNeo4jGraphStore();
  const preferences = new SystemPreferencesService();
  preferences.updateLlmProviders([
    {
      id: 'fake-openai',
      label: 'Fake OpenAI',
      type: 'openai-compatible',
      enabled: true,
      baseUrl: fakeProvider.baseUrl,
      apiKey: 'test-key',
      models: [
        {
          id: 'fake-chat',
          label: 'Fake Chat',
          modelId: 'fake-chat',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['chat'],
          defaultFor: ['chat'],
        },
        {
          id: 'fake-embedding',
          label: 'Fake Embedding',
          modelId: 'fake-embedding',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['embedding'],
          defaultFor: ['embedding'],
        },
        {
          id: 'fake-rerank',
          label: 'Fake Rerank',
          modelId: 'fake-rerank',
          enabled: true,
          capabilityMode: 'manual',
          capabilities: ['rerank'],
          defaultFor: ['rerank'],
        },
      ],
    },
  ]);

  const { app, cleanup } = createLibraryServer({ systemPreferences: preferences, neo4jGraphStore: fakeNeo4j });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        neo4j: {
          enabled: true,
          uri: 'neo4j://fake-host:7687',
          username: 'neo4j',
          password: 'password',
          database: 'neo4j',
        },
      }),
    });
    assert.equal(profileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(buildResponse.status, 202);

    const namespace = 'syosetu:n1000lib';
    let payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed');

    assert.match(payload.knowledgeGraph.build.message, /AI 图谱|向量索引/);
    assert.ok(payload.knowledgeGraph.build.entityCount >= 4);
    assert.ok(payload.knowledgeGraph.build.relationCount >= 2);
    assert.ok(payload.knowledgeGraph.buildLogs.length >= 8);
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /构建开始|抽取结束|图谱构建完成/.test(entry.message)));
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /开始归并 .*候选实体/.test(entry.message)));
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /实体向量批次 1\/1 已完成/.test(entry.message)));
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /片段向量批次 1\/1 已完成/.test(entry.message)));
    assert.ok(payload.knowledgeGraph.buildLogs.some((entry) => /命名空间 syosetu:n1000lib/.test(entry.message)));
    assert.ok(payload.knowledgeGraph.entities.some((entity) => entity.name === '艾琳' && entity.aliases.includes('搭档')));
    assert.ok(payload.knowledgeGraph.entities.some((entity) => entity.name === '莱昂' && entity.aliases.includes('主人公（莱昂）')));
    assert.ok(payload.knowledgeGraph.entities.some((entity) => ['黑塔', '高塔'].includes(entity.name) && entity.aliases.includes('高塔（黑塔）')));
    assert.equal(payload.knowledgeGraph.entities.some((entity) => entity.name === '主人公（莱昂）'), false);
    assert.equal(payload.knowledgeGraph.entities.some((entity) => entity.name === '高塔（黑塔）'), false);
    assert.ok(payload.knowledgeGraph.relations.some((relation) => relation.evidence.some((evidence) => evidence.includes('联手调查黑塔'))));
    assert.ok(fakeNeo4j.clearCalls.includes(namespace));
    assert.ok(fakeNeo4j.hasEntity(namespace, '艾琳'));

    fakeNeo4j.injectGarbage(namespace);
    const rebuildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, { method: 'POST' });
    assert.equal(rebuildResponse.status, 202);

    payload = await pollGraph(baseUrl, (current) => current.knowledgeGraph.build.status === 'completed');
    assert.ok(fakeNeo4j.clearCalls.filter((entry) => entry === namespace).length >= 2);
    assert.equal(fakeNeo4j.hasEntity(namespace, '坏掉的旧图谱实体'), false);

    const assistantResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '谁成了男主的搭档？' }),
    });
    const assistantPayload = await assistantResponse.json() as {
      reply: {
        mode: string;
        message: string;
        sources: Array<{ type: string; chapterId: string | null }>;
        trace: {
          graphHits: Array<{ source: string; label: string }>;
          chunkHits: Array<{ rerankScore: number | null; selected: boolean; chapterId: string | null }>;
        };
      };
    };

    assert.equal(assistantResponse.status, 200);
    assert.equal(assistantPayload.reply.mode, 'llm');
    assert.match(assistantPayload.reply.message, /艾琳/);
    assert.ok(assistantPayload.reply.sources.some((source) => source.type === 'graph'));
    assert.ok(assistantPayload.reply.sources.some((source) => source.chapterId === 'chapter-2'));
    assert.ok(assistantPayload.reply.trace.graphHits.some((hit) => hit.source === 'neo4j'));
    assert.ok(assistantPayload.reply.trace.chunkHits.some((hit) => hit.selected));
    assert.ok(assistantPayload.reply.trace.chunkHits.some((hit) => hit.rerankScore !== null));

    const clearResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`, { method: 'DELETE' });
    const clearPayload = await clearResponse.json() as {
      knowledgeGraph: {
        build: { status: string; entityCount: number; relationCount: number };
        buildLogs: Array<{ level: string; message: string }>;
        entities: unknown[];
        relations: unknown[];
        profile: { configLocked: boolean };
      };
    };

    assert.equal(clearResponse.status, 200);
    assert.equal(clearPayload.knowledgeGraph.build.status, 'idle');
    assert.equal(clearPayload.knowledgeGraph.build.entityCount, 0);
    assert.equal(clearPayload.knowledgeGraph.build.relationCount, 0);
    assert.equal(clearPayload.knowledgeGraph.profile.configLocked, false);
    assert.equal(clearPayload.knowledgeGraph.entities.length, 0);
    assert.equal(clearPayload.knowledgeGraph.relations.length, 0);
    assert.ok(clearPayload.knowledgeGraph.buildLogs.some((entry) => /手动清空/.test(entry.message)));
    assert.equal(fakeNeo4j.hasEntity(namespace, '艾琳'), false);
  } finally {
    await closeServer(server);
    cleanup();
    await fakeProvider.close();
  }
});