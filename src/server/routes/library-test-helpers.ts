import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createServerApp } from '../app';
import { ControlCenterService, type SpiderRegistryEntry } from '../core/control-center';
import type { Neo4jGraphQueryResult, Neo4jGraphStore, Neo4jGraphStoreConfig } from '../core/library-intelligence';
import type {
  StoredKnowledgeGraphEntityRow,
  StoredKnowledgeGraphRelationRow,
} from '../core/novel-repository';
import type { StoredNovelSnapshot } from '../core/spider';
import { SqliteNovelRepository } from '../core/novel-repository';
import { SystemPreferencesService } from '../core/system-preferences';

export class InMemoryNeo4jGraphStore implements Neo4jGraphStore {
  readonly clearCalls: string[] = [];
  readonly #namespaces = new Map<string, {
    entities: Map<string, { id: string; name: string; aliases: string[]; mentionChapterIds: string[]; summary: string }>;
    relations: Map<string, { id: string; fromEntityId: string; toEntityId: string; summary: string; evidence: string[]; chapterIds: string[] }>;
  }>();

  async clearNamespaceGraph(namespace: string, _config: Neo4jGraphStoreConfig): Promise<boolean> {
    this.clearCalls.push(namespace);
    return this.#namespaces.delete(namespace);
  }

  async replaceNamespaceGraph(
    snapshot: StoredNovelSnapshot,
    entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>,
    relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>,
    _config: Neo4jGraphStoreConfig,
  ): Promise<void> {
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

  async queryNamespaceGraph(namespace: string, query: string, _config: Neo4jGraphStoreConfig): Promise<Neo4jGraphQueryResult> {
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

export function createLibraryServer(options: {
  systemPreferences?: SystemPreferencesService;
  neo4jGraphStore?: Neo4jGraphStore;
  spiders?: SpiderRegistryEntry[];
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
    spiders: options.spiders ?? [],
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

export async function waitForServerListening(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address.');
  }

  return `http://127.0.0.1:${address.port}`;
}

export async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function createFakeOpenAiProviderServer(options: {
  rejectJsonSchema?: boolean;
  failExtractionAttempts?: number;
  failExtractionAttemptsByModel?: Record<string, number>;
  extractionDelayMs?: number;
  maxEmbeddingBatchSize?: number;
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
  const maxEmbeddingBatchSize = options.maxEmbeddingBatchSize ?? 0;
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
      if (maxEmbeddingBatchSize && inputs.length > maxEmbeddingBatchSize) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          error: {
            message: `Embedding batch too large: ${inputs.length}`,
            type: 'server_error',
            code: 'server_error',
          },
        }));
        return;
      }

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
        name: '主人公（莱昂）',
        entityType: 'character',
        aliases: [],
        summary: '以称谓加本名的形式再次指向莱昂。',
        evidence: '主人公（莱昂）与艾琳继续调查黑塔。',
      },
      {
        name: '黑塔',
        entityType: 'location',
        aliases: ['高塔'],
        summary: '艾琳与莱昂联手调查的核心地点。',
        evidence: '两人决定联手调查黑塔。',
      },
      {
        name: '高塔（黑塔）',
        entityType: 'location',
        aliases: [],
        summary: '以别称加本名的形式再次指向黑塔。',
        evidence: '高塔（黑塔）就是两人这次调查的目标。',
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
