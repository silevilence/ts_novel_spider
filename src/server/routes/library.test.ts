import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { createServerApp } from '../app';
import { ControlCenterService } from '../core/control-center';
import type { Neo4jGraphStore } from '../core/library-intelligence';
import { SqliteNovelRepository } from '../core/novel-repository';
import { SystemPreferencesService } from '../core/system-preferences';

class InMemoryNeo4jGraphStore implements Neo4jGraphStore {
  readonly clearCalls: string[] = [];
  readonly #namespaces = new Map<string, {
    entities: Map<string, { id: string; name: string; aliases: string[]; mentionChapterIds: string[]; summary: string }>;
    relations: Map<string, { id: string; fromEntityId: string; toEntityId: string; summary: string; evidence: string[]; chapterIds: string[] }>;
  }>();

  async clearNamespaceGraph(namespace: string): Promise<boolean> {
    this.clearCalls.push(namespace);
    return this.#namespaces.delete(namespace);
  }

  async replaceNamespaceGraph(snapshot, entities, relations): Promise<void> {
    const namespace = `${snapshot.sourceId}:${snapshot.metadata.novelId}`;
    const existing = this.#namespaces.get(namespace) ?? {
      entities: new Map<string, { id: string; name: string; aliases: string[]; mentionChapterIds: string[]; summary: string }>(),
      relations: new Map<string, { id: string; fromEntityId: string; toEntityId: string; summary: string; evidence: string[]; chapterIds: string[] }>(),
    };

    for (const entity of entities) {
      existing.entities.set(entity.id, {
        id: entity.id,
        name: entity.name,
        aliases: entity.aliases,
        mentionChapterIds: entity.mentionChapterIds,
        summary: entity.summary,
      });
    }

    for (const relation of relations) {
      existing.relations.set(relation.id, {
        id: relation.id,
        fromEntityId: relation.fromEntityId,
        toEntityId: relation.toEntityId,
        summary: relation.summary,
        evidence: relation.evidence,
        chapterIds: relation.chapterIds,
      });
    }

    this.#namespaces.set(namespace, existing);
  }

  async queryNamespaceGraph(namespace: string, query: string) {
    const stored = this.#namespaces.get(namespace);
    if (!stored) {
      return { hits: [], source: null };
    }

    const normalized = query.toLocaleLowerCase('zh-CN');
    const tokens = extractQueryTokensForTest(normalized);
    const entityById = stored.entities;
    const relationHits = [...stored.relations.values()]
      .map((relation) => {
        const fromName = entityById.get(relation.fromEntityId)?.name ?? relation.fromEntityId;
        const toName = entityById.get(relation.toEntityId)?.name ?? relation.toEntityId;
        const fromAliases = entityById.get(relation.fromEntityId)?.aliases.join(' ') ?? '';
        const toAliases = entityById.get(relation.toEntityId)?.aliases.join(' ') ?? '';
        const text = `${fromName} ${fromAliases} ${toName} ${toAliases} ${relation.summary} ${relation.evidence.join(' ')}`.toLocaleLowerCase('zh-CN');
        const score = scoreTokenGroup(text, tokens) + (text.includes('搭档') && normalized.includes('搭档') ? 3 : 0);
        return { relation, fromName, toName, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2);

    if (relationHits.length > 0) {
      const hits = relationHits.map(({ relation, fromName, toName, score }) => ({
        source: 'neo4j' as const,
        label: `${fromName} -> ${toName}`,
        excerpt: `${relation.summary}。证据：${relation.evidence[0] ?? relation.summary}`,
        score,
        chapterIds: relation.chapterIds,
        entityNames: [fromName, toName],
        relationSummaries: [relation.summary],
      }));
      return {
        hits,
        source: {
          type: 'graph' as const,
          label: 'Neo4j 子图命中',
          excerpt: hits.map((hit) => `${hit.label}：${hit.excerpt}`).join('；'),
          chapterId: hits[0]?.chapterIds[0] ?? null,
        },
      };
    }

    return { hits: [], source: null };
  }

  injectGarbage(namespace: string): void {
    const stored = this.#namespaces.get(namespace) ?? {
      entities: new Map<string, { id: string; name: string; aliases: string[]; mentionChapterIds: string[]; summary: string }>(),
      relations: new Map<string, { id: string; fromEntityId: string; toEntityId: string; summary: string; evidence: string[]; chapterIds: string[] }>(),
    };
    stored.entities.set('entity-bad', {
      id: 'entity-bad',
      name: '坏掉的旧图谱实体',
      aliases: [],
      mentionChapterIds: [],
      summary: '不应该在重建后继续存在。',
    });
    this.#namespaces.set(namespace, stored);
  }

  hasEntity(namespace: string, name: string): boolean {
    return [...(this.#namespaces.get(namespace)?.entities.values() ?? [])].some((entity) => entity.name === name);
  }
}

function createLibraryServer(options: {
  systemPreferences?: SystemPreferencesService;
  neo4jGraphStore?: Neo4jGraphStore;
  beforeControlCenter?: (repository: SqliteNovelRepository) => void;
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-library-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));

  repository.saveMetadata('syosetu', {
    novelId: 'n1000lib',
    title: '离线书库样例',
    author: '测试作者',
    description: '用于验证书库路由与阅读器。',
    tags: ['离线', '书库'],
    chapterCount: 3,
    infoPageUrl: 'https://example.com/n1000lib',
  });
  repository.saveChapterIndex('syosetu', 'n1000lib', [
    {
      id: 'chapter-1',
      index: 1,
      title: '第一章',
      volumeTitle: '第一卷',
      url: 'https://example.com/n1000lib/1',
    },
    {
      id: 'chapter-2',
      index: 2,
      title: '第二章',
      volumeTitle: '第一卷',
      url: 'https://example.com/n1000lib/2',
    },
    {
      id: 'chapter-3',
      index: 3,
      title: '第三章',
      volumeTitle: '第二卷',
      url: 'https://example.com/n1000lib/3',
    },
  ]);
  repository.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'chapter-1',
    index: 1,
    title: '第一章',
    volumeTitle: '第一卷',
    url: 'https://example.com/n1000lib/1',
    content: '艾琳和莱昂在晨雾城相遇。艾琳决定帮助莱昂寻找失踪的星图。\n\n![插图](https://cdn.example.com/cover/chapter-1.png)',
  });
  repository.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'chapter-2',
    index: 2,
    title: '第二章',
    volumeTitle: '第一卷',
    url: 'https://example.com/n1000lib/2',
    content: '莱昂在晨雾城外再次遇到艾琳，两人决定联手调查黑塔。黑塔守卫与莱昂发生冲突。',
  });

  options.beforeControlCenter?.(repository);

  const controlCenter = new ControlCenterService({
    repository,
    spiders: [],
    systemPreferences: options.systemPreferences ?? new SystemPreferencesService(),
    ...(options.neo4jGraphStore ? { neo4jGraphStore: options.neo4jGraphStore } : {}),
    offlineAssetStoragePath: path.join(tempDir, 'assets'),
    exportStoragePath: path.join(tempDir, 'exports'),
    assetFetchImpl: async () => new Response('image-binary', {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
    }),
  });

  const app = createServerApp({ controlCenter });

  return {
    app,
    repository,
    cleanup: () => {
      controlCenter.close();
      repository.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('library routes recover stale running graph builds when no active task exists', async () => {
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
    const graphPayload = (await graphResponse.json()) as {
      knowledgeGraph: {
        build: {
          status: string;
          stage: string;
          message: string;
          errorMessage: string | null;
          modelStats: Array<{ inFlightCount: number; throughputPerMinute: number; circuitState: string }>;
        };
        buildLogs: Array<{ level: string; message: string }>;
      };
    };

    assert.equal(graphResponse.status, 200);
    assert.equal(graphPayload.knowledgeGraph.build.status, 'failed');
    assert.equal(graphPayload.knowledgeGraph.build.stage, 'failed');
    assert.match(graphPayload.knowledgeGraph.build.message, /已中断|恢复/);
    assert.match(graphPayload.knowledgeGraph.build.errorMessage ?? '', /服务重启|异常退出|当前服务进程/);
    assert.equal(graphPayload.knowledgeGraph.build.modelStats[0]?.inFlightCount, 0);
    assert.equal(graphPayload.knowledgeGraph.build.modelStats[0]?.throughputPerMinute, 0);
    assert.equal(graphPayload.knowledgeGraph.build.modelStats[0]?.circuitState, 'closed');
    assert.ok(graphPayload.knowledgeGraph.buildLogs.some((entry) => /自动恢复为失败状态/.test(entry.message)));
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

test('library routes resume interrupted graph builds when checkpoints exist', async () => {
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    let graphPayload: {
      knowledgeGraph: {
        build: { status: string; message: string; entityCount: number; relationCount: number };
        buildLogs: Array<{ level: string; message: string }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 160; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed' || graphPayload?.knowledgeGraph.build.status === 'failed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.ok((graphPayload?.knowledgeGraph.build.entityCount ?? 0) >= 2);
    assert.ok((graphPayload?.knowledgeGraph.build.relationCount ?? 0) >= 1);
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /自动恢复图谱构建/.test(entry.message)));
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

test('library routes pause a running graph build and resume with the latest saved config', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({
    extractionDelayMs: 180,
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initialProfileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        extractionConcurrency: 1,
        extractionModels: [
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-a',
            maxConcurrency: 1,
          },
        ],
      }),
    });
    assert.equal(initialProfileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });
    assert.equal(buildResponse.status, 202);

    let graphPayload: {
      knowledgeGraph: {
        profile: {
          extractionConcurrency: number;
          extractionModels: Array<{ modelId: string; maxConcurrency: number }>;
        };
        build: {
          status: string;
          progressPercent: number;
        };
        buildLogs: Array<{ message: string }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'running') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.equal(graphPayload?.knowledgeGraph.build.status, 'running');

    const pauseResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/pause`, {
      method: 'POST',
    });
    assert.equal(pauseResponse.status, 202);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'paused') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const pausedCheckpointCount = repository.listKnowledgeGraphBuildCheckpoints('syosetu', 'n1000lib').length;
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'paused');
    assert.ok(pausedCheckpointCount >= 1);
    assert.ok(pausedCheckpointCount < 3);

    const updatedProfileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        extractionConcurrency: 2,
        extractionModels: [
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-a',
            maxConcurrency: 1,
          },
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-b',
            maxConcurrency: 1,
          },
        ],
      }),
    });
    assert.equal(updatedProfileResponse.status, 200);

    const resumeResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/resume`, {
      method: 'POST',
    });
    assert.equal(resumeResponse.status, 202);

    for (let attempt = 0; attempt < 240; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.equal(graphPayload?.knowledgeGraph.profile.extractionConcurrency, 2);
    assert.deepEqual(
      graphPayload?.knowledgeGraph.profile.extractionModels.map((entry) => [entry.modelId, entry.maxConcurrency]),
      [['fake-chat-a', 1], ['fake-chat-b', 1]],
    );
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /图谱构建已暂停/.test(entry.message)));
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /继续图谱构建/.test(entry.message)));
    assert.deepEqual(fakeProvider.getSeenExtractionModels().sort(), ['fake-chat-a', 'fake-chat-b']);
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
    await fakeProvider.close();
  }
});

async function createFakeOpenAiProviderServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  getSeenExtractionModels: () => string[];
  getExtractionChaptersByModel: () => Record<string, string[]>;
}>;
async function createFakeOpenAiProviderServer(options: {
  rejectJsonSchema?: boolean;
  failExtractionAttempts?: number;
  failExtractionAttemptsByModel?: Record<string, number>;
  extractionDelayMs?: number;
  malformedPromptedJson?: boolean;
  loosePromptedJsonTypes?: boolean;
} = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  getSeenExtractionModels: () => string[];
  getExtractionRequestCounts: () => Record<string, number>;
  getExtractionChaptersByModel: () => Record<string, string[]>;
}> {
  let remainingExtractionFailures = options.failExtractionAttempts ?? 0;
  const remainingExtractionFailuresByModel = new Map(Object.entries(options.failExtractionAttemptsByModel ?? {}));
  const seenExtractionModels = new Set<string>();
  const extractionRequestCounts = new Map<string, number>();
  const extractionChaptersByModel = new Map<string, Set<string>>();
  const server = http.createServer(async (request, response) => {
    const payload = request.method === 'POST' ? await readJsonBody(request) : null;
    const bodyText = extractTextPayload(payload);

    if (request.url === '/v1/chat/completions') {
      const requestedModel = typeof (payload as { model?: unknown })?.model === 'string'
        ? (payload as { model: string }).model
        : '';
      if (bodyText.includes('你是小说知识图谱抽取器') && requestedModel) {
        seenExtractionModels.add(requestedModel);
        extractionRequestCounts.set(requestedModel, (extractionRequestCounts.get(requestedModel) ?? 0) + 1);
        const chapterMatch = bodyText.match(/章节：([^\n\r]+)/);
        const chapterTitle = chapterMatch?.[1]?.trim();
        if (chapterTitle) {
          const chapters = extractionChaptersByModel.get(requestedModel) ?? new Set<string>();
          chapters.add(chapterTitle);
          extractionChaptersByModel.set(requestedModel, chapters);
        }
      }

      if (remainingExtractionFailures > 0 && bodyText.includes('你是小说知识图谱抽取器')) {
        remainingExtractionFailures -= 1;
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          error: {
            message: 'Temporary upstream overload',
            type: 'server_error',
            code: 'server_error',
          },
        }));
        return;
      }

      const remainingModelFailures = requestedModel ? remainingExtractionFailuresByModel.get(requestedModel) ?? 0 : 0;
      if (remainingModelFailures > 0 && bodyText.includes('你是小说知识图谱抽取器')) {
        remainingExtractionFailuresByModel.set(requestedModel, remainingModelFailures - 1);
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          error: {
            message: `Temporary upstream overload for ${requestedModel}`,
            type: 'server_error',
            code: 'server_error',
          },
        }));
        return;
      }

      if (
        options.rejectJsonSchema
        && bodyText.includes('你是小说知识图谱抽取器')
        && !bodyText.includes('请只输出一个 JSON 对象')
      ) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          error: {
            message: 'This response_format type is unavailable now',
            type: 'invalid_request_error',
            code: 'invalid_request_error',
          },
        }));
        return;
      }

      const content = bodyText.includes('你是小说知识图谱抽取器')
        ? buildFakeExtractionContent(bodyText, {
            malformed: Boolean(options.malformedPromptedJson && bodyText.includes('请只输出一个 JSON 对象')),
            looseTypes: Boolean(options.loosePromptedJsonTypes && bodyText.includes('请只输出一个 JSON 对象')),
          })
        : '根据图谱与正文片段，艾琳后来成了莱昂在调查黑塔时的搭档，并与他保持协作关系。';
      if (options.extractionDelayMs && bodyText.includes('你是小说知识图谱抽取器')) {
        await new Promise((resolve) => setTimeout(resolve, options.extractionDelayMs));
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'fake-chat',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      }));
      return;
    }

    if (request.url === '/v1/embeddings') {
      const inputs = Array.isArray((payload as { input?: unknown })?.input)
        ? (payload as { input: unknown[] }).input.map((value) => String(value))
        : [String((payload as { input?: unknown })?.input ?? '')];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        object: 'list',
        data: inputs.map((value, index) => ({
          object: 'embedding',
          index,
          embedding: buildFakeEmbedding(value),
        })),
        model: 'fake-embedding',
        usage: {
          prompt_tokens: 0,
          total_tokens: 0,
        },
      }));
      return;
    }

    if (request.url === '/v1/rerank') {
      const query = String((payload as { query?: unknown })?.query ?? '');
      const documents = Array.isArray((payload as { documents?: unknown })?.documents)
        ? (payload as { documents: unknown[] }).documents.map((value) => String(value))
        : [];
      const queryEmbedding = buildFakeEmbedding(query);
      const ranked = documents
        .map((document, index) => ({
          index,
          relevance_score: dotProduct(queryEmbedding, buildFakeEmbedding(document)),
        }))
        .sort((left, right) => right.relevance_score - left.relevance_score);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: ranked }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected fake AI provider TCP address.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getSeenExtractionModels: () => [...seenExtractionModels],
    getExtractionRequestCounts: () => Object.fromEntries(extractionRequestCounts),
    getExtractionChaptersByModel: () => Object.fromEntries(
      [...extractionChaptersByModel.entries()].map(([modelId, chapters]) => [modelId, [...chapters].sort()]),
    ),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
  };
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function extractTextPayload(payload: unknown): string {
  const parts: string[] = [];

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.text === 'string') {
        parts.push(record.text);
      }

      visit(record.prompt);
      visit(record.input);
      visit(record.content);
      visit(record.messages);
    }
  };

  visit(payload);
  return parts.join('\n');
}

function buildFakeExtractionContent(prompt: string, options: {
  malformed?: boolean;
  looseTypes?: boolean;
} = {}): string {
  if (prompt.includes('帮助莱昂寻找失踪的星图')) {
    const content = JSON.stringify({
      summary: '艾琳在晨雾城与莱昂相遇，并主动帮助他寻找失踪的星图。',
      events: [
        {
          summary: '艾琳决定帮助莱昂寻找星图。',
          evidence: '艾琳决定帮助莱昂寻找失踪的星图。',
          chapterScope: '第一章',
        },
      ],
      entities: [
        {
          name: '艾琳',
          entityType: 'character',
          aliases: ['女伴'],
          summary: '在晨雾城与莱昂相遇，并主动提供帮助。',
          evidence: '艾琳决定帮助莱昂寻找失踪的星图。',
        },
        {
          name: '莱昂',
          entityType: 'character',
          aliases: ['男主'],
          summary: '正在寻找失踪星图的核心人物。',
          evidence: '艾琳决定帮助莱昂寻找失踪的星图。',
        },
        {
          name: '晨雾城',
          entityType: 'location',
          aliases: [],
          summary: '艾琳与莱昂首次会面的地点。',
          evidence: '艾琳和莱昂在晨雾城相遇。',
        },
        {
          name: '星图',
          entityType: 'concept',
          aliases: ['地图'],
          summary: '驱动当前行动的失踪线索。',
          evidence: '寻找失踪的星图。',
        },
      ],
      relations: [
        {
          from: '艾琳',
          to: '莱昂',
          relationType: 'alliance',
          summary: '艾琳开始协助莱昂寻找星图。',
          evidence: '艾琳决定帮助莱昂寻找失踪的星图。',
          chapterScope: '第一章',
        },
      ],
      keywordHints: ['艾琳', '莱昂', '晨雾城', '星图'],
    });

    return finalizeFakeExtractionContent(content, options);
  }

  const content = JSON.stringify({
    summary: '艾琳与莱昂在晨雾城外联手调查黑塔，并与黑塔守卫发生冲突。',
    events: [
      {
        summary: '艾琳与莱昂正式联手调查黑塔。',
        evidence: '两人决定联手调查黑塔。',
        chapterScope: '第二章',
      },
      {
        summary: '莱昂与黑塔守卫爆发冲突。',
        evidence: '黑塔守卫与莱昂发生冲突。',
        chapterScope: '第二章',
      },
    ],
    entities: [
      {
        name: '艾琳',
        entityType: 'character',
        aliases: ['搭档'],
        summary: '成为莱昂调查黑塔时的重要同伴。',
        evidence: '两人决定联手调查黑塔。',
      },
      {
        name: '莱昂',
        entityType: 'character',
        aliases: ['男主'],
        summary: '与艾琳并肩调查黑塔，并亲自参与冲突。',
        evidence: '黑塔守卫与莱昂发生冲突。',
      },
      {
        name: '黑塔',
        entityType: 'location',
        aliases: ['高塔'],
        summary: '艾琳与莱昂联手调查的核心地点。',
        evidence: '两人决定联手调查黑塔。',
      },
      {
        name: '黑塔守卫',
        entityType: 'organization',
        aliases: [],
        summary: '阻拦莱昂调查黑塔的守卫力量。',
        evidence: '黑塔守卫与莱昂发生冲突。',
      },
    ],
    relations: [
      {
        from: '艾琳',
        to: '莱昂',
        relationType: 'alliance',
        summary: '艾琳与莱昂已经形成协作搭档，共同调查黑塔。',
        evidence: '两人决定联手调查黑塔。',
        chapterScope: '第二章',
      },
      {
        from: '莱昂',
        to: '黑塔守卫',
        relationType: 'conflict',
        summary: '莱昂在调查黑塔时与守卫正面冲突。',
        evidence: '黑塔守卫与莱昂发生冲突。',
        chapterScope: '第二章',
      },
    ],
    keywordHints: ['艾琳', '莱昂', '黑塔', '搭档', '调查'],
  });

  return finalizeFakeExtractionContent(content, options);
}

function finalizeFakeExtractionContent(content: string, options: {
  malformed?: boolean;
  looseTypes?: boolean;
}): string {
  let resolvedContent = content;

  if (options.looseTypes) {
    const record = JSON.parse(resolvedContent) as {
      entities?: Array<Record<string, unknown>>;
      keywordHints?: unknown;
    };
    if (Array.isArray(record.entities)) {
      const firstEntity = record.entities[0];
      const secondEntity = record.entities[1];
      if (firstEntity) {
        firstEntity.aliases = '女伴';
      }
      if (secondEntity) {
        secondEntity.aliases = '男主';
      }
    }
    record.keywordHints = '艾琳, 莱昂, 调查';
    resolvedContent = JSON.stringify(record);
  }

  return options.malformed
    ? resolvedContent.replace('"summary"', 'summary').replace(/}\s*$/, ',}')
    : resolvedContent;
}

test('library routes inject current chapter content for assistant chat even before graph chunks exist', async () => {
  const { app, cleanup } = createLibraryServer();
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
    const assistantResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/assistant/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: '总结本章的主要内容',
        chapterId: 'chapter-1',
      }),
    });
    const assistantPayload = (await assistantResponse.json()) as {
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

function buildFakeEmbedding(text: string): number[] {
  const normalized = text.toLocaleLowerCase('zh-CN');
  return [
    scoreTokenGroup(normalized, ['莱昂', '男主', '主角']),
    scoreTokenGroup(normalized, ['艾琳', '同伴', '搭档', '伙伴', '女伴']),
    scoreTokenGroup(normalized, ['黑塔', '高塔', '塔']),
    scoreTokenGroup(normalized, ['星图', '地图']),
    scoreTokenGroup(normalized, ['调查', '寻找', '帮助', '联手']),
  ];
}

test('library routes retry transient AI extraction failures before falling back', async () => {
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });

    assert.equal(buildResponse.status, 202);

    let graphPayload: {
      knowledgeGraph: {
        build: { status: string; message: string };
        buildLogs: Array<{ level: string; message: string }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed' || graphPayload?.knowledgeGraph.build.status === 'failed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.match(graphPayload?.knowledgeGraph.build.message ?? '', /AI 图谱|向量索引/);
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /图谱构建完成/.test(entry.message)));
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
    await fakeProvider.close();
  }
});

test('library routes repair prompted JSON leaf type mismatches before local fallback', async () => {
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });

    assert.equal(buildResponse.status, 202);

    let graphPayload: {
      knowledgeGraph: {
        build: { status: string; message: string; entityCount: number };
        buildLogs: Array<{ level: string; message: string }>;
        entities: Array<{ name: string; aliases: string[] }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.match(graphPayload?.knowledgeGraph.build.message ?? '', /AI 图谱/);
    assert.ok((graphPayload?.knowledgeGraph.build.entityCount ?? 0) >= 4);
    assert.ok(graphPayload?.knowledgeGraph.entities.some((entity) => entity.name === '艾琳' && entity.aliases.includes('女伴')));
    assert.ok(graphPayload?.knowledgeGraph.entities.some((entity) => entity.name === '莱昂' && entity.aliases.includes('男主')));
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /回退 0 个/.test(entry.message)));
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
    await fakeProvider.close();
  }
});

test('library routes distribute extraction work across the configured model pool', async () => {
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        extractionConcurrency: 2,
        extractionModels: [
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-a',
            maxConcurrency: 1,
          },
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-b',
            maxConcurrency: 1,
          },
        ],
      }),
    });

    assert.equal(profileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });
    assert.equal(buildResponse.status, 202);

    let graphPayload: {
      knowledgeGraph: {
        build: { status: string };
        profile: { extractionModels: Array<{ modelId: string; maxConcurrency: number }> };
      };
    } | null = null;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.deepEqual(
      graphPayload?.knowledgeGraph.profile.extractionModels.map((entry) => [entry.modelId, entry.maxConcurrency]),
      [['fake-chat-a', 1], ['fake-chat-b', 1]],
    );
    assert.deepEqual(fakeProvider.getSeenExtractionModels().sort(), ['fake-chat-a', 'fake-chat-b']);
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
    await fakeProvider.close();
  }
});

test('library routes requeue failed chunks onto another extraction model before local fallback', async () => {
  const fakeProvider = await createFakeOpenAiProviderServer({
    failExtractionAttemptsByModel: {
      'fake-chat-a': 5,
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        extractionConcurrency: 2,
        extractionModels: [
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-a',
            maxConcurrency: 1,
          },
          {
            providerId: 'fake-openai',
            modelId: 'fake-chat-b',
            maxConcurrency: 1,
          },
        ],
      }),
    });

    assert.equal(profileResponse.status, 200);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });
    assert.equal(buildResponse.status, 202);

    let graphPayload: {
      knowledgeGraph: {
        build: {
          status: string;
          modelStats: Array<{
            modelId: string;
            attemptCount: number;
            failureCount: number;
            handoffInCount: number;
            handoffOutCount: number;
            circuitOpenedCount: number;
            cooldownUntil: string | null;
            throughputPerMinute: number;
          }>;
        };
        buildLogs: Array<{ message: string }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /回退 0 个/.test(entry.message)));
    assert.deepEqual(fakeProvider.getSeenExtractionModels().sort(), ['fake-chat-a', 'fake-chat-b']);

    const requestCounts = fakeProvider.getExtractionRequestCounts();
    assert.ok((requestCounts['fake-chat-a'] ?? 0) >= 1);
    assert.ok((requestCounts['fake-chat-b'] ?? 0) >= 1);

    const chaptersByModel = fakeProvider.getExtractionChaptersByModel();
    assert.deepEqual(chaptersByModel['fake-chat-b'], ['第一章', '第二章']);

    const modelStats = new Map(graphPayload.knowledgeGraph.build.modelStats.map((entry) => [entry.modelId, entry]));
    assert.equal(modelStats.get('fake-chat-a')?.attemptCount, 1);
    assert.ok((modelStats.get('fake-chat-a')?.failureCount ?? 0) >= 1);
    assert.ok((modelStats.get('fake-chat-a')?.handoffOutCount ?? 0) >= 1);
    assert.ok((modelStats.get('fake-chat-a')?.circuitOpenedCount ?? 0) >= 1);
    assert.ok(Boolean(modelStats.get('fake-chat-a')?.cooldownUntil));
    assert.ok((modelStats.get('fake-chat-b')?.handoffInCount ?? 0) >= 1);
    assert.ok((modelStats.get('fake-chat-b')?.attemptCount ?? 0) >= 2);
    assert.ok((modelStats.get('fake-chat-b')?.throughputPerMinute ?? 0) > 0);
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
    await fakeProvider.close();
  }
});

function scoreTokenGroup(text: string, tokens: string[]): number {
  return tokens.reduce((score, token) => score + (text.includes(token.toLocaleLowerCase('zh-CN')) ? 1 : 0), 0);
}

function dotProduct(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function extractQueryTokensForTest(query: string): string[] {
  const matches = query.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]{1,16}/gu) ?? [];
  const tokens = matches.flatMap((token) => {
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
      const parts = new Set<string>();
      for (let size = 2; size <= 4; size += 1) {
        for (let start = 0; start <= token.length - size; start += 1) {
          parts.add(token.slice(start, start + size));
        }
      }
      return [...parts];
    }
    return [token];
  });

  return [...new Set(tokens.filter((token) => token.length >= 2))];
}

test('library routes expose stored novels, detail stats and chapter reading data', async () => {
  const { app, cleanup } = createLibraryServer();
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

    const listResponse = await fetch(`${baseUrl}/api/library/novels`);
    const listPayload = (await listResponse.json()) as {
      novels: Array<{ metadata: { title: string }; downloadedChapters: number; indexedChapters: number }>;
    };

    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.novels.length, 1);
    assert.equal(listPayload.novels[0]?.metadata.title, '离线书库样例');
    assert.equal(listPayload.novels[0]?.downloadedChapters, 2);
    assert.equal(listPayload.novels[0]?.indexedChapters, 1);

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = (await detailResponse.json()) as {
      novel: {
        stats: { total: number; downloaded: number; pending: number };
        media: { total: number; pending: number };
        chapters: Array<{ id: string; hasContent: boolean; media: { total: number } }>;
      };
      knowledgeGraph: {
        build: { status: string };
      };
    };

    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.novel.stats.total, 3);
    assert.equal(detailPayload.novel.stats.downloaded, 2);
    assert.equal(detailPayload.novel.stats.pending, 1);
    assert.equal(detailPayload.novel.media.total, 1);
    assert.equal(detailPayload.novel.media.pending, 1);
    assert.equal(detailPayload.novel.chapters[0]?.media.total, 1);
    assert.equal(detailPayload.novel.chapters[2]?.hasContent, false);
    assert.equal(detailPayload.knowledgeGraph.build.status, 'idle');
    assert.deepEqual(detailPayload.novel.aliases, []);
    assert.equal(detailPayload.novel.readingProgress, null);
    assert.deepEqual(detailPayload.novel.bookmarks, []);

    const chapterResponse = await fetch(
      `${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1`,
    );
    const chapterPayload = (await chapterResponse.json()) as {
      chapter: {
        previousChapterId: string | null;
        nextChapterId: string | null;
        chapter: { content: string; title: string };
        mediaAssets: Array<{ sourceUrl: string; cached: boolean }>;
      };
    };

    assert.equal(chapterResponse.status, 200);
    assert.equal(chapterPayload.chapter.previousChapterId, null);
    assert.equal(chapterPayload.chapter.nextChapterId, 'chapter-2');
    assert.equal(chapterPayload.chapter.chapter.title, '第一章');
    assert.match(chapterPayload.chapter.chapter.content, /艾琳和莱昂在晨雾城相遇/);
    assert.equal(chapterPayload.chapter.mediaAssets[0]?.cached, false);
    assert.equal(
      chapterPayload.chapter.mediaAssets[0]?.sourceUrl,
      'https://cdn.example.com/cover/chapter-1.png',
    );
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

test('library routes build a knowledge graph, lock config and answer assistant chat', async () => {
  const { app, cleanup } = createLibraryServer();
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

    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        extractionConcurrency: 4,
        neo4j: {
          enabled: false,
        },
      }),
    });
    const profilePayload = (await profileResponse.json()) as {
      profile: { configLocked: boolean; neo4j: { enabled: boolean }; extractionConcurrency: number };
    };

    assert.equal(profileResponse.status, 200);
    assert.equal(profilePayload.profile.configLocked, false);
    assert.equal(profilePayload.profile.neo4j.enabled, false);
    assert.equal(profilePayload.profile.extractionConcurrency, 4);

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });
    const buildPayload = (await buildResponse.json()) as {
      build: { status: string };
    };

    assert.equal(buildResponse.status, 202);
    assert.equal(buildPayload.build.status, 'queued');

    let graphPayload: {
      knowledgeGraph: {
        build: { status: string; entityCount: number; relationCount: number };
        profile: { configLocked: boolean; extractionConcurrency: number };
        entities: Array<{ name: string }>;
        relations: Array<{ summary: string }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.ok((graphPayload?.knowledgeGraph.build.entityCount ?? 0) >= 2);
    assert.ok((graphPayload?.knowledgeGraph.build.relationCount ?? 0) >= 1);
    assert.ok(graphPayload?.knowledgeGraph.entities.some((entity) => entity.name === '艾琳'));
    assert.ok(graphPayload?.knowledgeGraph.relations[0]?.summary.length);
    assert.equal(graphPayload?.knowledgeGraph.profile.configLocked, true);
    assert.equal(graphPayload?.knowledgeGraph.profile.extractionConcurrency, 4);

    const lockedResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chatModel: {
          providerId: 'override-provider',
          modelId: 'override-model',
        },
      }),
    });

    assert.equal(lockedResponse.status, 409);

    const assistantResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/assistant/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: '艾琳和莱昂现在是什么关系？',
        chapterId: 'chapter-2',
      }),
    });
    const assistantPayload = (await assistantResponse.json()) as {
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

test('library routes use AI extraction fallback, hybrid retrieval, JSON repair and manual graph clearing when models are configured', async () => {
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
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const profileResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
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

    const buildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });

    assert.equal(buildResponse.status, 202);
    const namespace = 'syosetu:n1000lib';

    let graphPayload: {
      knowledgeGraph: {
        build: { status: string; message: string; entityCount: number; relationCount: number };
        buildLogs: Array<{ level: string; message: string }>;
        entities: Array<{ name: string; aliases: string[] }>;
        relations: Array<{ summary: string; evidence: string[] }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const graphResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await graphResponse.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(graphPayload);
    assert.equal(graphPayload?.knowledgeGraph.build.status, 'completed');
    assert.match(graphPayload?.knowledgeGraph.build.message ?? '', /AI 图谱|向量索引/);
    assert.ok((graphPayload?.knowledgeGraph.build.entityCount ?? 0) >= 4);
    assert.ok((graphPayload?.knowledgeGraph.build.relationCount ?? 0) >= 2);
    assert.ok((graphPayload?.knowledgeGraph.buildLogs.length ?? 0) >= 4);
    assert.ok(graphPayload?.knowledgeGraph.buildLogs.some((entry) => /构建开始|抽取结束|图谱构建完成/.test(entry.message)));
    assert.ok(graphPayload?.knowledgeGraph.entities.some((entity) => entity.name === '艾琳' && entity.aliases.includes('搭档')));
    assert.ok(graphPayload?.knowledgeGraph.relations.some((relation) =>
      relation.evidence.some((evidence) => evidence.includes('联手调查黑塔')),
    ));
    assert.ok(fakeNeo4j.clearCalls.includes(namespace));
    assert.ok(fakeNeo4j.hasEntity(namespace, '艾琳'));

    fakeNeo4j.injectGarbage(namespace);

    const rebuildResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph/build`, {
      method: 'POST',
    });
    assert.equal(rebuildResponse.status, 202);

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const refreshed = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`);
      graphPayload = (await refreshed.json()) as typeof graphPayload;

      if (graphPayload?.knowledgeGraph.build.status === 'completed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok((fakeNeo4j.clearCalls.filter((entry) => entry === namespace)).length >= 2);
    assert.equal(fakeNeo4j.hasEntity(namespace, '坏掉的旧图谱实体'), false);

    const assistantResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/assistant/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: '谁成了男主的搭档？',
      }),
    });
    const assistantPayload = (await assistantResponse.json()) as {
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

    const clearResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/graph`, {
      method: 'DELETE',
    });
    const clearPayload = (await clearResponse.json()) as {
      knowledgeGraph: {
        build: { status: string; message: string; entityCount: number; relationCount: number };
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
    await fakeProvider.close();
  }
});

test('library routes support advanced search, aliases, progress watermark and bookmarks', async () => {
  const { app, cleanup } = createLibraryServer();
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

    const aliasCreateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ alias: '样例别名' }),
    });
    const aliasCreatePayload = (await aliasCreateResponse.json()) as {
      alias: { id: string; alias: string };
    };

    assert.equal(aliasCreateResponse.status, 201);
    assert.equal(aliasCreatePayload.alias.alias, '样例别名');

    const searchByAliasResponse = await fetch(`${baseUrl}/api/library/novels?q=alias:%E6%A0%B7%E4%BE%8B%E5%88%AB%E5%90%8D`);
    const searchByAliasPayload = (await searchByAliasResponse.json()) as {
      novels: Array<{ metadata: { novelId: string } }>;
    };

    assert.equal(searchByAliasResponse.status, 200);
    assert.equal(searchByAliasPayload.novels.length, 1);
    assert.equal(searchByAliasPayload.novels[0]?.metadata.novelId, 'n1000lib');

    const searchByBooleanResponse = await fetch(`${baseUrl}/api/library/novels?q=name:%E7%A6%BB%E7%BA%BF+tag:%E4%B9%A6%E5%BA%93+-site:other`);
    const searchByBooleanPayload = (await searchByBooleanResponse.json()) as {
      novels: Array<{ metadata: { novelId: string } }>;
    };

    assert.equal(searchByBooleanResponse.status, 200);
    assert.equal(searchByBooleanPayload.novels.length, 1);

    const bookmarkCreateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/bookmarks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chapterId: 'chapter-1',
        note: '这里开始进入主线。',
      }),
    });
    const bookmarkCreatePayload = (await bookmarkCreateResponse.json()) as {
      bookmark: { id: string; note: string; chapterId: string };
    };

    assert.equal(bookmarkCreateResponse.status, 201);
    assert.equal(bookmarkCreatePayload.bookmark.chapterId, 'chapter-1');

    const progressChapter2Response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/progress`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ chapterId: 'chapter-2' }),
    });
    const progressChapter2Payload = (await progressChapter2Response.json()) as {
      progress: { currentChapterId: string; highestChapterId: string; highestChapterIndex: number };
    };

    assert.equal(progressChapter2Response.status, 200);
    assert.equal(progressChapter2Payload.progress.currentChapterId, 'chapter-2');
    assert.equal(progressChapter2Payload.progress.highestChapterId, 'chapter-2');
    assert.equal(progressChapter2Payload.progress.highestChapterIndex, 2);

    const progressChapter1Response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/progress`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ chapterId: 'chapter-1' }),
    });
    const progressChapter1Payload = (await progressChapter1Response.json()) as {
      progress: { currentChapterId: string; highestChapterId: string; highestChapterIndex: number };
    };

    assert.equal(progressChapter1Response.status, 200);
    assert.equal(progressChapter1Payload.progress.currentChapterId, 'chapter-1');
    assert.equal(progressChapter1Payload.progress.highestChapterId, 'chapter-2');
    assert.equal(progressChapter1Payload.progress.highestChapterIndex, 2);

    const bookmarkUpdateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/bookmarks/${bookmarkCreatePayload.bookmark.id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ note: '已更新备注。' }),
    });
    const bookmarkUpdatePayload = (await bookmarkUpdateResponse.json()) as {
      bookmark: { note: string };
    };

    assert.equal(bookmarkUpdateResponse.status, 200);
    assert.equal(bookmarkUpdatePayload.bookmark.note, '已更新备注。');

    const aliasUpdateResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases/${aliasCreatePayload.alias.id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ alias: '更新后的别名' }),
    });
    const aliasUpdatePayload = (await aliasUpdateResponse.json()) as {
      alias: { alias: string };
    };

    assert.equal(aliasUpdateResponse.status, 200);
    assert.equal(aliasUpdatePayload.alias.alias, '更新后的别名');

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = (await detailResponse.json()) as {
      novel: {
        aliases: Array<{ alias: string }>;
        readingProgress: { currentChapterId: string; highestChapterId: string } | null;
        bookmarks: Array<{ id: string; note: string }>;
      };
    };

    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.novel.aliases[0]?.alias, '更新后的别名');
    assert.equal(detailPayload.novel.readingProgress?.currentChapterId, 'chapter-1');
    assert.equal(detailPayload.novel.readingProgress?.highestChapterId, 'chapter-2');
    assert.equal(detailPayload.novel.bookmarks[0]?.note, '已更新备注。');

    const bookmarkDeleteResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/bookmarks/${bookmarkCreatePayload.bookmark.id}`, {
      method: 'DELETE',
    });
    assert.equal(bookmarkDeleteResponse.status, 204);

    const aliasDeleteResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/aliases/${aliasCreatePayload.alias.id}`, {
      method: 'DELETE',
    });
    assert.equal(aliasDeleteResponse.status, 204);
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

test('library routes cache all pending media assets for a stored novel', async () => {
  const { app, cleanup } = createLibraryServer();
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

    const cacheResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, {
      method: 'POST',
    });
    const cachePayload = (await cacheResponse.json()) as {
      result: { total: number; cached: number; skipped: number };
    };

    assert.equal(cacheResponse.status, 200);
    assert.deepEqual(cachePayload.result, {
      total: 1,
      cached: 1,
      skipped: 0,
    });

    const detailResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib`);
    const detailPayload = (await detailResponse.json()) as {
      novel: {
        media: { total: number; cached: number; pending: number };
      };
    };

    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailPayload.novel.media, {
      total: 1,
      cached: 1,
      pending: 0,
    });
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

test('library routes export markdown, txt and epub packages for a stored novel', async () => {
  const { app, cleanup } = createLibraryServer();
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

    const markdownResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/exports/markdown/download`);
    assert.equal(markdownResponse.status, 200);
    assert.match(markdownResponse.headers.get('content-type') ?? '', /application\/zip/);
    assert.match(markdownResponse.headers.get('content-disposition') ?? '', /n1000lib/);
    const markdownZip = await JSZip.loadAsync(Buffer.from(await markdownResponse.arrayBuffer()));
    const markdownEntryName = Object.keys(markdownZip.files).find((entry) => entry.endsWith('.md'));
    assert.ok(markdownEntryName);
    const markdown = await markdownZip.file(markdownEntryName!)?.async('string');
    assert.match(markdown ?? '', /^# 离线书库样例/m);
    assert.match(markdown ?? '', /## 第1卷/m);
    assert.match(markdown ?? '', /### 第1章 第一章/m);
    assert.match(markdown ?? '', /!\[插图\]\(https:\/\/cdn\.example\.com\/cover\/chapter-1\.png\)/);

    const textResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/exports/txt/download`);
    assert.equal(textResponse.status, 200);
    assert.match(textResponse.headers.get('content-type') ?? '', /text\/plain/);
    const text = await textResponse.text();
    assert.match(text, /^离线书库样例/m);
    assert.match(text, /第1章 第一章/);
    assert.match(text, /第1章 第一章\n艾琳和莱昂在晨雾城相遇/);
    assert.doesNotMatch(text, /第1章 第一章\n\n艾琳和莱昂在晨雾城相遇/);
    assert.doesNotMatch(text, /第一卷/);

    const epubResponse = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/exports/epub/download`);
    assert.equal(epubResponse.status, 200);
    assert.match(epubResponse.headers.get('content-type') ?? '', /application\/epub\+zip/);
    const epubZip = await JSZip.loadAsync(Buffer.from(await epubResponse.arrayBuffer()));
    assert.equal(await epubZip.file('mimetype')?.async('string'), 'application/epub+zip');
    const nav = await epubZip.file('OEBPS/nav.xhtml')?.async('string');
    assert.match(nav ?? '', /<a href="volume-0001\.xhtml">第1卷<\/a>/);
    assert.match(nav ?? '', /第1章 第一章/);
    const intro = await epubZip.file('OEBPS/intro.xhtml')?.async('string');
    assert.match(intro ?? '', /离线书库样例/);
    const volume1 = await epubZip.file('OEBPS/volume-0001.xhtml')?.async('string');
    assert.match(volume1 ?? '', /第1卷/);
    assert.match(volume1 ?? '', /chapter-0001.xhtml/);
    const chapter1 = await epubZip.file('OEBPS/chapter-0001.xhtml')?.async('string');
    assert.match(chapter1 ?? '', /第1章 第一章/);
    assert.match(chapter1 ?? '', /第1卷/);
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