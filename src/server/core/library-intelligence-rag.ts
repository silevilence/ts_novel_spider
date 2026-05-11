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

export interface KnowledgeGraphBuildArtifacts {
  entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>;
  relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>;
  chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>;
  usedLlmExtraction: boolean;
  usedEmbeddingIndex: boolean;
  diagnostics: KnowledgeGraphBuildDiagnostics;
}

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
}

export interface KnowledgeGraphBuildDiagnostics {
  totalChunks: number;
  llmSuccessCount: number;
  llmFailureCount: number;
  fallbackCount: number;
  failureSamples: string[];
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
const MAX_GRAPH_ENTITIES = 18;
const MAX_GRAPH_RELATIONS = 24;
const MAX_ASSISTANT_SOURCES = 6;
const MAX_CHUNK_CHARACTERS = 620;
const MAX_CHUNK_PARAGRAPHS = 2;
const MAX_RERANK_DOCUMENTS = 8;
const MAX_SCHEMA_EXTRACTION_ATTEMPTS = 2;
const MAX_PROMPTED_JSON_ATTEMPTS = 3;
const EXTRACTION_RETRY_BASE_DELAY_MS = 250;
const EXTRACTION_CONCURRENCY = 2;

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
  extractionModel: ResolvedCapabilityRoute | null;
  embeddingModel: ResolvedCapabilityRoute | null;
  checkpoints?: StoredKnowledgeGraphBuildCheckpointRow[];
  extractionConcurrency?: number;
  onCheckpoint?: (checkpoint: {
    chunkId: string;
    chapterId: string;
    chapterIndex: number;
    chunkIndex: number;
    chapterTitle: string;
    extractionJson: string;
    warningMessage: string | null;
  }) => void | Promise<void>;
  onProgress?: (event: KnowledgeGraphBuildProgressEvent) => void | Promise<void>;
}): Promise<KnowledgeGraphBuildArtifacts> {
  const chunkPlans = createChunkPlans(options.snapshot.chapters);
  const entityMap = new Map<string, AggregateEntity>();
  const aliasMap = new Map<string, string>();
  const relationMap = new Map<string, AggregateRelation>();
  const chunkRows: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>> = [];

  const checkpointMap = new Map((options.checkpoints ?? []).map((checkpoint) => [checkpoint.chunkId, checkpoint]));
  const extractionByChunkId = new Map<string, { extraction: ChunkExtraction; warning: string | null }>();
  let usedLlmExtraction = false;
  let llmSuccessCount = 0;
  let llmFailureCount = 0;
  let fallbackCount = 0;
  const failureSamples: string[] = [];

  for (const checkpoint of checkpointMap.values()) {
    const extraction = parseCheckpointExtraction(checkpoint.extractionJson);
    extractionByChunkId.set(checkpoint.chunkId, {
      extraction,
      warning: checkpoint.warningMessage,
    });

    if (extraction.usedLlm) {
      usedLlmExtraction = true;
      llmSuccessCount += 1;
    } else {
      fallbackCount += 1;
      if (checkpoint.warningMessage) {
        llmFailureCount += 1;
        pushUnique(failureSamples, checkpoint.warningMessage, 4);
      }
    }
  }

  let completedChunks = checkpointMap.size;
  const pendingChunks = chunkPlans.filter((chunk) => !checkpointMap.has(chunk.id));
  const workerCount = Math.max(1, Math.min(options.extractionModel ? (options.extractionConcurrency ?? EXTRACTION_CONCURRENCY) : 1, pendingChunks.length || 1));
  let nextPendingIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextPendingIndex < pendingChunks.length) {
      const chunk = pendingChunks[nextPendingIndex];
      nextPendingIndex += 1;
      if (!chunk) {
        return;
      }

      let extraction: ChunkExtraction;
      let warning: string | null = null;

      await options.onProgress?.({
        phase: 'started',
        chunkNumber: chunkPlans.indexOf(chunk) + 1,
        processedChunks: completedChunks,
        totalChunks: chunkPlans.length,
        chapterId: chunk.chapterId,
        chapterTitle: chunk.chapterTitle,
        chunkIndex: chunk.chunkIndex,
        llmSuccessCount,
        llmFailureCount,
        fallbackCount,
        mode: options.extractionModel ? 'llm' : 'fallback',
        warning: null,
      });

      if (options.extractionModel) {
        try {
          extraction = await extractChunkWithLlm(options.snapshot, chunk, options.extractionModel);
          usedLlmExtraction = true;
          llmSuccessCount += 1;
        } catch (error) {
          warning = describeErrorMessage(error);
          llmFailureCount += 1;
          fallbackCount += 1;
          pushUnique(failureSamples, warning, 4);
          extraction = extractChunkHeuristically(options.snapshot, chunk);
        }
      } else {
        fallbackCount += 1;
        extraction = extractChunkHeuristically(options.snapshot, chunk);
      }

      extractionByChunkId.set(chunk.id, { extraction, warning });
      await options.onCheckpoint?.({
        chunkId: chunk.id,
        chapterId: chunk.chapterId,
        chapterIndex: chunk.chapterIndex,
        chunkIndex: chunk.chunkIndex,
        chapterTitle: chunk.chapterTitle,
        extractionJson: JSON.stringify(extraction),
        warningMessage: warning,
      });

      completedChunks += 1;
      await options.onProgress?.({
        phase: 'completed',
        chunkNumber: chunkPlans.indexOf(chunk) + 1,
        processedChunks: completedChunks,
        totalChunks: chunkPlans.length,
        chapterId: chunk.chapterId,
        chapterTitle: chunk.chapterTitle,
        chunkIndex: chunk.chunkIndex,
        llmSuccessCount,
        llmFailureCount,
        fallbackCount,
        mode: extraction.usedLlm ? 'llm' : 'fallback',
        warning,
      });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

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

  if (options.extractionModel && chunkPlans.length > 0 && !usedLlmExtraction && llmFailureCount === chunkPlans.length) {
    throw new Error(`已配置图谱抽取模型，但所有结构化抽取请求都失败了。最近错误：${failureSamples[0] ?? '未返回具体错误。'}`);
  }

  const finalizedEntities = finalizeEntities(entityMap, options.snapshot);
  const retainedEntityKeys = new Set(finalizedEntities.map((entity) => normalizeEntityKey(entity.name)));
  const entityIdsByKey = new Map(finalizedEntities.map((entity) => [normalizeEntityKey(entity.name), entity.id]));

  const finalizedRelations = finalizeRelations(relationMap, entityMap, retainedEntityKeys, entityIdsByKey);
  const finalizedChunks = chunkRows.map((chunk) => ({
    ...chunk,
    entityNames: chunk.entityNames.filter((name) => retainedEntityKeys.has(normalizeEntityKey(name))),
  }));

  if (finalizedEntities.length === 0) {
    const fallback = buildFallbackGraph(options.snapshot, finalizedChunks);
    if (options.embeddingModel && finalizedChunks.length > 0) {
      await assignChunkEmbeddings(finalizedChunks, options.embeddingModel);
    }

    return {
      entities: fallback.entities,
      relations: fallback.relations,
      chunks: finalizedChunks,
      usedLlmExtraction,
      usedEmbeddingIndex: Boolean(options.embeddingModel && finalizedChunks.some((chunk) => chunk.embedding)),
      diagnostics: {
        totalChunks: chunkPlans.length,
        llmSuccessCount,
        llmFailureCount,
        fallbackCount,
        failureSamples,
      },
    };
  }

  let usedEmbeddingIndex = false;
  if (options.embeddingModel) {
    await assignEntityEmbeddings(finalizedEntities, options.embeddingModel);
    await assignChunkEmbeddings(finalizedChunks, options.embeddingModel);
    usedEmbeddingIndex = finalizedEntities.some((entity) => entity.embedding) || finalizedChunks.some((chunk) => chunk.embedding);
  }

  return {
    entities: finalizedEntities,
    relations: finalizedRelations,
    chunks: finalizedChunks,
    usedLlmExtraction,
    usedEmbeddingIndex,
    diagnostics: {
      totalChunks: chunkPlans.length,
      llmSuccessCount,
      llmFailureCount,
      fallbackCount,
      failureSamples,
    },
  };
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
    '2. relations 只保留有明确语义的关系，禁止只因为同段出现就建立关系。',
    '3. events 用一句话概括片段中的关键事件。',
    '4. summary 用一句话总结片段；keywordHints 保留检索用关键词。',
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

function finalizeEntities(
  entityMap: Map<string, AggregateEntity>,
  snapshot: StoredNovelSnapshot,
): Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>> {
  return [...entityMap.values()]
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
    })
    .slice(0, MAX_GRAPH_ENTITIES)
    .map((entity, index, all) => {
      const chapterIds = [...entity.chapterIds].sort();
      const mentionBaseline = Math.max(1, all[0]?.mentionCount ?? 1);
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
  const embeddings = await embedValues(texts, route);

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
  const embeddings = await embedValues(texts, route);

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

async function embedValues(values: string[], route: ResolvedCapabilityRoute): Promise<number[][]> {
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