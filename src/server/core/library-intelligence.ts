import crypto from 'node:crypto';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createOllama } from 'ai-sdk-ollama';
import neo4j from 'neo4j-driver';

import {
  buildKnowledgeGraphArtifacts,
  collectAssistantSources as collectAssistantSourcesForRag,
  countKnowledgeGraphChunkPlans,
  countReusableKnowledgeGraphCheckpoints,
  type AssistantGraphTraceHit,
  type AssistantRetrievalTrace,
  type KnowledgeGraphBuildExecutionMode,
  createKnowledgeGraphBuildModelStats,
  KnowledgeGraphBuildPausedError,
  type KnowledgeGraphBuildModelStat,
  type KnowledgeGraphBuildProgressEvent,
  type KnowledgeGraphBuildStageEvent,
  type ResolvedCapabilityRoute,
} from './library-intelligence-rag';

import type {
  SqliteNovelRepository,
  StoredKnowledgeGraphBuildRow,
  StoredKnowledgeGraphBuildLogLevel,
  StoredKnowledgeGraphBuildLogRow,
  StoredKnowledgeGraphEntityRow,
  StoredKnowledgeGraphProfileInput,
  StoredKnowledgeGraphProfileRow,
  StoredKnowledgeGraphRelationRow,
} from './novel-repository';
import type {
  LlmModelConfig,
  LlmPreferencesState,
  LlmProviderConfig,
  ModelCapability,
  Neo4jPreferencesState,
  SystemPreferencesService,
} from './system-preferences';
import type { StoredChapterRecord, StoredNovelSnapshot } from './spider';

export type KnowledgeGraphBuildStatus = 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
export type KnowledgeGraphBuildStage = 'idle' | 'extracting' | 'relating' | 'syncing' | 'completed' | 'failed';
export type KnowledgeGraphEntityType = 'character' | 'location' | 'organization' | 'concept' | 'author';
export type KnowledgeGraphRelationType = 'co_occurs' | 'alliance' | 'conflict' | 'family';
export type KnowledgeGraphBuildMode = KnowledgeGraphBuildExecutionMode;

export interface KnowledgeGraphModelRoute {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  source: 'novel' | 'global';
}

export interface KnowledgeGraphNeo4jTarget {
  enabled: boolean;
  source: 'novel' | 'global' | 'none';
  uri: string;
  username: string;
  database: string;
  isConfigured: boolean;
}

export interface LibraryKnowledgeGraphProfileInput {
  chatModel?: { providerId?: string; modelId?: string } | null;
  extractionModels?: Array<{ providerId?: string; modelId?: string; maxConcurrency?: number }> | null;
  embeddingModel?: { providerId?: string; modelId?: string } | null;
  rerankModel?: { providerId?: string; modelId?: string } | null;
  extractionConcurrency?: number;
  neo4j?: {
    enabled?: boolean;
    uri?: string;
    username?: string;
    password?: string;
    database?: string;
  } | null;
}

export interface LibraryKnowledgeGraphProfile {
  chatModel: KnowledgeGraphModelRoute | null;
  extractionModels: Array<KnowledgeGraphModelRoute & { maxConcurrency: number }>;
  embeddingModel: KnowledgeGraphModelRoute | null;
  rerankModel: KnowledgeGraphModelRoute | null;
  extractionConcurrency: number;
  neo4j: KnowledgeGraphNeo4jTarget;
  configLocked: boolean;
  lockedAt: string | null;
  updatedAt: string | null;
}

export interface LibraryKnowledgeGraphBuild {
  status: KnowledgeGraphBuildStatus;
  stage: KnowledgeGraphBuildStage;
  progressPercent: number;
  message: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastBuiltAt: string | null;
  syncedToNeo4jAt: string | null;
  entityCount: number;
  relationCount: number;
  modelStats: KnowledgeGraphBuildModelStat[];
  updatedAt: string | null;
}

export interface LibraryKnowledgeGraphBuildLog {
  id: string;
  stage: KnowledgeGraphBuildStage;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

export interface LibraryKnowledgeGraphEntity {
  id: string;
  name: string;
  entityType: KnowledgeGraphEntityType;
  summary: string;
  prominence: number;
  mentionCount: number;
  mentionChapterIds: string[];
  firstChapterId: string | null;
  lastChapterId: string | null;
  aliases: string[];
}

export interface LibraryKnowledgeGraphRelation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: KnowledgeGraphRelationType;
  summary: string;
  weight: number;
  chapterIds: string[];
  evidence: string[];
}

export interface LibraryKnowledgeGraphState {
  profile: LibraryKnowledgeGraphProfile;
  build: LibraryKnowledgeGraphBuild;
  buildLogs: LibraryKnowledgeGraphBuildLog[];
  namespace: string;
  entities: LibraryKnowledgeGraphEntity[];
  relations: LibraryKnowledgeGraphRelation[];
}

export interface LibraryAssistantSource {
  type: 'metadata' | 'graph' | 'chapter';
  label: string;
  excerpt: string;
  chapterId: string | null;
}

export interface LibraryAssistantResponse {
  mode: 'llm' | 'local';
  message: string;
  sources: LibraryAssistantSource[];
  model: KnowledgeGraphModelRoute | null;
  trace: AssistantRetrievalTrace;
}

export interface Neo4jGraphStoreConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

export interface Neo4jGraphQueryResult {
  hits: AssistantGraphTraceHit[];
  source: LibraryAssistantSource | null;
}

export interface Neo4jGraphStore {
  clearNamespaceGraph(namespace: string, config: Neo4jGraphStoreConfig): Promise<boolean>;
  replaceNamespaceGraph(
    snapshot: StoredNovelSnapshot,
    entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>,
    relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>,
    config: Neo4jGraphStoreConfig,
  ): Promise<void>;
  queryNamespaceGraph(
    namespace: string,
    query: string,
    config: Neo4jGraphStoreConfig,
  ): Promise<Neo4jGraphQueryResult>;
}

export interface AskLibraryAssistantInput {
  sourceId: string;
  novelId: string;
  message: string;
  chapterId?: string;
}

export interface LibraryIntelligenceServiceOptions {
  repository: SqliteNovelRepository;
  preferences: SystemPreferencesService;
  neo4jGraphStore?: Neo4jGraphStore;
}

const STOP_TOKENS = new Set([
  '第一章',
  '第二章',
  '第三章',
  '第四章',
  '第五章',
  '第一卷',
  '第二卷',
  '第三卷',
  '我们',
  '你们',
  '他们',
  '她们',
  '因为',
  '于是',
  '然后',
  '这里',
  '那里',
  '已经',
  '没有',
  '一个',
  '这个',
  '那个',
]);
const TOKEN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]{1,11}/gu;
const MAX_GRAPH_ENTITIES = 128;
const MAX_GRAPH_RELATIONS = 384;
const MAX_ASSISTANT_SOURCES = 6;
const DEFAULT_EXTRACTION_CONCURRENCY = 2;
const MIN_EXTRACTION_CONCURRENCY = 1;
const MAX_EXTRACTION_CONCURRENCY = 12;
const DEFAULT_EXTRACTION_MODEL_CONCURRENCY = 1;
const MIN_EXTRACTION_MODEL_CONCURRENCY = 1;
const MAX_EXTRACTION_MODEL_CONCURRENCY = 12;

interface ActiveKnowledgeGraphBuildState {
  pauseRequested: boolean;
}

type BackgroundBuildMode = 'fresh' | 'resume' | 'recover';

export class LibraryIntelligenceService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #neo4jGraphStore: Neo4jGraphStore;
  readonly #activeBuilds = new Map<string, ActiveKnowledgeGraphBuildState>();

  constructor(options: LibraryIntelligenceServiceOptions) {
    this.#repository = options.repository;
    this.#preferences = options.preferences;
    this.#neo4jGraphStore = options.neo4jGraphStore ?? new DriverNeo4jGraphStore();
    this.restoreResumableBuilds();
  }

  getNovelKnowledgeGraph(sourceId: string, novelId: string): LibraryKnowledgeGraphState | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    return this.buildKnowledgeGraphState(snapshot);
  }

  updateNovelKnowledgeGraphProfile(
    sourceId: string,
    novelId: string,
    input: LibraryKnowledgeGraphProfileInput,
  ): LibraryKnowledgeGraphProfile | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    const current = this.#repository.getKnowledgeGraphProfile(sourceId, novelId);
    const nextInput = mergeProfileInput(current, input);

    if (current?.configLocked && hasProfileChange(current, nextInput)) {
      throw new Error('该书籍的图谱配置已经锁定。如需切换模型或 Neo4j 目标，请先清理现有图谱数据。');
    }

    const stored = this.#repository.saveKnowledgeGraphProfile({
      sourceId,
      novelId,
      ...nextInput,
      configLocked: current?.configLocked ?? false,
      lockedAt: current?.lockedAt ?? null,
    });

    return this.serializeProfile(stored);
  }

  startNovelKnowledgeGraphBuild(
    sourceId: string,
    novelId: string,
    options: { mode?: KnowledgeGraphBuildMode } = {},
  ): LibraryKnowledgeGraphBuild | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    const buildMode = normalizeBuildMode(options.mode);
    const buildKey = createNovelKey(sourceId, novelId);
    const currentBuild = this.reconcileDetachedBuildState(sourceId, novelId);
    if (this.#activeBuilds.has(buildKey) || currentBuild?.status === 'queued' || currentBuild?.status === 'running') {
      return this.serializeBuild(currentBuild ?? createIdleBuild());
    }

    const storedProfile = this.#repository.getKnowledgeGraphProfile(sourceId, novelId);
    const llmState = this.#preferences.getLlmState();
    const extractionModels = resolveExtractionRoutes(llmState, storedProfile);

    this.#repository.clearKnowledgeGraphBuildLogs(sourceId, novelId);
    if (buildMode === 'full') {
      this.#repository.clearKnowledgeGraphBuildCheckpoints(sourceId, novelId);
    }

    const queued = this.#repository.saveKnowledgeGraphBuild({
      sourceId,
      novelId,
      status: 'queued',
      stage: 'idle',
      progressPercent: 0,
      message: buildMode === 'rebuild'
        ? '已进入队列，准备基于已缓存结构重新归并实体和关系。'
        : buildMode === 'full'
          ? '已进入队列，准备全量重建图谱。'
          : '已进入队列，准备增量更新图谱。',
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      lastBuiltAt: currentBuild?.lastBuiltAt ?? null,
      syncedToNeo4jAt: currentBuild?.syncedToNeo4jAt ?? null,
      entityCount: currentBuild?.entityCount ?? 0,
      relationCount: currentBuild?.relationCount ?? 0,
      modelStats: createKnowledgeGraphBuildModelStats(extractionModels),
    });

    this.startBackgroundBuild(snapshot, { mode: 'fresh', buildMode });

    return this.serializeBuild(queued);
  }

  pauseNovelKnowledgeGraphBuild(sourceId: string, novelId: string): LibraryKnowledgeGraphBuild | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    const currentBuild = this.reconcileDetachedBuildState(sourceId, novelId);
    if (!currentBuild || (currentBuild.status !== 'queued' && currentBuild.status !== 'running')) {
      throw new Error('当前没有可暂停的图谱任务。');
    }

    if (currentBuild.stage !== 'idle' && currentBuild.stage !== 'extracting') {
      throw new Error('当前图谱已经进入归并或同步阶段，暂时不能暂停。');
    }

    const buildKey = createNovelKey(sourceId, novelId);
    const activeBuild = this.#activeBuilds.get(buildKey);
    if (!activeBuild) {
      throw new Error('当前图谱任务未在本进程中运行，无法暂停。');
    }

    activeBuild.pauseRequested = true;
    this.writeBuildLog(sourceId, novelId, 'extracting', 'warn', '已收到暂停请求，等待当前片段处理完成后停止。');

    return this.serializeBuild(this.#repository.getKnowledgeGraphBuild(sourceId, novelId) ?? currentBuild);
  }

  resumeNovelKnowledgeGraphBuild(sourceId: string, novelId: string): LibraryKnowledgeGraphBuild | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    const buildKey = createNovelKey(sourceId, novelId);
    const currentBuild = this.reconcileDetachedBuildState(sourceId, novelId);
    if (this.#activeBuilds.has(buildKey) || currentBuild?.status === 'queued' || currentBuild?.status === 'running') {
      return this.serializeBuild(currentBuild ?? createIdleBuild());
    }

    if (currentBuild?.status !== 'paused') {
      throw new Error('当前图谱不在暂停状态，不能继续。');
    }

    const resumed = this.#repository.saveKnowledgeGraphBuild({
      sourceId,
      novelId,
      status: 'queued',
      stage: 'idle',
      progressPercent: currentBuild.progressPercent,
      message: '已继续构建，正在按最新配置接续未完成片段。',
      errorMessage: null,
      startedAt: currentBuild.startedAt,
      completedAt: null,
      lastBuiltAt: currentBuild.lastBuiltAt,
      syncedToNeo4jAt: currentBuild.syncedToNeo4jAt,
      entityCount: currentBuild.entityCount,
      relationCount: currentBuild.relationCount,
      modelStats: currentBuild.modelStats,
    });

    this.writeBuildLog(sourceId, novelId, 'extracting', 'info', '继续图谱构建：将按当前已保存配置接续剩余片段。');
    this.startBackgroundBuild(snapshot, { mode: 'resume', buildMode: 'incremental' });

    return this.serializeBuild(resumed);
  }

  async clearNovelKnowledgeGraph(sourceId: string, novelId: string): Promise<LibraryKnowledgeGraphState | null> {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    const buildKey = createNovelKey(sourceId, novelId);
    const currentBuild = this.reconcileDetachedBuildState(sourceId, novelId);
    if (this.#activeBuilds.has(buildKey) || currentBuild?.status === 'queued' || currentBuild?.status === 'running') {
      throw new Error('当前图谱仍在构建中，暂时不能清空。');
    }

    const profile = this.#repository.getKnowledgeGraphProfile(sourceId, novelId);
    const cleanupNeo4j = resolveNeo4jCleanupConfig(profile, this.#preferences.getNeo4jState());
    const shouldClearNeo4j = Boolean(currentBuild?.syncedToNeo4jAt || resolveNeo4jConfig(profile, this.#preferences.getNeo4jState())?.enabled);
    let clearedNeo4j = false;

    if (shouldClearNeo4j) {
      if (!cleanupNeo4j) {
        throw new Error('当前图谱曾同步到 Neo4j，但缺少可用的清理连接信息。');
      }

      clearedNeo4j = await this.#neo4jGraphStore.clearNamespaceGraph(
        createGraphNamespace(snapshot.sourceId, snapshot.metadata.novelId),
        cleanupNeo4j,
      );
    }

    this.#repository.clearKnowledgeGraph(sourceId, novelId);

    if (profile) {
      this.#repository.saveKnowledgeGraphProfile({
        ...profile,
        configLocked: false,
        lockedAt: null,
      });
    }

    this.#repository.saveKnowledgeGraphBuild({
      sourceId,
      novelId,
      status: 'idle',
      stage: 'idle',
      progressPercent: 0,
      message: clearedNeo4j ? '本地图谱和 Neo4j 子图已清空。' : '本地图谱已清空。',
      errorMessage: null,
      startedAt: null,
      completedAt: new Date().toISOString(),
      lastBuiltAt: null,
      syncedToNeo4jAt: null,
      entityCount: 0,
      relationCount: 0,
      modelStats: [],
    });
    this.writeBuildLog(sourceId, novelId, 'idle', 'info', clearedNeo4j ? '已手动清空本地图谱和 Neo4j 子图。' : '已手动清空本地图谱。');

    return this.buildKnowledgeGraphState(snapshot);
  }

  async askLibraryAssistant(input: AskLibraryAssistantInput): Promise<LibraryAssistantResponse> {
    const snapshot = this.#repository.getSnapshot(input.sourceId, input.novelId);
    if (!snapshot) {
      throw new Error(`Library novel ${input.sourceId}/${input.novelId} was not found.`);
    }

    const graphState = this.buildKnowledgeGraphState(snapshot);
    const storedProfile = this.#repository.getKnowledgeGraphProfile(input.sourceId, input.novelId);
    const llmState = this.#preferences.getLlmState();
    const embeddingModel = resolveCapabilityRoute(
      llmState,
      'embedding',
      storedProfile ? routeFromProfile(storedProfile.embeddingProviderId, storedProfile.embeddingModelId) : null,
    );
    const rerankModel = resolveCapabilityRoute(
      llmState,
      'rerank',
      storedProfile ? routeFromProfile(storedProfile.rerankProviderId, storedProfile.rerankModelId) : null,
    );
    const sourceCollection = await collectAssistantSourcesForRag({
      snapshot,
      query: input.message,
      entities: this.#repository.listKnowledgeGraphEntities(input.sourceId, input.novelId),
      relations: this.#repository.listKnowledgeGraphRelations(input.sourceId, input.novelId),
      chunks: this.#repository.listKnowledgeGraphChunks(input.sourceId, input.novelId),
      embeddingModel,
      rerankModel,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
    const neo4jQuery = await this.queryNeo4jGraph(snapshot, input.message, storedProfile, graphState.build);
    const sources = neo4jQuery.source
      ? [...sourceCollection.sources.filter((source) => source.label !== neo4jQuery.source?.label), neo4jQuery.source].slice(0, MAX_ASSISTANT_SOURCES)
      : sourceCollection.sources;
    const trace: AssistantRetrievalTrace = {
      ...sourceCollection.trace,
      graphHits: neo4jQuery.hits.length > 0
        ? [...neo4jQuery.hits, ...sourceCollection.trace.graphHits]
        : sourceCollection.trace.graphHits,
    };
    const prompt = buildAssistantPrompt(snapshot, graphState, input.message, sources, input.chapterId);
    const model = resolveCapabilityRoute(
      llmState,
      'chat',
      graphState.profile.chatModel ? {
        providerId: graphState.profile.chatModel.providerId,
        modelId: graphState.profile.chatModel.modelId,
      } : null,
    );

    if (!model) {
      return {
        mode: 'local',
        message: buildLocalAssistantAnswer(snapshot, sources, input.message),
        sources,
        model: null,
        trace,
      };
    }

    try {
      const message = await generateChatReply(model.provider, model.model, prompt);
      return {
        mode: 'llm',
        message: message.trim(),
        sources,
        model: serializeCapabilityRoute(model.provider, model.model, model.source),
        trace,
      };
    } catch {
      return {
        mode: 'local',
        message: buildLocalAssistantAnswer(snapshot, sources, input.message),
        sources,
        model: serializeCapabilityRoute(model.provider, model.model, model.source),
        trace,
      };
    }
  }

  private buildKnowledgeGraphState(snapshot: StoredNovelSnapshot): LibraryKnowledgeGraphState {
    const profile = this.#repository.getKnowledgeGraphProfile(snapshot.sourceId, snapshot.metadata.novelId);
    const build = this.reconcileDetachedBuildState(snapshot.sourceId, snapshot.metadata.novelId);

    return {
      profile: this.serializeProfile(profile),
      build: this.serializeBuild(build ?? createIdleBuild()),
      buildLogs: this.#repository.listKnowledgeGraphBuildLogs(snapshot.sourceId, snapshot.metadata.novelId).map(serializeBuildLog),
      namespace: createGraphNamespace(snapshot.sourceId, snapshot.metadata.novelId),
      entities: this.#repository.listKnowledgeGraphEntities(snapshot.sourceId, snapshot.metadata.novelId).map(serializeEntity),
      relations: this.#repository.listKnowledgeGraphRelations(snapshot.sourceId, snapshot.metadata.novelId).map(serializeRelation),
    };
  }

  private serializeProfile(profile: StoredKnowledgeGraphProfileRow | null): LibraryKnowledgeGraphProfile {
    const llmState = this.#preferences.getLlmState();
    const neo4jState = this.#preferences.getNeo4jState();
    const chatModel = resolveCapabilityRoute(llmState, 'chat', profile ? routeFromProfile(profile.chatProviderId, profile.chatModelId) : null);
    const extractionModels = resolveExtractionRoutes(llmState, profile);
    const embeddingModel = resolveCapabilityRoute(llmState, 'embedding', profile ? routeFromProfile(profile.embeddingProviderId, profile.embeddingModelId) : null);
    const rerankModel = resolveCapabilityRoute(llmState, 'rerank', profile ? routeFromProfile(profile.rerankProviderId, profile.rerankModelId) : null);

    return {
      chatModel: chatModel ? serializeCapabilityRoute(chatModel.provider, chatModel.model, chatModel.source) : null,
      extractionModels: extractionModels.map((route) => ({
        ...serializeCapabilityRoute(route.provider, route.model, route.source),
        maxConcurrency: route.maxConcurrency,
      })),
      embeddingModel: embeddingModel ? serializeCapabilityRoute(embeddingModel.provider, embeddingModel.model, embeddingModel.source) : null,
      rerankModel: rerankModel ? serializeCapabilityRoute(rerankModel.provider, rerankModel.model, rerankModel.source) : null,
      extractionConcurrency: normalizeExtractionConcurrency(profile?.extractionConcurrency),
      neo4j: resolveNeo4jTarget(profile, neo4jState),
      configLocked: profile?.configLocked ?? false,
      lockedAt: profile?.lockedAt ?? null,
      updatedAt: profile?.updatedAt ?? null,
    };
  }

  private serializeBuild(build: StoredKnowledgeGraphBuildRow): LibraryKnowledgeGraphBuild {
    return {
      status: build.status,
      stage: build.stage,
      progressPercent: build.progressPercent,
      message: build.message,
      errorMessage: build.errorMessage,
      startedAt: build.startedAt,
      completedAt: build.completedAt,
      lastBuiltAt: build.lastBuiltAt,
      syncedToNeo4jAt: build.syncedToNeo4jAt,
      entityCount: build.entityCount,
      relationCount: build.relationCount,
      modelStats: build.modelStats,
      updatedAt: build.updatedAt,
    };
  }

  private reconcileDetachedBuildState(sourceId: string, novelId: string): StoredKnowledgeGraphBuildRow | null {
    const currentBuild = this.#repository.getKnowledgeGraphBuild(sourceId, novelId);
    if (!currentBuild || (currentBuild.status !== 'queued' && currentBuild.status !== 'running')) {
      return currentBuild;
    }

    const buildKey = createNovelKey(sourceId, novelId);
    if (this.#activeBuilds.has(buildKey)) {
      return currentBuild;
    }

    const completedAt = new Date().toISOString();
    const recovered = this.#repository.saveKnowledgeGraphBuild({
      sourceId,
      novelId,
      status: 'failed',
      stage: 'failed',
      progressPercent: currentBuild.progressPercent,
      message: '检测到上一次图谱任务已中断，当前已按失败状态恢复。',
      errorMessage: currentBuild.errorMessage ?? '旧的图谱构建任务没有在当前服务进程中继续执行，通常是服务重启或任务异常退出导致。',
      startedAt: currentBuild.startedAt,
      completedAt,
      lastBuiltAt: currentBuild.lastBuiltAt,
      syncedToNeo4jAt: currentBuild.syncedToNeo4jAt,
      entityCount: currentBuild.entityCount,
      relationCount: currentBuild.relationCount,
      modelStats: resetVolatileModelStats(currentBuild.modelStats),
    });

    this.writeBuildLog(
      sourceId,
      novelId,
      'failed',
      'warn',
      '检测到数据库中遗留的 queued/running 图谱记录，但当前进程内没有对应任务，已自动恢复为失败状态。',
    );

    return recovered;
  }

  private saveBuildState(input: {
    sourceId: string;
    novelId: string;
    status: KnowledgeGraphBuildStatus;
    stage: KnowledgeGraphBuildStage;
    progressPercent: number;
    message: string;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    lastBuiltAt: string | null;
    syncedToNeo4jAt: string | null;
    entityCount: number;
    relationCount: number;
    modelStats?: KnowledgeGraphBuildModelStat[];
  }): void {
    const currentBuild = this.#repository.getKnowledgeGraphBuild(input.sourceId, input.novelId);
    this.#repository.saveKnowledgeGraphBuild({
      ...input,
      modelStats: input.modelStats ?? currentBuild?.modelStats ?? [],
    });
  }

  private writeBuildLog(
    sourceId: string,
    novelId: string,
    stage: KnowledgeGraphBuildStage,
    level: StoredKnowledgeGraphBuildLogLevel,
    message: string,
  ): void {
    this.#repository.appendKnowledgeGraphBuildLog({
      sourceId,
      novelId,
      stage,
      level,
      message,
    });

    const prefix = `[graph:${sourceId}/${novelId}]`;
    if (level === 'error') {
      console.error(prefix, message);
      return;
    }

    if (level === 'warn') {
      console.warn(prefix, message);
      return;
    }

    console.info(prefix, message);
  }

  private async runBuild(snapshot: StoredNovelSnapshot): Promise<void> {
    return this.runBuildInternal(snapshot, { mode: 'fresh', buildMode: 'incremental' }, { pauseRequested: false });
  }

  private restoreResumableBuilds(): void {
    for (const entry of this.#repository.listResumableKnowledgeGraphBuilds()) {
      const checkpoints = this.#repository.listKnowledgeGraphBuildCheckpoints(entry.sourceId, entry.novelId);
      if (checkpoints.length === 0) {
        continue;
      }

      const snapshot = this.#repository.getSnapshot(entry.sourceId, entry.novelId);
      if (!snapshot) {
        continue;
      }

      this.startBackgroundBuild(snapshot, { mode: 'recover', buildMode: 'incremental' });
    }
  }

  private startBackgroundBuild(snapshot: StoredNovelSnapshot, options: { mode: BackgroundBuildMode; buildMode: KnowledgeGraphBuildMode }): void {
    const buildKey = createNovelKey(snapshot.sourceId, snapshot.metadata.novelId);
    if (this.#activeBuilds.has(buildKey)) {
      return;
    }

    const runtimeState: ActiveKnowledgeGraphBuildState = {
      pauseRequested: false,
    };
    this.#activeBuilds.set(buildKey, runtimeState);
    queueMicrotask(() => {
      void this.runBuildInternal(snapshot, options, runtimeState).finally(() => {
        this.#activeBuilds.delete(buildKey);
      });
    });
  }

  private async runBuildInternal(
    snapshot: StoredNovelSnapshot,
    options: { mode: BackgroundBuildMode; buildMode: KnowledgeGraphBuildMode },
    runtimeState: ActiveKnowledgeGraphBuildState,
  ): Promise<void> {
    const sourceId = snapshot.sourceId;
    const novelId = snapshot.metadata.novelId;
    const existingBuild = this.#repository.getKnowledgeGraphBuild(sourceId, novelId);
    const startedAt = options.mode === 'fresh' ? new Date().toISOString() : existingBuild?.startedAt ?? new Date().toISOString();
    const previousBuild = this.#repository.getKnowledgeGraphBuild(sourceId, novelId);
    const storedProfile = this.#repository.getKnowledgeGraphProfile(sourceId, novelId);
    const llmState = this.#preferences.getLlmState();
    const extractionModels = resolveExtractionRoutes(llmState, storedProfile);
    const embeddingModel = resolveCapabilityRoute(
      llmState,
      'embedding',
      storedProfile ? routeFromProfile(storedProfile.embeddingProviderId, storedProfile.embeddingModelId) : null,
    );
    const checkpoints = this.#repository.listKnowledgeGraphBuildCheckpoints(sourceId, novelId);
    const totalChunkCount = countKnowledgeGraphChunkPlans(snapshot);
    const reusableCheckpointCount = options.buildMode === 'full'
      ? 0
      : countReusableKnowledgeGraphCheckpoints(snapshot, checkpoints);
    const hasFullCheckpointCoverage = totalChunkCount > 0 && reusableCheckpointCount >= totalChunkCount;
    const extractionConcurrency = normalizeExtractionConcurrency(storedProfile?.extractionConcurrency);
    const initialModelStats = createKnowledgeGraphBuildModelStats(extractionModels);
    const resumedModelStats = existingBuild?.modelStats.length ? resetVolatileModelStats(existingBuild.modelStats) : initialModelStats;
    const pendingChunkCount = Math.max(totalChunkCount - reusableCheckpointCount, 0);

    const totalDownloadedChapters = snapshot.chapters.filter((chapter) => chapter.status === 'downloaded' && chapter.content).length;

    this.saveBuildState({
      sourceId,
      novelId,
      status: 'running',
      stage: hasFullCheckpointCoverage ? 'relating' : 'extracting',
      progressPercent: hasFullCheckpointCoverage ? 62 : 10,
      message: hasFullCheckpointCoverage
        ? embeddingModel
          ? `已复用 ${reusableCheckpointCount} 个片段缓存，正在归并关系并写入向量索引。`
          : `已复用 ${reusableCheckpointCount} 个片段缓存，正在归并关系与证据。`
        : options.mode === 'recover'
          ? reusableCheckpointCount > 0
            ? `正在恢复上次中断的图谱构建，已接续 ${reusableCheckpointCount} 个片段。`
            : '正在恢复上次中断的图谱构建，并重新接管抽取任务。'
          : options.mode === 'resume'
            ? reusableCheckpointCount > 0
              ? `正在继续上次暂停的图谱构建，已接续 ${reusableCheckpointCount} 个片段，并按最新配置处理剩余内容。`
              : '正在继续上次暂停的图谱构建，并按最新配置重新接管抽取任务。'
            : options.buildMode === 'rebuild'
              ? '正在基于已缓存结构重新归并实体关系，无需重新抽取章节片段。'
              : options.buildMode === 'full'
                ? extractionModels.length > 0
                  ? `正在全量重建图谱：重新解析 ${totalDownloadedChapters} 个已下载章节，抽取模型 ${extractionModels.length} 个，全局并发 ${extractionConcurrency}。`
                  : '正在全量重建图谱，当前只使用本地规则。'
                : reusableCheckpointCount > 0
                  ? `正在增量更新图谱：复用 ${reusableCheckpointCount} 个片段缓存，仅补处理 ${pendingChunkCount} 个片段。`
                  : extractionModels.length > 0
                    ? `正在增量更新图谱：当前没有可复用缓存，将解析 ${totalDownloadedChapters} 个已下载章节，抽取模型 ${extractionModels.length} 个，全局并发 ${extractionConcurrency}。`
                    : '正在增量更新图谱，当前只使用本地规则。',
      errorMessage: null,
      startedAt,
      completedAt: null,
      lastBuiltAt: null,
      syncedToNeo4jAt: null,
      entityCount: 0,
      relationCount: 0,
      modelStats: resumedModelStats,
    });
    if (hasFullCheckpointCoverage) {
      this.writeBuildLog(
        sourceId,
        novelId,
        'relating',
        options.mode === 'recover' ? 'warn' : 'info',
        options.mode === 'recover'
          ? `检测到全部 ${reusableCheckpointCount} 个片段缓存已齐，已直接恢复到关系归并阶段。`
          : `继续图谱构建：全部 ${reusableCheckpointCount} 个片段已完成抽取，当前直接进入关系归并阶段。`,
      );
    } else if (options.mode === 'recover') {
      this.writeBuildLog(
        sourceId,
        novelId,
        'extracting',
        'warn',
        reusableCheckpointCount > 0
          ? `检测到服务重启或任务中断，已自动恢复图谱构建，并从 ${reusableCheckpointCount} 个已完成片段继续。`
          : '检测到服务重启或任务中断，已自动恢复图谱构建，并从头重新接管抽取任务。',
      );
    } else if (options.mode === 'resume') {
      this.writeBuildLog(
        sourceId,
        novelId,
        'extracting',
        'info',
        reusableCheckpointCount > 0
          ? `继续图谱构建：已从 ${reusableCheckpointCount} 个已完成片段接续，并按当前配置处理剩余片段。`
          : '继续图谱构建：将按当前配置重新接管剩余抽取任务。',
      );
    } else {
      this.writeBuildLog(
        sourceId,
        novelId,
        'extracting',
        'info',
        options.buildMode === 'rebuild'
          ? `重建开始：已复用 ${reusableCheckpointCount} 个片段缓存，准备重新归并实体关系。`
          : options.buildMode === 'full'
            ? extractionModels.length > 0
              ? `全量重建开始：准备重新解析 ${totalDownloadedChapters} 个已下载章节，抽取模型 ${extractionModels.length} 个，全局并发 ${extractionConcurrency}。`
              : `全量重建开始：准备重新解析 ${totalDownloadedChapters} 个已下载章节，当前只使用本地规则。`
            : reusableCheckpointCount > 0
              ? `增量更新开始：复用 ${reusableCheckpointCount} 个片段缓存，仅补处理 ${pendingChunkCount} 个片段。`
              : extractionModels.length > 0
                ? `增量更新开始：暂无可复用缓存，准备解析 ${totalDownloadedChapters} 个已下载章节，抽取模型 ${extractionModels.length} 个，全局并发 ${extractionConcurrency}。`
                : `增量更新开始：暂无可复用缓存，当前只使用本地规则。`,
      );
    }

    try {
      const extracted = await buildKnowledgeGraphArtifacts({
        snapshot,
        extractionModels,
        embeddingModel,
        checkpoints,
        mode: options.buildMode,
        extractionConcurrency,
        startedAt,
        ...(existingBuild?.modelStats ? { modelStatsSeed: existingBuild.modelStats } : {}),
        shouldPause: () => runtimeState.pauseRequested,
        onCheckpoint: async (checkpoint) => {
          this.#repository.saveKnowledgeGraphBuildCheckpoint({
            sourceId,
            novelId,
            chunkId: checkpoint.chunkId,
            chapterId: checkpoint.chapterId,
            chapterIndex: checkpoint.chapterIndex,
            chunkIndex: checkpoint.chunkIndex,
            chapterTitle: checkpoint.chapterTitle,
            extractionJson: checkpoint.extractionJson,
            warningMessage: checkpoint.warningMessage,
          });
        },
        onProgress: async (event) => {
          await this.handleBuildExtractionProgress(sourceId, novelId, startedAt, event);
        },
        onStageProgress: async (event) => {
          await this.handleBuildStageProgress(sourceId, novelId, startedAt, event, resumedModelStats);
        },
      });

      this.saveBuildState({
        sourceId,
        novelId,
        status: 'running',
        stage: 'relating',
        progressPercent: 62,
        message: extracted.usedEmbeddingIndex
          ? `已识别 ${extracted.entities.length} 个实体，正在写入关系和向量索引。`
          : `已识别 ${extracted.entities.length} 个实体，正在归并关系与证据。`,
        errorMessage: null,
        startedAt,
        completedAt: null,
        lastBuiltAt: null,
        syncedToNeo4jAt: null,
        entityCount: extracted.entities.length,
        relationCount: extracted.relations.length,
        modelStats: extracted.diagnostics.modelStats,
      });
      this.writeBuildLog(
        sourceId,
        novelId,
        'relating',
        'info',
        `抽取结束：共处理 ${extracted.diagnostics.totalChunks} 个片段，结构化成功 ${extracted.diagnostics.llmSuccessCount} 个，回退 ${extracted.diagnostics.fallbackCount} 个。`,
      );

      this.saveBuildState({
        sourceId,
        novelId,
        status: 'running',
        stage: 'relating',
        progressPercent: 78,
        message: `关系归并完成，正在写入本地图谱与 ${extracted.chunks.length} 个片段索引。`,
        errorMessage: null,
        startedAt,
        completedAt: null,
        lastBuiltAt: null,
        syncedToNeo4jAt: null,
        entityCount: extracted.entities.length,
        relationCount: extracted.relations.length,
        modelStats: extracted.diagnostics.modelStats,
      });
      this.writeBuildLog(
        sourceId,
        novelId,
        'relating',
        'info',
        `开始写入本地图谱：${extracted.entities.length} 个实体，${extracted.relations.length} 条关系，${extracted.chunks.length} 个片段索引。`,
      );

      this.#repository.replaceKnowledgeGraph(sourceId, novelId, extracted.entities, extracted.relations, extracted.chunks);
      this.#repository.replaceKnowledgeGraphBuildCheckpoints(sourceId, novelId, extracted.checkpoints);
      this.writeBuildLog(
        sourceId,
        novelId,
        'relating',
        'info',
        `本地图谱已写入：${extracted.entities.length} 个实体，${extracted.relations.length} 条关系，${extracted.chunks.length} 个片段索引；已刷新 ${extracted.checkpoints.length} 个结构缓存。`,
      );

      let syncedToNeo4jAt: string | null = null;
      let staleNeo4jGraphCleared = false;
      const namespace = createGraphNamespace(snapshot.sourceId, snapshot.metadata.novelId);
      const resolvedNeo4j = resolveNeo4jConfig(
        this.#repository.getKnowledgeGraphProfile(sourceId, novelId),
        this.#preferences.getNeo4jState(),
      );
      const cleanupNeo4j = resolveNeo4jCleanupConfig(
        this.#repository.getKnowledgeGraphProfile(sourceId, novelId),
        this.#preferences.getNeo4jState(),
      );

      if (cleanupNeo4j && (Boolean(previousBuild?.syncedToNeo4jAt) || Boolean(resolvedNeo4j?.enabled))) {
        this.saveBuildState({
          sourceId,
          novelId,
          status: 'running',
          stage: 'syncing',
          progressPercent: 80,
          message: resolvedNeo4j?.enabled
            ? '正在清理旧版 Neo4j 子图并准备写入新结果。'
            : '正在清理 Neo4j 中的旧版图谱。',
          errorMessage: null,
          startedAt,
          completedAt: null,
          lastBuiltAt: null,
          syncedToNeo4jAt: null,
          entityCount: extracted.entities.length,
          relationCount: extracted.relations.length,
          modelStats: extracted.diagnostics.modelStats,
        });
        this.writeBuildLog(
          sourceId,
          novelId,
          'syncing',
          'info',
          resolvedNeo4j?.enabled
            ? `开始清理旧版 Neo4j 子图，命名空间 ${namespace}，随后写入新结果。`
            : `开始清理 Neo4j 中的旧版图谱，命名空间 ${namespace}。`,
        );
        staleNeo4jGraphCleared = await this.#neo4jGraphStore.clearNamespaceGraph(
          namespace,
          cleanupNeo4j,
        );
        this.writeBuildLog(
          sourceId,
          novelId,
          'syncing',
          'info',
          staleNeo4jGraphCleared
            ? `旧版 Neo4j 子图清理完成：命名空间 ${namespace}。`
            : `Neo4j 中未发现需要清理的旧子图：命名空间 ${namespace}。`,
        );
      }

      if (resolvedNeo4j?.enabled && resolvedNeo4j.uri && resolvedNeo4j.username) {
        this.saveBuildState({
          sourceId,
          novelId,
          status: 'running',
          stage: 'syncing',
          progressPercent: 84,
          message: '本地图谱已生成，正在同步到 Neo4j。',
          errorMessage: null,
          startedAt,
          completedAt: null,
          lastBuiltAt: null,
          syncedToNeo4jAt: null,
          entityCount: extracted.entities.length,
          relationCount: extracted.relations.length,
          modelStats: extracted.diagnostics.modelStats,
        });
        this.writeBuildLog(
          sourceId,
          novelId,
          'syncing',
          'info',
          `开始同步 Neo4j 子图：命名空间 ${namespace}，${extracted.entities.length} 个实体，${extracted.relations.length} 条关系。`,
        );

        await this.#neo4jGraphStore.replaceNamespaceGraph(snapshot, extracted.entities, extracted.relations, resolvedNeo4j);
        syncedToNeo4jAt = new Date().toISOString();
        this.writeBuildLog(
          sourceId,
          novelId,
          'syncing',
          'info',
          `Neo4j 子图同步完成：命名空间 ${namespace}，可按 sourceId=${snapshot.sourceId}、novelId=${snapshot.metadata.novelId} 过滤查看。`,
        );
      }

      const completedAt = new Date().toISOString();
      this.saveBuildState({
        sourceId,
        novelId,
        status: 'completed',
        stage: 'completed',
        progressPercent: 100,
        message: syncedToNeo4jAt
          ? extracted.usedEmbeddingIndex
            ? 'AI 图谱、向量索引已构建完成，并已同步到 Neo4j。'
            : 'AI 图谱已构建完成，并已同步到 Neo4j。'
          : staleNeo4jGraphCleared
            ? extracted.usedEmbeddingIndex
              ? 'AI 图谱与向量索引构建完成，旧版 Neo4j 图谱已清理。'
              : extracted.usedLlmExtraction
                ? 'AI 图谱构建完成，旧版 Neo4j 图谱已清理。'
                : '基础图谱构建完成，旧版 Neo4j 图谱已清理。'
          : extracted.usedEmbeddingIndex
            ? 'AI 图谱与向量索引构建完成，当前保存在本地书库。'
            : extracted.usedLlmExtraction
              ? 'AI 图谱构建完成，当前保存在本地书库。'
              : '基础图谱构建完成，当前保存在本地书库。',
        errorMessage: null,
        startedAt,
        completedAt,
        lastBuiltAt: completedAt,
        syncedToNeo4jAt,
        entityCount: extracted.entities.length,
        relationCount: extracted.relations.length,
        modelStats: extracted.diagnostics.modelStats,
      });
      this.writeBuildLog(sourceId, novelId, 'completed', 'info', `图谱构建完成：${extracted.entities.length} 个实体，${extracted.relations.length} 条关系。`);

      this.#repository.saveKnowledgeGraphProfile(
        freezeProfile(
          snapshot,
          this.#repository.getKnowledgeGraphProfile(sourceId, novelId),
          this.#preferences.getLlmState(),
          this.#preferences.getNeo4jState(),
        ),
      );
      this.writeBuildLog(sourceId, novelId, 'completed', 'info', '本次图谱配置已冻结；后续若需调整，请先暂停或重新发起构建。');
    } catch (error) {
      if (error instanceof KnowledgeGraphBuildPausedError) {
        const currentBuild = this.#repository.getKnowledgeGraphBuild(sourceId, novelId);
        const completedAt = new Date().toISOString();
        this.saveBuildState({
          sourceId,
          novelId,
          status: 'paused',
          stage: currentBuild?.stage === 'idle' ? 'extracting' : currentBuild?.stage ?? 'extracting',
          progressPercent: currentBuild?.progressPercent ?? 10,
          message: '图谱构建已暂停，可先调整配置，再继续当前任务。',
          errorMessage: null,
          startedAt,
          completedAt,
          lastBuiltAt: previousBuild?.lastBuiltAt ?? null,
          syncedToNeo4jAt: previousBuild?.syncedToNeo4jAt ?? null,
          entityCount: currentBuild?.entityCount ?? 0,
          relationCount: currentBuild?.relationCount ?? 0,
          modelStats: currentBuild?.modelStats ?? resumedModelStats,
        });
        this.writeBuildLog(sourceId, novelId, 'extracting', 'warn', '图谱构建已暂停，已完成的片段会保留，后续可按最新配置继续。');
        return;
      }

      const message = error instanceof Error ? error.message : 'Knowledge graph build failed.';
      this.saveBuildState({
        sourceId,
        novelId,
        status: 'failed',
        stage: 'failed',
        progressPercent: 100,
        message: '图谱构建失败，请检查模型或 Neo4j 设置。',
        errorMessage: message,
        startedAt,
        completedAt: new Date().toISOString(),
        lastBuiltAt: null,
        syncedToNeo4jAt: null,
        entityCount: 0,
        relationCount: 0,
        modelStats: resumedModelStats,
      });
      this.writeBuildLog(sourceId, novelId, 'failed', 'error', `图谱构建失败：${message}`);
    }
  }

  private async handleBuildExtractionProgress(
    sourceId: string,
    novelId: string,
    startedAt: string,
    event: KnowledgeGraphBuildProgressEvent,
  ): Promise<void> {
    const progressBase = event.phase === 'started'
      ? Math.max(event.processedChunks, event.chunkNumber - 0.5)
      : event.processedChunks;
    const progressPercent = Number(Math.max(10, Math.min(58, 10 + ((progressBase / Math.max(event.totalChunks, 1)) * 48))).toFixed(2));
    if (event.phase === 'started') {
      const message = event.mode === 'llm'
        ? `正在请求结构化抽取：片段 ${event.chunkNumber}/${event.totalChunks}，${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。`
        : `正在整理片段 ${event.chunkNumber}/${event.totalChunks}：${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。`;

      this.saveBuildState({
        sourceId,
        novelId,
        status: 'running',
        stage: 'extracting',
        progressPercent,
        message,
        errorMessage: null,
        startedAt,
        completedAt: null,
        lastBuiltAt: null,
        syncedToNeo4jAt: null,
        entityCount: 0,
        relationCount: 0,
        modelStats: event.modelStats,
      });

      this.writeBuildLog(
        sourceId,
        novelId,
        'extracting',
        'info',
        event.mode === 'llm'
          ? `开始解析片段 ${event.chunkNumber}/${event.totalChunks}：${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。`
          : `开始整理片段 ${event.chunkNumber}/${event.totalChunks}：${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。`,
      );
      return;
    }

    const message = event.mode === 'llm'
      ? `正在解析片段 ${event.processedChunks}/${event.totalChunks}：${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。`
      : `片段 ${event.processedChunks}/${event.totalChunks} 结构化抽取失败，已回退本地规则：${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。`;

    this.saveBuildState({
      sourceId,
      novelId,
      status: 'running',
      stage: 'extracting',
      progressPercent,
      message,
      errorMessage: event.warning,
      startedAt,
      completedAt: null,
      lastBuiltAt: null,
      syncedToNeo4jAt: null,
      entityCount: 0,
      relationCount: 0,
      modelStats: event.modelStats,
    });

    const shouldLogCheckpoint = event.processedChunks === 1 || event.processedChunks === event.totalChunks || event.processedChunks % 5 === 0;
    if (event.warning) {
      this.writeBuildLog(
        sourceId,
        novelId,
        'extracting',
        'warn',
        `片段 ${event.processedChunks}/${event.totalChunks} 回退本地规则：${event.chapterTitle} · 第 ${event.chunkIndex + 1} 段。原因：${event.warning}`,
      );
      return;
    }

    if (shouldLogCheckpoint) {
      this.writeBuildLog(
        sourceId,
        novelId,
        'extracting',
        'info',
        `已完成 ${event.processedChunks}/${event.totalChunks} 个片段；结构化成功 ${event.llmSuccessCount} 个，回退 ${event.fallbackCount} 个。`,
      );
    }
  }

  private async handleBuildStageProgress(
    sourceId: string,
    novelId: string,
    startedAt: string,
    event: KnowledgeGraphBuildStageEvent,
    modelStats: KnowledgeGraphBuildModelStat[],
  ): Promise<void> {
    const currentBuild = this.#repository.getKnowledgeGraphBuild(sourceId, novelId);
    this.saveBuildState({
      sourceId,
      novelId,
      status: 'running',
      stage: event.stage,
      progressPercent: event.progressPercent,
      message: event.message,
      errorMessage: null,
      startedAt,
      completedAt: null,
      lastBuiltAt: null,
      syncedToNeo4jAt: null,
      entityCount: currentBuild?.entityCount ?? 0,
      relationCount: currentBuild?.relationCount ?? 0,
      modelStats,
    });
    this.writeBuildLog(sourceId, novelId, event.stage, 'info', event.message);
  }

  private async queryNeo4jGraph(
    snapshot: StoredNovelSnapshot,
    query: string,
    profile: StoredKnowledgeGraphProfileRow | null,
    build: LibraryKnowledgeGraphBuild,
  ): Promise<Neo4jGraphQueryResult> {
    if (!build.syncedToNeo4jAt) {
      return { hits: [], source: null };
    }

    const cleanupConfig = resolveNeo4jCleanupConfig(profile, this.#preferences.getNeo4jState());
    if (!cleanupConfig) {
      return { hits: [], source: null };
    }

    try {
      return await this.#neo4jGraphStore.queryNamespaceGraph(
        createGraphNamespace(snapshot.sourceId, snapshot.metadata.novelId),
        query,
        cleanupConfig,
      );
    } catch {
      return { hits: [], source: null };
    }
  }
}

function createIdleBuild(): StoredKnowledgeGraphBuildRow {
  return {
    status: 'idle',
    stage: 'idle',
    progressPercent: 0,
    message: '图谱尚未开始构建。',
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    lastBuiltAt: null,
    syncedToNeo4jAt: null,
    entityCount: 0,
    relationCount: 0,
    modelStats: [],
    updatedAt: null,
  };
}

function resetVolatileModelStats(stats: KnowledgeGraphBuildModelStat[]): KnowledgeGraphBuildModelStat[] {
  return stats.map((entry) => ({
    ...entry,
    inFlightCount: 0,
    consecutiveFailures: 0,
    circuitState: 'closed',
    cooldownUntil: null,
    firstAttemptAt: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    recentSuccessAt: [],
    throughputPerMinute: 0,
  }));
}

function mergeProfileInput(
  current: StoredKnowledgeGraphProfileRow | null,
  input: LibraryKnowledgeGraphProfileInput,
): Omit<StoredKnowledgeGraphProfileInput, 'sourceId' | 'novelId' | 'configLocked' | 'lockedAt'> {
  return {
    chatProviderId: input.chatModel?.providerId?.trim() ?? current?.chatProviderId ?? '',
    chatModelId: input.chatModel?.modelId?.trim() ?? current?.chatModelId ?? '',
    extractionModels: normalizeExtractionModelPool(input.extractionModels ?? current?.extractionModels),
    embeddingProviderId: input.embeddingModel?.providerId?.trim() ?? current?.embeddingProviderId ?? '',
    embeddingModelId: input.embeddingModel?.modelId?.trim() ?? current?.embeddingModelId ?? '',
    rerankProviderId: input.rerankModel?.providerId?.trim() ?? current?.rerankProviderId ?? '',
    rerankModelId: input.rerankModel?.modelId?.trim() ?? current?.rerankModelId ?? '',
    extractionConcurrency: normalizeExtractionConcurrency(input.extractionConcurrency ?? current?.extractionConcurrency),
    neo4jEnabled: input.neo4j?.enabled ?? current?.neo4jEnabled ?? false,
    neo4jUri: input.neo4j?.uri?.trim() ?? current?.neo4jUri ?? '',
    neo4jUsername: input.neo4j?.username?.trim() ?? current?.neo4jUsername ?? '',
    neo4jPassword: input.neo4j?.password?.trim() ?? current?.neo4jPassword ?? '',
    neo4jDatabase: input.neo4j?.database?.trim() ?? current?.neo4jDatabase ?? '',
  };
}

function hasProfileChange(
  current: StoredKnowledgeGraphProfileRow,
  next: Omit<StoredKnowledgeGraphProfileInput, 'sourceId' | 'novelId' | 'configLocked' | 'lockedAt'>,
): boolean {
  return (
    current.chatProviderId !== next.chatProviderId ||
    current.chatModelId !== next.chatModelId ||
    !isExtractionModelPoolEqual(current.extractionModels, next.extractionModels) ||
    current.embeddingProviderId !== next.embeddingProviderId ||
    current.embeddingModelId !== next.embeddingModelId ||
    current.rerankProviderId !== next.rerankProviderId ||
    current.rerankModelId !== next.rerankModelId ||
    current.extractionConcurrency !== next.extractionConcurrency ||
    current.neo4jEnabled !== next.neo4jEnabled ||
    current.neo4jUri !== next.neo4jUri ||
    current.neo4jUsername !== next.neo4jUsername ||
    current.neo4jPassword !== next.neo4jPassword ||
    current.neo4jDatabase !== next.neo4jDatabase
  );
}

function routeFromProfile(providerId: string, modelId: string): { providerId: string; modelId: string } | null {
  return providerId && modelId ? { providerId, modelId } : null;
}

function resolveCapabilityRoute(
  state: LlmPreferencesState,
  capability: ModelCapability,
  override: { providerId: string; modelId: string } | null,
): { provider: LlmProviderConfig; model: LlmModelConfig; source: 'novel' | 'global' } | null {
  if (override) {
    const provider = state.providers.find((entry) => entry.id === override.providerId && entry.enabled);
    const model = provider?.models.find((entry) => entry.id === override.modelId && entry.enabled);
    if (provider && model) {
      return { provider, model, source: 'novel' };
    }
  }

  for (const provider of state.providers) {
    if (!provider.enabled) {
      continue;
    }

    const preferred = provider.models.find(
      (model) => model.enabled && model.defaultFor.includes(capability) && model.resolvedCapabilities.includes(capability),
    );
    if (preferred) {
      return { provider, model: preferred, source: 'global' };
    }
  }

  for (const provider of state.providers) {
    if (!provider.enabled) {
      continue;
    }

    const fallback = provider.models.find(
      (model) => model.enabled && model.resolvedCapabilities.includes(capability),
    );
    if (fallback) {
      return { provider, model: fallback, source: 'global' };
    }
  }

  return null;
}

function serializeCapabilityRoute(
  provider: LlmProviderConfig,
  model: LlmModelConfig,
  source: 'novel' | 'global',
): KnowledgeGraphModelRoute {
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    modelId: model.id,
    modelLabel: model.label,
    source,
  };
}

async function generateChatReply(provider: LlmProviderConfig, model: LlmModelConfig, prompt: string): Promise<string> {
  switch (provider.type) {
    case 'openai-compatible': {
      const factory = createOpenAI({
        apiKey: provider.apiKey,
        baseURL: buildProviderApiBaseUrl(provider),
        ...(provider.organization ? { organization: provider.organization } : {}),
      });
      const result = await generateText({ model: factory.chat(model.modelId), prompt, maxOutputTokens: 720 });
      return result.text;
    }
    case 'anthropic': {
      const factory = createAnthropic({ apiKey: provider.apiKey, baseURL: normalizeBaseUrl(provider.baseUrl) });
      const result = await generateText({ model: factory(model.modelId), prompt, maxOutputTokens: 720 });
      return result.text;
    }
    case 'google-generative-ai': {
      const factory = createGoogleGenerativeAI({ apiKey: provider.apiKey, baseURL: normalizeBaseUrl(provider.baseUrl) });
      const result = await generateText({ model: factory(model.modelId), prompt, maxOutputTokens: 720 });
      return result.text;
    }
    case 'ollama': {
      const factory = createOllama({ baseURL: normalizeBaseUrl(provider.baseUrl), ...(provider.apiKey ? { apiKey: provider.apiKey } : {}) });
      const result = await generateText({ model: factory.chat(model.modelId), prompt, maxOutputTokens: 720 });
      return result.text;
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = new URL(baseUrl).toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function buildProviderApiBaseUrl(provider: Pick<LlmProviderConfig, 'type' | 'baseUrl'>): string {
  const normalizedBaseUrl = normalizeBaseUrl(provider.baseUrl);

  if (provider.type !== 'openai-compatible') {
    return normalizedBaseUrl;
  }

  const url = new URL(normalizedBaseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (normalizedPath.length === 0) {
    url.pathname = '/v1';
    return url.toString().replace(/\/$/, '');
  }

  return normalizedBaseUrl;
}

function resolveNeo4jTarget(
  profile: StoredKnowledgeGraphProfileRow | null,
  neo4jState: Neo4jPreferencesState,
): KnowledgeGraphNeo4jTarget {
  if (profile?.neo4jEnabled) {
    return {
      enabled: true,
      source: 'novel',
      uri: profile.neo4jUri,
      username: profile.neo4jUsername,
      database: profile.neo4jDatabase,
      isConfigured: Boolean(profile.neo4jUri && profile.neo4jUsername),
    };
  }

  if (neo4jState.config.enabled) {
    return {
      enabled: true,
      source: 'global',
      uri: neo4jState.config.uri,
      username: neo4jState.config.username,
      database: neo4jState.config.database,
      isConfigured: neo4jState.config.isConfigured,
    };
  }

  return {
    enabled: false,
    source: 'none',
    uri: '',
    username: '',
    database: '',
    isConfigured: false,
  };
}

function resolveNeo4jConfig(
  profile: StoredKnowledgeGraphProfileRow | null,
  neo4jState: Neo4jPreferencesState,
): {
  enabled: boolean;
  uri: string;
  username: string;
  password: string;
  database: string;
} | null {
  if (profile?.neo4jEnabled) {
    return {
      enabled: true,
      uri: profile.neo4jUri,
      username: profile.neo4jUsername,
      password: profile.neo4jPassword,
      database: profile.neo4jDatabase,
    };
  }

  if (!neo4jState.config.enabled) {
    return null;
  }

  return {
    enabled: true,
    uri: neo4jState.config.uri,
    username: neo4jState.config.username,
    password: neo4jState.config.password,
    database: neo4jState.config.database,
  };
}

function resolveNeo4jCleanupConfig(
  profile: StoredKnowledgeGraphProfileRow | null,
  neo4jState: Neo4jPreferencesState,
): Neo4jGraphStoreConfig | null {
  if (profile?.neo4jUri && profile.neo4jUsername) {
    return {
      uri: profile.neo4jUri,
      username: profile.neo4jUsername,
      password: profile.neo4jPassword,
      database: profile.neo4jDatabase,
    };
  }

  if (neo4jState.config.uri && neo4jState.config.username) {
    return {
      uri: neo4jState.config.uri,
      username: neo4jState.config.username,
      password: neo4jState.config.password,
      database: neo4jState.config.database,
    };
  }

  return null;
}

function extractGraph(snapshot: StoredNovelSnapshot): {
  entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>;
  relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>;
} {
  const chapters = snapshot.chapters.filter((chapter) => chapter.status === 'downloaded' && chapter.content);
  const entityStats = new Map<string, { mentions: number; chapterIds: Set<string> }>();
  const paragraphEntries: Array<{ chapterId: string; text: string; tokens: string[] }> = [];

  for (const chapter of chapters) {
    if (!chapter.content) {
      continue;
    }

    for (const paragraph of splitParagraphs(chapter.content)) {
      const tokens = extractTokens(paragraph);
      paragraphEntries.push({ chapterId: chapter.id, text: paragraph, tokens });

      for (const token of tokens) {
        const stats = entityStats.get(token) ?? { mentions: 0, chapterIds: new Set<string>() };
        stats.mentions += 1;
        stats.chapterIds.add(chapter.id);
        entityStats.set(token, stats);
      }
    }
  }

  const topEntities = [...entityStats.entries()]
    .filter(([, stats]) => stats.mentions >= 2)
    .sort((left, right) => right[1].mentions - left[1].mentions || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, MAX_GRAPH_ENTITIES)
    .map(([name, stats]) => ({ name, stats }));

  if (topEntities.length === 0) {
    return buildFallbackEntities(snapshot);
  }

  const entityNameSet = new Set(topEntities.map((entry) => entry.name));
  const entities = topEntities.map(({ name, stats }) => {
    const chapterIds = [...stats.chapterIds].sort();
    return {
      id: createStableId('entity', name),
      name,
      entityType: classifyEntity(snapshot, name),
      summary: `${name} 在已下载章节中出现 ${stats.mentions} 次，分布于 ${chapterIds.length} 章。`,
      prominence: Number((stats.mentions / Math.max(1, topEntities[0]?.stats.mentions ?? 1)).toFixed(3)),
      mentionCount: stats.mentions,
      mentionChapterIds: chapterIds,
      firstChapterId: chapterIds[0] ?? null,
      lastChapterId: chapterIds[chapterIds.length - 1] ?? null,
      aliases: [],
      embedding: null,
    } satisfies Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>;
  });

  const relationStats = new Map<string, {
    fromEntityId: string;
    toEntityId: string;
    relationType: KnowledgeGraphRelationType;
    chapterIds: Set<string>;
    evidence: string[];
    weight: number;
  }>();

  for (const paragraph of paragraphEntries) {
    const paragraphEntities = [...new Set(paragraph.tokens.filter((token) => entityNameSet.has(token)))];
    if (paragraphEntities.length < 2) {
      continue;
    }

    for (let index = 0; index < paragraphEntities.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < paragraphEntities.length; nextIndex += 1) {
        const fromName = paragraphEntities[index];
        const toName = paragraphEntities[nextIndex];
        if (!fromName || !toName) {
          continue;
        }

        const ordered = [fromName, toName].sort((left, right) => left.localeCompare(right, 'zh-CN'));
        const key = ordered.join('::');
        const existing = relationStats.get(key) ?? {
          fromEntityId: createStableId('entity', ordered[0] ?? ''),
          toEntityId: createStableId('entity', ordered[1] ?? ''),
          relationType: classifyRelation(paragraph.text),
          chapterIds: new Set<string>(),
          evidence: [],
          weight: 0,
        };
        existing.weight += 1;
        existing.chapterIds.add(paragraph.chapterId);
        if (existing.evidence.length < 3) {
          existing.evidence.push(paragraph.text.slice(0, 180));
        }
        relationStats.set(key, existing);
      }
    }
  }

  const relations = [...relationStats.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, MAX_GRAPH_RELATIONS)
    .map((relation) => ({
      id: createStableId('relation', `${relation.fromEntityId}:${relation.toEntityId}`),
      fromEntityId: relation.fromEntityId,
      toEntityId: relation.toEntityId,
      relationType: relation.relationType,
      summary: buildRelationSummary(relation),
      weight: relation.weight,
      chapterIds: [...relation.chapterIds].sort(),
      evidence: relation.evidence,
    } satisfies Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>));

  return { entities, relations };
}

function buildFallbackEntities(snapshot: StoredNovelSnapshot): {
  entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>;
  relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>;
} {
  const titleEntityId = createStableId('entity', snapshot.metadata.title);
  const entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>> = [
    {
      id: titleEntityId,
      name: snapshot.metadata.title,
      entityType: 'concept',
      summary: '当前作品标题，对应整本书的主题锚点。',
      prominence: 1,
      mentionCount: 1,
      mentionChapterIds: [],
      firstChapterId: null,
      lastChapterId: null,
      aliases: [],
      embedding: null,
    },
  ];

  if (snapshot.metadata.author) {
    entities.push({
      id: createStableId('entity', snapshot.metadata.author),
      name: snapshot.metadata.author,
      entityType: 'author',
      summary: '作品作者信息。',
      prominence: 0.5,
      mentionCount: 1,
      mentionChapterIds: [],
      firstChapterId: null,
      lastChapterId: null,
      aliases: [],
      embedding: null,
    });
  }

  const relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>> = entities.length > 1
    ? [{
        id: createStableId('relation', `${entities[0]?.id ?? ''}:${entities[1]?.id ?? ''}`),
        fromEntityId: entities[0]?.id ?? '',
        toEntityId: entities[1]?.id ?? '',
        relationType: 'co_occurs',
        summary: '当前仅能从元数据中恢复基础关系。',
        weight: 1,
        chapterIds: [],
        evidence: [snapshot.metadata.description.slice(0, 180)],
      }]
    : [];

  return { entities, relations };
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\r?\n{2,}/)
    .map((paragraph) => paragraph.replace(/!\[[^\]]*\]\(([^)]+)\)/g, ' ').replace(/<[^>]+>/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

function extractTokens(text: string): string[] {
  const normalized = text.replace(/[，。！？、；：,.!?()\[\]{}<>\s]|[和与在从向对把被将了的地得是又并而后前中上下来]/g, ' ');
  const matches = normalized.match(TOKEN_PATTERN) ?? [];
  const expanded = matches.flatMap((value) => expandTokenCandidates(value.trim()));
  return [...new Set(expanded.filter((token) => isEntityToken(token)))];
}

function expandTokenCandidates(token: string): string[] {
  if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
    const candidates = new Set<string>();

    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start <= token.length - size; start += 1) {
        candidates.add(token.slice(start, start + size));
      }
    }

    return [...candidates];
  }

  return [token];
}

function isEntityToken(token: string): boolean {
  if (token.length < 2 || token.length > 12 || STOP_TOKENS.has(token)) {
    return false;
  }

  if (/^第[一二三四五六七八九十百千\d]+[章节卷部话]$/.test(token)) {
    return false;
  }

  if (/^[A-Za-z]{1,2}$/.test(token)) {
    return false;
  }

  return true;
}

function classifyEntity(snapshot: StoredNovelSnapshot, name: string): KnowledgeGraphEntityType {
  if (snapshot.metadata.author && name === snapshot.metadata.author) {
    return 'author';
  }

  if (snapshot.metadata.tags.includes(name)) {
    return 'concept';
  }

  if (/[国城镇村岛塔宫馆学院]/.test(name)) {
    return 'location';
  }

  if (/[团军会局组盟宗派]/.test(name)) {
    return 'organization';
  }

  return 'character';
}

function classifyRelation(text: string): KnowledgeGraphRelationType {
  if (/[敌战杀仇争斗]/.test(text)) {
    return 'conflict';
  }

  if (/[父母兄弟姐妹家族]/.test(text)) {
    return 'family';
  }

  if (/[帮助联手同行同伴守护合作]/.test(text)) {
    return 'alliance';
  }

  return 'co_occurs';
}

function buildRelationSummary(relation: {
  relationType: KnowledgeGraphRelationType;
  chapterIds: Set<string>;
  weight: number;
}): string {
  const label = relation.relationType === 'conflict'
    ? '出现明显冲突'
    : relation.relationType === 'family'
      ? '存在亲缘线索'
      : relation.relationType === 'alliance'
        ? '多次协同行动'
        : '多次共同出现';

  return `${label}，共覆盖 ${relation.chapterIds.size} 章、${relation.weight} 段证据。`;
}

function serializeEntity(entity: StoredKnowledgeGraphEntityRow): LibraryKnowledgeGraphEntity {
  return {
    id: entity.id,
    name: entity.name,
    entityType: entity.entityType,
    summary: entity.summary,
    prominence: entity.prominence,
    mentionCount: entity.mentionCount,
    mentionChapterIds: entity.mentionChapterIds,
    firstChapterId: entity.firstChapterId,
    lastChapterId: entity.lastChapterId,
    aliases: entity.aliases,
  };
}

function serializeRelation(relation: StoredKnowledgeGraphRelationRow): LibraryKnowledgeGraphRelation {
  return {
    id: relation.id,
    fromEntityId: relation.fromEntityId,
    toEntityId: relation.toEntityId,
    relationType: relation.relationType,
    summary: relation.summary,
    weight: relation.weight,
    chapterIds: relation.chapterIds,
    evidence: relation.evidence,
  };
}

function buildAssistantPrompt(
  snapshot: StoredNovelSnapshot,
  graphState: LibraryKnowledgeGraphState,
  userMessage: string,
  sources: LibraryAssistantSource[],
  chapterId?: string,
): string {
  const sourceBlock = sources
    .map((source, index) => `${index + 1}. [${source.type}] ${source.label}\n${source.excerpt}`)
    .join('\n\n');

  return [
    '你是小说阅读助手。回答时只基于提供的书籍信息、图谱摘要和章节片段，不要编造未出现的剧情。',
    '回答请用简体中文，优先直接回答问题，再说明你的依据。',
    `当前视图: ${chapterId ? `阅读章节 ${chapterId}` : '书籍详情页'}`,
    `书名: ${snapshot.metadata.title}`,
    `作者: ${snapshot.metadata.author || '未知作者'}`,
    `图谱实体数: ${graphState.build.entityCount}`,
    `图谱关系数: ${graphState.build.relationCount}`,
    '可用上下文:',
    sourceBlock || '无附加上下文。',
    `用户问题: ${userMessage.trim()}`,
  ].join('\n\n');
}

function buildLocalAssistantAnswer(
  snapshot: StoredNovelSnapshot,
  sources: LibraryAssistantSource[],
  userMessage: string,
): string {
  const lines: string[] = [
    '当前还没有可用的聊天模型，我先根据本地图谱和章节内容给出整理后的回答。',
  ];
  const chapterSource = sources.find((source) => source.type === 'chapter');
  const graphSource = sources.find((source) => source.type === 'graph');

  if (chapterSource) {
    lines.push(`和你问题最接近的正文片段来自「${chapterSource.label}」：${chapterSource.excerpt}`);
  }

  if (graphSource) {
    lines.push(`图谱里当前最相关的线索是：${graphSource.excerpt}`);
  }

  if (!chapterSource && !graphSource) {
    lines.push(`我暂时只拿到了《${snapshot.metadata.title}》的元数据，还不足以对“${userMessage.trim()}”做更细的剧情判断。`);
  } else {
    lines.push('如果你希望回答更细，可以先在设置页补好聊天模型，再重新提问。');
  }

  return lines.join('\n\n');
}

function collectAssistantSources(
  snapshot: StoredNovelSnapshot,
  graphState: LibraryKnowledgeGraphState,
  query: string,
  chapterId?: string,
): LibraryAssistantSource[] {
  const sources: LibraryAssistantSource[] = [{
    type: 'metadata',
    label: '作品元数据',
    excerpt: `《${snapshot.metadata.title}》 作者 ${snapshot.metadata.author || '未知作者'}。简介：${snapshot.metadata.description.slice(0, 220) || '暂无简介。'}`,
    chapterId: null,
  }];

  if (graphState.entities.length > 0) {
    const matchedEntities = graphState.entities.filter((entity) => query.includes(entity.name)).slice(0, 3);
    const graphExcerpt = matchedEntities.length > 0
      ? matchedEntities.map((entity) => `${entity.name}：${entity.summary}`).join('；')
      : graphState.relations.slice(0, 2).map((relation) => relation.summary).join('；');

    if (graphExcerpt) {
      sources.push({
        type: 'graph',
        label: '知识图谱摘要',
        excerpt: graphExcerpt,
        chapterId: null,
      });
    }
  }

  const chapter = chapterId ? snapshot.chapters.find((entry) => entry.id === chapterId) : null;
  if (chapter?.content) {
    sources.push({
      type: 'chapter',
      label: chapter.title,
      excerpt: chapter.content.slice(0, 320),
      chapterId: chapter.id,
    });
  }

  const relevantChapters = rankRelevantChapters(snapshot.chapters, query)
    .filter((entry) => entry.content && entry.id !== chapterId)
    .slice(0, MAX_ASSISTANT_SOURCES - sources.length);

  for (const entry of relevantChapters) {
    sources.push({
      type: 'chapter',
      label: entry.title,
      excerpt: extractRelevantExcerpt(entry, query),
      chapterId: entry.id,
    });
  }

  return sources.slice(0, MAX_ASSISTANT_SOURCES);
}

function rankRelevantChapters(chapters: StoredChapterRecord[], query: string): StoredChapterRecord[] {
  const tokens = extractQueryTokens(query);

  return [...chapters]
    .filter((chapter) => chapter.content)
    .map((chapter) => ({ chapter, score: computeChapterScore(chapter, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.chapter.index - right.chapter.index)
    .map((entry) => entry.chapter);
}

function extractQueryTokens(query: string): string[] {
  const tokens = query.match(TOKEN_PATTERN) ?? [];
  const expanded = tokens.flatMap((token) => expandTokenCandidates(token.trim()));
  return [...new Set(expanded.filter((token) => isEntityToken(token)))];
}

function computeChapterScore(chapter: StoredChapterRecord, tokens: string[]): number {
  if (!chapter.content) {
    return 0;
  }

  const haystack = `${chapter.title}\n${chapter.content}`;
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? token.length : 0), 0);
}

function extractRelevantExcerpt(chapter: StoredChapterRecord, query: string): string {
  if (!chapter.content) {
    return '';
  }

  const tokens = extractQueryTokens(query);
  const paragraphs = splitParagraphs(chapter.content);
  const matched = paragraphs.find((paragraph) => tokens.some((token) => paragraph.includes(token)));
  return (matched ?? paragraphs[0] ?? chapter.content).slice(0, 320);
}

class DriverNeo4jGraphStore implements Neo4jGraphStore {
  async clearNamespaceGraph(namespace: string, config: Neo4jGraphStoreConfig): Promise<boolean> {
    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
    const session = driver.session({ ...(config.database ? { database: config.database } : {}) });

    try {
      const result = await session.executeWrite((transaction) => transaction.run(
        `
          MATCH (node {namespace: $namespace})
          WITH collect(node) AS nodes
          FOREACH (node IN nodes | DETACH DELETE node)
          RETURN size(nodes) AS deletedCount
        `,
        { namespace },
      ));

      const deletedCount = result.records[0]?.get('deletedCount');
      return Number(readNeo4jNumber(deletedCount)) > 0;
    } finally {
      await session.close();
      await driver.close();
    }
  }

  async replaceNamespaceGraph(
    snapshot: StoredNovelSnapshot,
    entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>,
    relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>,
    config: Neo4jGraphStoreConfig,
  ): Promise<void> {
    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
    const session = driver.session({ ...(config.database ? { database: config.database } : {}) });
    const namespace = createGraphNamespace(snapshot.sourceId, snapshot.metadata.novelId);

    try {
      await session.executeWrite(async (transaction) => {
        await transaction.run(
          `
            MERGE (novel:NovelGraphNovel {namespace: $namespace})
            SET novel.sourceId = $sourceId,
                novel.novelId = $novelId,
                novel.title = $title,
                novel.author = $author,
                novel.updatedAt = $updatedAt
          `,
          {
            namespace,
            sourceId: snapshot.sourceId,
            novelId: snapshot.metadata.novelId,
            title: snapshot.metadata.title,
            author: snapshot.metadata.author,
            updatedAt: snapshot.updatedAt,
          },
        );

        await transaction.run(
          `
            UNWIND $entities AS entity
            MERGE (node:NovelGraphEntity {namespace: $namespace, entityId: entity.id})
            SET node.namespace = $namespace,
                node.sourceId = $sourceId,
                node.novelId = $novelId,
                node.name = entity.name,
                node.entityType = entity.entityType,
                node.summary = entity.summary,
                node.prominence = entity.prominence,
                node.mentionCount = entity.mentionCount,
                node.mentionChapterIds = entity.mentionChapterIds,
                node.firstChapterId = entity.firstChapterId,
                node.lastChapterId = entity.lastChapterId,
                node.aliases = entity.aliases
          `,
          {
            namespace,
            sourceId: snapshot.sourceId,
            novelId: snapshot.metadata.novelId,
            entities,
          },
        );

        await transaction.run(
          `
            MATCH (novel:NovelGraphNovel {namespace: $namespace})
            MATCH (node:NovelGraphEntity {namespace: $namespace})
            MERGE (novel)-[:HAS_GRAPH_ENTITY {namespace: $namespace}]->(node)
          `,
          { namespace },
        );

        await transaction.run(
          `
            UNWIND $relations AS relation
            MATCH (from:NovelGraphEntity {namespace: $namespace, entityId: relation.fromEntityId})
            MATCH (to:NovelGraphEntity {namespace: $namespace, entityId: relation.toEntityId})
            MERGE (from)-[edge:NOVEL_RELATED {namespace: $namespace, relationId: relation.id}]->(to)
            SET edge.namespace = $namespace,
                edge.sourceId = $sourceId,
                edge.novelId = $novelId,
                edge.relationType = relation.relationType,
                edge.summary = relation.summary,
                edge.weight = relation.weight,
                edge.chapterIds = relation.chapterIds,
                edge.evidence = relation.evidence
          `,
          {
            namespace,
            sourceId: snapshot.sourceId,
            novelId: snapshot.metadata.novelId,
            relations,
          },
        );
      });
    } finally {
      await session.close();
      await driver.close();
    }
  }

  async queryNamespaceGraph(
    namespace: string,
    query: string,
    config: Neo4jGraphStoreConfig,
  ): Promise<Neo4jGraphQueryResult> {
    const tokens = extractQueryTokens(query).map((token) => token.toLocaleLowerCase('zh-CN'));
    if (tokens.length === 0) {
      return { hits: [], source: null };
    }

    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
    const session = driver.session({ ...(config.database ? { database: config.database } : {}) });

    try {
      const relationResult = await session.executeRead((transaction) => transaction.run(
        `
          MATCH (from:NovelGraphEntity {namespace: $namespace})-[edge:NOVEL_RELATED {namespace: $namespace}]-(to:NovelGraphEntity {namespace: $namespace})
          WITH from, to, edge,
               reduce(score = 0.0, token IN $tokens |
                 score +
                 CASE WHEN toLower(coalesce(from.name, '')) CONTAINS token THEN 3.0 ELSE 0.0 END +
                 CASE WHEN toLower(coalesce(to.name, '')) CONTAINS token THEN 3.0 ELSE 0.0 END +
                 CASE WHEN toLower(coalesce(edge.summary, '')) CONTAINS token THEN 2.0 ELSE 0.0 END +
                 CASE WHEN any(evidence IN coalesce(edge.evidence, []) WHERE toLower(evidence) CONTAINS token) THEN 1.5 ELSE 0.0 END
               ) AS score
          WHERE score > 0
          RETURN from.name AS fromName,
                 to.name AS toName,
                 edge.summary AS summary,
                 edge.evidence AS evidence,
                 edge.chapterIds AS chapterIds,
                 score
          ORDER BY score DESC, edge.weight DESC
          LIMIT 3
        `,
        { namespace, tokens },
      ));

      const hits = relationResult.records.map((record) => {
        const fromName = String(record.get('fromName') ?? '未知节点');
        const toName = String(record.get('toName') ?? '未知节点');
        const summary = String(record.get('summary') ?? '');
        const evidence = normalizeNeo4jStringArray(record.get('evidence'));
        return {
          source: 'neo4j' as const,
          label: `${fromName} -> ${toName}`,
          excerpt: `${summary}。证据：${evidence[0] ?? summary}`,
          score: Number(readNeo4jNumber(record.get('score')).toFixed(3)),
          chapterIds: normalizeNeo4jStringArray(record.get('chapterIds')),
          entityNames: [fromName, toName],
          relationSummaries: [summary],
        } satisfies AssistantGraphTraceHit;
      });

      if (hits.length > 0) {
        return {
          hits,
          source: {
            type: 'graph',
            label: 'Neo4j 子图命中',
            excerpt: hits.map((hit) => `${hit.label}：${hit.excerpt}`).join('；').slice(0, 360),
            chapterId: hits[0]?.chapterIds[0] ?? null,
          },
        };
      }

      const nodeResult = await session.executeRead((transaction) => transaction.run(
        `
          MATCH (node:NovelGraphEntity {namespace: $namespace})
          WITH node,
               reduce(score = 0.0, token IN $tokens |
                 score +
                 CASE WHEN toLower(coalesce(node.name, '')) CONTAINS token THEN 3.0 ELSE 0.0 END +
                 CASE WHEN toLower(coalesce(node.summary, '')) CONTAINS token THEN 1.0 ELSE 0.0 END +
                 CASE WHEN any(alias IN coalesce(node.aliases, []) WHERE toLower(alias) CONTAINS token) THEN 2.0 ELSE 0.0 END
               ) AS score
          WHERE score > 0
          RETURN node.name AS name,
                 node.summary AS summary,
                 node.mentionChapterIds AS chapterIds,
                 score
          ORDER BY score DESC, node.prominence DESC
          LIMIT 3
        `,
        { namespace, tokens },
      ));

      const nodeHits = nodeResult.records.map((record) => {
        const name = String(record.get('name') ?? '未知节点');
        const summary = String(record.get('summary') ?? '');
        return {
          source: 'neo4j' as const,
          label: name,
          excerpt: summary,
          score: Number(readNeo4jNumber(record.get('score')).toFixed(3)),
          chapterIds: normalizeNeo4jStringArray(record.get('chapterIds')),
          entityNames: [name],
          relationSummaries: [],
        } satisfies AssistantGraphTraceHit;
      });

      return {
        hits: nodeHits,
        source: nodeHits.length > 0
          ? {
              type: 'graph',
              label: 'Neo4j 子图命中',
              excerpt: nodeHits.map((hit) => `${hit.label}：${hit.excerpt}`).join('；').slice(0, 360),
              chapterId: nodeHits[0]?.chapterIds[0] ?? null,
            }
          : null,
      };
    } finally {
      await session.close();
      await driver.close();
    }
  }
}

function readNeo4jNumber(value: unknown): number {
  if (neo4j.isInt(value)) {
    return value.toNumber();
  }

  return typeof value === 'number' ? value : 0;
}

function normalizeNeo4jStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function createGraphNamespace(sourceId: string, novelId: string): string {
  return `${sourceId}:${novelId}`;
}

function createNovelKey(sourceId: string, novelId: string): string {
  return `${sourceId}/${novelId}`;
}

function createStableId(prefix: string, value: string): string {
  return `${prefix}-${crypto.createHash('sha1').update(value).digest('hex').slice(0, 16)}`;
}

function freezeProfile(
  snapshot: StoredNovelSnapshot,
  current: StoredKnowledgeGraphProfileRow | null,
  llmState: LlmPreferencesState,
  neo4jState: Neo4jPreferencesState,
): StoredKnowledgeGraphProfileInput {
  const chat = resolveCapabilityRoute(llmState, 'chat', current ? routeFromProfile(current.chatProviderId, current.chatModelId) : null);
  const extractionModels = resolveExtractionRoutes(llmState, current);
  const embedding = resolveCapabilityRoute(llmState, 'embedding', current ? routeFromProfile(current.embeddingProviderId, current.embeddingModelId) : null);
  const rerank = resolveCapabilityRoute(llmState, 'rerank', current ? routeFromProfile(current.rerankProviderId, current.rerankModelId) : null);
  const neo4j = resolveNeo4jConfig(current, neo4jState);

  return {
    sourceId: snapshot.sourceId,
    novelId: snapshot.metadata.novelId,
    chatProviderId: chat?.provider.id ?? current?.chatProviderId ?? '',
    chatModelId: chat?.model.id ?? current?.chatModelId ?? '',
    extractionModels: extractionModels.map((route) => ({
      providerId: route.provider.id,
      modelId: route.model.id,
      maxConcurrency: route.maxConcurrency,
    })),
    embeddingProviderId: embedding?.provider.id ?? current?.embeddingProviderId ?? '',
    embeddingModelId: embedding?.model.id ?? current?.embeddingModelId ?? '',
    rerankProviderId: rerank?.provider.id ?? current?.rerankProviderId ?? '',
    rerankModelId: rerank?.model.id ?? current?.rerankModelId ?? '',
    extractionConcurrency: normalizeExtractionConcurrency(current?.extractionConcurrency),
    neo4jEnabled: neo4j?.enabled ?? false,
    neo4jUri: neo4j?.uri ?? current?.neo4jUri ?? '',
    neo4jUsername: neo4j?.username ?? current?.neo4jUsername ?? '',
    neo4jPassword: neo4j?.password ?? current?.neo4jPassword ?? '',
    neo4jDatabase: neo4j?.database ?? current?.neo4jDatabase ?? '',
    configLocked: true,
    lockedAt: current?.lockedAt ?? new Date().toISOString(),
  };
}

function serializeBuildLog(log: StoredKnowledgeGraphBuildLogRow): LibraryKnowledgeGraphBuildLog {
  return {
    id: log.id,
    stage: log.stage,
    level: log.level,
    message: log.message,
    createdAt: log.createdAt,
  };
}

function normalizeExtractionConcurrency(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EXTRACTION_CONCURRENCY;
  }

  return Math.max(
    MIN_EXTRACTION_CONCURRENCY,
    Math.min(MAX_EXTRACTION_CONCURRENCY, Math.trunc(value ?? DEFAULT_EXTRACTION_CONCURRENCY)),
  );
}

function normalizeExtractionModelConcurrency(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EXTRACTION_MODEL_CONCURRENCY;
  }

  return Math.max(
    MIN_EXTRACTION_MODEL_CONCURRENCY,
    Math.min(MAX_EXTRACTION_MODEL_CONCURRENCY, Math.trunc(value ?? DEFAULT_EXTRACTION_MODEL_CONCURRENCY)),
  );
}

function normalizeBuildMode(mode: KnowledgeGraphBuildMode | undefined): KnowledgeGraphBuildMode {
  if (mode === 'full' || mode === 'rebuild') {
    return mode;
  }

  return 'incremental';
}

function normalizeExtractionModelPool(
  value: Array<{ providerId?: string; modelId?: string; maxConcurrency?: number }> | null | undefined,
): Array<{ providerId: string; modelId: string; maxConcurrency: number }> {
  const uniqueModels = new Map<string, { providerId: string; modelId: string; maxConcurrency: number }>();

  for (const entry of value ?? []) {
    const providerId = entry.providerId?.trim();
    const modelId = entry.modelId?.trim();
    if (!providerId || !modelId) {
      continue;
    }

    uniqueModels.set(`${providerId}::${modelId}`, {
      providerId,
      modelId,
      maxConcurrency: normalizeExtractionModelConcurrency(entry.maxConcurrency),
    });
  }

  return [...uniqueModels.values()];
}

function isExtractionModelPoolEqual(
  left: Array<{ providerId: string; modelId: string; maxConcurrency: number }>,
  right: Array<{ providerId: string; modelId: string; maxConcurrency: number }>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => (
    entry.providerId === right[index]?.providerId
    && entry.modelId === right[index]?.modelId
    && entry.maxConcurrency === right[index]?.maxConcurrency
  ));
}

function resolveExtractionRoutes(
  state: LlmPreferencesState,
  profile: StoredKnowledgeGraphProfileRow | null,
): Array<ResolvedCapabilityRoute & { maxConcurrency: number }> {
  const configured = normalizeExtractionModelPool(profile?.extractionModels).flatMap((entry) => {
    const resolved = resolveCapabilityRoute(state, 'chat', routeFromProfile(entry.providerId, entry.modelId));
    return resolved ? [{ ...resolved, maxConcurrency: normalizeExtractionModelConcurrency(entry.maxConcurrency) }] : [];
  });

  if (configured.length > 0) {
    return configured;
  }

  const fallback = resolveCapabilityRoute(
    state,
    'chat',
    profile ? routeFromProfile(profile.chatProviderId, profile.chatModelId) : null,
  );
  return fallback
    ? [{ ...fallback, maxConcurrency: normalizeExtractionConcurrency(profile?.extractionConcurrency) }]
    : [];
}