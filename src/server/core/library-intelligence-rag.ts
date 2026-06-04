import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { cosineSimilarity, embedMany, generateObject, generateText, rerank } from 'ai';
import { createOllama } from 'ai-sdk-ollama';
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

import type {
  StoredKnowledgeGraphBuildCheckpointRow,
  StoredKnowledgeGraphChunkRow,
  StoredKnowledgeGraphEntityRow,
  StoredKnowledgeGraphRelationRow,
} from './novel-repository';
import type { LlmModelConfig, LlmProviderConfig } from './system-preferences';
import type { StoredChapterRecord, StoredNovelSnapshot } from './spider';

type KnowledgeGraphEntityType = StoredKnowledgeGraphEntityRow['entityType'];
type KnowledgeGraphRelationType = StoredKnowledgeGraphRelationRow['relationType'];

export interface ResolvedCapabilityRoute {
  provider: LlmProviderConfig;
  model: LlmModelConfig;
  source: 'novel' | 'global';
}

export interface ResolvedExtractionRoute extends ResolvedCapabilityRoute {
  maxConcurrency: number;
}

export interface KnowledgeGraphBuildArtifacts {
  entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>;
  relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>;
  chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>;
  checkpoints: Array<{
    chunkId: string;
    chapterId: string;
    chapterIndex: number;
    chunkIndex: number;
    chapterTitle: string;
    extractionJson: string;
    warningMessage: string | null;
    status: 'success' | 'failed';
  }>;
  usedLlmExtraction: boolean;
  usedEmbeddingIndex: boolean;
  diagnostics: KnowledgeGraphBuildDiagnostics;
}

export type KnowledgeGraphBuildExecutionMode = 'full' | 'incremental' | 'rebuild';

export interface KnowledgeGraphBuildProgressEvent {
  phase: 'started' | 'completed';
  chunkNumber: number;
  processedChunks: number;
  totalChunks: number;
  chapterId: string;
  chapterTitle: string;
  chunkIndex: number;
  llmSuccessCount: number;
  llmFailureCount: number;
  fallbackCount: number;
  mode: 'llm' | 'fallback';
  warning: string | null;
  modelStats: KnowledgeGraphBuildModelStat[];
}

export interface KnowledgeGraphBuildStageEvent {
  stage: 'relating';
  progressPercent: number;
  message: string;
}

export type KnowledgeGraphModelCircuitState = 'closed' | 'open' | 'half-open';

export interface KnowledgeGraphBuildModelStat {
  providerId: string;
  modelId: string;
  source: 'novel' | 'global';
  maxConcurrency: number;
  attemptCount: number;
  llmSuccessCount: number;
  failureCount: number;
  fallbackCount: number;
  handoffInCount: number;
  handoffOutCount: number;
  inFlightCount: number;
  consecutiveFailures: number;
  circuitState: KnowledgeGraphModelCircuitState;
  circuitOpenedCount: number;
  cooldownUntil: string | null;
  firstAttemptAt: string | null;
  lastError: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  recentSuccessAt: string[];
  failureRate: number;
  throughputPerMinute: number;
}

export interface KnowledgeGraphBuildDiagnostics {
  totalChunks: number;
  llmSuccessCount: number;
  llmFailureCount: number;
  fallbackCount: number;
  failureSamples: string[];
  modelStats: KnowledgeGraphBuildModelStat[];
}

export class KnowledgeGraphBuildPausedError extends Error {
  constructor(message = 'Knowledge graph build paused.') {
    super(message);
    this.name = 'KnowledgeGraphBuildPausedError';
  }
}

export interface AssistantSourceDocument {
  type: 'metadata' | 'graph' | 'chapter';
  label: string;
  excerpt: string;
  chapterId: string | null;
}

export interface AssistantGraphTraceHit {
  source: 'local' | 'neo4j';
  label: string;
  excerpt: string;
  score: number;
  chapterIds: string[];
  entityNames: string[];
  relationSummaries: string[];
}

export interface AssistantChunkTraceHit {
  chunkId: string;
  label: string;
  chapterId: string | null;
  excerpt: string;
  keywordScore: number;
  semanticScore: number;
  rerankScore: number | null;
  finalScore: number;
  selected: boolean;
}

export interface AssistantRetrievalTrace {
  usedEmbedding: boolean;
  usedRerank: boolean;
  graphHits: AssistantGraphTraceHit[];
  chunkHits: AssistantChunkTraceHit[];
}

export interface AssistantSourceCollectionResult {
  sources: AssistantSourceDocument[];
  trace: AssistantRetrievalTrace;
}

interface ChunkPlan {
  id: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  chunkIndex: number;
  content: string;
}

interface PendingChunkState {
  chunk: ChunkPlan;
  attemptedModelKeys: Set<string>;
}

interface ExtractionModelRuntimeState {
  providerId: string;
  modelId: string;
  source: 'novel' | 'global';
  maxConcurrency: number;
  attemptCount: number;
  llmSuccessCount: number;
  failureCount: number;
  fallbackCount: number;
  handoffInCount: number;
  handoffOutCount: number;
  inFlightCount: number;
  consecutiveFailures: number;
  circuitState: KnowledgeGraphModelCircuitState;
  circuitOpenedCount: number;
  cooldownUntilMs: number | null;
  firstAttemptAt: string | null;
  lastError: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  recentSuccessAt: string[];
}

interface ChunkExtraction {
  summary: string;
  eventSummary: string;
  entities: Array<{
    name: string;
    entityType: KnowledgeGraphEntityType;
    aliases: string[];
    summary: string;
    evidence: string;
  }>;
  relations: Array<{
    from: string;
    to: string;
    relationType: KnowledgeGraphRelationType;
    summary: string;
    evidence: string;
    chapterScope: string;
  }>;
  keywordHints: string[];
  usedLlm: boolean;
  sourceFingerprint?: string;
}

interface ResolvedCheckpointEntry {
  checkpoint: StoredKnowledgeGraphBuildCheckpointRow;
  extraction: ChunkExtraction;
  warning: string | null;
}

interface AggregateEntity {
  displayName: string;
  aliases: Set<string>;
  typeVotes: Map<KnowledgeGraphEntityType, number>;
  summaries: string[];
  chapterIds: Set<string>;
  mentionCount: number;
  firstChapterIndex: number;
  lastChapterIndex: number;
  embedding: number[] | null;
}

interface AggregateRelation {
  fromKey: string;
  toKey: string;
  typeVotes: Map<KnowledgeGraphRelationType, number>;
  summaries: string[];
  chapterIds: Set<string>;
  evidences: string[];
  weight: number;
}

interface RankedChunkCandidate {
  chunk: StoredKnowledgeGraphChunkRow;
  keywordScore: number;
  semanticScore: number;
  rerankScore: number | null;
  finalScore: number;
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
const TOKEN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]{1,16}/gu;
const MAX_GRAPH_ENTITIES = 128;
const MAX_GRAPH_RELATIONS = 384;
const MAX_ASSISTANT_SOURCES = 6;
const MAX_CHUNK_CHARACTERS = 620;
const MAX_CHUNK_PARAGRAPHS = 2;
const MAX_RERANK_DOCUMENTS = 8;
const MAX_SCHEMA_EXTRACTION_ATTEMPTS = 2;
const MAX_PROMPTED_JSON_ATTEMPTS = 3;
const EXTRACTION_RETRY_BASE_DELAY_MS = 250;
const EXTRACTION_CONCURRENCY = 2;
const MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 1;
const MODEL_CIRCUIT_BREAKER_BASE_COOLDOWN_MS = 4000;
const MODEL_CIRCUIT_BREAKER_MAX_COOLDOWN_MS = 20000;
const MODEL_THROUGHPUT_WINDOW_SIZE = 12;
const MODEL_THROUGHPUT_MIN_WINDOW_MS = 10000;
const EMBEDDING_BATCH_SIZE = 64;

const chunkEventSchema = z.object({
  summary: z.string().min(1).max(160),
  evidence: z.string().max(240).default(''),
  chapterScope: z.string().max(80).default(''),
});

const chunkEntitySchema = z.object({
  name: z.string().min(1).max(40),
  entityType: z.enum(['character', 'location', 'organization', 'concept', 'author']),
  aliases: z.array(z.string().min(1).max(40)).max(6).default([]),
  summary: z.string().min(1).max(180),
  evidence: z.string().max(240).default(''),
});

const chunkRelationSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  relationType: z.enum(['co_occurs', 'alliance', 'conflict', 'family']),
  summary: z.string().min(1).max(180),
  evidence: z.string().min(1).max(240),
  chapterScope: z.string().max(80).default(''),
});

const chunkExtractionSchema = z.object({
  summary: z.string().min(1).max(280),
  events: z.array(chunkEventSchema).max(6).default([]),
  entities: z.array(chunkEntitySchema).max(12).default([]),
  relations: z.array(chunkRelationSchema).max(10).default([]),
  keywordHints: z.array(z.string().min(1).max(24)).max(10).default([]),
});

export async function buildKnowledgeGraphArtifacts(options: {
  snapshot: StoredNovelSnapshot;
  extractionModels: ResolvedExtractionRoute[];
  embeddingModel: ResolvedCapabilityRoute | null;
  checkpoints?: StoredKnowledgeGraphBuildCheckpointRow[];
  mode?: KnowledgeGraphBuildExecutionMode;
  extractionConcurrency?: number;
  startedAt?: string | null;
  modelStatsSeed?: KnowledgeGraphBuildModelStat[];
  shouldPause?: () => boolean;
  onCheckpoint?: (checkpoint: {
    chunkId: string;
    chapterId: string;
    chapterIndex: number;
    chunkIndex: number;
    chapterTitle: string;
    extractionJson: string;
    warningMessage: string | null;
    status: 'success' | 'failed';
  }) => void | Promise<void>;
  onProgress?: (event: KnowledgeGraphBuildProgressEvent) => void | Promise<void>;
  onStageProgress?: (event: KnowledgeGraphBuildStageEvent) => void | Promise<void>;
}): Promise<KnowledgeGraphBuildArtifacts> {
  const chunkPlans = createChunkPlans(options.snapshot.chapters);
  const buildMode = options.mode ?? 'incremental';
  const extractionModels = options.extractionModels.filter((route) => route.maxConcurrency > 0);

  if (extractionModels.length === 0) {
    throw new Error(
      '未配置图谱提取模型，无法构建知识图谱。请先在小说图谱配置中添加至少一个提取模型。',
    );
  }

  const buildStartedAtMs = parseTimestampMs(options.startedAt) ?? Date.now();
  const modelStates = createExtractionModelRuntimeStates(extractionModels, options.modelStatsSeed);
  const entityMap = new Map<string, AggregateEntity>();
  const aliasMap = new Map<string, string>();
  const relationMap = new Map<string, AggregateRelation>();
  const chunkRows: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>> = [];

  const checkpointMap = buildMode === 'full'
    ? new Map<string, ResolvedCheckpointEntry>()
    : createReusableCheckpointMap(chunkPlans, options.checkpoints ?? []);
  const extractionByChunkId = new Map<string, { extraction: ChunkExtraction; warning: string | null }>();
  let usedLlmExtraction = false;
  let llmSuccessCount = 0;
  let llmFailureCount = 0;
  let fallbackCount = 0;
  const failureSamples: string[] = [];

  for (const checkpoint of checkpointMap.values()) {
    extractionByChunkId.set(checkpoint.checkpoint.chunkId, {
      extraction: checkpoint.extraction,
      warning: checkpoint.warning,
    });

    if (checkpoint.extraction.usedLlm) {
      usedLlmExtraction = true;
      llmSuccessCount += 1;
    } else if (checkpoint.warning) {
      llmFailureCount += 1;
      pushUnique(failureSamples, checkpoint.warning, 4);
    }
  }

  let completedChunks = checkpointMap.size;
  const pendingQueue = chunkPlans
    .filter((chunk) => !checkpointMap.has(chunk.id))
    .map((chunk) => ({
      chunk,
      attemptedModelKeys: new Set<string>(),
    } satisfies PendingChunkState));
  if (buildMode === 'rebuild' && pendingQueue.length > 0) {
    throw new Error('当前缺少完整的结构缓存，暂时不能只重建实体和关系。请先执行一次增量更新或全量重建。');
  }
  const candidateModelKeys = new Set(
    extractionModels.flatMap((route) => {
      const modelKey = getExtractionRouteModelKey(route);
      return modelKey ? [modelKey] : [];
    }),
  );
  const circuitBreakerEnabled = candidateModelKeys.size > 1;
  const workerSlots: Array<{ id: string; route: ResolvedExtractionRoute | null }> =
    createExtractionWorkerSlots(extractionModels);
  const maxInFlight = Math.max(
    1,
    Math.min(
      extractionModels.length > 0 ? (options.extractionConcurrency ?? EXTRACTION_CONCURRENCY) : 1,
      pendingQueue.length || 1,
      workerSlots.length || 1,
    ),
  );
  const availableSlots = [...workerSlots];
  const inFlight = new Map<string, Promise<{
    slot: { id: string; route: ResolvedExtractionRoute | null };
    pending: PendingChunkState;
    extraction: ChunkExtraction;
    warning: string | null;
  }>>();

  const pauseRequested = () => options.shouldPause?.() === true;

  while (pendingQueue.length > 0 || inFlight.size > 0) {
    while (inFlight.size < maxInFlight && availableSlots.length > 0) {
      if (pauseRequested()) {
        break;
      }

      let scheduledAny = false;
      const slotScanCount = availableSlots.length;

      for (let scanIndex = 0; scanIndex < slotScanCount && inFlight.size < maxInFlight; scanIndex += 1) {
        const slot = availableSlots.shift();
        if (!slot) {
          continue;
        }

        const slotModelState = getModelStateForRoute(modelStates, slot.route);
        if (isModelCoolingDown(slotModelState)) {
          availableSlots.push(slot);
          continue;
        }

        const pending = dequeueChunkForSlot(pendingQueue, slot.route);
        if (!pending) {
          availableSlots.push(slot);
          continue;
        }

        markModelAttemptStarted(slotModelState, pending, slot.route);

        scheduledAny = true;
        await options.onProgress?.({
          phase: 'started',
          chunkNumber: chunkPlans.indexOf(pending.chunk) + 1,
          processedChunks: completedChunks,
          totalChunks: chunkPlans.length,
          chapterId: pending.chunk.chapterId,
          chapterTitle: pending.chunk.chapterTitle,
          chunkIndex: pending.chunk.chunkIndex,
          llmSuccessCount,
          llmFailureCount,
          fallbackCount,
          mode: extractionModels.length > 0 ? 'llm' : 'fallback',
          warning: null,
          modelStats: snapshotModelStats(modelStates, buildStartedAtMs),
        });

        inFlight.set(slot.id, processChunkWithRoute(options.snapshot, pending.chunk, slot.route).then((result) => ({
          slot,
          pending,
          ...result,
        })));
      }

      if (!scheduledAny) {
        break;
      }
    }

    if (inFlight.size === 0) {
      if (pendingQueue.length > 0 && pauseRequested()) {
        throw new KnowledgeGraphBuildPausedError('图谱构建已暂停，未完成的片段会保留到下次继续。');
      }

      const waitMs = getNextModelCooldownWaitMs(availableSlots, modelStates);
      if (pendingQueue.length > 0 && waitMs !== null) {
        await waitForDuration(waitMs);
        continue;
      }

      break;
    }

    const settled = await Promise.race(inFlight.values());
    inFlight.delete(settled.slot.id);
    availableSlots.push(settled.slot);

    const routeModelKey = getExtractionRouteModelKey(settled.slot.route);
    const modelState = getModelStateForRoute(modelStates, settled.slot.route);
    if (routeModelKey && settled.warning) {
      settled.pending.attemptedModelKeys.add(routeModelKey);
    }

    const canHandoff = Boolean(
      settled.warning
      && settled.slot.route
      && hasRemainingCandidateModel(settled.pending.attemptedModelKeys, candidateModelKeys),
    );

    finalizeModelAttempt(modelState, {
      warning: settled.warning,
      usedLlm: settled.extraction.usedLlm,
      handedOff: canHandoff,
      enableCircuitBreaker: circuitBreakerEnabled,
    });

    if (canHandoff) {
      llmFailureCount += 1;
      pushUnique(failureSamples, settled.warning ?? '未返回具体错误。', 4);
      pendingQueue.push(settled.pending);
      continue;
    }

    if (settled.extraction.usedLlm) {
      usedLlmExtraction = true;
      llmSuccessCount += 1;
    } else if (settled.warning) {
      // 所有模型均失败，片段标记为 failed
      llmFailureCount += 1;
      pushUnique(failureSamples, settled.warning, 4);
    }

    extractionByChunkId.set(settled.pending.chunk.id, { extraction: settled.extraction, warning: settled.warning });
    await options.onCheckpoint?.({
      chunkId: settled.pending.chunk.id,
      chapterId: settled.pending.chunk.chapterId,
      chapterIndex: settled.pending.chunk.chapterIndex,
      chunkIndex: settled.pending.chunk.chunkIndex,
      chapterTitle: settled.pending.chunk.chapterTitle,
      extractionJson: serializeCheckpointExtraction(settled.pending.chunk, settled.extraction),
      warningMessage: settled.warning,
      status: settled.extraction.usedLlm ? 'success' : 'failed',
    });

    completedChunks += 1;
    await options.onProgress?.({
      phase: 'completed',
      chunkNumber: chunkPlans.indexOf(settled.pending.chunk) + 1,
      processedChunks: completedChunks,
      totalChunks: chunkPlans.length,
      chapterId: settled.pending.chunk.chapterId,
      chapterTitle: settled.pending.chunk.chapterTitle,
      chunkIndex: settled.pending.chunk.chunkIndex,
      llmSuccessCount,
      llmFailureCount,
      fallbackCount,
      mode: settled.extraction.usedLlm ? 'llm' : 'fallback',
      warning: settled.warning,
      modelStats: snapshotModelStats(modelStates, buildStartedAtMs),
    });
  }

  for (const chunk of chunkPlans) {
    const resolved = extractionByChunkId.get(chunk.id);
    if (!resolved) {
      throw new Error(`Chunk checkpoint missing for ${chunk.chapterId}#${chunk.chunkIndex}.`);
    }

    applyChunkExtraction({
      snapshot: options.snapshot,
      entityMap,
      aliasMap,
      relationMap,
      chunkRows,
      chunk,
      extraction: resolved.extraction,
    });
  }

  if (chunkPlans.length > 0 && !usedLlmExtraction && llmFailureCount > 0) {
    throw new Error(
      `已配置图谱抽取模型，但所有结构化抽取请求都失败了。请检查模型配置后使用重试端点再次尝试。最近错误：${failureSamples[0] ?? '未返回具体错误。'}`,
    );
  }

  await options.onStageProgress?.({
    stage: 'relating',
    progressPercent: 60,
    message: `开始归并 ${entityMap.size} 个候选实体与 ${relationMap.size} 组候选关系。`,
  });

  const mergeResult = mergeEquivalentAggregateEntities(entityMap, aliasMap);
  const remappedRelations = remapAggregateRelations(relationMap, mergeResult.keyRemap);
  const remappedChunks = remapChunkEntityNames(chunkRows, mergeResult.entityMap, mergeResult.aliasMap);

  await options.onStageProgress?.({
    stage: 'relating',
    progressPercent: 62,
    message: mergeResult.mergedEntityCount > 0
      ? `已合并 ${mergeResult.mergedEntityCount} 个同义实体，当前保留 ${mergeResult.entityMap.size} 个实体候选，关系候选 ${remappedRelations.size} 组。`
      : `实体归并完成，当前保留 ${mergeResult.entityMap.size} 个实体候选，关系候选 ${remappedRelations.size} 组。`,
  });

  const finalizedEntities = finalizeEntities(mergeResult.entityMap, options.snapshot);
  const retainedEntityKeys = new Set(finalizedEntities.map((entity) => normalizeEntityKey(entity.name)));
  const entityIdsByKey = new Map(finalizedEntities.map((entity) => [normalizeEntityKey(entity.name), entity.id]));

  const finalizedRelations = finalizeRelations(remappedRelations, mergeResult.entityMap, retainedEntityKeys, entityIdsByKey);
  const finalizedChunks = remappedChunks.map((chunk) => ({
    ...chunk,
    entityNames: chunk.entityNames.filter((name) => retainedEntityKeys.has(normalizeEntityKey(name))),
  }));

  await options.onStageProgress?.({
    stage: 'relating',
    progressPercent: options.embeddingModel ? 66 : 72,
    message: `关系归并完成：保留 ${finalizedEntities.length} 个实体、${finalizedRelations.length} 条关系、${finalizedChunks.length} 个片段索引。`,
  });

  if (finalizedEntities.length === 0) {
    const fallback = buildFallbackGraph(options.snapshot, finalizedChunks);
    if (options.embeddingModel && finalizedChunks.length > 0) {
      await assignChunkEmbeddings(finalizedChunks, options.embeddingModel, options.onStageProgress);
    }

    return {
      entities: fallback.entities,
      relations: fallback.relations,
      chunks: finalizedChunks,
      checkpoints: chunkPlans.flatMap((chunk) => {
        const resolved = extractionByChunkId.get(chunk.id);
        return resolved
          ? [{
              chunkId: chunk.id,
              chapterId: chunk.chapterId,
              chapterIndex: chunk.chapterIndex,
              chunkIndex: chunk.chunkIndex,
              chapterTitle: chunk.chapterTitle,
              extractionJson: serializeCheckpointExtraction(chunk, resolved.extraction),
              warningMessage: resolved.warning,
              status: resolved.extraction.usedLlm ? 'success' as const : 'failed' as const,
            }]
          : [];
      }),
      usedLlmExtraction,
      usedEmbeddingIndex: Boolean(options.embeddingModel && finalizedChunks.some((chunk) => chunk.embedding)),
      diagnostics: {
        totalChunks: chunkPlans.length,
        llmSuccessCount,
        llmFailureCount,
        fallbackCount,
        failureSamples,
        modelStats: snapshotModelStats(modelStates, buildStartedAtMs),
      },
    };
  }

  let usedEmbeddingIndex = false;
  if (options.embeddingModel) {
    await assignEntityEmbeddings(finalizedEntities, options.embeddingModel, options.onStageProgress);
    await assignChunkEmbeddings(finalizedChunks, options.embeddingModel, options.onStageProgress);
    usedEmbeddingIndex = finalizedEntities.some((entity) => entity.embedding) || finalizedChunks.some((chunk) => chunk.embedding);
  }

  return {
    entities: finalizedEntities,
    relations: finalizedRelations,
    chunks: finalizedChunks,
    checkpoints: chunkPlans.flatMap((chunk) => {
      const resolved = extractionByChunkId.get(chunk.id);
      return resolved
        ? [{
            chunkId: chunk.id,
            chapterId: chunk.chapterId,
            chapterIndex: chunk.chapterIndex,
            chunkIndex: chunk.chunkIndex,
            chapterTitle: chunk.chapterTitle,
            extractionJson: serializeCheckpointExtraction(chunk, resolved.extraction),
            warningMessage: resolved.warning,
            status: resolved.extraction.usedLlm ? 'success' as const : 'failed' as const,
          }]
        : [];
    }),
    usedLlmExtraction,
    usedEmbeddingIndex,
    diagnostics: {
      totalChunks: chunkPlans.length,
      llmSuccessCount,
      llmFailureCount,
      fallbackCount,
      failureSamples,
      modelStats: snapshotModelStats(modelStates, buildStartedAtMs),
    },
  };
}

export function createKnowledgeGraphBuildModelStats(
  routes: ResolvedExtractionRoute[],
): KnowledgeGraphBuildModelStat[] {
  return snapshotModelStats(createExtractionModelRuntimeStates(routes), Date.now());
}

export function countKnowledgeGraphChunkPlans(snapshot: StoredNovelSnapshot): number {
  return createChunkPlans(snapshot.chapters).length;
}

export function countReusableKnowledgeGraphCheckpoints(
  snapshot: StoredNovelSnapshot,
  checkpoints: StoredKnowledgeGraphBuildCheckpointRow[],
): number {
  return createReusableCheckpointMap(createChunkPlans(snapshot.chapters), checkpoints).size;
}

export async function collectAssistantSources(options: {
  snapshot: StoredNovelSnapshot;
  query: string;
  chapterId?: string;
  entities: StoredKnowledgeGraphEntityRow[];
  relations: StoredKnowledgeGraphRelationRow[];
  chunks: StoredKnowledgeGraphChunkRow[];
  embeddingModel: ResolvedCapabilityRoute | null;
  rerankModel: ResolvedCapabilityRoute | null;
}): Promise<AssistantSourceCollectionResult> {
  const sources: AssistantSourceDocument[] = [{
    type: 'metadata',
    label: '作品元数据',
    excerpt: `《${options.snapshot.metadata.title}》 作者 ${options.snapshot.metadata.author || '未知作者'}。简介：${options.snapshot.metadata.description.slice(0, 220) || '暂无简介。'}`,
    chapterId: null,
  }];
  const queryTokens = extractQueryTokens(options.query);

  let queryEmbedding: number[] | null = null;
  if (options.embeddingModel && (options.entities.some((entity) => entity.embedding) || options.chunks.some((chunk) => chunk.embedding))) {
    try {
      queryEmbedding = await embedSingleValue(options.query, options.embeddingModel);
    } catch {
      queryEmbedding = null;
    }
  }

  const trace: AssistantRetrievalTrace = {
    usedEmbedding: queryEmbedding !== null,
    usedRerank: false,
    graphHits: [],
    chunkHits: [],
  };

  const localGraph = buildGraphSource(options.entities, options.relations, queryTokens, queryEmbedding);
  if (localGraph.source) {
    sources.push(localGraph.source);
  }
  trace.graphHits.push(...localGraph.hits);

  const currentChunk = options.chapterId
    ? findBestChunkForChapter(options.chunks, options.chapterId, queryTokens)
    : null;
  if (currentChunk) {
    sources.push(createChunkSource(currentChunk));
  } else if (options.chapterId) {
    const chapter = options.snapshot.chapters.find((entry) => entry.id === options.chapterId && entry.content);
    if (chapter?.content) {
      sources.push({
        type: 'chapter',
        label: `${chapter.title} · 当前章节`,
        excerpt: chapter.content.slice(0, 320),
        chapterId: chapter.id,
      });
    }
  }

  const rankedChunks = await rankChunks({
    query: options.query,
    queryTokens,
    queryEmbedding,
    chunks: options.chunks,
    excludedChunkIds: new Set(currentChunk ? [currentChunk.id] : []),
    rerankModel: options.rerankModel,
  });
  trace.usedRerank = rankedChunks.some((candidate) => candidate.rerankScore !== null);

  for (const candidate of rankedChunks) {
    if (sources.length >= MAX_ASSISTANT_SOURCES) {
      break;
    }

    trace.chunkHits.push(createChunkTrace(candidate, true));
    sources.push(createChunkSource(candidate.chunk));
  }

  for (const candidate of rankedChunks.slice(trace.chunkHits.length)) {
    trace.chunkHits.push(createChunkTrace(candidate, false));
  }

  return {
    sources: sources.slice(0, MAX_ASSISTANT_SOURCES),
    trace,
  };
}

function createChunkPlans(chapters: StoredChapterRecord[]): ChunkPlan[] {
  const chunks: ChunkPlan[] = [];

  for (const chapter of chapters) {
    if (chapter.status !== 'downloaded' || !chapter.content) {
      continue;
    }

    const paragraphs = splitParagraphs(chapter.content);
    if (paragraphs.length === 0) {
      chunks.push({
        id: createStableId('chunk-plan', `${chapter.id}:0`),
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        chunkIndex: 0,
        content: chapter.content.slice(0, MAX_CHUNK_CHARACTERS),
      });
      continue;
    }

    let buffer: string[] = [];
    let bufferLength = 0;
    let chunkIndex = 0;

    const flushBuffer = () => {
      if (buffer.length === 0) {
        return;
      }

      chunks.push({
        id: createStableId('chunk-plan', `${chapter.id}:${chunkIndex}`),
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        chunkIndex,
        content: buffer.join('\n\n'),
      });
      chunkIndex += 1;
      buffer = [];
      bufferLength = 0;
    };

    for (const paragraph of paragraphs) {
      const nextLength = bufferLength + paragraph.length + (buffer.length > 0 ? 2 : 0);
      if (buffer.length > 0 && (nextLength > MAX_CHUNK_CHARACTERS || buffer.length >= MAX_CHUNK_PARAGRAPHS)) {
        flushBuffer();
      }

      if (paragraph.length > MAX_CHUNK_CHARACTERS) {
        const segments = sliceLongText(paragraph, MAX_CHUNK_CHARACTERS);
        for (const segment of segments) {
          if (buffer.length > 0) {
            flushBuffer();
          }

          chunks.push({
            id: createStableId('chunk-plan', `${chapter.id}:${chunkIndex}`),
            chapterId: chapter.id,
            chapterIndex: chapter.index,
            chapterTitle: chapter.title,
            chunkIndex,
            content: segment,
          });
          chunkIndex += 1;
        }
        continue;
      }

      buffer.push(paragraph);
      bufferLength += paragraph.length + (buffer.length > 1 ? 2 : 0);
    }

    flushBuffer();
  }

  return chunks;
}

function applyChunkExtraction(options: {
  snapshot: StoredNovelSnapshot;
  entityMap: Map<string, AggregateEntity>;
  aliasMap: Map<string, string>;
  relationMap: Map<string, AggregateRelation>;
  chunkRows: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>;
  chunk: ChunkPlan;
  extraction: ChunkExtraction;
}): void {
  const chunkEntityNames: string[] = [];
  for (const candidate of options.extraction.entities) {
    const entityKey = upsertAggregateEntity({
      snapshot: options.snapshot,
      entityMap: options.entityMap,
      aliasMap: options.aliasMap,
      chunk: options.chunk,
      candidate,
    });
    const aggregate = options.entityMap.get(entityKey);
    if (aggregate) {
      chunkEntityNames.push(aggregate.displayName);
    }
  }

  for (const relation of options.extraction.relations) {
    const fromKey = ensureAggregateEntity({
      snapshot: options.snapshot,
      entityMap: options.entityMap,
      aliasMap: options.aliasMap,
      chunk: options.chunk,
      name: relation.from,
    });
    const toKey = ensureAggregateEntity({
      snapshot: options.snapshot,
      entityMap: options.entityMap,
      aliasMap: options.aliasMap,
      chunk: options.chunk,
      name: relation.to,
    });

    if (!fromKey || !toKey || fromKey === toKey) {
      continue;
    }

    const ordered = [fromKey, toKey].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const relationKey = `${ordered[0]}::${ordered[1]}`;
    const existing = options.relationMap.get(relationKey) ?? {
      fromKey: ordered[0] ?? fromKey,
      toKey: ordered[1] ?? toKey,
      typeVotes: new Map<KnowledgeGraphRelationType, number>(),
      summaries: [],
      chapterIds: new Set<string>(),
      evidences: [],
      weight: 0,
    };
    existing.typeVotes.set(relation.relationType, (existing.typeVotes.get(relation.relationType) ?? 0) + 1);
    existing.weight += 1;
    existing.chapterIds.add(options.chunk.chapterId);
    pushUnique(existing.summaries, relation.summary, 4);
    pushUnique(existing.evidences, relation.evidence || relation.summary, 4);
    options.relationMap.set(relationKey, existing);
  }

  options.chunkRows.push({
    id: createStableId('chunk', `${options.chunk.chapterId}:${options.chunk.chunkIndex}`),
    chapterId: options.chunk.chapterId,
    chapterIndex: options.chunk.chapterIndex,
    chunkIndex: options.chunk.chunkIndex,
    chapterTitle: options.chunk.chapterTitle,
    summary: options.extraction.summary,
    eventSummary: options.extraction.eventSummary,
    content: options.chunk.content,
    entityNames: [...new Set(chunkEntityNames)].slice(0, 8),
    keywordHints: options.extraction.keywordHints,
    embedding: null,
  });
}

function parseCheckpointExtraction(extractionJson: string): ChunkExtraction {
  return JSON.parse(extractionJson) as ChunkExtraction;
}

function createReusableCheckpointMap(
  chunkPlans: ChunkPlan[],
  checkpoints: StoredKnowledgeGraphBuildCheckpointRow[],
): Map<string, ResolvedCheckpointEntry> {
  const rawMap = new Map(checkpoints.map((checkpoint) => [checkpoint.chunkId, checkpoint]));
  const reusable = new Map<string, ResolvedCheckpointEntry>();

  for (const chunk of chunkPlans) {
    const checkpoint = rawMap.get(chunk.id);
    if (!checkpoint) {
      continue;
    }

    const extraction = parseCheckpointExtraction(checkpoint.extractionJson);
    if (!isCheckpointReusable(chunk, extraction)) {
      continue;
    }

    reusable.set(chunk.id, {
      checkpoint,
      extraction,
      warning: checkpoint.warningMessage,
    });
  }

  return reusable;
}

function isCheckpointReusable(chunk: ChunkPlan, extraction: ChunkExtraction): boolean {
  if (!extraction.sourceFingerprint) {
    return true;
  }

  return extraction.sourceFingerprint === createChunkSourceFingerprint(chunk.content);
}

function serializeCheckpointExtraction(chunk: ChunkPlan, extraction: ChunkExtraction): string {
  return JSON.stringify({
    ...extraction,
    sourceFingerprint: createChunkSourceFingerprint(chunk.content),
  });
}

function createChunkSourceFingerprint(content: string): string {
  let hash = 0;

  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
  }

  return `${content.length}:${Math.abs(hash)}`;
}

function createExtractionModelRuntimeStates(
  routes: ResolvedExtractionRoute[],
  seed: KnowledgeGraphBuildModelStat[] = [],
): Map<string, ExtractionModelRuntimeState> {
  const seedMap = new Map(seed.map((entry) => [`${entry.providerId}::${entry.modelId}`, entry]));
  const states = new Map<string, ExtractionModelRuntimeState>();

  for (const route of routes) {
    const key = getExtractionRouteModelKey(route);
    if (!key) {
      continue;
    }

    const existing = states.get(key);
    if (existing) {
      existing.maxConcurrency += route.maxConcurrency;
      continue;
    }

    const seeded = seedMap.get(key);
    states.set(key, {
      providerId: route.provider.id,
      modelId: route.model.id,
      source: route.source,
      maxConcurrency: route.maxConcurrency,
      attemptCount: seeded?.attemptCount ?? 0,
      llmSuccessCount: seeded?.llmSuccessCount ?? 0,
      failureCount: seeded?.failureCount ?? 0,
      fallbackCount: seeded?.fallbackCount ?? 0,
      handoffInCount: seeded?.handoffInCount ?? 0,
      handoffOutCount: seeded?.handoffOutCount ?? 0,
      inFlightCount: 0,
      consecutiveFailures: 0,
      circuitState: 'closed',
      circuitOpenedCount: seeded?.circuitOpenedCount ?? 0,
      cooldownUntilMs: null,
      firstAttemptAt: null,
      lastError: seeded?.lastError ?? null,
      lastStartedAt: null,
      lastCompletedAt: null,
      recentSuccessAt: [],
    });
  }

  return states;
}

function getModelStateForRoute(
  modelStates: Map<string, ExtractionModelRuntimeState>,
  route: ResolvedExtractionRoute | null,
): ExtractionModelRuntimeState | null {
  const key = getExtractionRouteModelKey(route);
  return key ? modelStates.get(key) ?? null : null;
}

function markModelAttemptStarted(
  modelState: ExtractionModelRuntimeState | null,
  pending: PendingChunkState,
  route: ResolvedExtractionRoute | null,
): void {
  if (!modelState) {
    return;
  }

  const now = new Date().toISOString();
  if (modelState.circuitState === 'open' && !isModelCoolingDown(modelState)) {
    modelState.circuitState = 'half-open';
    modelState.cooldownUntilMs = null;
  }

  const routeModelKey = getExtractionRouteModelKey(route);
  if (routeModelKey && pending.attemptedModelKeys.size > 0 && !pending.attemptedModelKeys.has(routeModelKey)) {
    modelState.handoffInCount += 1;
  }

  modelState.attemptCount += 1;
  modelState.inFlightCount += 1;
  modelState.firstAttemptAt ??= now;
  modelState.lastStartedAt = now;
}

function finalizeModelAttempt(
  modelState: ExtractionModelRuntimeState | null,
  outcome: {
    warning: string | null;
    usedLlm: boolean;
    handedOff: boolean;
    enableCircuitBreaker: boolean;
  },
): void {
  if (!modelState) {
    return;
  }

  modelState.inFlightCount = Math.max(0, modelState.inFlightCount - 1);
  modelState.lastCompletedAt = new Date().toISOString();

  if (outcome.warning) {
    modelState.failureCount += 1;
    modelState.lastError = outcome.warning;
    modelState.consecutiveFailures += 1;
    if (outcome.handedOff) {
      modelState.handoffOutCount += 1;
    } else {
      modelState.fallbackCount += 1;
    }

    if (outcome.enableCircuitBreaker && modelState.consecutiveFailures >= MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      modelState.circuitState = 'open';
      modelState.circuitOpenedCount += 1;
      const cooldownMs = Math.min(
        MODEL_CIRCUIT_BREAKER_BASE_COOLDOWN_MS * modelState.circuitOpenedCount,
        MODEL_CIRCUIT_BREAKER_MAX_COOLDOWN_MS,
      );
      modelState.cooldownUntilMs = Date.now() + cooldownMs;
    }
    return;
  }

  if (outcome.usedLlm) {
    modelState.llmSuccessCount += 1;
    modelState.recentSuccessAt.push(modelState.lastCompletedAt);
    if (modelState.recentSuccessAt.length > MODEL_THROUGHPUT_WINDOW_SIZE) {
      modelState.recentSuccessAt.splice(0, modelState.recentSuccessAt.length - MODEL_THROUGHPUT_WINDOW_SIZE);
    }
  }

  modelState.lastError = null;
  modelState.consecutiveFailures = 0;
  modelState.circuitState = 'closed';
  modelState.cooldownUntilMs = null;
}

function snapshotModelStats(
  modelStates: Map<string, ExtractionModelRuntimeState>,
  buildStartedAtMs: number,
): KnowledgeGraphBuildModelStat[] {
  return [...modelStates.values()].map((state) => {
    const recentSuccessTimesMs = state.recentSuccessAt
      .map((value) => parseTimestampMs(value))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const throughputWindowCount = recentSuccessTimesMs.length;
    const oldestSuccessMs = throughputWindowCount >= 1 ? recentSuccessTimesMs[0] ?? null : null;
    const newestSuccessMs = throughputWindowCount >= 1 ? recentSuccessTimesMs[throughputWindowCount - 1] ?? null : null;
    const throughputWindowMs = throughputWindowCount >= 2
      && oldestSuccessMs !== null
      && newestSuccessMs !== null
      ? Math.max(
          newestSuccessMs - oldestSuccessMs,
          MODEL_THROUGHPUT_MIN_WINDOW_MS,
        )
      : 0;

    return {
      providerId: state.providerId,
      modelId: state.modelId,
      source: state.source,
      maxConcurrency: state.maxConcurrency,
      attemptCount: state.attemptCount,
      llmSuccessCount: state.llmSuccessCount,
      failureCount: state.failureCount,
      fallbackCount: state.fallbackCount,
      handoffInCount: state.handoffInCount,
      handoffOutCount: state.handoffOutCount,
      inFlightCount: state.inFlightCount,
      consecutiveFailures: state.consecutiveFailures,
      circuitState: state.circuitState,
      circuitOpenedCount: state.circuitOpenedCount,
      cooldownUntil: state.cooldownUntilMs ? new Date(state.cooldownUntilMs).toISOString() : null,
      firstAttemptAt: state.firstAttemptAt,
      lastError: state.lastError,
      lastStartedAt: state.lastStartedAt,
      lastCompletedAt: state.lastCompletedAt,
      recentSuccessAt: state.recentSuccessAt,
      failureRate: state.attemptCount > 0 ? Number((state.failureCount / state.attemptCount).toFixed(4)) : 0,
      throughputPerMinute: throughputWindowCount >= 2
        ? Number((((throughputWindowCount - 1) / throughputWindowMs) * 60000).toFixed(2))
        : 0,
    };
  });
}

function isModelCoolingDown(modelState: ExtractionModelRuntimeState | null): boolean {
  return Boolean(modelState && modelState.circuitState === 'open' && modelState.cooldownUntilMs && modelState.cooldownUntilMs > Date.now());
}

function getNextModelCooldownWaitMs(
  availableSlots: Array<{ id: string; route: ResolvedExtractionRoute | null }>,
  modelStates: Map<string, ExtractionModelRuntimeState>,
): number | null {
  const waitCandidates = availableSlots.flatMap((slot) => {
    const modelState = getModelStateForRoute(modelStates, slot.route);
    if (!isModelCoolingDown(modelState) || !modelState?.cooldownUntilMs) {
      return [];
    }

    return [Math.max(1, modelState.cooldownUntilMs - Date.now())];
  });

  if (waitCandidates.length === 0) {
    return null;
  }

  return Math.min(...waitCandidates);
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function waitForDuration(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getExtractionRouteModelKey(route: ResolvedExtractionRoute | null): string | null {
  return route ? `${route.provider.id}::${route.model.id}` : null;
}

function hasRemainingCandidateModel(
  attemptedModelKeys: Set<string>,
  candidateModelKeys: Set<string>,
): boolean {
  for (const key of candidateModelKeys) {
    if (!attemptedModelKeys.has(key)) {
      return true;
    }
  }

  return false;
}

function dequeueChunkForSlot(
  pendingQueue: PendingChunkState[],
  route: ResolvedExtractionRoute | null,
): PendingChunkState | null {
  if (route === null) {
    return pendingQueue.shift() ?? null;
  }

  const routeModelKey = getExtractionRouteModelKey(route);
  if (!routeModelKey) {
    return pendingQueue.shift() ?? null;
  }

  const pendingIndex = pendingQueue.findIndex((entry) => !entry.attemptedModelKeys.has(routeModelKey));
  if (pendingIndex < 0) {
    return null;
  }

  const [pending] = pendingQueue.splice(pendingIndex, 1);
  return pending ?? null;
}

function createExtractionWorkerSlots(
  routes: ResolvedExtractionRoute[],
): Array<{ id: string; route: ResolvedExtractionRoute }> {
  const slotBuckets = routes.map((route) => Array.from({ length: route.maxConcurrency }, (_, index) => ({
    id: `${route.provider.id}::${route.model.id}::${index}`,
    route,
  })));
  const slots: Array<{ id: string; route: ResolvedExtractionRoute }> = [];
  let hasRemaining = true;

  while (hasRemaining) {
    hasRemaining = false;
    for (const bucket of slotBuckets) {
      const slot = bucket.shift();
      if (!slot) {
        continue;
      }

      hasRemaining = true;
      slots.push(slot);
    }
  }

  return slots;
}

export async function processChunkWithRoute(
  snapshot: StoredNovelSnapshot,
  chunk: ChunkPlan,
  route: ResolvedExtractionRoute | null,
): Promise<{ extraction: ChunkExtraction; warning: string | null }> {
  if (!route) {
    throw new Error('未配置图谱提取模型，无法进行结构化提取。');
  }

  try {
    return {
      extraction: await extractChunkWithLlm(snapshot, chunk, route),
      warning: null,
    };
  } catch (error) {
    return {
      extraction: FAILED_EXTRACTION,
      warning: describeErrorMessage(error),
    };
  }
}

export const FAILED_EXTRACTION: ChunkExtraction = Object.freeze({
  summary: '',
  eventSummary: '',
  entities: [],
  relations: [],
  keywordHints: [],
  usedLlm: false,
});

async function extractChunkWithLlm(
  snapshot: StoredNovelSnapshot,
  chunk: ChunkPlan,
  route: ResolvedCapabilityRoute,
): Promise<ChunkExtraction> {
  const prompt = buildChunkExtractionPrompt(snapshot, chunk);
  const heuristicFallback = buildFallbackChunkExtractionObject(extractChunkHeuristically(snapshot, chunk));

  try {
    const object = await extractChunkObjectViaSchema(prompt, route);
    return normalizeChunkExtractionObject(object);
  } catch (error) {
    if (!shouldRetryChunkExtractionAsPromptedJson(error) && !shouldFallbackChunkExtractionToPromptedJson(error)) {
      throw error;
    }
  }

  const object = await extractChunkObjectViaPromptedJson(prompt, route, heuristicFallback);
  return normalizeChunkExtractionObject(object);
}

async function extractChunkObjectViaSchema(
  prompt: string,
  route: ResolvedCapabilityRoute,
): Promise<z.infer<typeof chunkExtractionSchema>> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_SCHEMA_EXTRACTION_ATTEMPTS; attempt += 1) {
    try {
      const { object } = await generateObject({
        model: createLanguageModel(route.provider, route.model),
        schema: chunkExtractionSchema,
        prompt,
        maxOutputTokens: 1000,
      });
      return object;
    } catch (error) {
      lastError = error;
      if (shouldRetryChunkExtractionAsPromptedJson(error)) {
        throw error;
      }

      if (!shouldRetryChunkExtraction(error) || attempt >= MAX_SCHEMA_EXTRACTION_ATTEMPTS) {
        throw error;
      }

      await waitForRetry(attempt);
    }
  }

  throw lastError;
}

function normalizeChunkExtractionObject(
  object: z.infer<typeof chunkExtractionSchema>,
): ChunkExtraction {
  const entities = object.entities.map((entity) => ({
    name: entity.name.trim(),
    entityType: entity.entityType,
    aliases: entity.aliases.map((alias) => alias.trim()).filter(Boolean),
    summary: entity.summary.trim(),
    evidence: entity.evidence.trim(),
  })).filter((entity) => entity.name.length > 0);

  const relations = object.relations.map((relation) => ({
    from: relation.from.trim(),
    to: relation.to.trim(),
    relationType: relation.relationType,
    summary: relation.summary.trim(),
    evidence: relation.evidence.trim(),
    chapterScope: relation.chapterScope.trim(),
  })).filter((relation) => relation.from.length > 0 && relation.to.length > 0);

  return {
    summary: object.summary.trim(),
    eventSummary: object.events.map((event) => event.summary.trim()).filter(Boolean).join('；').slice(0, 220),
    entities,
    relations,
    keywordHints: [...new Set(object.keywordHints.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 10),
    usedLlm: true,
  };
}

function buildChunkExtractionPrompt(snapshot: StoredNovelSnapshot, chunk: ChunkPlan): string {
  return [
    '你是小说知识图谱抽取器。请只根据给定片段输出结构化 JSON，不要补写未出现内容。',
    '要求：',
    '1. entities 只保留本片段明确出现或明确指代的人物、地点、组织、概念。',
    '2. entities 的 name 必须使用原文（作品原文中的名称），不得翻译为其他语言。',
    '3. relations 只保留有明确语义的关系，禁止只因为同段出现就建立关系。',
    '4. events 用一句话概括片段中的关键事件。',
    '5. summary 用一句话总结片段；keywordHints 保留检索用关键词。',
    `作品：${snapshot.metadata.title}`,
    `作者：${snapshot.metadata.author || '未知作者'}`,
    `章节：${chunk.chapterTitle}`,
    `片段序号：${chunk.chunkIndex + 1}`,
    '正文：',
    chunk.content,
  ].join('\n\n');
}

async function extractChunkObjectViaPromptedJson(
  prompt: string,
  route: ResolvedCapabilityRoute,
  fallbackObject: z.infer<typeof chunkExtractionSchema>,
): Promise<z.infer<typeof chunkExtractionSchema>> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_PROMPTED_JSON_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateText({
        model: createLanguageModel(route.provider, route.model),
        prompt: buildPromptedJsonExtractionPrompt(prompt, attempt),
        maxOutputTokens: 1400,
        ...(route.provider.type === 'openai-compatible'
          ? {
              providerOptions: {
                openai: {
                  reasoningEffort: 'low',
                  textVerbosity: 'low',
                },
              },
            }
          : {}),
      });

      return parsePromptedChunkObject(extractJsonObject(result.text), fallbackObject);
    } catch (error) {
      lastError = error;
      if (!shouldRetryChunkExtraction(error) || attempt >= MAX_PROMPTED_JSON_ATTEMPTS) {
        throw error;
      }

      await waitForRetry(attempt);
    }
  }

  throw lastError;
}

function buildPromptedJsonExtractionPrompt(basePrompt: string, attempt: number): string {
  const instructions = [
    '请只输出一个 JSON 对象，不要输出 Markdown 代码块，不要解释。',
    'JSON 结构必须包含：summary、events、entities、relations、keywordHints。',
    'events 中每项包含 summary、evidence、chapterScope。',
    'entities 中每项包含 name、entityType、aliases、summary、evidence。',
    'relations 中每项包含 from、to、relationType、summary、evidence、chapterScope。',
    '字段缺失时请返回空数组或空字符串，不要省略键。',
  ];

  if (attempt > 1) {
    instructions.push('这是重试请求。请进一步压缩输出：events 最多 4 条、entities 最多 8 条、relations 最多 6 条；不确定时宁可留空也不要展开解释。');
  }

  return [basePrompt, ...instructions].join('\n\n');
}

function shouldRetryChunkExtractionAsPromptedJson(error: unknown): boolean {
  const message = describeErrorMessage(error).toLocaleLowerCase('zh-CN');
  return message.includes('response_format') || message.includes('json_schema') || message.includes('strictjsonschema');
}

function shouldFallbackChunkExtractionToPromptedJson(error: unknown): boolean {
  const message = describeErrorMessage(error).toLocaleLowerCase('zh-CN');
  return message.includes('invalid json')
    || message.includes('json')
    || message.includes('unterminated')
    || message.includes('unexpected end')
    || message.includes('finishreason')
    || message.includes('length')
    || message.includes('zod')
    || message.includes('invalid_value');
}

function shouldRetryChunkExtraction(error: unknown): boolean {
  const message = describeErrorMessage(error).toLocaleLowerCase('zh-CN');
  return message.includes('timeout')
    || message.includes('timed out')
    || message.includes('abort')
    || message.includes('network')
    || message.includes('socket')
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('rate limit')
    || message.includes('too many requests')
    || message.includes('temporarily unavailable')
    || message.includes('overloaded')
    || message.includes('server error')
    || message.includes('bad gateway')
    || message.includes('gateway timeout')
    || message.includes('429')
    || message.includes('500')
    || message.includes('502')
    || message.includes('503')
    || message.includes('504')
    || shouldFallbackChunkExtractionToPromptedJson(error);
}

async function waitForRetry(attempt: number): Promise<void> {
  const delayMs = EXTRACTION_RETRY_BASE_DELAY_MS * attempt;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function describeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === 'string' ? error : '未返回具体错误。';
}

function extractJsonObject(text: string): unknown {
  const candidates = [
    text.trim(),
    text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      try {
        return JSON.parse(jsonrepair(candidate)) as unknown;
      } catch {
        continue;
      }
    }
  }

  throw new Error(`模型返回的 JSON 无法解析：${text.slice(0, 240)}`);
}

function parsePromptedChunkObject(
  value: unknown,
  fallbackObject: z.infer<typeof chunkExtractionSchema>,
): z.infer<typeof chunkExtractionSchema> {
  const repaired = repairPromptedChunkObject(value);
  const parsed = chunkExtractionSchema.safeParse(repaired);
  if (parsed.success) {
    return parsed.data;
  }

  return chunkExtractionSchema.parse(salvagePromptedChunkObject(repaired, fallbackObject));
}

function repairPromptedChunkObject(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    summary: coerceLooseString(record.summary),
    events: coerceObjectArray(record.events).map((event) => ({
      summary: coerceLooseString(event.summary),
      evidence: coerceLooseString(event.evidence),
      chapterScope: coerceLooseString(event.chapterScope),
    })),
    entities: coerceObjectArray(record.entities).map((entity) => ({
      name: coerceLooseString(entity.name),
      entityType: normalizeEntityTypeValue(entity.entityType),
      aliases: coerceLooseStringArray(entity.aliases, 6, 40),
      summary: coerceLooseString(entity.summary),
      evidence: coerceLooseString(entity.evidence),
    })),
    relations: coerceObjectArray(record.relations).map((relation) => ({
      from: coerceLooseString(relation.from),
      to: coerceLooseString(relation.to),
      relationType: normalizeRelationTypeValue(relation.relationType),
      summary: coerceLooseString(relation.summary),
      evidence: coerceLooseString(relation.evidence),
      chapterScope: coerceLooseString(relation.chapterScope),
    })),
    keywordHints: coerceLooseStringArray(record.keywordHints, 10, 24),
  };
}

function salvagePromptedChunkObject(
  value: unknown,
  fallbackObject: z.infer<typeof chunkExtractionSchema>,
): z.infer<typeof chunkExtractionSchema> {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    summary: salvageScalarString(record.summary, fallbackObject.summary, 280),
    events: salvageObjectArray(record.events, chunkEventSchema, fallbackObject.events, 6),
    entities: salvageObjectArray(record.entities, chunkEntitySchema, fallbackObject.entities, 12),
    relations: salvageObjectArray(record.relations, chunkRelationSchema, fallbackObject.relations, 10),
    keywordHints: salvageStringArray(record.keywordHints, fallbackObject.keywordHints, 10, 24),
  };
}

function buildFallbackChunkExtractionObject(
  fallback: ChunkExtraction,
): z.infer<typeof chunkExtractionSchema> {
  return {
    summary: fallback.summary.trim() || '本片段包含可抽取的叙事信息。',
    events: fallback.eventSummary.trim()
      ? [{
          summary: fallback.eventSummary.trim().slice(0, 160),
          evidence: '',
          chapterScope: '',
        }]
      : [],
    entities: fallback.entities.map((entity) => ({
      name: entity.name.trim(),
      entityType: entity.entityType,
      aliases: entity.aliases.map((alias) => alias.trim()).filter(Boolean).slice(0, 6),
      summary: entity.summary.trim() || `${entity.name.trim()} 在该片段中被提及。`,
      evidence: entity.evidence.trim(),
    })).slice(0, 12),
    relations: fallback.relations.map((relation) => ({
      from: relation.from.trim(),
      to: relation.to.trim(),
      relationType: relation.relationType,
      summary: relation.summary.trim(),
      evidence: relation.evidence.trim() || relation.summary.trim(),
      chapterScope: relation.chapterScope.trim(),
    })).slice(0, 10),
    keywordHints: fallback.keywordHints.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 10),
  };
}

function coerceObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  }

  if (value && typeof value === 'object') {
    return [value as Record<string, unknown>];
  }

  return [];
}

function coerceLooseString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
}

function coerceLooseStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? [value]
      : [];

  const normalized = items.flatMap((item) => {
    const text = coerceLooseString(item);
    if (!text) {
      return [];
    }

    return text
      .split(/[\n,，、;；|/]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
  });

  return [...new Set(normalized.map((item) => item.slice(0, maxItemLength)).filter(Boolean))].slice(0, maxItems);
}

function salvageScalarString(value: unknown, fallback: string, maxLength: number): string {
  const direct = typeof value === 'string' ? value.trim() : '';
  if (direct) {
    return direct.slice(0, maxLength);
  }

  return fallback.trim().slice(0, maxLength);
}

function salvageStringArray(value: unknown, fallback: string[], maxItems: number, maxItemLength: number): string[] {
  const repaired = coerceLooseStringArray(value, maxItems, maxItemLength);
  if (repaired.length > 0) {
    return repaired;
  }

  return fallback.map((item) => item.trim().slice(0, maxItemLength)).filter(Boolean).slice(0, maxItems);
}

function salvageObjectArray<T extends z.ZodTypeAny>(
  value: unknown,
  schema: T,
  fallback: z.infer<T>[],
  maxItems: number,
): z.infer<T>[] {
  const repairedItems = Array.isArray(value) ? value : [];
  const salvaged = repairedItems
    .map((item) => schema.safeParse(item))
    .filter((result): result is { success: true; data: z.infer<T> } => result.success)
    .map((result) => result.data)
    .slice(0, maxItems);

  if (salvaged.length > 0) {
    return salvaged;
  }

  return fallback.slice(0, maxItems);
}

function normalizeEntityTypeValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLocaleLowerCase('zh-CN');
  if (['character', '人物', '角色', '主角', '配角'].includes(normalized)) {
    return 'character';
  }

  if (['location', '地点', '地名', '场景', '城市', '区域'].includes(normalized)) {
    return 'location';
  }

  if (['organization', '组织', '势力', '团体', '机构'].includes(normalized)) {
    return 'organization';
  }

  if (['concept', '概念', '物品', '线索', '设定'].includes(normalized)) {
    return 'concept';
  }

  if (['author', '作者'].includes(normalized)) {
    return 'author';
  }

  if (/[城镇村岛塔宫馆学院国州县站港湾]/.test(normalized)) {
    return 'location';
  }

  if (/[团军会局组盟宗派队署府社]/.test(normalized)) {
    return 'organization';
  }

  if (normalized.length > 0) {
    return 'character';
  }

  return value;
}

function normalizeRelationTypeValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLocaleLowerCase('zh-CN');
  if (['co_occurs', 'co-occurs', '共现', '同现', '同场', '同时出现'].includes(normalized)) {
    return 'co_occurs';
  }

  if (['alliance', '合作', '协作', '盟友', '同伴', '联手'].includes(normalized)) {
    return 'alliance';
  }

  if (['conflict', '冲突', '敌对', '对立', '战斗'].includes(normalized)) {
    return 'conflict';
  }

  if (['family', '家族', '亲属', '亲缘', '血缘'].includes(normalized)) {
    return 'family';
  }

  if (/[冲突敌对对立战斗仇杀袭击]/.test(normalized)) {
    return 'conflict';
  }

  if (/[合作协作盟友同伴联手搭档帮助调查守护结盟支持]/.test(normalized)) {
    return 'alliance';
  }

  if (/[父母兄弟姐妹家族亲属血缘]/.test(normalized)) {
    return 'family';
  }

  if (normalized.length > 0) {
    return 'co_occurs';
  }

  return value;
}

function extractChunkHeuristically(snapshot: StoredNovelSnapshot, chunk: ChunkPlan): ChunkExtraction {
  const tokens = extractTokens(chunk.content);
  const topTokens = [...tokens].slice(0, 6);
  const entities = topTokens.map((token) => ({
    name: token,
    entityType: classifyEntity(snapshot, token),
    aliases: [] as string[],
    summary: `${token} 在该片段中被直接提及。`,
    evidence: firstSentence(chunk.content),
  }));

  const relations: ChunkExtraction['relations'] = [];
  for (let index = 0; index < topTokens.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < topTokens.length && nextIndex < index + 3; nextIndex += 1) {
      const from = topTokens[index];
      const to = topTokens[nextIndex];
      if (!from || !to) {
        continue;
      }

      relations.push({
        from,
        to,
        relationType: classifyRelation(chunk.content),
        summary: buildHeuristicRelationSummary(chunk.content, from, to),
        evidence: firstSentence(chunk.content),
        chapterScope: chunk.chapterTitle,
      });
    }
  }

  return {
    summary: firstSentence(chunk.content),
    eventSummary: firstSentence(chunk.content),
    entities,
    relations: relations.slice(0, 4),
    keywordHints: topTokens,
    usedLlm: false,
  };
}

function upsertAggregateEntity(options: {
  snapshot: StoredNovelSnapshot;
  entityMap: Map<string, AggregateEntity>;
  aliasMap: Map<string, string>;
  chunk: ChunkPlan;
  candidate: ChunkExtraction['entities'][number];
}): string {
  const preferredKey = resolveEntityKey(options.candidate.name, options.aliasMap) ?? normalizeEntityKey(options.candidate.name);
  const entity = options.entityMap.get(preferredKey) ?? {
    displayName: options.candidate.name.trim(),
    aliases: new Set<string>(),
    typeVotes: new Map<KnowledgeGraphEntityType, number>(),
    summaries: [],
    chapterIds: new Set<string>(),
    mentionCount: 0,
    firstChapterIndex: options.chunk.chapterIndex,
    lastChapterIndex: options.chunk.chapterIndex,
    embedding: null,
  };

  entity.displayName = chooseBetterEntityName(entity.displayName, options.candidate.name.trim());
  entity.typeVotes.set(options.candidate.entityType, (entity.typeVotes.get(options.candidate.entityType) ?? 0) + 1);
  pushUnique(entity.summaries, options.candidate.summary || options.candidate.evidence, 4);
  entity.chapterIds.add(options.chunk.chapterId);
  entity.firstChapterIndex = Math.min(entity.firstChapterIndex, options.chunk.chapterIndex);
  entity.lastChapterIndex = Math.max(entity.lastChapterIndex, options.chunk.chapterIndex);

  const aliasCandidates = [options.candidate.name, ...options.candidate.aliases]
    .map((value) => value.trim())
    .filter(Boolean);
  const mentionNeedles = [...new Set(aliasCandidates)];
  entity.mentionCount += countMentions(options.chunk.content, mentionNeedles);

  for (const alias of mentionNeedles) {
    const aliasKey = normalizeEntityKey(alias);
    if (aliasKey && aliasKey !== preferredKey) {
      entity.aliases.add(alias);
      options.aliasMap.set(aliasKey, preferredKey);
    }
  }

  options.aliasMap.set(normalizeEntityKey(entity.displayName), preferredKey);
  options.entityMap.set(preferredKey, entity);
  return preferredKey;
}

function ensureAggregateEntity(options: {
  snapshot: StoredNovelSnapshot;
  entityMap: Map<string, AggregateEntity>;
  aliasMap: Map<string, string>;
  chunk: ChunkPlan;
  name: string;
}): string | null {
  const normalized = normalizeEntityKey(options.name);
  if (!normalized) {
    return null;
  }

  const resolved = resolveEntityKey(options.name, options.aliasMap) ?? normalized;
  if (options.entityMap.has(resolved)) {
    return resolved;
  }

  options.entityMap.set(resolved, {
    displayName: options.name.trim(),
    aliases: new Set<string>(),
    typeVotes: new Map([[classifyEntity(options.snapshot, options.name.trim()), 1]]),
    summaries: [],
    chapterIds: new Set([options.chunk.chapterId]),
    mentionCount: Math.max(1, countMentions(options.chunk.content, [options.name.trim()])),
    firstChapterIndex: options.chunk.chapterIndex,
    lastChapterIndex: options.chunk.chapterIndex,
    embedding: null,
  });
  options.aliasMap.set(normalized, resolved);
  return resolved;
}

function mergeEquivalentAggregateEntities(
  entityMap: Map<string, AggregateEntity>,
  aliasMap: Map<string, string>,
): {
  entityMap: Map<string, AggregateEntity>;
  aliasMap: Map<string, string>;
  keyRemap: Map<string, string>;
  mergedEntityCount: number;
} {
  const entries = [...entityMap.entries()].map(([key, entity]) => ({
    key,
    entity,
    profile: buildEntityIdentityProfile(entity),
    resolvedType: chooseWinner(entity.typeVotes),
  }));
  const parent = entries.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      current = parent[current] ?? current;
    }

    let walker = index;
    while (parent[walker] !== current) {
      const next = parent[walker] ?? walker;
      parent[walker] = current;
      walker = next;
    }

    return current;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex];
      const right = entries[rightIndex];
      if (!left || !right) {
        continue;
      }

      if (!areAggregateEntityTypesCompatible(left.resolvedType, right.resolvedType)) {
        continue;
      }

      if (shouldMergeAggregateEntities(left.profile, right.profile)) {
        union(leftIndex, rightIndex);
      }
    }
  }

  const groupedEntries = new Map<number, typeof entries>();
  entries.forEach((entry, index) => {
    const root = find(index);
    const group = groupedEntries.get(root) ?? [];
    group.push(entry);
    groupedEntries.set(root, group);
  });

  const mergedEntities = new Map<string, AggregateEntity>();
  const mergedAliasMap = new Map<string, string>();
  const keyRemap = new Map<string, string>();
  let mergedEntityCount = 0;

  for (const group of groupedEntries.values()) {
    const merged = mergeAggregateEntityGroup(group);
    mergedEntities.set(merged.key, merged.entity);

    for (const alias of merged.variants) {
      const normalized = normalizeEntityKey(alias);
      if (normalized) {
        mergedAliasMap.set(normalized, merged.key);
      }
    }

    for (const entry of group) {
      keyRemap.set(entry.key, merged.key);
    }

    mergedEntityCount += Math.max(0, group.length - 1);
  }

  for (const [aliasKey, resolvedKey] of aliasMap.entries()) {
    const nextKey = keyRemap.get(resolvedKey) ?? resolvedKey;
    if (mergedEntities.has(nextKey)) {
      mergedAliasMap.set(aliasKey, nextKey);
    }
  }

  return {
    entityMap: mergedEntities,
    aliasMap: mergedAliasMap,
    keyRemap,
    mergedEntityCount,
  };
}

function remapAggregateRelations(
  relationMap: Map<string, AggregateRelation>,
  keyRemap: Map<string, string>,
): Map<string, AggregateRelation> {
  const remapped = new Map<string, AggregateRelation>();

  for (const relation of relationMap.values()) {
    const fromKey = keyRemap.get(relation.fromKey) ?? relation.fromKey;
    const toKey = keyRemap.get(relation.toKey) ?? relation.toKey;
    if (fromKey === toKey) {
      continue;
    }

    const ordered = [fromKey, toKey].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const relationKey = `${ordered[0]}::${ordered[1]}`;
    const existing = remapped.get(relationKey) ?? {
      fromKey: ordered[0] ?? fromKey,
      toKey: ordered[1] ?? toKey,
      typeVotes: new Map<KnowledgeGraphRelationType, number>(),
      summaries: [],
      chapterIds: new Set<string>(),
      evidences: [],
      weight: 0,
    };

    for (const [type, votes] of relation.typeVotes.entries()) {
      existing.typeVotes.set(type, (existing.typeVotes.get(type) ?? 0) + votes);
    }

    existing.weight += relation.weight;
    relation.chapterIds.forEach((chapterId) => existing.chapterIds.add(chapterId));
    relation.summaries.forEach((summary) => pushUnique(existing.summaries, summary, 4));
    relation.evidences.forEach((evidence) => pushUnique(existing.evidences, evidence, 4));
    remapped.set(relationKey, existing);
  }

  return remapped;
}

function remapChunkEntityNames(
  chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>,
  entityMap: Map<string, AggregateEntity>,
  aliasMap: Map<string, string>,
): Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>> {
  return chunks.map((chunk) => ({
    ...chunk,
    entityNames: [...new Set(chunk.entityNames.map((name) => {
      const resolvedKey = resolveEntityKey(name, aliasMap) ?? normalizeEntityKey(name);
      return entityMap.get(resolvedKey)?.displayName ?? name.trim();
    }).filter(Boolean))].slice(0, 8),
  }));
}

function mergeAggregateEntityGroup(
  group: Array<{ key: string; entity: AggregateEntity }>,
): {
  key: string;
  entity: AggregateEntity;
  variants: string[];
} {
  const allVariants = [...new Set(group.flatMap(({ entity }) => collectAggregateEntityVariants(entity)))];
  const canonicalName = chooseCanonicalEntityVariant(allVariants);
  const canonicalKey = normalizeEntityKey(canonicalName) || group[0]?.key || '';
  const mergedEntity: AggregateEntity = {
    displayName: canonicalName || group[0]?.entity.displayName || '',
    aliases: new Set<string>(),
    typeVotes: new Map<KnowledgeGraphEntityType, number>(),
    summaries: [],
    chapterIds: new Set<string>(),
    mentionCount: 0,
    firstChapterIndex: Number.POSITIVE_INFINITY,
    lastChapterIndex: Number.NEGATIVE_INFINITY,
    embedding: null,
  };

  for (const { entity } of group) {
    for (const [type, votes] of entity.typeVotes.entries()) {
      mergedEntity.typeVotes.set(type, (mergedEntity.typeVotes.get(type) ?? 0) + votes);
    }
    entity.summaries.forEach((summary) => pushUnique(mergedEntity.summaries, summary, 4));
    entity.chapterIds.forEach((chapterId) => mergedEntity.chapterIds.add(chapterId));
    mergedEntity.mentionCount += entity.mentionCount;
    mergedEntity.firstChapterIndex = Math.min(mergedEntity.firstChapterIndex, entity.firstChapterIndex);
    mergedEntity.lastChapterIndex = Math.max(mergedEntity.lastChapterIndex, entity.lastChapterIndex);
    collectAggregateEntityVariants(entity).forEach((variant) => {
      if (variant && variant !== mergedEntity.displayName) {
        mergedEntity.aliases.add(variant);
      }
    });
  }

  if (!Number.isFinite(mergedEntity.firstChapterIndex)) {
    mergedEntity.firstChapterIndex = 0;
  }
  if (!Number.isFinite(mergedEntity.lastChapterIndex)) {
    mergedEntity.lastChapterIndex = mergedEntity.firstChapterIndex;
  }

  return {
    key: canonicalKey,
    entity: mergedEntity,
    variants: [mergedEntity.displayName, ...mergedEntity.aliases],
  };
}

function collectAggregateEntityVariants(entity: AggregateEntity): string[] {
  return [...new Set([entity.displayName, ...entity.aliases].flatMap((value) => expandEntityVariants(value)))];
}

function buildEntityIdentityProfile(entity: AggregateEntity): {
  exactKeys: Set<string>;
  mergeablePartKeys: Set<string>;
  signatureKeys: Set<string>;
} {
  const exactKeys = new Set<string>();
  const mergeablePartKeys = new Set<string>();
  const signatureKeys = new Set<string>();

  for (const variant of [entity.displayName, ...entity.aliases]) {
    const normalizedVariant = normalizeEntityKey(variant);
    if (normalizedVariant) {
      exactKeys.add(normalizedVariant);
      if (isMergeableStandaloneEntityVariant(variant)) {
        mergeablePartKeys.add(canonicalizeEntityVariant(variant));
      }
    }

    const parts = splitStructuredEntityParts(variant);
    for (const part of parts) {
      if (isMergeableStandaloneEntityVariant(part)) {
        mergeablePartKeys.add(canonicalizeEntityVariant(part));
      }
    }

    const signature = buildStructuredEntitySignature(variant);
    if (signature) {
      signatureKeys.add(signature);
    }
  }

  return { exactKeys, mergeablePartKeys, signatureKeys };
}

function shouldMergeAggregateEntities(
  left: { exactKeys: Set<string>; mergeablePartKeys: Set<string>; signatureKeys: Set<string> },
  right: { exactKeys: Set<string>; mergeablePartKeys: Set<string>; signatureKeys: Set<string> },
): boolean {
  return hasIntersection(left.exactKeys, right.exactKeys)
    || hasIntersection(left.signatureKeys, right.signatureKeys)
    || hasIntersection(left.mergeablePartKeys, right.mergeablePartKeys);
}

function areAggregateEntityTypesCompatible(
  left: KnowledgeGraphEntityType | null,
  right: KnowledgeGraphEntityType | null,
): boolean {
  return left === null || right === null || left === right;
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function expandEntityVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return [...new Set([trimmed, ...splitStructuredEntityParts(trimmed)])];
}

function splitStructuredEntityParts(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const parts = trimmed
    .split(/[()（）\[\]【】「」『』<>〈〉《》]/u)
    .map((part) => part.trim())
    .filter(Boolean);

  return [...new Set(parts.length > 1 ? parts : [trimmed])];
}

function buildStructuredEntitySignature(value: string): string | null {
  const canonicalParts = [...new Set(splitStructuredEntityParts(value).map((part) => canonicalizeEntityVariant(part)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return canonicalParts.length >= 2 ? canonicalParts.join('::') : null;
}

function canonicalizeEntityVariant(value: string): string {
  const normalized = normalizeEntityKey(value);
  if (!normalized) {
    return '';
  }

  if (['主角', '主人公'].includes(normalized)) {
    return 'protagonist';
  }

  if (['我', '私', '俺', '咱', '吾', '余', '在下', '本人', '自己'].includes(normalized)) {
    return 'self';
  }

  if (['男主角', '男主'].includes(normalized)) {
    return 'male-protagonist';
  }

  if (['女主角', '女主'].includes(normalized)) {
    return 'female-protagonist';
  }

  return normalized;
}

function isMergeableStandaloneEntityVariant(value: string): boolean {
  const canonical = canonicalizeEntityVariant(value);
  if (!canonical) {
    return false;
  }

  if (canonical === 'self') {
    return true;
  }

  return !isDescriptorLikeEntityVariant(canonical);
}

function isDescriptorLikeEntityVariant(value: string): boolean {
  return new Set([
    'protagonist',
    'male-protagonist',
    'female-protagonist',
    '老师',
    '导师',
    '队长',
    '同伴',
    '伙伴',
    '搭档',
    '守卫',
    '骑士',
    '公主',
    '王子',
    '国王',
    '皇帝',
    '会长',
    '部长',
    '店长',
    '医生',
    '护士',
  ]).has(value);
}

function chooseCanonicalEntityVariant(candidates: string[]): string {
  return [...candidates]
    .filter(Boolean)
    .sort((left, right) => scoreCanonicalEntityVariant(right) - scoreCanonicalEntityVariant(left) || left.localeCompare(right, 'zh-CN'))[0] ?? '';
}

function scoreCanonicalEntityVariant(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return Number.NEGATIVE_INFINITY;
  }

  const canonical = canonicalizeEntityVariant(trimmed);
  let score = 0;
  if (!/[()（）\[\]【】「」『』<>〈〉《》]/u.test(trimmed)) {
    score += 40;
  }
  if (canonical === 'self') {
    score += 24;
  }
  if (!isDescriptorLikeEntityVariant(canonical)) {
    score += 18;
  }
  score += Math.max(0, 12 - Math.abs(trimmed.length - 3));
  return score;
}

function finalizeEntities(
  entityMap: Map<string, AggregateEntity>,
  snapshot: StoredNovelSnapshot,
): Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>> {
  // 先构建去重后的实体列表：按 createStableId 去重，保留排序靠前（更显著）的实体。
  // normalizeEntityKey（Map 键）和 createStableId 的归一化算法不同，
  // 可能导致不同键的实体在 createStableId 下碰撞 —— 这是 UNIQUE constraint 的根因。
  const dedupedById = new Map<string, { entity: AggregateEntity; rank: number }>();
  let rank = 0;
  for (const entity of [...entityMap.values()]
    .filter((entity) => entity.displayName.length > 0)
    .sort((left, right) => {
      const chapterDelta = right.chapterIds.size - left.chapterIds.size;
      if (chapterDelta !== 0) {
        return chapterDelta;
      }

      const mentionDelta = right.mentionCount - left.mentionCount;
      if (mentionDelta !== 0) {
        return mentionDelta;
      }

      return left.displayName.localeCompare(right.displayName, 'zh-CN');
    })) {
    rank += 1;
    const id = createStableId('entity', entity.displayName);
    if (!dedupedById.has(id)) {
      dedupedById.set(id, { entity, rank });
    }
    // 已存在同 ID 的实体：保留更显著的（排序靠前的），静默丢弃后者。
  }

  const sorted = [...dedupedById.values()].sort((left, right) => left.rank - right.rank);
  const sliced = sorted.slice(0, MAX_GRAPH_ENTITIES);

  return sliced.map(({ entity }, index, all) => {
    const chapterIds = [...entity.chapterIds].sort();
    const mentionBaseline = Math.max(1, all[0]?.entity.mentionCount ?? 1);
    const entityType = chooseWinner(entity.typeVotes) ?? classifyEntity(snapshot, entity.displayName);
    return {
      id: createStableId('entity', entity.displayName),
      name: entity.displayName,
      entityType,
      summary: entity.summaries.join('；').slice(0, 240) || `${entity.displayName} 在正文中多次出现。`,
      prominence: Number((entity.mentionCount / mentionBaseline).toFixed(3)),
      mentionCount: Math.max(1, entity.mentionCount),
      mentionChapterIds: chapterIds,
      firstChapterId: chapterIds[0] ?? null,
      lastChapterId: chapterIds[chapterIds.length - 1] ?? null,
      aliases: [...entity.aliases].filter((alias) => alias !== entity.displayName).slice(0, 6),
      embedding: entity.embedding,
    } satisfies Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>;
  });
}

function finalizeRelations(
  relationMap: Map<string, AggregateRelation>,
  entityMap: Map<string, AggregateEntity>,
  retainedEntityKeys: Set<string>,
  entityIdsByKey: Map<string, string>,
): Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>> {
  return [...relationMap.values()]
    .filter((relation) => retainedEntityKeys.has(relation.fromKey) && retainedEntityKeys.has(relation.toKey))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, MAX_GRAPH_RELATIONS)
    .map((relation) => {
      const relationType = chooseWinner(relation.typeVotes) ?? 'co_occurs';
      const fromEntityId = entityIdsByKey.get(relation.fromKey) ?? createStableId('entity', relation.fromKey);
      const toEntityId = entityIdsByKey.get(relation.toKey) ?? createStableId('entity', relation.toKey);
      const displayFrom = entityMap.get(relation.fromKey)?.displayName ?? relation.fromKey;
      const displayTo = entityMap.get(relation.toKey)?.displayName ?? relation.toKey;
      return {
        id: createStableId('relation', `${fromEntityId}:${toEntityId}:${relationType}`),
        fromEntityId,
        toEntityId,
        relationType,
        summary: relation.summaries[0] ?? buildHeuristicRelationSummary(`${displayFrom} ${displayTo}`, displayFrom, displayTo),
        weight: relation.weight,
        chapterIds: [...relation.chapterIds].sort(),
        evidence: relation.evidences.slice(0, 4),
      } satisfies Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>;
    });
}

async function assignEntityEmbeddings(
  entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>,
  route: ResolvedCapabilityRoute,
  onStageProgress?: (event: KnowledgeGraphBuildStageEvent) => void | Promise<void>,
): Promise<void> {
  if (entities.length === 0) {
    return;
  }

  const texts = entities.map((entity) => [
    `实体：${entity.name}`,
    `类型：${entity.entityType}`,
    `摘要：${entity.summary}`,
    entity.aliases.length > 0 ? `别名：${entity.aliases.join('、')}` : '',
  ].filter(Boolean).join('\n'));
  const totalBatches = Math.max(1, Math.ceil(texts.length / EMBEDDING_BATCH_SIZE));
  await onStageProgress?.({
    stage: 'relating',
    progressPercent: 68,
    message: `开始为 ${entities.length} 个实体生成向量，共 ${totalBatches} 批。`,
  });
  const embeddings = await embedValues(texts, route, async ({ batchIndex, batchCount, size }) => {
    await onStageProgress?.({
      stage: 'relating',
      progressPercent: 68 + Number(((batchIndex / Math.max(batchCount, 1)) * 4).toFixed(2)),
      message: `实体向量批次 ${batchIndex}/${batchCount} 已完成，本批 ${size} 个实体。`,
    });
  });

  embeddings.forEach((embedding, index) => {
    const entity = entities[index];
    if (entity) {
      entity.embedding = embedding;
    }
  });
}

async function assignChunkEmbeddings(
  chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>,
  route: ResolvedCapabilityRoute,
  onStageProgress?: (event: KnowledgeGraphBuildStageEvent) => void | Promise<void>,
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const texts = chunks.map((chunk) => [
    `章节：${chunk.chapterTitle}`,
    `摘要：${chunk.summary}`,
    chunk.eventSummary ? `事件：${chunk.eventSummary}` : '',
    `正文：${chunk.content.slice(0, 360)}`,
  ].filter(Boolean).join('\n'));
  const totalBatches = Math.max(1, Math.ceil(texts.length / EMBEDDING_BATCH_SIZE));
  await onStageProgress?.({
    stage: 'relating',
    progressPercent: 72,
    message: `开始为 ${chunks.length} 个片段生成向量，共 ${totalBatches} 批。`,
  });
  const embeddings = await embedValues(texts, route, async ({ batchIndex, batchCount, size }) => {
    await onStageProgress?.({
      stage: 'relating',
      progressPercent: 72 + Number(((batchIndex / Math.max(batchCount, 1)) * 6).toFixed(2)),
      message: `片段向量批次 ${batchIndex}/${batchCount} 已完成，本批 ${size} 个片段。`,
    });
  });

  embeddings.forEach((embedding, index) => {
    const chunk = chunks[index];
    if (chunk) {
      chunk.embedding = embedding;
    }
  });
}

function buildFallbackGraph(
  snapshot: StoredNovelSnapshot,
  chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>,
): {
  entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>;
  relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>;
} {
  const titleEntityId = createStableId('entity', snapshot.metadata.title);
  const entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>> = [{
    id: titleEntityId,
    name: snapshot.metadata.title,
    entityType: 'concept',
    summary: '当前作品标题，对应整本书的主题锚点。',
    prominence: 1,
    mentionCount: 1,
    mentionChapterIds: chunks.map((chunk) => chunk.chapterId),
    firstChapterId: chunks[0]?.chapterId ?? null,
    lastChapterId: chunks[chunks.length - 1]?.chapterId ?? null,
    aliases: [],
    embedding: null,
  }];

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
        summary: '当前仅能从元数据恢复基础关系。',
        weight: 1,
        chapterIds: [],
        evidence: [snapshot.metadata.description.slice(0, 180)],
      }]
    : [];

  return { entities, relations };
}

function buildGraphSource(
  entities: StoredKnowledgeGraphEntityRow[],
  relations: StoredKnowledgeGraphRelationRow[],
  queryTokens: string[],
  queryEmbedding: number[] | null,
): { source: AssistantSourceDocument | null; hits: AssistantGraphTraceHit[] } {
  if (entities.length === 0) {
    return { source: null, hits: [] };
  }

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const entityScores = new Map<string, number>();

  for (const entity of entities) {
    const keywordScore = scoreTextAgainstQuery(queryTokens, `${entity.name} ${entity.aliases.join(' ')} ${entity.summary}`);
    const semanticScore = queryEmbedding && entity.embedding ? cosineSimilarity(queryEmbedding, entity.embedding) * 12 : 0;
    entityScores.set(entity.id, keywordScore + semanticScore + entity.prominence);
  }

  const rankedRelations = relations
    .map((relation) => {
      const relationText = `${relation.summary} ${relation.evidence.join(' ')}`;
      const keywordScore = scoreTextAgainstQuery(queryTokens, relationText);
      const relatedEntityScore = (entityScores.get(relation.fromEntityId) ?? 0) + (entityScores.get(relation.toEntityId) ?? 0);
      return {
        relation,
        score: keywordScore + relatedEntityScore + relation.weight * 0.1,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);

  const relationHits: AssistantGraphTraceHit[] = rankedRelations.map(({ relation, score }) => {
    const fromEntity = entityById.get(relation.fromEntityId)?.name ?? relation.fromEntityId;
    const toEntity = entityById.get(relation.toEntityId)?.name ?? relation.toEntityId;
    const evidence = relation.evidence[0] ?? relation.summary;
    return {
      source: 'local',
      label: `${fromEntity} -> ${toEntity}`,
      excerpt: `${relation.summary}。证据：${evidence}`,
      score: Number(score.toFixed(3)),
      chapterIds: relation.chapterIds,
      entityNames: [fromEntity, toEntity],
      relationSummaries: [relation.summary],
    };
  });

  if (rankedRelations.length > 0) {
    const excerpt = rankedRelations.map(({ relation }) => {
      const fromEntity = entityById.get(relation.fromEntityId)?.name ?? relation.fromEntityId;
      const toEntity = entityById.get(relation.toEntityId)?.name ?? relation.toEntityId;
      const evidence = relation.evidence[0] ?? relation.summary;
      return `${fromEntity} -> ${toEntity}：${relation.summary}。证据：${evidence}`;
    }).join('；');
    return {
      source: {
        type: 'graph',
        label: '知识图谱子图',
        excerpt,
        chapterId: rankedRelations[0]?.relation.chapterIds[0] ?? null,
      },
      hits: relationHits,
    };
  }

  const rankedEntities = entities
    .map((entity) => ({ entity, score: entityScores.get(entity.id) ?? 0 }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  if (rankedEntities.length === 0) {
    return { source: null, hits: [] };
  }

  return {
    source: {
      type: 'graph',
      label: '知识图谱子图',
      excerpt: rankedEntities.map(({ entity }) => `${entity.name}：${entity.summary}`).join('；'),
      chapterId: rankedEntities[0]?.entity.firstChapterId ?? null,
    },
    hits: rankedEntities.map(({ entity, score }) => ({
      source: 'local',
      label: entity.name,
      excerpt: entity.summary,
      score: Number(score.toFixed(3)),
      chapterIds: entity.mentionChapterIds,
      entityNames: [entity.name],
      relationSummaries: [],
    })),
  };
}

function findBestChunkForChapter(
  chunks: StoredKnowledgeGraphChunkRow[],
  chapterId: string,
  queryTokens: string[],
): StoredKnowledgeGraphChunkRow | null {
  const candidates = chunks.filter((chunk) => chunk.chapterId === chapterId);
  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((chunk) => ({
      chunk,
      score: scoreTextAgainstQuery(queryTokens, `${chunk.summary} ${chunk.eventSummary} ${chunk.content}`),
    }))
    .sort((left, right) => right.score - left.score || left.chunk.chunkIndex - right.chunk.chunkIndex)[0]?.chunk ?? candidates[0] ?? null;
}

async function rankChunks(options: {
  query: string;
  queryTokens: string[];
  queryEmbedding: number[] | null;
  chunks: StoredKnowledgeGraphChunkRow[];
  excludedChunkIds: Set<string>;
  rerankModel: ResolvedCapabilityRoute | null;
}): Promise<RankedChunkCandidate[]> {
  const ranked = options.chunks
    .filter((chunk) => !options.excludedChunkIds.has(chunk.id))
    .map((chunk) => {
      const keywordScore = scoreTextAgainstQuery(options.queryTokens, `${chunk.chapterTitle} ${chunk.summary} ${chunk.eventSummary} ${chunk.content}`);
      const semanticScore = options.queryEmbedding && chunk.embedding ? cosineSimilarity(options.queryEmbedding, chunk.embedding) * 12 : 0;
      return {
        chunk,
        keywordScore,
        semanticScore,
        rerankScore: null,
        finalScore: keywordScore + semanticScore,
      } satisfies RankedChunkCandidate;
    })
    .filter((entry) => entry.finalScore > 0)
    .sort((left, right) => right.finalScore - left.finalScore || left.chunk.chapterIndex - right.chunk.chapterIndex)
    .slice(0, MAX_RERANK_DOCUMENTS);

  if (ranked.length <= 1 || !options.rerankModel) {
    return ranked.slice(0, MAX_ASSISTANT_SOURCES);
  }

  try {
    const rerankedScores = await rerankDocuments(options.query, ranked, options.rerankModel);
    return ranked
      .map((entry, index) => ({
        ...entry,
        rerankScore: rerankedScores.get(index) ?? 0,
        finalScore: entry.finalScore + (rerankedScores.get(index) ?? 0) * 10,
      }))
      .sort((left, right) => right.finalScore - left.finalScore || left.chunk.chapterIndex - right.chunk.chapterIndex)
      .slice(0, MAX_ASSISTANT_SOURCES);
  } catch {
    return ranked.slice(0, MAX_ASSISTANT_SOURCES);
  }
}

function createChunkSource(chunk: StoredKnowledgeGraphChunkRow): AssistantSourceDocument {
  const excerpt = [chunk.summary, chunk.eventSummary, chunk.content.slice(0, 240)]
    .filter(Boolean)
    .join('。')
    .slice(0, 320);

  return {
    type: 'chapter',
    label: `${chunk.chapterTitle} · 片段 ${chunk.chunkIndex + 1}`,
    excerpt,
    chapterId: chunk.chapterId,
  };
}

function createChunkTrace(candidate: RankedChunkCandidate, selected: boolean): AssistantChunkTraceHit {
  return {
    chunkId: candidate.chunk.id,
    label: `${candidate.chunk.chapterTitle} · 片段 ${candidate.chunk.chunkIndex + 1}`,
    chapterId: candidate.chunk.chapterId,
    excerpt: [candidate.chunk.summary, candidate.chunk.eventSummary, candidate.chunk.content.slice(0, 160)]
      .filter(Boolean)
      .join('。')
      .slice(0, 280),
    keywordScore: Number(candidate.keywordScore.toFixed(3)),
    semanticScore: Number(candidate.semanticScore.toFixed(3)),
    rerankScore: candidate.rerankScore === null ? null : Number(candidate.rerankScore.toFixed(3)),
    finalScore: Number(candidate.finalScore.toFixed(3)),
    selected,
  };
}

async function rerankDocuments(
  query: string,
  candidates: RankedChunkCandidate[],
  route: ResolvedCapabilityRoute,
): Promise<Map<number, number>> {
  const documents = candidates.map((entry) => `${entry.chunk.chapterTitle}\n${entry.chunk.summary}\n${entry.chunk.eventSummary}\n${entry.chunk.content.slice(0, 360)}`);

  if (route.provider.type === 'ollama') {
    const provider = createOllama({
      baseURL: normalizeBaseUrl(route.provider.baseUrl),
      ...(route.provider.apiKey ? { apiKey: route.provider.apiKey } : {}),
    });
    const result = await rerank({
      model: provider.embeddingReranking(route.model.modelId),
      query,
      documents,
      topN: documents.length,
    });

    return new Map(result.ranking.map((entry) => [entry.originalIndex, entry.score]));
  }

  if (route.provider.type === 'openai-compatible') {
    const response = await fetch(buildRerankEndpoint(route.provider), {
      method: 'POST',
      headers: buildJsonRequestHeaders(route.provider),
      body: JSON.stringify({
        model: route.model.modelId,
        query,
        documents,
        top_n: documents.length,
        topN: documents.length,
      }),
    });
    const payload = await safeReadJson(response);
    if (!response.ok || !isRecognizedRerankResponse(payload)) {
      throw new Error('Configured rerank provider did not return a recognizable ranking payload.');
    }

    return new Map(payload.data.map((entry) => [entry.index, entry.relevance_score]));
  }

  throw new Error('Current rerank path only supports openai-compatible and ollama providers.');
}

async function embedValues(
  values: string[],
  route: ResolvedCapabilityRoute,
  onBatchComplete?: (event: { batchIndex: number; batchCount: number; size: number }) => void | Promise<void>,
): Promise<number[][]> {
  if (values.length === 0) {
    return [];
  }

  if (values.length <= EMBEDDING_BATCH_SIZE) {
    const embeddings = await embedValueBatch(values, route);
    await onBatchComplete?.({ batchIndex: 1, batchCount: 1, size: values.length });
    return embeddings;
  }

  const embeddings: number[][] = [];
  const batchCount = Math.ceil(values.length / EMBEDDING_BATCH_SIZE);
  let batchIndex = 0;
  for (let start = 0; start < values.length; start += EMBEDDING_BATCH_SIZE) {
    batchIndex += 1;
    const batch = values.slice(start, start + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await embedValueBatch(batch, route);
    embeddings.push(...batchEmbeddings);
    await onBatchComplete?.({ batchIndex, batchCount, size: batch.length });
  }

  return embeddings;
}

async function embedValueBatch(values: string[], route: ResolvedCapabilityRoute): Promise<number[][]> {
  switch (route.provider.type) {
    case 'openai-compatible': {
      const provider = createOpenAI({
        apiKey: route.provider.apiKey,
        baseURL: buildProviderApiBaseUrl(route.provider),
        ...(route.provider.organization ? { organization: route.provider.organization } : {}),
        name: 'openai-compatible',
      });
      const result = await embedMany({ model: provider.embedding(route.model.modelId), values });
      return result.embeddings;
    }
    case 'google-generative-ai': {
      const provider = createGoogleGenerativeAI({
        apiKey: route.provider.apiKey,
        baseURL: normalizeBaseUrl(route.provider.baseUrl),
      });
      const result = await embedMany({ model: provider.embedding(route.model.modelId), values });
      return result.embeddings;
    }
    case 'ollama': {
      const provider = createOllama({
        baseURL: normalizeBaseUrl(route.provider.baseUrl),
        ...(route.provider.apiKey ? { apiKey: route.provider.apiKey } : {}),
      });
      const result = await embedMany({ model: provider.embedding(route.model.modelId), values });
      return result.embeddings;
    }
    case 'anthropic':
      throw new Error('Anthropic provider does not expose embeddings through the current path.');
  }
}

async function embedSingleValue(value: string, route: ResolvedCapabilityRoute): Promise<number[]> {
  const [embedding] = await embedValues([value], route);
  if (!embedding) {
    throw new Error('Embedding provider returned an empty vector set.');
  }

  return embedding;
}

function createLanguageModel(provider: LlmProviderConfig, model: LlmModelConfig) {
  switch (provider.type) {
    case 'openai-compatible': {
      const factory = createOpenAI({
        apiKey: provider.apiKey,
        baseURL: buildProviderApiBaseUrl(provider),
        ...(provider.organization ? { organization: provider.organization } : {}),
        name: 'openai-compatible',
      });
      return factory.chat(model.modelId);
    }
    case 'anthropic': {
      const factory = createAnthropic({ apiKey: provider.apiKey, baseURL: normalizeBaseUrl(provider.baseUrl) });
      return factory(model.modelId);
    }
    case 'google-generative-ai': {
      const factory = createGoogleGenerativeAI({ apiKey: provider.apiKey, baseURL: normalizeBaseUrl(provider.baseUrl) });
      return factory(model.modelId);
    }
    case 'ollama': {
      const factory = createOllama({ baseURL: normalizeBaseUrl(provider.baseUrl), ...(provider.apiKey ? { apiKey: provider.apiKey } : {}) });
      return factory.chat(model.modelId);
    }
  }
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\r?\n{2,}/)
    .map((paragraph) => paragraph.replace(/!\[[^\]]*\]\(([^)]+)\)/g, ' ').replace(/<[^>]+>/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

function sliceLongText(text: string, maxLength: number): string[] {
  const slices: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    slices.push(text.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }
  return slices;
}

function extractTokens(text: string): string[] {
  const normalized = text.replace(/[，。！？、；：,.!?()\[\]{}<>\s]|[和与在从向对把被将了的地得是又并而后前中上下来]/g, ' ');
  const matches = normalized.match(TOKEN_PATTERN) ?? [];
  const expanded = matches.flatMap((value) => expandTokenCandidates(value.trim()));
  return [...new Set(expanded.filter((token) => isEntityToken(token)))];
}

function extractQueryTokens(query: string): string[] {
  const tokens = query.match(TOKEN_PATTERN) ?? [];
  const expanded = tokens.flatMap((token) => expandTokenCandidates(token.trim()));
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
  if (token.length < 2 || token.length > 16 || STOP_TOKENS.has(token)) {
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

function buildHeuristicRelationSummary(text: string, from: string, to: string): string {
  const relationType = classifyRelation(text);
  const label = relationType === 'conflict'
    ? '出现冲突'
    : relationType === 'family'
      ? '出现亲缘线索'
      : relationType === 'alliance'
        ? '出现协作关系'
        : '在同一叙事片段中共同出现';
  return `${from} 与 ${to} ${label}。`;
}

function firstSentence(text: string): string {
  const sentence = text.split(/[。！？!?\n]/).map((part) => part.trim()).find(Boolean);
  return (sentence ?? text).slice(0, 180);
}

function pushUnique(values: string[], value: string, limit: number): void {
  const normalized = value.trim();
  if (!normalized || values.includes(normalized)) {
    return;
  }

  if (values.length < limit) {
    values.push(normalized);
  }
}

function chooseBetterEntityName(current: string, candidate: string): string {
  if (!current) {
    return candidate;
  }

  if (candidate.length > current.length) {
    return candidate;
  }

  return current;
}

function chooseWinner<T extends string>(votes: Map<T, number>): T | null {
  let winner: T | null = null;
  let maxVotes = -1;

  for (const [value, score] of votes.entries()) {
    if (score > maxVotes) {
      maxVotes = score;
      winner = value;
    }
  }

  return winner;
}

function normalizeEntityKey(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
}

function resolveEntityKey(value: string, aliasMap: Map<string, string>): string | null {
  const normalized = normalizeEntityKey(value);
  return aliasMap.get(normalized) ?? (normalized || null);
}

function countMentions(text: string, needles: string[]): number {
  let mentions = 0;
  for (const needle of needles) {
    if (!needle) {
      continue;
    }
    mentions += text.split(needle).length - 1;
  }
  return Math.max(1, mentions);
}

function scoreTextAgainstQuery(tokens: string[], text: string): number {
  const haystack = text.toLocaleLowerCase('zh-CN');
  return tokens.reduce((score, token) => score + (haystack.includes(token.toLocaleLowerCase('zh-CN')) ? token.length : 0), 0);
}

function createStableId(prefix: string, value: string): string {
  return `${prefix}-${value.trim().toLocaleLowerCase('zh-CN').replace(/[^\p{L}\p{N}]+/gu, '-')}`;
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

function buildRerankEndpoint(provider: Pick<LlmProviderConfig, 'type' | 'baseUrl'>): string {
  return `${buildProviderApiBaseUrl(provider)}/rerank`;
}

function buildProviderHeaders(provider: Pick<LlmProviderConfig, 'apiKey' | 'organization'>): Record<string, string> {
  return {
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    ...(provider.organization ? { 'OpenAI-Organization': provider.organization } : {}),
  };
}

function buildJsonRequestHeaders(provider: Pick<LlmProviderConfig, 'apiKey' | 'organization'>): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildProviderHeaders(provider),
  };
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecognizedRerankResponse(payload: unknown): payload is { data: Array<{ index: number; relevance_score: number }> } {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    return false;
  }

  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) && data.every((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { index?: unknown }).index === 'number' &&
    typeof (entry as { relevance_score?: unknown }).relevance_score === 'number',
  );
}