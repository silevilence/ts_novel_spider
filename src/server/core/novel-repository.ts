import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import type { KnowledgeGraphBuildModelStat } from './library-intelligence-rag';
import type { LlmModelGatewayRoute } from './system-preferences';

import type {
  ChapterContent,
  ChapterIndexEntry,
  NovelMetadata,
  StoredChapterRecord,
  StoredNovelSnapshot,
} from './spider';

interface NovelRow {
  source_id: string;
  novel_id: string;
  title: string;
  author: string;
  description: string;
  tags_json: string;
  chapter_count: number;
  info_page_url: string;
  updated_at: string;
  deleted_at?: string | null;
  deleted_scheduling_json?: string | null;
  deleted_opds_visible?: number | null;
}

export interface StoredNovelLibraryRow {
  sourceId: string;
  metadata: NovelMetadata;
  updatedAt: string;
  downloadedChapters: number;
  failedChapters: number;
  indexedChapters: number;
  latestDownloadedAt: string | null;
  aliases: StoredNovelAliasRow[];
  readingProgress: StoredReadingProgressRow | null;
  bookmarkCount: number;
}

export interface StoredNovelAliasRow {
  id: string;
  alias: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredReadingProgressRow {
  currentChapterId: string;
  currentChapterIndex: number;
  currentUpdatedAt: string;
  highestChapterId: string;
  highestChapterIndex: number;
  highestUpdatedAt: string;
}

export interface StoredBookmarkRow {
  id: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  volumeTitle: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTaskHistoryRow {
  taskId: string;
  sourceId: string;
  novelId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  snapshotJson: string;
}

export interface StoredScheduledNovelRow {
  sourceId: string;
  novelId: string;
  enabled: boolean;
  autoTranslate: boolean;
  autoSummarize: boolean;
  summarizeModel: LlmModelGatewayRoute | null;
  lastCheckedAt: string | null;
  lastCheckResult: 'new_chapters' | 'up_to_date' | 'error' | null;
  lastCheckMessage: string | null;
  hasSummary: boolean;
  updatedAt: string;
}

export interface StoredScheduledSummaryRow {
  id: string;
  runId: string;
  sourceId: string;
  novelId: string;
  chapterIds: string[];
  summary: string;
  providerId: string;
  modelId: string;
  createdAt: string;
}

export interface StoredScheduledCheckRunRow {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalChecked: number;
  newChaptersFound: number;
  skipped: number;
  errored: number;
}

export interface StoredOpdsNovelRow {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface StoredOpdsCompilationRunRow {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalScanned: number;
  compiled: number;
  skipped: number;
  errored: number;
}

export interface StoredKnowledgeGraphProfileInput {
  sourceId: string;
  novelId: string;
  chatProviderId: string;
  chatModelId: string;
  extractionModels: Array<{
    providerId: string;
    modelId: string;
    maxConcurrency: number;
  }>;
  embeddingProviderId: string;
  embeddingModelId: string;
  rerankProviderId: string;
  rerankModelId: string;
  extractionConcurrency: number;
  neo4jEnabled: boolean;
  neo4jUri: string;
  neo4jUsername: string;
  neo4jPassword: string;
  neo4jDatabase: string;
  configLocked: boolean;
  lockedAt: string | null;
}

export interface StoredKnowledgeGraphProfileRow extends StoredKnowledgeGraphProfileInput {
  updatedAt: string;
}

export interface StoredKnowledgeGraphBuildRow {
  status: 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  stage: 'idle' | 'extracting' | 'relating' | 'syncing' | 'completed' | 'failed';
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

export type StoredKnowledgeGraphBuildLogLevel = 'info' | 'warn' | 'error';

export interface StoredKnowledgeGraphBuildLogRow {
  id: string;
  stage: StoredKnowledgeGraphBuildRow['stage'];
  level: StoredKnowledgeGraphBuildLogLevel;
  message: string;
  createdAt: string;
}

export interface StoredKnowledgeGraphBuildCheckpointRow {
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  chunkIndex: number;
  chapterTitle: string;
  extractionJson: string;
  warningMessage: string | null;
  status: 'success' | 'failed';
  updatedAt: string;
}

export interface StoredReaderTypographyOverrideRow {
  sourceId: string;
  novelId: string;
  fontSize: number;
  fontSizePreset: string;
  lineHeight: number;
  paragraphSpacing: number;
  fontFamilyPreset: string;
  fontFamilyCustom: string;
  updatedAt: string;
}

export interface StoredKnowledgeGraphEntityRow {
  id: string;
  name: string;
  entityType: 'character' | 'location' | 'organization' | 'concept' | 'author';
  summary: string;
  prominence: number;
  mentionCount: number;
  mentionChapterIds: string[];
  firstChapterId: string | null;
  lastChapterId: string | null;
  aliases: string[];
  embedding: number[] | null;
  updatedAt: string;
}

export interface StoredKnowledgeGraphRelationRow {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: 'co_occurs' | 'alliance' | 'conflict' | 'family';
  summary: string;
  weight: number;
  chapterIds: string[];
  evidence: string[];
  updatedAt: string;
}

export interface StoredKnowledgeGraphChunkRow {
  id: string;
  chapterId: string;
  chapterIndex: number;
  chunkIndex: number;
  chapterTitle: string;
  summary: string;
  eventSummary: string;
  content: string;
  entityNames: string[];
  keywordHints: string[];
  embedding: number[] | null;
  updatedAt: string;
}

/** A reusable high-level GraphRAG entry with links back to the source graph and prose. */
export interface StoredKnowledgeGraphSummaryRow {
  id: string;
  summaryType: 'subgraph' | 'chapter_cluster' | 'community';
  stableKey: string;
  title: string;
  summary: string;
  chapterIds: string[];
  entityIds: string[];
  relationIds: string[];
  embedding: number[] | null;
  sourceFingerprint: string;
  updatedAt: string;
}

// ── 翻译流水线 ──

export type TranslationLanguageCode = string;

export type TranslationBuildStatus = 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
export type TranslationBuildStage = 'idle' | 'extracting_terms' | 'translating_terms' | 'segmenting' | 'translating' | 'reviewing' | 'assembling' | 'completed' | 'failed';
export type TranslationChapterStatus = 'pending' | 'segmenting' | 'translating' | 'reviewing' | 'assembling' | 'completed' | 'failed';
export type TranslationExportMode = 'original' | 'translated' | 'bilingual';

export interface TranslationModelRoute {
  providerId: string;
  modelId: string;
  maxConcurrency: number;
}

export interface StoredTranslationProfileInput {
  sourceId: string;
  novelId: string;
  sourceLang: TranslationLanguageCode;
  targetLang: TranslationLanguageCode;
  termExtractionModel: TranslationModelRoute | null;
  translationModels: TranslationModelRoute[];
  reviewModel: TranslationModelRoute | null;
  translationConcurrency: number;
  qualityThreshold: number;
  autoRejectUntranslatedTerms: boolean;
  defaultExportMode: TranslationExportMode;
  configLocked: boolean;
  lockedAt: string | null;
}

export interface StoredTranslationProfileRow extends StoredTranslationProfileInput {
  updatedAt: string;
}

export interface StoredTranslationTermRow {
  id: string;
  sourceId: string;
  novelId: string;
  sourceTerm: string;
  targetTerm: string | null;
  entityType: string | null;
  note: string | null;
  extractedFromChapterId: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTranslationBuildRow {
  status: TranslationBuildStatus;
  stage: TranslationBuildStage;
  progressPercent: number;
  message: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  modelStatsJson: string;
  translatedChapters: number;
  reviewedChapters: number;
  failedChapters: number;
  glossaryVersion: number;
  profileVersion: number;
  currentChapterTitle: string | null;
  currentChapterParagraphs: number;
  currentChapterTranslatedParagraphs: number;
  totalTranslatedParagraphs: number;
  totalParagraphEstimate: number;
  updatedAt: string | null;
}

export type StoredTranslationBuildLogLevel = 'info' | 'warn' | 'error';

export interface StoredTranslationBuildLogRow {
  id: string;
  stage: TranslationBuildStage;
  level: StoredTranslationBuildLogLevel;
  message: string;
  createdAt: string;
}

export interface StoredTranslationBuildCheckpointRow {
  chapterId: string;
  chapterIndex: number;
  stage: TranslationChapterStatus;
  pipelineStateJson: string;
  warningMessage: string | null;
  updatedAt: string;
}

export interface StoredChapterTranslationRow {
  sourceId: string;
  novelId: string;
  chapterId: string;
  sourceLang: TranslationLanguageCode;
  targetLang: TranslationLanguageCode;
  translatedTitle: string | null;
  status: TranslationChapterStatus;
  overallQualityScore: number | null;
  translatorModelId: string | null;
  reviewerModelId: string | null;
  tokenUsageJson: string | null;
  sourceContentHash: string;
  glossaryVersion: number;
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChapterTranslationParagraphRow {
  id: string;
  sourceId: string;
  novelId: string;
  chapterId: string;
  paragraphIndex: number;
  sourceText: string;
  translatedText: string | null;
  confidence: number | null;
  appliedTermIds: string[];
  modelId: string | null;
  updatedAt: string;
}

export interface StoredChapterTranslationQaRow {
  id: string;
  sourceId: string;
  novelId: string;
  chapterId: string;
  checkType: string;
  score: number;
  severity: string;
  suggestion: string | null;
  paragraphIndices: number[];
  resolved: boolean;
  createdAt: string;
}

interface ChapterRow {
  source_id: string;
  novel_id: string;
  chapter_id: string;
  chapter_index: number;
  title: string;
  volume_title: string | null;
  url: string;
  content: string | null;
  status: 'indexed' | 'downloaded' | 'failed';
  error_message: string | null;
  downloaded_at: string | null;
  updated_at: string;
}

interface TaskHistoryRow {
  task_id: string;
  source_id: string;
  novel_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  snapshot_json: string;
}

interface NovelAliasRow {
  alias_id: string;
  source_id: string;
  novel_id: string;
  alias_value: string;
  normalized_alias: string;
  created_at: string;
  updated_at: string;
}

interface ReadingProgressRow {
  source_id: string;
  novel_id: string;
  current_chapter_id: string;
  current_chapter_index: number;
  current_updated_at: string;
  highest_chapter_id: string;
  highest_chapter_index: number;
  highest_updated_at: string;
}

interface BookmarkRow {
  bookmark_id: string;
  source_id: string;
  novel_id: string;
  chapter_id: string;
  chapter_index: number;
  chapter_title: string;
  volume_title: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

interface ReaderTypographyRow {
  source_id: string;
  novel_id: string;
  font_size: number;
  font_size_preset: string;
  line_height: number;
  paragraph_spacing: number;
  font_family_preset: string;
  font_family_custom: string;
  updated_at: string;
}

interface KnowledgeGraphProfileRow {
  source_id: string;
  novel_id: string;
  chat_provider_id: string;
  chat_model_id: string;
  extraction_models_json: string;
  embedding_provider_id: string;
  embedding_model_id: string;
  rerank_provider_id: string;
  rerank_model_id: string;
  extraction_concurrency: number;
  neo4j_enabled: number;
  neo4j_uri: string;
  neo4j_username: string;
  neo4j_password: string;
  neo4j_database: string;
  config_locked: number;
  locked_at: string | null;
  updated_at: string;
}

interface KnowledgeGraphBuildRow {
  source_id: string;
  novel_id: string;
  status: 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  stage: 'idle' | 'extracting' | 'relating' | 'syncing' | 'completed' | 'failed';
  progress_percent: number;
  message: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_built_at: string | null;
  synced_to_neo4j_at: string | null;
  entity_count: number;
  relation_count: number;
  model_stats_json: string;
  updated_at: string;
}

interface KnowledgeGraphBuildLogRow {
  log_id: string;
  source_id: string;
  novel_id: string;
  stage: StoredKnowledgeGraphBuildRow['stage'];
  level: StoredKnowledgeGraphBuildLogLevel;
  message: string;
  created_at: string;
}

interface KnowledgeGraphBuildCheckpointRow {
  source_id: string;
  novel_id: string;
  chunk_id: string;
  chapter_id: string;
  chapter_index: number;
  chunk_index: number;
  chapter_title: string;
  extraction_json: string;
  warning_message: string | null;
  status: string;
  updated_at: string;
}

interface KnowledgeGraphEntityRow {
  entity_id: string;
  source_id: string;
  novel_id: string;
  entity_name: string;
  entity_type: 'character' | 'location' | 'organization' | 'concept' | 'author';
  summary: string;
  prominence: number;
  mention_count: number;
  mention_chapter_ids_json: string;
  first_chapter_id: string | null;
  last_chapter_id: string | null;
  aliases_json: string;
  embedding_json: string | null;
  updated_at: string;
}

interface KnowledgeGraphRelationRow {
  relation_id: string;
  source_id: string;
  novel_id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: 'co_occurs' | 'alliance' | 'conflict' | 'family';
  summary: string;
  weight: number;
  chapter_ids_json: string;
  evidence_json: string;
  updated_at: string;
}

interface KnowledgeGraphChunkRow {
  chunk_id: string;
  source_id: string;
  novel_id: string;
  chapter_id: string;
  chapter_index: number;
  chunk_index: number;
  chapter_title: string;
  summary: string;
  event_summary: string;
  content: string;
  entity_names_json: string;
  keyword_hints_json: string;
  embedding_json: string | null;
  updated_at: string;
}

export interface StoredNovelVersionRow {
  version: number;
  title: string;
  author: string;
  description: string;
  tags: string[];
  createdAt: string;
}

export interface StoredChapterVersionRow {
  version: number;
  title: string;
  content: string;
  createdAt: string;
}

export interface StoredManualVolumeRow {
  title: string;
  sortIndex: number;
  chapterCount: number;
}

// ── 精翻工作区（与小说级粗翻完全隔离） ──

export type RefinedTranslationTaskStatus = 'draft' | 'paused' | 'running' | 'completed' | 'needs_attention' | 'deleted';
export type RefinedTranslationStage = 'glossary_setup' | 'glossary_translation' | 'translating' | 'checking' | 'reviewing' | 'revising' | 'completed';
export type RefinedTranslationSegmentStatus = 'pending' | 'translated' | 'skipped' | 'failed';
export type RefinedTranslationChapterStatus = RefinedTranslationSegmentStatus | 'reviewed' | 'needs_attention';
export type RefinedTranslationTermStatus = 'pending' | 'confirmed' | 'excluded';
export type RefinedTranslationReviewResolution = 'open' | 'accepted' | 'partially_accepted' | 'rejected' | 'resolved' | 'ignored' | 'superseded';

export interface RefinedModelRoute { providerId: string; modelId: string; /** Whether this workflow route should request the provider's native thinking mode. */ thinkingEnabled?: boolean; }
export interface RefinedTranslationModelConfig {
  termExtractionModel: RefinedModelRoute | null;
  termTranslationModel: RefinedModelRoute | null;
  translationModels: RefinedModelRoute[];
  omissionModel: RefinedModelRoute | null;
  reviewModel: RefinedModelRoute | null;
  concurrency: number;
  maxReviewRounds: number;
}

export interface StoredRefinedTranslationTaskRow {
  id: string; sourceId: string | null; novelId: string | null; name: string; novelTitle: string; author: string;
  /** Immutable source metadata copied at task creation; it survives source-novel deletion. */
  sourceMetadata: { title: string; author: string; description: string; tags: string[]; infoPageUrl: string };
  /** Metadata translated as part of the refined workflow; sourceMetadata remains immutable. */
  translatedMetadata: { title: string | null; author: string | null; description: string | null; tags: string[] };
  sourceLang: string; targetLang: string; status: RefinedTranslationTaskStatus; stage: RefinedTranslationStage;
  modelConfig: RefinedTranslationModelConfig; deletedAt: string | null; createdAt: string; updatedAt: string;
}
export interface StoredRefinedTranslationChapterRow {
  taskId: string; chapterId: string; chapterIndex: number; title: string; volumeTitle: string | null; sourceContent: string;
  translatedTitle: string | null; status: RefinedTranslationChapterStatus; reviewRound: number; reviewScore: number | null; updatedAt: string;
}
export interface StoredRefinedTranslationSegmentRow {
  id: string; taskId: string; chapterId: string; paragraphIndex: number; sourceText: string; translatedText: string | null;
  status: RefinedTranslationSegmentStatus; updatedAt: string;
}
export interface StoredRefinedTranslationTermRow {
  id: string; taskId: string; sourceTerm: string; targetTerm: string | null; entityType: string | null; priority: number;
  suggestion: string | null; status: RefinedTranslationTermStatus; updatedAt: string;
}
export interface StoredRefinedTranslationReviewRow {
  id: string; taskId: string; chapterId: string; reviewRound: number; severity: string; paragraphIndices: number[];
  scores: Record<string, number>; suggestion: string; replacementText: string | null; forceChange: boolean; resolved: boolean; resolution: RefinedTranslationReviewResolution; resolutionNote: string | null; createdAt: string;
}
export interface StoredRefinedTranslationLogRow { id: string; taskId: string; level: 'info' | 'warn' | 'error'; message: string; createdAt: string; }
export interface StoredRefinedTranslationTransitionRow { id: string; taskId: string; fromStage: RefinedTranslationStage | null; toStage: RefinedTranslationStage; condition: string; chapterId: string | null; reviewRound: number | null; createdAt: string; }

interface KnowledgeGraphSummaryRow {
  summary_id: string;
  source_id: string;
  novel_id: string;
  summary_type: 'subgraph' | 'chapter_cluster' | 'community';
  stable_key: string;
  title: string;
  summary: string;
  chapter_ids_json: string;
  entity_ids_json: string;
  relation_ids_json: string;
  embedding_json: string | null;
  source_fingerprint: string;
  updated_at: string;
}

// ── 翻译流水线内部行 ──

interface TranslationProfileRow {
  source_id: string;
  novel_id: string;
  source_lang: string;
  target_lang: string;
  term_extraction_model_json: string | null;
  translation_models_json: string;
  review_model_json: string | null;
  translation_concurrency: number;
  quality_threshold: number;
  auto_reject_untranslated_terms: number;
  default_export_mode: string;
  config_locked: number;
  locked_at: string | null;
  updated_at: string;
}

interface TranslationTermRow {
  term_id: string;
  source_id: string;
  novel_id: string;
  source_term: string;
  target_term: string | null;
  entity_type: string | null;
  note: string | null;
  extracted_from_chapter_id: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface TranslationBuildRow {
  source_id: string;
  novel_id: string;
  status: string;
  stage: string;
  progress_percent: number;
  message: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  model_stats_json: string;
  translated_chapters: number;
  reviewed_chapters: number;
  failed_chapters: number;
  glossary_version: number;
  profile_version: number;
  current_chapter_title: string | null;
  current_chapter_paragraphs: number;
  current_chapter_translated_paragraphs: number;
  total_translated_paragraphs: number;
  total_paragraph_estimate: number;
  updated_at: string;
}

interface TranslationBuildLogRow {
  log_id: string;
  source_id: string;
  novel_id: string;
  stage: string;
  level: string;
  message: string;
  created_at: string;
}

interface TranslationBuildCheckpointRow {
  source_id: string;
  novel_id: string;
  chapter_id: string;
  chapter_index: number;
  stage: string;
  pipeline_state_json: string;
  warning_message: string | null;
  updated_at: string;
}

interface ChapterTranslationRow {
  source_id: string;
  novel_id: string;
  chapter_id: string;
  source_lang: string;
  target_lang: string;
  translated_title: string | null;
  status: string;
  overall_quality_score: number | null;
  translator_model_id: string | null;
  reviewer_model_id: string | null;
  token_usage_json: string | null;
  source_content_hash: string;
  glossary_version: number;
  profile_version: number;
  created_at: string;
  updated_at: string;
}

interface ChapterTranslationParagraphRow {
  paragraph_id: string;
  source_id: string;
  novel_id: string;
  chapter_id: string;
  paragraph_index: number;
  source_text: string;
  translated_text: string | null;
  confidence: number | null;
  applied_term_ids_json: string;
  model_id: string | null;
  updated_at: string;
}

interface ChapterTranslationQaRow {
  qa_id: string;
  source_id: string;
  novel_id: string;
  chapter_id: string;
  check_type: string;
  score: number;
  severity: string;
  suggestion: string | null;
  paragraph_indices_json: string;
  resolved: number;
  created_at: string;
}

export class SqliteNovelRepository {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.#database.close();
  }

  getSnapshot(sourceId: string, novelId: string): StoredNovelSnapshot | null {
    const novelRow = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, title, author, description, tags_json, chapter_count, info_page_url, updated_at
          FROM novels
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as NovelRow | undefined;

    if (!novelRow) {
      return null;
    }

    const chapterRows = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, chapter_id, chapter_index, title, volume_title, url, content, status, error_message, downloaded_at, updated_at
          FROM chapters
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC
        `,
      )
      .all(sourceId, novelId) as ChapterRow[];

    return {
      sourceId,
      metadata: mapNovelRow(novelRow),
      chapters: chapterRows.map(mapChapterRow),
      updatedAt: novelRow.updated_at,
    };
  }

  /** 返回本地已索引的章节列表（仅 ChapterIndexEntry 字段） */
  getChapterIndex(sourceId: string, novelId: string): ChapterIndexEntry[] {
    const rows = this.#database
      .prepare(
        `SELECT chapter_id, chapter_index, title, volume_title, url
         FROM chapters
         WHERE source_id = ? AND novel_id = ?
         ORDER BY chapter_index ASC`,
      )
      .all(sourceId, novelId) as Array<{
      chapter_id: string; chapter_index: number; title: string;
      volume_title: string | null; url: string;
    }>;

    return rows.map((row) => {
      const entry: ChapterIndexEntry = {
        id: row.chapter_id,
        index: row.chapter_index,
        title: row.title,
        url: row.url,
      };
      if (row.volume_title) {
        entry.volumeTitle = row.volume_title;
      }
      return entry;
    });
  }

  listNovels(): StoredNovelLibraryRow[] {
    const rows = this.#database
      .prepare(
        `
          SELECT
            n.source_id,
            n.novel_id,
            n.title,
            n.author,
            n.description,
            n.tags_json,
            n.chapter_count,
            n.info_page_url,
            n.updated_at,
            COALESCE(SUM(CASE WHEN c.status = 'downloaded' THEN 1 ELSE 0 END), 0) AS downloaded_chapters,
            COALESCE(SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_chapters,
            COALESCE(SUM(CASE WHEN c.status = 'indexed' THEN 1 ELSE 0 END), 0) AS indexed_chapters,
            MAX(c.downloaded_at) AS latest_downloaded_at
          FROM novels n
          LEFT JOIN chapters c
           ON c.source_id = n.source_id
           AND c.novel_id = n.novel_id
           AND c.chapter_id NOT GLOB '__*'
          WHERE n.deleted_at IS NULL
          GROUP BY
            n.source_id,
            n.novel_id,
            n.title,
            n.author,
            n.description,
            n.tags_json,
            n.chapter_count,
            n.info_page_url,
            n.updated_at
          ORDER BY n.updated_at DESC, n.title COLLATE NOCASE ASC
        `,
      )
      .all() as Array<NovelRow & {
      downloaded_chapters: number;
      failed_chapters: number;
      indexed_chapters: number;
      latest_downloaded_at: string | null;
    }>;

    const aliasMap = this.buildAliasMap();
    const progressMap = this.buildReadingProgressMap();
    const bookmarkCountMap = this.buildBookmarkCountMap();

    return rows.map((row) => ({
      sourceId: row.source_id,
      metadata: mapNovelRow(row),
      updatedAt: row.updated_at,
      downloadedChapters: row.downloaded_chapters,
      failedChapters: row.failed_chapters,
      indexedChapters: row.indexed_chapters,
      latestDownloadedAt: row.latest_downloaded_at,
      aliases: aliasMap.get(buildNovelKey(row.source_id, row.novel_id)) ?? [],
      readingProgress: progressMap.get(buildNovelKey(row.source_id, row.novel_id)) ?? null,
      bookmarkCount: bookmarkCountMap.get(buildNovelKey(row.source_id, row.novel_id)) ?? 0,
    }));
  }

  listNovelAliases(sourceId: string, novelId: string): StoredNovelAliasRow[] {
    return this.#database
      .prepare(
        `
          SELECT alias_id, source_id, novel_id, alias_value, normalized_alias, created_at, updated_at
          FROM novel_aliases
          WHERE source_id = ? AND novel_id = ?
          ORDER BY updated_at DESC, alias_value COLLATE NOCASE ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapNovelAliasRow(row as NovelAliasRow));
  }

  createNovelAlias(sourceId: string, novelId: string, alias: string): StoredNovelAliasRow {
    this.assertNovelExists(sourceId, novelId);

    const normalizedAlias = normalizeSearchValue(alias);
    if (!normalizedAlias) {
      throw new Error('Alias must not be empty.');
    }

    const aliasValue = alias.trim();
    const aliasId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO novel_aliases (
            alias_id,
            source_id,
            novel_id,
            alias_value,
            normalized_alias,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(aliasId, sourceId, novelId, aliasValue, normalizedAlias, timestamp, timestamp);

    const createdAlias = this.listNovelAliases(sourceId, novelId).find((entry) => entry.id === aliasId);
    if (!createdAlias) {
      throw new Error(`Failed to load alias ${aliasId} after creation.`);
    }

    return createdAlias;
  }

  updateNovelAlias(sourceId: string, novelId: string, aliasId: string, alias: string): StoredNovelAliasRow | null {
    const normalizedAlias = normalizeSearchValue(alias);
    if (!normalizedAlias) {
      throw new Error('Alias must not be empty.');
    }

    const aliasValue = alias.trim();
    const timestamp = new Date().toISOString();
    const result = this.#database
      .prepare(
        `
          UPDATE novel_aliases
          SET alias_value = ?, normalized_alias = ?, updated_at = ?
          WHERE alias_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(aliasValue, normalizedAlias, timestamp, aliasId, sourceId, novelId);

    if (result.changes === 0) {
      return null;
    }

    return this.listNovelAliases(sourceId, novelId).find((entry) => entry.id === aliasId) ?? null;
  }

  deleteNovelAlias(sourceId: string, novelId: string, aliasId: string): boolean {
    const result = this.#database
      .prepare(
        `
          DELETE FROM novel_aliases
          WHERE alias_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(aliasId, sourceId, novelId);

    return result.changes > 0;
  }

  getReadingProgress(sourceId: string, novelId: string): StoredReadingProgressRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            current_chapter_id,
            current_chapter_index,
            current_updated_at,
            highest_chapter_id,
            highest_chapter_index,
            highest_updated_at
          FROM reading_progress
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as ReadingProgressRow | undefined;

    return row ? mapReadingProgressRow(row) : null;
  }

  updateReadingProgress(sourceId: string, novelId: string, chapterId: string): StoredReadingProgressRow | null {
    const chapter = this.getChapter(sourceId, novelId, chapterId);
    if (!chapter) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const existing = this.getReadingProgress(sourceId, novelId);
    const highestChapter = existing && existing.highestChapterIndex > chapter.index
      ? {
          id: existing.highestChapterId,
          index: existing.highestChapterIndex,
          updatedAt: existing.highestUpdatedAt,
        }
      : {
          id: chapter.id,
          index: chapter.index,
          updatedAt: timestamp,
        };

    this.#database
      .prepare(
        `
          INSERT INTO reading_progress (
            source_id,
            novel_id,
            current_chapter_id,
            current_chapter_index,
            current_updated_at,
            highest_chapter_id,
            highest_chapter_index,
            highest_updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            current_chapter_id = excluded.current_chapter_id,
            current_chapter_index = excluded.current_chapter_index,
            current_updated_at = excluded.current_updated_at,
            highest_chapter_id = excluded.highest_chapter_id,
            highest_chapter_index = excluded.highest_chapter_index,
            highest_updated_at = excluded.highest_updated_at
        `,
      )
      .run(
        sourceId,
        novelId,
        chapter.id,
        chapter.index,
        timestamp,
        highestChapter.id,
        highestChapter.index,
        highestChapter.updatedAt,
      );

    return this.getReadingProgress(sourceId, novelId);
  }

  listBookmarks(sourceId: string, novelId: string): StoredBookmarkRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            bookmark_id,
            source_id,
            novel_id,
            chapter_id,
            chapter_index,
            chapter_title,
            volume_title,
            note,
            created_at,
            updated_at
          FROM bookmarks
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC, created_at ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapBookmarkRow(row as BookmarkRow));
  }

  createBookmark(sourceId: string, novelId: string, chapterId: string, note: string): StoredBookmarkRow | null {
    const chapter = this.getChapter(sourceId, novelId, chapterId);
    if (!chapter) {
      return null;
    }

    const bookmarkId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const normalizedNote = note.trim();

    this.#database
      .prepare(
        `
          INSERT INTO bookmarks (
            bookmark_id,
            source_id,
            novel_id,
            chapter_id,
            chapter_index,
            chapter_title,
            volume_title,
            note,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        bookmarkId,
        sourceId,
        novelId,
        chapter.id,
        chapter.index,
        chapter.title,
        chapter.volumeTitle ?? null,
        normalizedNote,
        timestamp,
        timestamp,
      );

    return this.listBookmarks(sourceId, novelId).find((entry) => entry.id === bookmarkId) ?? null;
  }

  updateBookmark(sourceId: string, novelId: string, bookmarkId: string, note: string): StoredBookmarkRow | null {
    const timestamp = new Date().toISOString();
    const result = this.#database
      .prepare(
        `
          UPDATE bookmarks
          SET note = ?, updated_at = ?
          WHERE bookmark_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(note.trim(), timestamp, bookmarkId, sourceId, novelId);

    if (result.changes === 0) {
      return null;
    }

    return this.listBookmarks(sourceId, novelId).find((entry) => entry.id === bookmarkId) ?? null;
  }

  deleteBookmark(sourceId: string, novelId: string, bookmarkId: string): boolean {
    const result = this.#database
      .prepare(
        `
          DELETE FROM bookmarks
          WHERE bookmark_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(bookmarkId, sourceId, novelId);

    return result.changes > 0;
  }

  getReaderTypographyOverride(sourceId: string, novelId: string): StoredReaderTypographyOverrideRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            font_size,
            font_size_preset,
            line_height,
            paragraph_spacing,
            font_family_preset,
            font_family_custom,
            updated_at
          FROM reader_typography
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as ReaderTypographyRow | undefined;

    return row ? mapReaderTypographyRow(row) : null;
  }

  saveReaderTypographyOverride(input: StoredReaderTypographyOverrideRow): StoredReaderTypographyOverrideRow {
    const timestamp = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO reader_typography (
            source_id,
            novel_id,
            font_size,
            font_size_preset,
            line_height,
            paragraph_spacing,
            font_family_preset,
            font_family_custom,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (source_id, novel_id) DO UPDATE SET
            font_size = excluded.font_size,
            font_size_preset = excluded.font_size_preset,
            line_height = excluded.line_height,
            paragraph_spacing = excluded.paragraph_spacing,
            font_family_preset = excluded.font_family_preset,
            font_family_custom = excluded.font_family_custom,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId,
        input.novelId,
        input.fontSize,
        input.fontSizePreset,
        input.lineHeight,
        input.paragraphSpacing,
        input.fontFamilyPreset,
        input.fontFamilyCustom,
        timestamp,
      );

    return {
      ...input,
      updatedAt: timestamp,
    };
  }

  deleteReaderTypographyOverride(sourceId: string, novelId: string): boolean {
    const result = this.#database
      .prepare(
        `
          DELETE FROM reader_typography
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .run(sourceId, novelId);

    return result.changes > 0;
  }

  getKnowledgeGraphProfile(sourceId: string, novelId: string): StoredKnowledgeGraphProfileRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            chat_provider_id,
            chat_model_id,
            extraction_models_json,
            embedding_provider_id,
            embedding_model_id,
            rerank_provider_id,
            rerank_model_id,
            extraction_concurrency,
            neo4j_enabled,
            neo4j_uri,
            neo4j_username,
            neo4j_password,
            neo4j_database,
            config_locked,
            locked_at,
            updated_at
          FROM novel_graph_profiles
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as KnowledgeGraphProfileRow | undefined;

    return row ? mapKnowledgeGraphProfileRow(row) : null;
  }

  saveKnowledgeGraphProfile(input: StoredKnowledgeGraphProfileInput): StoredKnowledgeGraphProfileRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_graph_profiles (
            source_id,
            novel_id,
            chat_provider_id,
            chat_model_id,
            extraction_models_json,
            embedding_provider_id,
            embedding_model_id,
            rerank_provider_id,
            rerank_model_id,
            extraction_concurrency,
            neo4j_enabled,
            neo4j_uri,
            neo4j_username,
            neo4j_password,
            neo4j_database,
            config_locked,
            locked_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            chat_provider_id = excluded.chat_provider_id,
            chat_model_id = excluded.chat_model_id,
            extraction_models_json = excluded.extraction_models_json,
            embedding_provider_id = excluded.embedding_provider_id,
            embedding_model_id = excluded.embedding_model_id,
            rerank_provider_id = excluded.rerank_provider_id,
            rerank_model_id = excluded.rerank_model_id,
            extraction_concurrency = excluded.extraction_concurrency,
            neo4j_enabled = excluded.neo4j_enabled,
            neo4j_uri = excluded.neo4j_uri,
            neo4j_username = excluded.neo4j_username,
            neo4j_password = excluded.neo4j_password,
            neo4j_database = excluded.neo4j_database,
            config_locked = excluded.config_locked,
            locked_at = excluded.locked_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId,
        input.novelId,
        input.chatProviderId,
        input.chatModelId,
        JSON.stringify(input.extractionModels),
        input.embeddingProviderId,
        input.embeddingModelId,
        input.rerankProviderId,
        input.rerankModelId,
        input.extractionConcurrency,
        input.neo4jEnabled ? 1 : 0,
        input.neo4jUri,
        input.neo4jUsername,
        input.neo4jPassword,
        input.neo4jDatabase,
        input.configLocked ? 1 : 0,
        input.lockedAt,
        updatedAt,
      );

    const profile = this.getKnowledgeGraphProfile(input.sourceId, input.novelId);
    if (!profile) {
      throw new Error(`Failed to load knowledge graph profile for ${input.sourceId}/${input.novelId}.`);
    }

    return profile;
  }

  getKnowledgeGraphBuild(sourceId: string, novelId: string): StoredKnowledgeGraphBuildRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            status,
            stage,
            progress_percent,
            message,
            error_message,
            started_at,
            completed_at,
            last_built_at,
            synced_to_neo4j_at,
            entity_count,
            relation_count,
            model_stats_json,
            updated_at
          FROM novel_graph_builds
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as KnowledgeGraphBuildRow | undefined;

    return row ? mapKnowledgeGraphBuildRow(row) : null;
  }

  saveKnowledgeGraphBuild(input: {
    sourceId: string;
    novelId: string;
    status: 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
    stage: 'idle' | 'extracting' | 'relating' | 'syncing' | 'completed' | 'failed';
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
  }): StoredKnowledgeGraphBuildRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_graph_builds (
            source_id,
            novel_id,
            status,
            stage,
            progress_percent,
            message,
            error_message,
            started_at,
            completed_at,
            last_built_at,
            synced_to_neo4j_at,
            entity_count,
            relation_count,
            model_stats_json,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            status = excluded.status,
            stage = excluded.stage,
            progress_percent = excluded.progress_percent,
            message = excluded.message,
            error_message = excluded.error_message,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            last_built_at = excluded.last_built_at,
            synced_to_neo4j_at = excluded.synced_to_neo4j_at,
            entity_count = excluded.entity_count,
            relation_count = excluded.relation_count,
            model_stats_json = excluded.model_stats_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId,
        input.novelId,
        input.status,
        input.stage,
        input.progressPercent,
        input.message,
        input.errorMessage,
        input.startedAt,
        input.completedAt,
        input.lastBuiltAt,
        input.syncedToNeo4jAt,
        input.entityCount,
        input.relationCount,
        JSON.stringify(input.modelStats),
        updatedAt,
      );

    const build = this.getKnowledgeGraphBuild(input.sourceId, input.novelId);
    if (!build) {
      throw new Error(`Failed to load knowledge graph build state for ${input.sourceId}/${input.novelId}.`);
    }

    return build;
  }

  listKnowledgeGraphBuildLogs(sourceId: string, novelId: string, limit = 200): StoredKnowledgeGraphBuildLogRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            log_id,
            source_id,
            novel_id,
            stage,
            level,
            message,
            created_at
          FROM novel_graph_build_logs
          WHERE source_id = ? AND novel_id = ?
          ORDER BY created_at DESC, log_id DESC
          LIMIT ?
        `,
      )
      .all(sourceId, novelId, limit)
      .map((row) => mapKnowledgeGraphBuildLogRow(row as KnowledgeGraphBuildLogRow))
      .reverse();
  }

  appendKnowledgeGraphBuildLog(input: {
    sourceId: string;
    novelId: string;
    stage: StoredKnowledgeGraphBuildRow['stage'];
    level: StoredKnowledgeGraphBuildLogLevel;
    message: string;
  }): StoredKnowledgeGraphBuildLogRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const logId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_graph_build_logs (
            log_id,
            source_id,
            novel_id,
            stage,
            level,
            message,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(logId, input.sourceId, input.novelId, input.stage, input.level, input.message, createdAt);

    return {
      id: logId,
      stage: input.stage,
      level: input.level,
      message: input.message,
      createdAt,
    };
  }

  clearKnowledgeGraphBuildLogs(sourceId: string, novelId: string): void {
    this.#database
      .prepare('DELETE FROM novel_graph_build_logs WHERE source_id = ? AND novel_id = ?')
      .run(sourceId, novelId);
  }

  listKnowledgeGraphBuildCheckpoints(sourceId: string, novelId: string): StoredKnowledgeGraphBuildCheckpointRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            chunk_id,
            chapter_id,
            chapter_index,
            chunk_index,
            chapter_title,
            extraction_json,
            warning_message,
            status,
            updated_at
          FROM novel_graph_build_checkpoints
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC, chunk_index ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapKnowledgeGraphBuildCheckpointRow(row as KnowledgeGraphBuildCheckpointRow));
  }

  listFailedKnowledgeGraphCheckpoints(sourceId: string, novelId: string): StoredKnowledgeGraphBuildCheckpointRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            chunk_id,
            chapter_id,
            chapter_index,
            chunk_index,
            chapter_title,
            extraction_json,
            warning_message,
            status,
            updated_at
          FROM novel_graph_build_checkpoints
          WHERE source_id = ? AND novel_id = ? AND status = 'failed'
          ORDER BY chapter_index ASC, chunk_index ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapKnowledgeGraphBuildCheckpointRow(row as KnowledgeGraphBuildCheckpointRow));
  }

  saveKnowledgeGraphBuildCheckpoint(input: {
    sourceId: string;
    novelId: string;
    chunkId: string;
    chapterId: string;
    chapterIndex: number;
    chunkIndex: number;
    chapterTitle: string;
    extractionJson: string;
    warningMessage: string | null;
    status: 'success' | 'failed';
  }): void {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_graph_build_checkpoints (
            source_id,
            novel_id,
            chunk_id,
            chapter_id,
            chapter_index,
            chunk_index,
            chapter_title,
            extraction_json,
            warning_message,
            status,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id, chunk_id) DO UPDATE SET
            chapter_id = excluded.chapter_id,
            chapter_index = excluded.chapter_index,
            chunk_index = excluded.chunk_index,
            chapter_title = excluded.chapter_title,
            extraction_json = excluded.extraction_json,
            warning_message = excluded.warning_message,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId,
        input.novelId,
        input.chunkId,
        input.chapterId,
        input.chapterIndex,
        input.chunkIndex,
        input.chapterTitle,
        input.extractionJson,
        input.warningMessage,
        input.status,
        updatedAt,
      );
  }

  clearKnowledgeGraphBuildCheckpoints(sourceId: string, novelId: string): void {
    this.#database
      .prepare('DELETE FROM novel_graph_build_checkpoints WHERE source_id = ? AND novel_id = ?')
      .run(sourceId, novelId);
  }

  replaceKnowledgeGraphBuildCheckpoints(
    sourceId: string,
    novelId: string,
    checkpoints: Array<{
      chunkId: string;
      chapterId: string;
      chapterIndex: number;
      chunkIndex: number;
      chapterTitle: string;
      extractionJson: string;
      warningMessage: string | null;
      status: 'success' | 'failed';
    }>,
  ): void {
    this.assertNovelExists(sourceId, novelId);

    const insertCheckpoint = this.#database.prepare(
      `
        INSERT INTO novel_graph_build_checkpoints (
          source_id,
          novel_id,
          chunk_id,
          chapter_id,
          chapter_index,
          chunk_index,
          chapter_title,
          extraction_json,
          warning_message,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    const transaction = this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM novel_graph_build_checkpoints WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);

      for (const checkpoint of checkpoints) {
        insertCheckpoint.run(
          sourceId,
          novelId,
          checkpoint.chunkId,
          checkpoint.chapterId,
          checkpoint.chapterIndex,
          checkpoint.chunkIndex,
          checkpoint.chapterTitle,
          checkpoint.extractionJson,
          checkpoint.warningMessage,
          checkpoint.status,
          new Date().toISOString(),
        );
      }
    });

    transaction();
  }

  listResumableKnowledgeGraphBuilds(): Array<{ sourceId: string; novelId: string; build: StoredKnowledgeGraphBuildRow }> {
    return this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            status,
            stage,
            progress_percent,
            message,
            error_message,
            started_at,
            completed_at,
            last_built_at,
            synced_to_neo4j_at,
            entity_count,
            relation_count,
            updated_at
          FROM novel_graph_builds
          WHERE status IN ('queued', 'running')
          ORDER BY updated_at ASC
        `,
      )
      .all()
      .map((row) => {
        const build = row as KnowledgeGraphBuildRow;
        return {
          sourceId: build.source_id,
          novelId: build.novel_id,
          build: mapKnowledgeGraphBuildRow(build),
        };
      });
  }

  listKnowledgeGraphEntities(sourceId: string, novelId: string): StoredKnowledgeGraphEntityRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            entity_id,
            source_id,
            novel_id,
            entity_name,
            entity_type,
            summary,
            prominence,
            mention_count,
            mention_chapter_ids_json,
            first_chapter_id,
            last_chapter_id,
            aliases_json,
            embedding_json,
            updated_at
          FROM knowledge_graph_entities
          WHERE source_id = ? AND novel_id = ?
          ORDER BY prominence DESC, mention_count DESC, entity_name COLLATE NOCASE ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapKnowledgeGraphEntityRow(row as KnowledgeGraphEntityRow));
  }

  listKnowledgeGraphRelations(sourceId: string, novelId: string): StoredKnowledgeGraphRelationRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            relation_id,
            source_id,
            novel_id,
            from_entity_id,
            to_entity_id,
            relation_type,
            summary,
            weight,
            chapter_ids_json,
            evidence_json,
            updated_at
          FROM knowledge_graph_relations
          WHERE source_id = ? AND novel_id = ?
          ORDER BY weight DESC, relation_id ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapKnowledgeGraphRelationRow(row as KnowledgeGraphRelationRow));
  }

  listKnowledgeGraphChunks(sourceId: string, novelId: string): StoredKnowledgeGraphChunkRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            chunk_id,
            source_id,
            novel_id,
            chapter_id,
            chapter_index,
            chunk_index,
            chapter_title,
            summary,
            event_summary,
            content,
            entity_names_json,
            keyword_hints_json,
            embedding_json,
            updated_at
          FROM knowledge_graph_chunks
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC, chunk_index ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapKnowledgeGraphChunkRow(row as KnowledgeGraphChunkRow));
  }

  isNovelTrashed(sourceId: string, novelId: string): boolean {
    const row = this.#database.prepare(`SELECT deleted_at FROM novels WHERE source_id=? AND novel_id=?`).get(sourceId, novelId) as { deleted_at: string | null } | undefined;
    return Boolean(row?.deleted_at);
  }

  listTrashedNovels(): StoredNovelLibraryRow[] {
    const rows = this.#database.prepare(`
      SELECT n.source_id, n.novel_id, n.title, n.author, n.description, n.tags_json, n.chapter_count, n.info_page_url, n.updated_at,
        0 AS downloaded_chapters, 0 AS failed_chapters, 0 AS indexed_chapters, NULL AS latest_downloaded_at
      FROM novels n WHERE n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC
    `).all() as Array<NovelRow & { downloaded_chapters: number; failed_chapters: number; indexed_chapters: number; latest_downloaded_at: string | null }>;
    return rows.map((row) => ({ sourceId: row.source_id, metadata: mapNovelRow(row), updatedAt: row.updated_at,
      downloadedChapters: row.downloaded_chapters, failedChapters: row.failed_chapters, indexedChapters: row.indexed_chapters,
      latestDownloadedAt: row.latest_downloaded_at, aliases: [], readingProgress: null, bookmarkCount: 0 }));
  }

  createManualNovel(title: string): StoredNovelSnapshot {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('手动小说标题不能为空。');
    const novelId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    this.#database.prepare(`INSERT INTO novels (source_id, novel_id, title, author, description, tags_json, chapter_count, info_page_url, updated_at)
      VALUES ('manual', ?, ?, '', '', '[]', 0, '', ?)`).run(novelId, normalizedTitle, timestamp);
    return this.getSnapshot('manual', novelId)!;
  }

  updateManualMetadata(novelId: string, input: { title: string; author: string; description: string; tags: string[] }): { changed: boolean; snapshot: StoredNovelSnapshot } {
    const previous = this.getSnapshot('manual', novelId);
    if (!previous) throw new Error('手动小说不存在。');
    const title = input.title.trim();
    if (!title) throw new Error('标题不能为空。');
    const author = input.author.trim(); const description = input.description.trim();
    const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
    const unchanged = previous.metadata.title === title && previous.metadata.author === author && previous.metadata.description === description
      && areTagsEquivalent(previous.metadata.tags, tags);
    if (unchanged) return { changed: false, snapshot: previous };
    const timestamp = new Date().toISOString();
    this.#database.prepare(`UPDATE novels SET title = ?, author = ?, description = ?, tags_json = ?, updated_at = ? WHERE source_id = 'manual' AND novel_id = ?`)
      .run(title, author, description, JSON.stringify(tags), timestamp, novelId);
    const version = this.#nextMetadataVersion('manual', novelId);
    this.#recordMetadataVersion('manual', novelId, version, title, author, description, tags, timestamp);
    return { changed: true, snapshot: this.getSnapshot('manual', novelId)! };
  }

  /** 创建或保存手动章节；只有内容、标题或所属卷实际变化时才产生版本。 */
  saveManualChapter(novelId: string, input: { chapterId?: string; title: string; volumeTitle?: string | null; content: string }): { changed: boolean; chapter: StoredChapterRecord } {
    const snapshot = this.getSnapshot('manual', novelId);
    if (!snapshot) throw new Error('手动小说不存在。');
    const title = input.title.trim();
    if (!title) throw new Error('章节标题不能为空。');
    const chapterId = input.chapterId ?? crypto.randomUUID();
    const old = input.chapterId ? this.getChapter('manual', novelId, chapterId) : null;
    const content = input.content;
    if (old && old.title === title && old.content === content && (old.volumeTitle ?? null) === (input.volumeTitle?.trim() || null)) return { changed: false, chapter: old };
    const timestamp = new Date().toISOString();
    const chapterIndex = old?.index ?? snapshot.chapters.filter((chapter) => !chapter.id.startsWith('__')).length + 1;
    const volumeTitle = input.volumeTitle?.trim() || null;
    if (volumeTitle) this.#ensureManualVolume(novelId, volumeTitle);
    this.#database.prepare(`INSERT INTO chapters (source_id, novel_id, chapter_id, chapter_index, title, volume_title, url, content, status, error_message, downloaded_at, updated_at)
      VALUES ('manual', ?, ?, ?, ?, ?, '', ?, 'downloaded', NULL, ?, ?)
      ON CONFLICT(source_id, novel_id, chapter_id) DO UPDATE SET title=excluded.title, volume_title=excluded.volume_title, content=excluded.content, status='downloaded', downloaded_at=excluded.downloaded_at, updated_at=excluded.updated_at`)
      .run(novelId, chapterId, chapterIndex, title, volumeTitle, content, timestamp, timestamp);
    this.#database.prepare(`UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE source_id='manual' AND novel_id=? AND chapter_id NOT GLOB '__*'), updated_at=? WHERE source_id='manual' AND novel_id=?`).run(novelId, timestamp, novelId);
    this.#reindexManualChapters(novelId);
    const current = this.getChapter('manual', novelId, chapterId)!;
    const nextVersion = this.#nextChapterVersion('manual', novelId, chapterId);
    if (nextVersion > 0 || content.trim()) {
      this.#recordChapterVersion('manual', novelId, chapterId, nextVersion, title, content, timestamp);
    }
    return { changed: true, chapter: current };
  }

  deleteManualChapter(novelId: string, chapterId: string): boolean {
    const result = this.#database.prepare(`DELETE FROM chapters WHERE source_id='manual' AND novel_id=? AND chapter_id=?`).run(novelId, chapterId);
    if (result.changes) this.#reindexManualChapters(novelId);
    return result.changes > 0;
  }

  reorderManualChapters(novelId: string, chapterIds: string[]): void {
    const current = this.getSnapshot('manual', novelId); if (!current) throw new Error('手动小说不存在。');
    const realIds = current.chapters.filter((chapter) => !chapter.id.startsWith('__')).map((chapter) => chapter.id);
    if (new Set(chapterIds).size !== realIds.length || chapterIds.some((id) => !realIds.includes(id))) throw new Error('章节排序数据不完整。');
    const transaction = this.#database.transaction(() => chapterIds.forEach((id, index) => this.#database.prepare(`UPDATE chapters SET chapter_index=?, updated_at=? WHERE source_id='manual' AND novel_id=? AND chapter_id=?`).run(index + 1, new Date().toISOString(), novelId, id)));
    transaction();
  }

  listManualVolumes(novelId: string): StoredManualVolumeRow[] {
    this.assertNovelExists('manual', novelId);
    return this.#database.prepare(`SELECT mv.volume_title, mv.sort_index, COUNT(c.chapter_id) AS chapter_count
      FROM manual_volumes mv LEFT JOIN chapters c ON c.source_id='manual' AND c.novel_id=mv.novel_id AND c.volume_title=mv.volume_title
      WHERE mv.novel_id=? GROUP BY mv.volume_title, mv.sort_index ORDER BY mv.sort_index, mv.volume_title`).all(novelId)
      .map((row) => { const value = row as { volume_title: string; sort_index: number; chapter_count: number }; return { title: value.volume_title, sortIndex: value.sort_index, chapterCount: value.chapter_count }; });
  }

  createManualVolume(novelId: string, title: string): StoredManualVolumeRow {
    const normalized = title.trim(); if (!normalized) throw new Error('卷名不能为空。');
    this.assertNovelExists('manual', novelId); this.#ensureManualVolume(novelId, normalized);
    return this.listManualVolumes(novelId).find((volume) => volume.title === normalized)!;
  }

  renameManualVolume(novelId: string, title: string, nextTitle: string): void {
    const normalized = nextTitle.trim(); if (!normalized) throw new Error('卷名不能为空。');
    const transaction = this.#database.transaction(() => {
      const changed = this.#database.prepare(`UPDATE manual_volumes SET volume_title=? WHERE novel_id=? AND volume_title=?`).run(normalized, novelId, title).changes;
      if (!changed) throw new Error('卷不存在。');
      this.#database.prepare(`UPDATE chapters SET volume_title=?, updated_at=? WHERE source_id='manual' AND novel_id=? AND volume_title=?`).run(normalized, new Date().toISOString(), novelId, title);
    }); transaction();
  }

  deleteManualVolume(novelId: string, title: string): number {
    const transaction = this.#database.transaction(() => {
      const deleted = this.#database.prepare(`DELETE FROM chapters WHERE source_id='manual' AND novel_id=? AND volume_title=?`).run(novelId, title).changes;
      this.#database.prepare(`DELETE FROM manual_volumes WHERE novel_id=? AND volume_title=?`).run(novelId, title);
      this.#reindexManualChapters(novelId); return deleted;
    }); return transaction();
  }

  listMetadataVersions(sourceId: string, novelId: string): StoredNovelVersionRow[] {
    return this.#database.prepare(`SELECT version, title, author, description, tags_json, created_at FROM novel_metadata_versions WHERE source_id=? AND novel_id=? ORDER BY version DESC`).all(sourceId, novelId)
      .map((row) => { const value = row as { version: number; title: string; author: string; description: string; tags_json: string; created_at: string }; return { version: value.version, title: value.title, author: value.author, description: value.description, tags: parseTagsJson(value.tags_json), createdAt: value.created_at }; });
  }

  listChapterVersions(sourceId: string, novelId: string, chapterId: string): StoredChapterVersionRow[] {
    return this.#database.prepare(`SELECT version, title, content, created_at FROM chapter_versions WHERE source_id=? AND novel_id=? AND chapter_id=? ORDER BY version DESC`).all(sourceId, novelId, chapterId)
      .map((row) => { const value = row as { version: number; title: string; content: string; created_at: string }; return { version: value.version, title: value.title, content: value.content, createdAt: value.created_at }; });
  }

  getChapterVersionChangeCount(sourceId: string, novelId: string, chapterId: string): number {
    const row = this.#database.prepare(
      `SELECT COUNT(*) AS count FROM chapter_versions WHERE source_id=? AND novel_id=? AND chapter_id=?`,
    ).get(sourceId, novelId, chapterId) as { count: number };
    return Math.max(0, row.count - 1);
  }

  restoreMetadataVersion(sourceId: string, novelId: string, version: number): StoredNovelSnapshot {
    const row = this.#database.prepare(`SELECT title, author, description, tags_json FROM novel_metadata_versions WHERE source_id=? AND novel_id=? AND version=?`).get(sourceId, novelId, version) as { title: string; author: string; description: string; tags_json: string } | undefined;
    if (!row) throw new Error('元数据版本不存在。');
    const snapshot = this.getSnapshot(sourceId, novelId); if (!snapshot) throw new Error('小说不存在。');
    const timestamp = new Date().toISOString();
    this.#database.prepare(`UPDATE novels SET title=?, author=?, description=?, tags_json=?, updated_at=? WHERE source_id=? AND novel_id=?`).run(row.title, row.author, row.description, row.tags_json, timestamp, sourceId, novelId);
    this.#recordMetadataVersion(sourceId, novelId, this.#nextMetadataVersion(sourceId, novelId), row.title, row.author, row.description, parseTagsJson(row.tags_json), timestamp);
    return this.getSnapshot(sourceId, novelId)!;
  }

  restoreChapterVersion(sourceId: string, novelId: string, chapterId: string, version: number): StoredChapterRecord {
    const row = this.#database.prepare(`SELECT title, content FROM chapter_versions WHERE source_id=? AND novel_id=? AND chapter_id=? AND version=?`).get(sourceId, novelId, chapterId, version) as { title: string; content: string } | undefined;
    if (!row) throw new Error('章节版本不存在。');
    const current = this.getChapter(sourceId, novelId, chapterId); if (!current) throw new Error('章节不存在。');
    const timestamp = new Date().toISOString();
    this.#database.prepare(`UPDATE chapters SET title=?, content=?, status='downloaded', downloaded_at=?, updated_at=? WHERE source_id=? AND novel_id=? AND chapter_id=?`).run(row.title, row.content, timestamp, timestamp, sourceId, novelId, chapterId);
    this.#recordChapterVersion(sourceId, novelId, chapterId, this.#nextChapterVersion(sourceId, novelId, chapterId), row.title, row.content, timestamp);
    return this.getChapter(sourceId, novelId, chapterId)!;
  }

  /** 将小说移入回收站，并保存其原定时更新与 OPDS 状态。 */
  moveNovelToTrash(sourceId: string, novelId: string): boolean {
    const novel = this.#database.prepare(`SELECT deleted_at, opds_visible FROM novels WHERE source_id=? AND novel_id=?`).get(sourceId, novelId) as { deleted_at: string | null; opds_visible: number } | undefined;
    if (!novel || novel.deleted_at) return false;
    const scheduled = this.getScheduledNovel(sourceId, novelId);
    this.#database.prepare(`UPDATE novels SET deleted_at=?, deleted_scheduling_json=?, deleted_opds_visible=?, opds_visible=0 WHERE source_id=? AND novel_id=?`)
      .run(new Date().toISOString(), JSON.stringify(scheduled ?? null), novel.opds_visible, sourceId, novelId);
    this.deleteScheduledNovel(sourceId, novelId);
    return true;
  }

  /** 从回收站还原小说及其移入前的定时更新与 OPDS 状态。 */
  restoreNovelFromTrash(sourceId: string, novelId: string): boolean {
    const row = this.#database.prepare(`SELECT deleted_at, deleted_scheduling_json, deleted_opds_visible FROM novels WHERE source_id=? AND novel_id=?`).get(sourceId, novelId) as { deleted_at: string | null; deleted_scheduling_json: string | null; deleted_opds_visible: number | null } | undefined;
    if (!row?.deleted_at) return false;
    const transaction = this.#database.transaction(() => {
      this.#database.prepare(`UPDATE novels SET deleted_at=NULL, opds_visible=?, deleted_scheduling_json=NULL, deleted_opds_visible=NULL WHERE source_id=? AND novel_id=?`).run(row.deleted_opds_visible ?? 0, sourceId, novelId);
      if (row.deleted_scheduling_json) { try { const state = JSON.parse(row.deleted_scheduling_json) as StoredScheduledNovelRow; this.upsertScheduledNovel(sourceId, novelId, state.enabled, state.autoTranslate, state.autoSummarize, state.summarizeModel); } catch { /* old snapshot is optional */ } }
    }); transaction(); return true;
  }

  getNovelPurgeStatus(sourceId: string, novelId: string): { canPurge: boolean; remainingDays: number; deletedAt: string | null } | null {
    const row = this.#database.prepare(`SELECT deleted_at FROM novels WHERE source_id=? AND novel_id=?`).get(sourceId, novelId) as { deleted_at: string | null } | undefined;
    if (!row) return null; if (!row.deleted_at) return { canPurge: false, remainingDays: 15, deletedAt: null };
    const remainingDays = Math.max(0, Math.ceil((15 * 86400000 - Math.max(0, Date.now() - Date.parse(row.deleted_at))) / 86400000));
    return { canPurge: remainingDays === 0, remainingDays, deletedAt: row.deleted_at };
  }

  /** 在回收站保留期结束后，永久清理小说及其关联数据。 */
  purgeNovel(sourceId: string, novelId: string): boolean {
    const status = this.getNovelPurgeStatus(sourceId, novelId); if (!status?.canPurge) return false;
    const transaction = this.#database.transaction(() => {
      if (sourceId === 'manual') this.#database.prepare(`DELETE FROM manual_volumes WHERE novel_id=?`).run(novelId);
      for (const table of ['chapter_versions', 'novel_metadata_versions', 'chapter_translation_paragraphs', 'chapter_translations', 'chapter_translation_qa', 'novel_translation_build_checkpoints', 'novel_translation_build_logs', 'novel_translation_builds', 'novel_translation_profiles', 'novel_translation_terms', 'knowledge_graph_summaries', 'knowledge_graph_chunks', 'knowledge_graph_relations', 'knowledge_graph_entities', 'novel_graph_build_checkpoints', 'novel_graph_build_logs', 'novel_graph_builds', 'novel_graph_profiles', 'scheduled_summaries', 'scheduled_novels', 'reader_typography', 'bookmarks', 'reading_progress', 'novel_aliases', 'task_history', 'chapters']) {
        this.#database.prepare(`DELETE FROM ${table} WHERE source_id=? AND novel_id=?`).run(sourceId, novelId);
      }
      return this.#database.prepare(`DELETE FROM novels WHERE source_id=? AND novel_id=? AND deleted_at IS NOT NULL`).run(sourceId, novelId).changes > 0;
    });
    return transaction();
  }

  listKnowledgeGraphSummaries(sourceId: string, novelId: string): StoredKnowledgeGraphSummaryRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            summary_id, source_id, novel_id, summary_type, stable_key, title, summary,
            chapter_ids_json, entity_ids_json, relation_ids_json, embedding_json,
            source_fingerprint, updated_at
          FROM knowledge_graph_summaries
          WHERE source_id = ? AND novel_id = ?
          ORDER BY summary_type ASC, stable_key ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapKnowledgeGraphSummaryRow(row as KnowledgeGraphSummaryRow));
  }

  replaceKnowledgeGraph(
    sourceId: string,
    novelId: string,
    entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>,
    relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>,
    chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>,
    summaries: Array<Omit<StoredKnowledgeGraphSummaryRow, 'updatedAt'>> = [],
  ): void {
    this.assertNovelExists(sourceId, novelId);

    const timestamp = new Date().toISOString();
    const insertEntity = this.#database.prepare(
      `
        INSERT OR IGNORE INTO knowledge_graph_entities (
          entity_id,
          source_id,
          novel_id,
          entity_name,
          entity_type,
          summary,
          prominence,
          mention_count,
          mention_chapter_ids_json,
          first_chapter_id,
          last_chapter_id,
          aliases_json,
          embedding_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const insertRelation = this.#database.prepare(
      `
        INSERT OR IGNORE INTO knowledge_graph_relations (
          relation_id,
          source_id,
          novel_id,
          from_entity_id,
          to_entity_id,
          relation_type,
          summary,
          weight,
          chapter_ids_json,
          evidence_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const insertChunk = this.#database.prepare(
      `
        INSERT OR IGNORE INTO knowledge_graph_chunks (
          chunk_id,
          source_id,
          novel_id,
          chapter_id,
          chapter_index,
          chunk_index,
          chapter_title,
          summary,
          event_summary,
          content,
          entity_names_json,
          keyword_hints_json,
          embedding_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const insertSummary = this.#database.prepare(
      `
        INSERT OR IGNORE INTO knowledge_graph_summaries (
          summary_id, source_id, novel_id, summary_type, stable_key, title, summary,
          chapter_ids_json, entity_ids_json, relation_ids_json, embedding_json,
          source_fingerprint, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    const transaction = this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM knowledge_graph_chunks WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_relations WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_entities WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_summaries WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);

      for (const entity of entities) {
        insertEntity.run(
          entity.id,
          sourceId,
          novelId,
          entity.name,
          entity.entityType,
          entity.summary,
          entity.prominence,
          entity.mentionCount,
          JSON.stringify(entity.mentionChapterIds),
          entity.firstChapterId,
          entity.lastChapterId,
          JSON.stringify(entity.aliases),
          entity.embedding ? JSON.stringify(entity.embedding) : null,
          timestamp,
        );
      }

      for (const relation of relations) {
        insertRelation.run(
          relation.id,
          sourceId,
          novelId,
          relation.fromEntityId,
          relation.toEntityId,
          relation.relationType,
          relation.summary,
          relation.weight,
          JSON.stringify(relation.chapterIds),
          JSON.stringify(relation.evidence),
          timestamp,
        );
      }

      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          sourceId,
          novelId,
          chunk.chapterId,
          chunk.chapterIndex,
          chunk.chunkIndex,
          chunk.chapterTitle,
          chunk.summary,
          chunk.eventSummary,
          chunk.content,
          JSON.stringify(chunk.entityNames),
          JSON.stringify(chunk.keywordHints),
          chunk.embedding ? JSON.stringify(chunk.embedding) : null,
          timestamp,
        );
      }

      for (const summary of summaries) {
        insertSummary.run(
          summary.id,
          sourceId,
          novelId,
          summary.summaryType,
          summary.stableKey,
          summary.title,
          summary.summary,
          JSON.stringify(summary.chapterIds),
          JSON.stringify(summary.entityIds),
          JSON.stringify(summary.relationIds),
          summary.embedding ? JSON.stringify(summary.embedding) : null,
          summary.sourceFingerprint,
          timestamp,
        );
      }
    });

    transaction();
  }

  clearKnowledgeGraph(sourceId: string, novelId: string): void {
    this.assertNovelExists(sourceId, novelId);

    const transaction = this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM novel_graph_build_checkpoints WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_chunks WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_relations WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_entities WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_summaries WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM novel_graph_build_logs WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
    });

    transaction();
  }

  listTaskSnapshots(limit = 20): StoredTaskHistoryRow[] {
    const rows = this.#database
      .prepare(
        `
          SELECT task_id, source_id, novel_id, status, created_at, updated_at, snapshot_json
          FROM task_history
          ORDER BY created_at DESC, updated_at DESC
          LIMIT ?
        `,
      )
      .all(limit) as TaskHistoryRow[];

    return rows.map((row) => ({
      taskId: row.task_id,
      sourceId: row.source_id,
      novelId: row.novel_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      snapshotJson: row.snapshot_json,
    }));
  }

  getChapter(sourceId: string, novelId: string, chapterId: string): StoredChapterRecord | null {
    const chapterRow = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, chapter_id, chapter_index, title, volume_title, url, content, status, error_message, downloaded_at, updated_at
          FROM chapters
          WHERE source_id = ? AND novel_id = ? AND chapter_id = ?
        `,
      )
      .get(sourceId, novelId, chapterId) as ChapterRow | undefined;

    return chapterRow ? mapChapterRow(chapterRow) : null;
  }

  saveMetadata(sourceId: string, metadata: NovelMetadata): void {
    const previous = this.getSnapshot(sourceId, metadata.novelId)?.metadata ?? null;
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO novels (source_id, novel_id, title, author, description, tags_json, chapter_count, info_page_url, updated_at)
          VALUES (@source_id, @novel_id, @title, @author, @description, @tags_json, @chapter_count, @info_page_url, @updated_at)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            description = excluded.description,
            tags_json = excluded.tags_json,
            chapter_count = excluded.chapter_count,
            info_page_url = excluded.info_page_url,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        source_id: sourceId,
        novel_id: metadata.novelId,
        title: metadata.title,
        author: metadata.author,
        description: metadata.description,
        tags_json: JSON.stringify(metadata.tags),
        chapter_count: metadata.chapterCount,
        info_page_url: metadata.infoPageUrl,
        updated_at: timestamp,
      });

    const changed = !previous || previous.title !== metadata.title || previous.author !== metadata.author
      || previous.description !== metadata.description || !areTagsEquivalent(previous.tags, metadata.tags);
    if (changed) this.#recordMetadataVersion(sourceId, metadata.novelId, this.#nextMetadataVersion(sourceId, metadata.novelId), metadata.title, metadata.author, metadata.description, metadata.tags, timestamp);
  }

  replaceCrawledChapterIfChanged(sourceId: string, novelId: string, chapter: ChapterContent): { changed: boolean; chapter: StoredChapterRecord } {
    const previous = this.getChapter(sourceId, novelId, chapter.chapterId);
    if (!previous) throw new Error(`章节 ${chapter.chapterId} 不存在。`);
    if (previous.title === chapter.title && previous.content === chapter.content) return { changed: false, chapter: previous };
    this.saveChapterContent(sourceId, novelId, chapter);
    const current = this.getChapter(sourceId, novelId, chapter.chapterId)!;
    return { changed: true, chapter: current };
  }

  saveChapterIndex(sourceId: string, novelId: string, chapters: ChapterIndexEntry[]): void {
    const timestamp = new Date().toISOString();
    const statement = this.#database.prepare(
      `
        INSERT INTO chapters (
          source_id,
          novel_id,
          chapter_id,
          chapter_index,
          title,
          volume_title,
          url,
          content,
          status,
          error_message,
          downloaded_at,
          updated_at
        )
        VALUES (
          @source_id,
          @novel_id,
          @chapter_id,
          @chapter_index,
          @title,
          @volume_title,
          @url,
          NULL,
          'indexed',
          NULL,
          NULL,
          @updated_at
        )
        ON CONFLICT(source_id, novel_id, chapter_id) DO UPDATE SET
          chapter_index = excluded.chapter_index,
          title = excluded.title,
          volume_title = excluded.volume_title,
          url = excluded.url,
          updated_at = excluded.updated_at
      `,
    );

    const transaction = this.#database.transaction((entries: ChapterIndexEntry[]) => {
      for (const chapter of entries) {
        statement.run({
          source_id: sourceId,
          novel_id: novelId,
          chapter_id: chapter.id,
          chapter_index: chapter.index,
          title: chapter.title,
          volume_title: chapter.volumeTitle ?? null,
          url: chapter.url,
          updated_at: timestamp,
        });
      }
    });

    transaction(chapters);
  }

  saveChapterContent(sourceId: string, novelId: string, chapter: ChapterContent): void {
    const previous = this.getChapter(sourceId, novelId, chapter.chapterId);
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          UPDATE chapters
          SET
            chapter_index = @chapter_index,
            title = @title,
            volume_title = @volume_title,
            url = @url,
            content = @content,
            status = 'downloaded',
            error_message = NULL,
            downloaded_at = @downloaded_at,
            updated_at = @updated_at
          WHERE source_id = @source_id AND novel_id = @novel_id AND chapter_id = @chapter_id
        `,
      )
      .run({
        source_id: sourceId,
        novel_id: novelId,
        chapter_id: chapter.chapterId,
        chapter_index: chapter.index,
        title: chapter.title,
        volume_title: chapter.volumeTitle ?? null,
        url: chapter.url,
        content: chapter.content,
        downloaded_at: timestamp,
        updated_at: timestamp,
      });
    if (!previous || previous.title !== chapter.title || previous.content !== chapter.content) {
      this.#recordChapterVersion(sourceId, novelId, chapter.chapterId, this.#nextChapterVersion(sourceId, novelId, chapter.chapterId), chapter.title, chapter.content, timestamp);
    }
  }

  markChapterFailure(sourceId: string, novelId: string, chapterId: string, error: Error): void {
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          UPDATE chapters
          SET
            status = 'failed',
            error_message = @error_message,
            updated_at = @updated_at
          WHERE source_id = @source_id AND novel_id = @novel_id AND chapter_id = @chapter_id
        `,
      )
      .run({
        source_id: sourceId,
        novel_id: novelId,
        chapter_id: chapterId,
        error_message: error.message,
        updated_at: timestamp,
      });
  }

  saveTaskSnapshot(
    task: {
      id: string;
      sourceId: string;
      novelId: string;
      status: string;
      createdAt: string;
    },
    snapshot: unknown,
    limit = 100,
  ): void {
    const updatedAt = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO task_history (task_id, source_id, novel_id, status, created_at, updated_at, snapshot_json)
          VALUES (@task_id, @source_id, @novel_id, @status, @created_at, @updated_at, @snapshot_json)
          ON CONFLICT(task_id) DO UPDATE SET
            source_id = excluded.source_id,
            novel_id = excluded.novel_id,
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            snapshot_json = excluded.snapshot_json
        `,
      )
      .run({
        task_id: task.id,
        source_id: task.sourceId,
        novel_id: task.novelId,
        status: task.status,
        created_at: task.createdAt,
        updated_at: updatedAt,
        snapshot_json: JSON.stringify(snapshot),
      });

    this.#database
      .prepare(
        `
          DELETE FROM task_history
          WHERE task_id NOT IN (
            SELECT task_id
            FROM task_history
            ORDER BY created_at DESC, updated_at DESC
            LIMIT ?
          )
        `,
      )
      .run(limit);
  }

  // ── 翻译流水线 CRUD ──

  getTranslationProfile(sourceId: string, novelId: string): StoredTranslationProfileRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id, novel_id, source_lang, target_lang,
            term_extraction_model_json, translation_models_json, review_model_json,
            translation_concurrency, quality_threshold, auto_reject_untranslated_terms,
            default_export_mode, config_locked, locked_at, updated_at
          FROM novel_translation_profiles
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as TranslationProfileRow | undefined;

    return row ? mapTranslationProfileRow(row) : null;
  }

  saveTranslationProfile(input: StoredTranslationProfileInput): StoredTranslationProfileRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_translation_profiles (
            source_id, novel_id, source_lang, target_lang,
            term_extraction_model_json, translation_models_json, review_model_json,
            translation_concurrency, quality_threshold, auto_reject_untranslated_terms,
            default_export_mode, config_locked, locked_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            source_lang = excluded.source_lang,
            target_lang = excluded.target_lang,
            term_extraction_model_json = excluded.term_extraction_model_json,
            translation_models_json = excluded.translation_models_json,
            review_model_json = excluded.review_model_json,
            translation_concurrency = excluded.translation_concurrency,
            quality_threshold = excluded.quality_threshold,
            auto_reject_untranslated_terms = excluded.auto_reject_untranslated_terms,
            default_export_mode = excluded.default_export_mode,
            config_locked = excluded.config_locked,
            locked_at = excluded.locked_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId, input.novelId, input.sourceLang, input.targetLang,
        input.termExtractionModel ? JSON.stringify(input.termExtractionModel) : null,
        JSON.stringify(input.translationModels),
        input.reviewModel ? JSON.stringify(input.reviewModel) : null,
        input.translationConcurrency, input.qualityThreshold,
        input.autoRejectUntranslatedTerms ? 1 : 0,
        input.defaultExportMode,
        input.configLocked ? 1 : 0, input.lockedAt,
        updatedAt,
      );

    const profile = this.getTranslationProfile(input.sourceId, input.novelId);
    if (!profile) {
      throw new Error(`Failed to load translation profile for ${input.sourceId}/${input.novelId}.`);
    }
    return profile;
  }

  getTranslationBuild(sourceId: string, novelId: string): StoredTranslationBuildRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id, novel_id, status, stage, progress_percent, message, error_message,
            started_at, completed_at, model_stats_json, translated_chapters, reviewed_chapters,
            failed_chapters, glossary_version, profile_version,
            current_chapter_title, current_chapter_paragraphs, current_chapter_translated_paragraphs, total_translated_paragraphs, total_paragraph_estimate,
            updated_at
          FROM novel_translation_builds
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as TranslationBuildRow | undefined;

    return row ? mapTranslationBuildRow(row) : null;
  }

  saveTranslationBuild(input: {
    sourceId: string;
    novelId: string;
    status: TranslationBuildStatus;
    stage: TranslationBuildStage;
    progressPercent: number;
    message: string;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    modelStatsJson: string;
    translatedChapters: number;
    reviewedChapters: number;
    failedChapters: number;
    glossaryVersion: number;
    profileVersion: number;
    currentChapterTitle?: string | null;
    currentChapterParagraphs?: number;
    currentChapterTranslatedParagraphs?: number;
    totalTranslatedParagraphs?: number;
    totalParagraphEstimate?: number;
  }): StoredTranslationBuildRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_translation_builds (
            source_id, novel_id, status, stage, progress_percent, message, error_message,
            started_at, completed_at, model_stats_json, translated_chapters, reviewed_chapters,
            failed_chapters, glossary_version, profile_version,
            current_chapter_title, current_chapter_paragraphs, current_chapter_translated_paragraphs, total_translated_paragraphs, total_paragraph_estimate,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            status = excluded.status, stage = excluded.stage,
            progress_percent = excluded.progress_percent, message = excluded.message,
            error_message = excluded.error_message, started_at = excluded.started_at,
            completed_at = excluded.completed_at, model_stats_json = excluded.model_stats_json,
            translated_chapters = excluded.translated_chapters,
            reviewed_chapters = excluded.reviewed_chapters,
            failed_chapters = excluded.failed_chapters,
            glossary_version = excluded.glossary_version,
            profile_version = excluded.profile_version,
            current_chapter_title = excluded.current_chapter_title,
            current_chapter_paragraphs = excluded.current_chapter_paragraphs,
            current_chapter_translated_paragraphs = excluded.current_chapter_translated_paragraphs,
            total_translated_paragraphs = excluded.total_translated_paragraphs,
            total_paragraph_estimate = excluded.total_paragraph_estimate,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId, input.novelId, input.status, input.stage,
        input.progressPercent, input.message, input.errorMessage,
        input.startedAt, input.completedAt, input.modelStatsJson,
        input.translatedChapters, input.reviewedChapters, input.failedChapters,
        input.glossaryVersion, input.profileVersion,
        input.currentChapterTitle ?? null, input.currentChapterParagraphs ?? 0, input.currentChapterTranslatedParagraphs ?? 0, input.totalTranslatedParagraphs ?? 0,
        input.totalParagraphEstimate ?? 0,
        updatedAt,
      );

    const build = this.getTranslationBuild(input.sourceId, input.novelId);
    if (!build) {
      throw new Error(`Failed to load translation build state for ${input.sourceId}/${input.novelId}.`);
    }
    return build;
  }

  listTranslationTerms(sourceId: string, novelId: string): StoredTranslationTermRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            term_id, source_id, novel_id, source_term, target_term, entity_type, note,
            extracted_from_chapter_id, priority, created_at, updated_at
          FROM novel_translation_terms
          WHERE source_id = ? AND novel_id = ?
          ORDER BY priority DESC, source_term COLLATE NOCASE ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapTranslationTermRow(row as TranslationTermRow));
  }

  createTranslationTerm(input: {
    sourceId: string;
    novelId: string;
    sourceTerm: string;
    targetTerm?: string | null;
    entityType?: string | null;
    note?: string | null;
    extractedFromChapterId?: string | null;
    priority?: number;
  }): StoredTranslationTermRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const termId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_translation_terms (
            term_id, source_id, novel_id, source_term, target_term, entity_type, note,
            extracted_from_chapter_id, priority, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        termId, input.sourceId, input.novelId, input.sourceTerm.trim(),
        input.targetTerm?.trim() ?? null, input.entityType?.trim() ?? null,
        input.note?.trim() ?? null, input.extractedFromChapterId ?? null,
        input.priority ?? 0, timestamp, timestamp,
      );

    const createdTerm = this.listTranslationTerms(input.sourceId, input.novelId).find((t) => t.id === termId);
    if (!createdTerm) {
      throw new Error(`Failed to load translation term ${termId} after creation.`);
    }
    return createdTerm;
  }

  updateTranslationTerm(
    sourceId: string,
    novelId: string,
    termId: string,
    updates: {
      targetTerm?: string | null;
      entityType?: string | null;
      note?: string | null;
      priority?: number;
    },
  ): StoredTranslationTermRow | null {
    const timestamp = new Date().toISOString();
    const existing = this.listTranslationTerms(sourceId, novelId).find((t) => t.id === termId);
    if (!existing) {
      return null;
    }

    this.#database
      .prepare(
        `
          UPDATE novel_translation_terms
          SET
            target_term = ?, entity_type = ?, note = ?, priority = ?,
            updated_at = ?
          WHERE term_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(
        'targetTerm' in updates ? (updates.targetTerm?.trim() ?? null) : existing.targetTerm,
        'entityType' in updates ? (updates.entityType?.trim() ?? null) : existing.entityType,
        'note' in updates ? (updates.note?.trim() ?? null) : existing.note,
        'priority' in updates ? (updates.priority ?? existing.priority) : existing.priority,
        timestamp,
        termId, sourceId, novelId,
      );

    return this.listTranslationTerms(sourceId, novelId).find((t) => t.id === termId) ?? null;
  }

  deleteTranslationTerm(sourceId: string, novelId: string, termId: string): boolean {
    const result = this.#database
      .prepare('DELETE FROM novel_translation_terms WHERE term_id = ? AND source_id = ? AND novel_id = ?')
      .run(termId, sourceId, novelId);

    return result.changes > 0;
  }

  /** 批量创建或更新术语——去重源词，保留已有译词优先 */
  upsertTranslationTerms(sourceId: string, novelId: string, terms: Array<{
    sourceTerm: string;
    targetTerm?: string | null;
    entityType?: string | null;
    note?: string | null;
    extractedFromChapterId?: string | null;
    priority?: number;
  }>): { created: number; updated: number; skipped: number } {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const existing = this.listTranslationTerms(sourceId, novelId);
    const existingMap = new Map(existing.map((t) => [t.sourceTerm, t]));

    for (const input of terms) {
      const sourceTerm = input.sourceTerm.trim();
      if (!sourceTerm) {
        continue;
      }

      const found = existingMap.get(sourceTerm);
      if (found) {
        if (!found.targetTerm && input.targetTerm) {
          this.updateTranslationTerm(sourceId, novelId, found.id, { targetTerm: input.targetTerm });
          updated++;
        } else if (!found.entityType && input.entityType) {
          this.updateTranslationTerm(sourceId, novelId, found.id, { entityType: input.entityType });
          updated++;
        } else {
          skipped++;
        }
      } else {
        this.createTranslationTerm({
          sourceId, novelId, sourceTerm: input.sourceTerm,
          ...(input.targetTerm !== undefined ? { targetTerm: input.targetTerm } : {}),
          ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.extractedFromChapterId !== undefined ? { extractedFromChapterId: input.extractedFromChapterId } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
        });
        created++;
      }
    }

    return { created, updated, skipped };
  }

  /** 查找所有缺失译文的术语 */
  listMissingTranslationTerms(sourceId: string, novelId: string): StoredTranslationTermRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            term_id, source_id, novel_id, source_term, target_term, entity_type, note,
            extracted_from_chapter_id, priority, created_at, updated_at
          FROM novel_translation_terms
          WHERE source_id = ? AND novel_id = ? AND target_term IS NULL
          ORDER BY priority DESC, source_term COLLATE NOCASE ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapTranslationTermRow(row as TranslationTermRow));
  }

  listTranslationBuildLogs(sourceId: string, novelId: string, limit = 200): StoredTranslationBuildLogRow[] {
    return this.#database
      .prepare(
        `
          SELECT log_id, source_id, novel_id, stage, level, message, created_at
          FROM novel_translation_build_logs
          WHERE source_id = ? AND novel_id = ?
          ORDER BY created_at DESC, log_id DESC
          LIMIT ?
        `,
      )
      .all(sourceId, novelId, limit)
      .map((row: unknown) => mapTranslationBuildLogRow(row as TranslationBuildLogRow))
      .reverse();
  }

  appendTranslationBuildLog(input: {
    sourceId: string;
    novelId: string;
    stage: TranslationBuildStage;
    level: StoredTranslationBuildLogLevel;
    message: string;
  }): StoredTranslationBuildLogRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const logId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_translation_build_logs (log_id, source_id, novel_id, stage, level, message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(logId, input.sourceId, input.novelId, input.stage, input.level, input.message, createdAt);

    return { id: logId, stage: input.stage, level: input.level, message: input.message, createdAt };
  }

  clearTranslationBuildLogs(sourceId: string, novelId: string): void {
    this.#database
      .prepare('DELETE FROM novel_translation_build_logs WHERE source_id = ? AND novel_id = ?')
      .run(sourceId, novelId);
  }

  listTranslationBuildCheckpoints(sourceId: string, novelId: string): StoredTranslationBuildCheckpointRow[] {
    return this.#database
      .prepare(
        `
          SELECT source_id, novel_id, chapter_id, chapter_index, stage, pipeline_state_json, warning_message, updated_at
          FROM novel_translation_build_checkpoints
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row: unknown) => mapTranslationBuildCheckpointRow(row as TranslationBuildCheckpointRow));
  }

  saveTranslationBuildCheckpoint(input: {
    sourceId: string;
    novelId: string;
    chapterId: string;
    chapterIndex: number;
    stage: TranslationChapterStatus;
    pipelineStateJson: string;
    warningMessage: string | null;
  }): void {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_translation_build_checkpoints (
            source_id, novel_id, chapter_id, chapter_index, stage, pipeline_state_json, warning_message, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id, chapter_id) DO UPDATE SET
            chapter_index = excluded.chapter_index, stage = excluded.stage,
            pipeline_state_json = excluded.pipeline_state_json,
            warning_message = excluded.warning_message, updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId, input.novelId, input.chapterId, input.chapterIndex,
        input.stage, input.pipelineStateJson, input.warningMessage, updatedAt,
      );
  }

  clearTranslationBuildCheckpoints(sourceId: string, novelId: string): void {
    this.#database
      .prepare('DELETE FROM novel_translation_build_checkpoints WHERE source_id = ? AND novel_id = ?')
      .run(sourceId, novelId);
  }

  getChapterTranslation(
    sourceId: string,
    novelId: string,
    chapterId: string,
    sourceLang: string,
    targetLang: string,
  ): StoredChapterTranslationRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id, novel_id, chapter_id, source_lang, target_lang, translated_title,
            status, overall_quality_score, translator_model_id, reviewer_model_id,
            token_usage_json, source_content_hash, glossary_version, profile_version,
            created_at, updated_at
          FROM chapter_translations
          WHERE source_id = ? AND novel_id = ? AND chapter_id = ? AND source_lang = ? AND target_lang = ?
        `,
      )
      .get(sourceId, novelId, chapterId, sourceLang, targetLang) as ChapterTranslationRow | undefined;

    return row ? mapChapterTranslationRow(row) : null;
  }

  saveChapterTranslation(input: {
    sourceId: string;
    novelId: string;
    chapterId: string;
    sourceLang: string;
    targetLang: string;
    translatedTitle?: string | null;
    status: TranslationChapterStatus;
    overallQualityScore?: number | null;
    translatorModelId?: string | null;
    reviewerModelId?: string | null;
    tokenUsageJson?: string | null;
    sourceContentHash: string;
    glossaryVersion: number;
    profileVersion: number;
  }): StoredChapterTranslationRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const timestamp = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO chapter_translations (
            source_id, novel_id, chapter_id, source_lang, target_lang, translated_title,
            status, overall_quality_score, translator_model_id, reviewer_model_id,
            token_usage_json, source_content_hash, glossary_version, profile_version,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id, chapter_id, source_lang, target_lang) DO UPDATE SET
            translated_title = excluded.translated_title, status = excluded.status,
            overall_quality_score = excluded.overall_quality_score,
            translator_model_id = excluded.translator_model_id,
            reviewer_model_id = excluded.reviewer_model_id,
            token_usage_json = excluded.token_usage_json,
            source_content_hash = excluded.source_content_hash,
            glossary_version = excluded.glossary_version,
            profile_version = excluded.profile_version,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId, input.novelId, input.chapterId, input.sourceLang, input.targetLang,
        input.translatedTitle ?? null, input.status, input.overallQualityScore ?? null,
        input.translatorModelId ?? null, input.reviewerModelId ?? null,
        input.tokenUsageJson ?? null, input.sourceContentHash,
        input.glossaryVersion, input.profileVersion,
        timestamp, timestamp,
      );

    const translation = this.getChapterTranslation(input.sourceId, input.novelId, input.chapterId, input.sourceLang, input.targetLang);
    if (!translation) {
      throw new Error(`Failed to load chapter translation for ${input.sourceId}/${input.novelId}/${input.chapterId}.`);
    }
    return translation;
  }

  listChapterTranslationParagraphs(
    sourceId: string,
    novelId: string,
    chapterId: string,
  ): StoredChapterTranslationParagraphRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            paragraph_id, source_id, novel_id, chapter_id, paragraph_index,
            source_text, translated_text, confidence, applied_term_ids_json, model_id, updated_at
          FROM chapter_translation_paragraphs
          WHERE source_id = ? AND novel_id = ? AND chapter_id = ?
          ORDER BY paragraph_index ASC
        `,
      )
      .all(sourceId, novelId, chapterId)
      .map((row: unknown) => mapChapterTranslationParagraphRow(row as ChapterTranslationParagraphRow));
  }

  saveChapterTranslationParagraph(input: {
    sourceId: string;
    novelId: string;
    chapterId: string;
    paragraphIndex: number;
    sourceText: string;
    translatedText?: string | null;
    confidence?: number | null;
    appliedTermIds?: string[];
    modelId?: string | null;
  }): StoredChapterTranslationParagraphRow {
    const paragraphId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO chapter_translation_paragraphs (
            paragraph_id, source_id, novel_id, chapter_id, paragraph_index,
            source_text, translated_text, confidence, applied_term_ids_json, model_id, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(paragraph_id) DO UPDATE SET
            paragraph_index = excluded.paragraph_index,
            source_text = excluded.source_text,
            translated_text = excluded.translated_text,
            confidence = excluded.confidence,
            applied_term_ids_json = excluded.applied_term_ids_json,
            model_id = excluded.model_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        paragraphId, input.sourceId, input.novelId, input.chapterId, input.paragraphIndex,
        input.sourceText, input.translatedText ?? null, input.confidence ?? null,
        JSON.stringify(input.appliedTermIds ?? []), input.modelId ?? null, timestamp,
      );

    return {
      id: paragraphId,
      sourceId: input.sourceId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      paragraphIndex: input.paragraphIndex,
      sourceText: input.sourceText,
      translatedText: input.translatedText ?? null,
      confidence: input.confidence ?? null,
      appliedTermIds: input.appliedTermIds ?? [],
      modelId: input.modelId ?? null,
      updatedAt: timestamp,
    };
  }

  /** 批量替换章节段落翻译（事务内先删后写） */
  replaceChapterTranslationParagraphs(
    sourceId: string,
    novelId: string,
    chapterId: string,
    paragraphs: Array<{
      paragraphIndex: number;
      sourceText: string;
      translatedText?: string | null;
      confidence?: number | null;
      appliedTermIds?: string[];
      modelId?: string | null;
    }>,
  ): StoredChapterTranslationParagraphRow[] {
    this.assertNovelExists(sourceId, novelId);

    const timestamp = new Date().toISOString();
    const insertStmt = this.#database.prepare(
      `
        INSERT INTO chapter_translation_paragraphs (
          paragraph_id, source_id, novel_id, chapter_id, paragraph_index,
          source_text, translated_text, confidence, applied_term_ids_json, model_id, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    const results: StoredChapterTranslationParagraphRow[] = [];
    const transaction = this.#database.transaction(() => {
      this.#database
        .prepare('DELETE FROM chapter_translation_paragraphs WHERE source_id = ? AND novel_id = ? AND chapter_id = ?')
        .run(sourceId, novelId, chapterId);

      for (const p of paragraphs) {
        const paragraphId = crypto.randomUUID();
        insertStmt.run(
          paragraphId, sourceId, novelId, chapterId, p.paragraphIndex,
          p.sourceText, p.translatedText ?? null, p.confidence ?? null,
          JSON.stringify(p.appliedTermIds ?? []), p.modelId ?? null, timestamp,
        );
        results.push({
          id: paragraphId,
          sourceId, novelId, chapterId,
          paragraphIndex: p.paragraphIndex,
          sourceText: p.sourceText,
          translatedText: p.translatedText ?? null,
          confidence: p.confidence ?? null,
          appliedTermIds: p.appliedTermIds ?? [],
          modelId: p.modelId ?? null,
          updatedAt: timestamp,
        });
      }
    });

    transaction();
    return results;
  }

  listChapterTranslationQa(sourceId: string, novelId: string, chapterId: string): StoredChapterTranslationQaRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            qa_id, source_id, novel_id, chapter_id, check_type, score, severity,
            suggestion, paragraph_indices_json, resolved, created_at
          FROM chapter_translation_qa
          WHERE source_id = ? AND novel_id = ? AND chapter_id = ?
          ORDER BY severity DESC, score ASC, created_at ASC
        `,
      )
      .all(sourceId, novelId, chapterId)
      .map((row: unknown) => mapChapterTranslationQaRow(row as ChapterTranslationQaRow));
  }

  createChapterTranslationQa(input: {
    sourceId: string;
    novelId: string;
    chapterId: string;
    checkType: string;
    score: number;
    severity: string;
    suggestion?: string | null;
    paragraphIndices?: number[];
  }): StoredChapterTranslationQaRow {
    const qaId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO chapter_translation_qa (
            qa_id, source_id, novel_id, chapter_id, check_type, score, severity,
            suggestion, paragraph_indices_json, resolved, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `,
      )
      .run(
        qaId, input.sourceId, input.novelId, input.chapterId,
        input.checkType, input.score, input.severity,
        input.suggestion ?? null, JSON.stringify(input.paragraphIndices ?? []), createdAt,
      );

    return {
      id: qaId,
      sourceId: input.sourceId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      checkType: input.checkType,
      score: input.score,
      severity: input.severity,
      suggestion: input.suggestion ?? null,
      paragraphIndices: input.paragraphIndices ?? [],
      resolved: false,
      createdAt,
    };
  }

  resolveChapterTranslationQa(sourceId: string, novelId: string, qaId: string): boolean {
    const result = this.#database
      .prepare('UPDATE chapter_translation_qa SET resolved = 1 WHERE qa_id = ? AND source_id = ? AND novel_id = ?')
      .run(qaId, sourceId, novelId);

    return result.changes > 0;
  }

  /** 批量替换章节 QA 记录（事务内先删后写） */
  replaceChapterTranslationQa(
    sourceId: string,
    novelId: string,
    chapterId: string,
    items: Array<{
      checkType: string;
      score: number;
      severity: string;
      suggestion?: string | null;
      paragraphIndices?: number[];
    }>,
  ): StoredChapterTranslationQaRow[] {
    this.assertNovelExists(sourceId, novelId);

    const createdAt = new Date().toISOString();
    const insertStmt = this.#database.prepare(
      `
        INSERT INTO chapter_translation_qa (
          qa_id, source_id, novel_id, chapter_id, check_type, score, severity,
          suggestion, paragraph_indices_json, resolved, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `,
    );

    const results: StoredChapterTranslationQaRow[] = [];
    const transaction = this.#database.transaction(() => {
      this.#database
        .prepare('DELETE FROM chapter_translation_qa WHERE source_id = ? AND novel_id = ? AND chapter_id = ?')
        .run(sourceId, novelId, chapterId);

      for (const item of items) {
        const qaId = crypto.randomUUID();
        insertStmt.run(
          qaId, sourceId, novelId, chapterId, item.checkType, item.score, item.severity,
          item.suggestion ?? null, JSON.stringify(item.paragraphIndices ?? []), createdAt,
        );
        results.push({
          id: qaId, sourceId, novelId, chapterId,
          checkType: item.checkType, score: item.score, severity: item.severity,
          suggestion: item.suggestion ?? null,
          paragraphIndices: item.paragraphIndices ?? [],
          resolved: false,
          createdAt,
        });
      }
    });

    transaction();
    return results;
  }

  listResumableTranslationBuilds(): Array<{ sourceId: string; novelId: string; build: StoredTranslationBuildRow }> {
    return this.#database
      .prepare(
        `
          SELECT source_id, novel_id, status, stage, progress_percent, message, error_message, started_at, completed_at, model_stats_json, translated_chapters, reviewed_chapters, failed_chapters, glossary_version, profile_version, updated_at
          FROM novel_translation_builds
          WHERE status IN ('queued', 'running')
          ORDER BY updated_at ASC
        `,
      )
      .all()
      .map((row) => {
        const build = row as TranslationBuildRow;
        return {
          sourceId: build.source_id,
          novelId: build.novel_id,
          build: mapTranslationBuildRow(build),
        };
      });
  }

  clearTranslationData(sourceId: string, novelId: string): void {
    this.assertNovelExists(sourceId, novelId);

    const transaction = this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM chapter_translation_qa WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM chapter_translation_paragraphs WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM chapter_translations WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM novel_translation_build_checkpoints WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM novel_translation_build_logs WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
    });

    transaction();
  }

  /**
   * 确保傀儡章节记录存在（供元数据/卷标题等合成翻译单元使用）。
   * 若章节已存在则不做任何操作（幂等）。
   */
  ensureSyntheticChapter(sourceId: string, novelId: string, chapterId: string, title: string, index: number): void {
    this.assertNovelExists(sourceId, novelId);
    const timestamp = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO chapters (source_id, novel_id, chapter_id, chapter_index, title, volume_title, url, content, status, error_message, downloaded_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, '', NULL, 'indexed', NULL, NULL, ?)`,
      )
      .run(sourceId, novelId, chapterId, index, title, timestamp);
  }

  /** 查找因术语库更新而需要重译的章节（术语版本号不匹配的已完成翻译章节） */
  listTranslationAffectedChapters(sourceId: string, novelId: string): Array<{
    chapterId: string;
    chapterIndex: number;
    currentGlossaryVersion: number;
    storedGlossaryVersion: number;
  }> {
    return this.#database
      .prepare(
        `
          SELECT chapter_id, chapter_index, glossary_version
          FROM chapters c
          JOIN chapter_translations ct USING (source_id, novel_id, chapter_id)
          WHERE ct.source_id = ? AND ct.novel_id = ? AND ct.status = 'completed' AND ct.glossary_version < (
            SELECT MAX(glossary_version) FROM novel_translation_builds WHERE source_id = ? AND novel_id = ?
          )
          ORDER BY chapter_index ASC
        `,
      )
      .all(sourceId, novelId, sourceId, novelId)
      .map((row: unknown) => {
        const r = row as { chapter_id: string; chapter_index: number; glossary_version: number };
        return {
          chapterId: r.chapter_id,
          chapterIndex: r.chapter_index,
          currentGlossaryVersion: 0,
          storedGlossaryVersion: r.glossary_version,
        };
      });
  }

  // ── 定时更新: scheduled_novels ──

  getScheduledNovels(): StoredScheduledNovelRow[] {
    const rows = this.#database
      .prepare(
        `SELECT sn.source_id, sn.novel_id, sn.enabled, sn.auto_translate, sn.auto_summarize,
                sn.summarize_model_json, sn.last_checked_at, sn.last_check_result, sn.last_check_message,
                sn.updated_at,
                EXISTS (
                  SELECT 1 FROM scheduled_summaries ss
                  WHERE ss.source_id = sn.source_id AND ss.novel_id = sn.novel_id
                ) AS has_summary
         FROM scheduled_novels sn
         JOIN novels n ON n.source_id = sn.source_id AND n.novel_id = sn.novel_id
         WHERE n.source_id <> 'manual' AND n.deleted_at IS NULL
         ORDER BY sn.source_id, sn.novel_id`,
      )
      .all() as Array<{
      source_id: string; novel_id: string; enabled: number; auto_translate: number; auto_summarize: number;
      summarize_model_json: string | null;
      last_checked_at: string | null; last_check_result: string | null;
      last_check_message: string | null; updated_at: string; has_summary: number;
    }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      enabled: row.enabled === 1,
      autoTranslate: row.auto_translate === 1,
      autoSummarize: row.auto_summarize === 1,
      summarizeModel: parseStoredModelRoute(row.summarize_model_json),
      lastCheckedAt: row.last_checked_at,
      lastCheckResult: row.last_check_result as StoredScheduledNovelRow['lastCheckResult'],
      lastCheckMessage: row.last_check_message,
      hasSummary: row.has_summary === 1,
      updatedAt: row.updated_at,
    }));
  }

  getEnabledScheduledNovels(): StoredScheduledNovelRow[] {
    const rows = this.#database
      .prepare(
        `SELECT sn.source_id, sn.novel_id, sn.enabled, sn.auto_translate, sn.auto_summarize,
                sn.summarize_model_json, sn.last_checked_at, sn.last_check_result, sn.last_check_message,
                sn.updated_at,
                EXISTS (
                  SELECT 1 FROM scheduled_summaries ss
                  WHERE ss.source_id = sn.source_id AND ss.novel_id = sn.novel_id
                ) AS has_summary
         FROM scheduled_novels sn
         JOIN novels n ON n.source_id = sn.source_id AND n.novel_id = sn.novel_id
         WHERE enabled = 1 AND n.source_id <> 'manual' AND n.deleted_at IS NULL
         ORDER BY sn.source_id, sn.novel_id`,
      )
      .all() as Array<{
      source_id: string; novel_id: string; enabled: number; auto_translate: number; auto_summarize: number;
      summarize_model_json: string | null;
      last_checked_at: string | null; last_check_result: string | null;
      last_check_message: string | null; updated_at: string; has_summary: number;
    }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      enabled: row.enabled === 1,
      autoTranslate: row.auto_translate === 1,
      autoSummarize: row.auto_summarize === 1,
      summarizeModel: parseStoredModelRoute(row.summarize_model_json),
      lastCheckedAt: row.last_checked_at,
      lastCheckResult: row.last_check_result as StoredScheduledNovelRow['lastCheckResult'],
      lastCheckMessage: row.last_check_message,
      hasSummary: row.has_summary === 1,
      updatedAt: row.updated_at,
    }));
  }

  getScheduledNovel(sourceId: string, novelId: string): StoredScheduledNovelRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT sn.source_id, sn.novel_id, sn.enabled, sn.auto_translate, sn.auto_summarize,
                sn.summarize_model_json, sn.last_checked_at, sn.last_check_result, sn.last_check_message,
                sn.updated_at,
                EXISTS (
                  SELECT 1 FROM scheduled_summaries ss
                  WHERE ss.source_id = sn.source_id AND ss.novel_id = sn.novel_id
                ) AS has_summary
         FROM scheduled_novels sn
         WHERE sn.source_id = ? AND sn.novel_id = ?`,
      )
      .get(sourceId, novelId) as {
      source_id: string; novel_id: string; enabled: number; auto_translate: number; auto_summarize: number;
      summarize_model_json: string | null;
      last_checked_at: string | null; last_check_result: string | null;
      last_check_message: string | null; updated_at: string; has_summary: number;
    } | undefined;

    if (!row) return undefined;

    return {
      sourceId: row.source_id,
      novelId: row.novel_id,
      enabled: row.enabled === 1,
      autoTranslate: row.auto_translate === 1,
      autoSummarize: row.auto_summarize === 1,
      summarizeModel: parseStoredModelRoute(row.summarize_model_json),
      lastCheckedAt: row.last_checked_at,
      lastCheckResult: row.last_check_result as StoredScheduledNovelRow['lastCheckResult'],
      lastCheckMessage: row.last_check_message,
      hasSummary: row.has_summary === 1,
      updatedAt: row.updated_at,
    };
  }

  upsertScheduledNovel(
    sourceId: string,
    novelId: string,
    enabled: boolean,
    autoTranslate?: boolean,
    autoSummarize?: boolean,
    summarizeModel?: LlmModelGatewayRoute | null,
  ): void {
    if (sourceId === 'manual') throw new Error('手动小说不能加入定时更新。');
    const now = new Date().toISOString();
    const existing = this.getScheduledNovel(sourceId, novelId);
    const resolvedAutoTranslate = autoTranslate ?? existing?.autoTranslate ?? false;
    const resolvedAutoSummarize = autoSummarize ?? existing?.autoSummarize ?? false;
    const resolvedSummarizeModel = summarizeModel === undefined ? (existing?.summarizeModel ?? null) : summarizeModel;
    this.#database
      .prepare(
        `INSERT INTO scheduled_novels (source_id, novel_id, enabled, auto_translate, auto_summarize, summarize_model_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, novel_id) DO UPDATE SET
           enabled = excluded.enabled,
           auto_translate = excluded.auto_translate,
           auto_summarize = excluded.auto_summarize,
           summarize_model_json = excluded.summarize_model_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        sourceId,
        novelId,
        enabled ? 1 : 0,
        resolvedAutoTranslate ? 1 : 0,
        resolvedAutoSummarize ? 1 : 0,
        serializeStoredModelRoute(resolvedSummarizeModel),
        now,
      );
  }

  updateScheduledNovelCheckResult(
    sourceId: string,
    novelId: string,
    result: StoredScheduledNovelRow['lastCheckResult'],
    message: string | null,
  ): void {
    const now = new Date().toISOString();
    this.#database
      .prepare(
        `UPDATE scheduled_novels
         SET last_checked_at = ?, last_check_result = ?, last_check_message = ?, updated_at = ?
         WHERE source_id = ? AND novel_id = ?`,
      )
      .run(now, result, message, now, sourceId, novelId);
  }

  bulkUpsertScheduledNovels(entries: Array<{
    sourceId: string;
    novelId: string;
    enabled: boolean;
    autoTranslate?: boolean;
    autoSummarize?: boolean;
    summarizeModel?: LlmModelGatewayRoute | null;
  }>): void {
    if (entries.some((entry) => entry.sourceId === 'manual')) {
      throw new Error('手动小说不能加入定时更新。');
    }
    const now = new Date().toISOString();
    const upsert = this.#database.prepare(
      `INSERT INTO scheduled_novels (source_id, novel_id, enabled, auto_translate, auto_summarize, summarize_model_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, novel_id) DO UPDATE SET
         enabled = excluded.enabled,
         auto_translate = excluded.auto_translate,
         auto_summarize = excluded.auto_summarize,
         summarize_model_json = excluded.summarize_model_json,
         updated_at = excluded.updated_at`,
    );

    const transaction = this.#database.transaction(() => {
      for (const entry of entries) {
        const existing = this.getScheduledNovel(entry.sourceId, entry.novelId);
        const resolvedAutoTranslate = entry.autoTranslate ?? existing?.autoTranslate ?? false;
        const resolvedAutoSummarize = entry.autoSummarize ?? existing?.autoSummarize ?? false;
        const resolvedSummarizeModel = entry.summarizeModel === undefined
          ? (existing?.summarizeModel ?? null)
          : entry.summarizeModel;
        upsert.run(
          entry.sourceId,
          entry.novelId,
          entry.enabled ? 1 : 0,
          resolvedAutoTranslate ? 1 : 0,
          resolvedAutoSummarize ? 1 : 0,
          serializeStoredModelRoute(resolvedSummarizeModel),
          now,
        );
      }
    });

    transaction();
  }

  deleteScheduledNovel(sourceId: string, novelId: string): void {
    this.#database
      .prepare(
        `DELETE FROM scheduled_novels
         WHERE source_id = ? AND novel_id = ?`,
      )
      .run(sourceId, novelId);
  }

  // ── 定时更新: scheduled_check_runs ──

  createScheduledCheckRun(id: string, startedAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO scheduled_check_runs (id, started_at, status)
         VALUES (?, ?, 'running')`,
      )
      .run(id, startedAt);
  }

  completeScheduledCheckRun(
    id: string,
    completedAt: string,
    totalChecked: number,
    newChaptersFound: number,
    skipped: number,
    errored: number,
  ): void {
    this.#database
      .prepare(
        `UPDATE scheduled_check_runs
         SET completed_at = ?, status = 'completed',
             total_checked = ?, new_chapters_found = ?, skipped = ?, errored = ?
         WHERE id = ?`,
      )
      .run(completedAt, totalChecked, newChaptersFound, skipped, errored, id);
  }

  listScheduledCheckRuns(limit: number, offset: number): StoredScheduledCheckRunRow[] {
    const rows = this.#database
      .prepare(
        `SELECT id, started_at, completed_at, status,
                total_checked, new_chapters_found, skipped, errored
         FROM scheduled_check_runs
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
        id: string; started_at: string; completed_at: string | null;
        status: string; total_checked: number; new_chapters_found: number;
        skipped: number; errored: number;
      }>;

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as 'running' | 'completed',
      totalChecked: row.total_checked,
      newChaptersFound: row.new_chapters_found,
      skipped: row.skipped,
      errored: row.errored,
    }));
  }

  createScheduledSummary(input: {
    runId: string;
    sourceId: string;
    novelId: string;
    chapterIds: string[];
    summary: string;
    providerId: string;
    modelId: string;
  }): void {
    this.#database
      .prepare(
        `INSERT INTO scheduled_summaries (
           summary_id, run_id, source_id, novel_id, chapter_ids_json,
           summary, provider_id, model_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.runId,
        input.sourceId,
        input.novelId,
        JSON.stringify(input.chapterIds),
        input.summary,
        input.providerId,
        input.modelId,
        new Date().toISOString(),
      );
  }

  listScheduledSummariesByRunIds(runIds: string[]): StoredScheduledSummaryRow[] {
    if (runIds.length === 0) {
      return [];
    }

    const placeholders = runIds.map(() => '?').join(', ');
    const rows = this.#database
      .prepare(
        `SELECT summary_id, run_id, source_id, novel_id, chapter_ids_json,
                summary, provider_id, model_id, created_at
         FROM scheduled_summaries
         WHERE run_id IN (${placeholders})
         ORDER BY created_at DESC`,
      )
      .all(...runIds) as Array<{
        summary_id: string;
        run_id: string;
        source_id: string;
        novel_id: string;
        chapter_ids_json: string;
        summary: string;
        provider_id: string;
        model_id: string;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.summary_id,
      runId: row.run_id,
      sourceId: row.source_id,
      novelId: row.novel_id,
      chapterIds: parseChapterIdsJson(row.chapter_ids_json),
      summary: row.summary,
      providerId: row.provider_id,
      modelId: row.model_id,
      createdAt: row.created_at,
    }));
  }

  getLatestCompletedCheckRun(): StoredScheduledCheckRunRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT id, started_at, completed_at, status, total_checked, new_chapters_found, skipped, errored
         FROM scheduled_check_runs
         WHERE status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
      )
      .get() as {
      id: string; started_at: string; completed_at: string | null;
      status: string; total_checked: number; new_chapters_found: number;
      skipped: number; errored: number;
    } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as 'running' | 'completed',
      totalChecked: row.total_checked,
      newChaptersFound: row.new_chapters_found,
      skipped: row.skipped,
      errored: row.errored,
    };
  }

  /** 服务启动恢复：将遗留的 running 记录标记为 completed */
  recoverIncompleteCheckRuns(): void {
    this.#database
      .prepare(
        `UPDATE scheduled_check_runs
         SET status = 'completed', completed_at = ?
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString());
  }

  // ── OPDS: 可见性与时间戳 ──

  getOpdsNovel(sourceId: string, novelId: string): StoredOpdsNovelRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT n.source_id, n.novel_id, n.title, n.opds_visible,
                n.content_updated_at, n.epub_compiled_at,
                EXISTS (
                  SELECT 1 FROM chapter_translations ct
                  WHERE ct.source_id = n.source_id
                    AND ct.novel_id = n.novel_id
                    AND ct.status = 'completed'
                ) AS has_translation
         FROM novels n
         WHERE n.source_id = ? AND n.novel_id = ?`,
      )
      .get(sourceId, novelId) as {
        source_id: string; novel_id: string; title: string;
        opds_visible: number; content_updated_at: string | null;
        epub_compiled_at: string | null; has_translation: number;
      } | undefined;

    if (!row) return undefined;

    return {
      sourceId: row.source_id,
      novelId: row.novel_id,
      title: row.title,
      opdsVisible: row.opds_visible === 1,
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
      hasTranslation: row.has_translation === 1,
    };
  }

  listOpdsNovels(): StoredOpdsNovelRow[] {
    const rows = this.#database
      .prepare(
        `SELECT n.source_id, n.novel_id, n.title, n.opds_visible,
                n.content_updated_at, n.epub_compiled_at,
                EXISTS (
                  SELECT 1 FROM chapter_translations ct
                  WHERE ct.source_id = n.source_id
                    AND ct.novel_id = n.novel_id
                    AND ct.status = 'completed'
                ) AS has_translation
         FROM novels n
         ORDER BY n.title COLLATE NOCASE ASC`,
      )
      .all() as Array<{
        source_id: string; novel_id: string; title: string;
        opds_visible: number; content_updated_at: string | null;
        epub_compiled_at: string | null; has_translation: number;
      }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      title: row.title,
      opdsVisible: row.opds_visible === 1,
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
      hasTranslation: row.has_translation === 1,
    }));
  }

  /** 查询所有 opds_visible=1 的小说（供扫描器使用） */
  listVisibleOpdsNovels(): Array<{
    sourceId: string;
    novelId: string;
    contentUpdatedAt: string | null;
    epubCompiledAt: string | null;
  }> {
    const rows = this.#database
      .prepare(
        `SELECT source_id, novel_id, content_updated_at, epub_compiled_at
         FROM novels
         WHERE opds_visible = 1 AND deleted_at IS NULL
         ORDER BY source_id, novel_id`,
      )
      .all() as Array<{
        source_id: string; novel_id: string;
        content_updated_at: string | null; epub_compiled_at: string | null;
      }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
    }));
  }

  /** 查询所有 opds_visible=1 的小说（含完整元数据，供 feed 构造） */
  listVisibleOpdsNovelsWithMetadata(): Array<{
    sourceId: string;
    novelId: string;
    title: string;
    author: string;
    description: string;
    tags: string[];
    contentUpdatedAt: string | null;
    epubCompiledAt: string | null;
    hasTranslation: boolean;
  }> {
    const rows = this.#database
      .prepare(
        `SELECT n.source_id, n.novel_id, n.title, n.author, n.description,
                n.tags_json, n.content_updated_at, n.epub_compiled_at,
                EXISTS (
                  SELECT 1 FROM chapter_translations ct
                  WHERE ct.source_id = n.source_id
                    AND ct.novel_id = n.novel_id
                    AND ct.status = 'completed'
                ) AS has_translation
         FROM novels n
         WHERE n.opds_visible = 1 AND n.deleted_at IS NULL
         ORDER BY n.title COLLATE NOCASE ASC`,
      )
      .all() as Array<{
        source_id: string; novel_id: string; title: string; author: string;
        description: string; tags_json: string;
        content_updated_at: string | null; epub_compiled_at: string | null;
        has_translation: number;
      }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      title: row.title,
      author: row.author,
      description: row.description,
      tags: JSON.parse(row.tags_json) as string[],
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
      hasTranslation: row.has_translation === 1,
    }));
  }

  updateOpdsVisible(sourceId: string, novelId: string, visible: boolean): void {
    this.#database
      .prepare(
        `UPDATE novels SET opds_visible = ? WHERE source_id = ? AND novel_id = ?`,
      )
      .run(visible ? 1 : 0, sourceId, novelId);
  }

  bulkUpdateOpdsVisible(entries: Array<{ sourceId: string; novelId: string; visible: boolean }>): void {
    const stmt = this.#database.prepare(
      `UPDATE novels SET opds_visible = ? WHERE source_id = ? AND novel_id = ?`,
    );
    const tx = this.#database.transaction(() => {
      for (const entry of entries) {
        stmt.run(entry.visible ? 1 : 0, entry.sourceId, entry.novelId);
      }
    });
    tx();
  }

  /** 章节入库或翻译完成后调用，bump 内容更新时间 */
  bumpNovelContentUpdatedAt(sourceId: string, novelId: string): void {
    const now = new Date().toISOString();
    this.#database
      .prepare(
        `UPDATE novels SET content_updated_at = ? WHERE source_id = ? AND novel_id = ?`,
      )
      .run(now, sourceId, novelId);
  }

  /** EPUB 制品生成成功后调用 */
  updateNovelEpubCompiledAt(sourceId: string, novelId: string, compiledAt: string): void {
    this.#database
      .prepare(
        `UPDATE novels SET epub_compiled_at = ? WHERE source_id = ? AND novel_id = ?`,
      )
      .run(compiledAt, sourceId, novelId);
  }

  /** 查询某书是否有已完成的章节翻译（供扫描器决定生成哪些版本） */
  novelHasCompletedTranslation(sourceId: string, novelId: string): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM chapter_translations
         WHERE source_id = ? AND novel_id = ? AND status = 'completed'
         LIMIT 1`,
      )
      .get(sourceId, novelId) as { 1: number } | undefined;
    return Boolean(row);
  }

  // ── OPDS: 制品生成审计 ──

  createOpdsCompilationRun(id: string, startedAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO opds_compilation_runs (id, started_at, status)
         VALUES (?, ?, 'running')`,
      )
      .run(id, startedAt);
  }

  completeOpdsCompilationRun(
    id: string,
    completedAt: string,
    totalScanned: number,
    compiled: number,
    skipped: number,
    errored: number,
  ): void {
    this.#database
      .prepare(
        `UPDATE opds_compilation_runs
         SET completed_at = ?, status = 'completed',
             total_scanned = ?, compiled = ?, skipped = ?, errored = ?
         WHERE id = ?`,
      )
      .run(completedAt, totalScanned, compiled, skipped, errored, id);
  }

  listOpdsCompilationRuns(limit: number, offset: number): StoredOpdsCompilationRunRow[] {
    const rows = this.#database
      .prepare(
        `SELECT id, started_at, completed_at, status,
               total_scanned, compiled, skipped, errored
         FROM opds_compilation_runs
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
        id: string; started_at: string; completed_at: string | null;
        status: string; total_scanned: number; compiled: number;
        skipped: number; errored: number;
      }>;

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as 'running' | 'completed',
      totalScanned: row.total_scanned,
      compiled: row.compiled,
      skipped: row.skipped,
      errored: row.errored,
    }));
  }

  getLatestCompletedOpdsCompilationRun(): StoredOpdsCompilationRunRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT id, started_at, completed_at, status,
               total_scanned, compiled, skipped, errored
         FROM opds_compilation_runs
         WHERE status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
      )
      .get() as {
        id: string; started_at: string; completed_at: string | null;
        status: string; total_scanned: number; compiled: number;
        skipped: number; errored: number;
      } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as 'running' | 'completed',
      totalScanned: row.total_scanned,
      compiled: row.compiled,
      skipped: row.skipped,
      errored: row.errored,
    };
  }

  /** 服务启动恢复：将遗留 running 记录标记为 completed */
  recoverIncompleteOpdsCompilationRuns(): void {
    this.#database
      .prepare(
        `UPDATE opds_compilation_runs
         SET status = 'completed', completed_at = ?
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString());
  }

  // ── 精翻工作区 ──

  createRefinedTranslationTask(input: {
    id: string; sourceId: string; novelId: string; name: string; novelTitle: string; author: string;
    sourceMetadata?: StoredRefinedTranslationTaskRow['sourceMetadata'];
    sourceLang: string; targetLang: string; modelConfig: RefinedTranslationModelConfig;
    chapters: Array<{ id: string; index: number; title: string; volumeTitle: string | null; content: string; paragraphs: string[] }>;
    terms: Array<{ sourceTerm: string; targetTerm: string | null; entityType: string | null; priority: number; suggestion: string | null }>;
  }): StoredRefinedTranslationTaskRow {
    const now = new Date().toISOString();
    const insertTask = this.#database.prepare(`INSERT INTO refined_translation_tasks
      (task_id, source_id, novel_id, task_name, novel_title, author, source_metadata_json, translated_metadata_json, source_lang, target_lang, status, stage, model_config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 'paused', 'glossary_setup', ?, ?, ?)`);
    const insertChapter = this.#database.prepare(`INSERT INTO refined_translation_chapters
      (task_id, chapter_id, chapter_index, title, volume_title, source_content, status, review_round, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`);
    const insertSegment = this.#database.prepare(`INSERT INTO refined_translation_segments
      (segment_id, task_id, chapter_id, paragraph_index, source_text, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`);
    const insertTerm = this.#database.prepare(`INSERT OR IGNORE INTO refined_translation_terms
      (term_id, task_id, source_term, target_term, entity_type, priority, suggestion, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`);
    this.#database.transaction(() => {
      insertTask.run(input.id, input.sourceId, input.novelId, input.name, input.novelTitle, input.author, JSON.stringify(input.sourceMetadata ?? { title: input.novelTitle, author: input.author, description: '', tags: [], infoPageUrl: '' }), input.sourceLang, input.targetLang, JSON.stringify(input.modelConfig), now, now);
      for (const chapter of input.chapters) {
        insertChapter.run(input.id, chapter.id, chapter.index, chapter.title, chapter.volumeTitle, chapter.content, now);
        chapter.paragraphs.forEach((sourceText, paragraphIndex) => insertSegment.run(crypto.randomUUID(), input.id, chapter.id, paragraphIndex, sourceText, now));
      }
      for (const term of input.terms) insertTerm.run(crypto.randomUUID(), input.id, term.sourceTerm, term.targetTerm, term.entityType, term.priority, term.suggestion, now);
    })();
    const task = this.getRefinedTranslationTask(input.id);
    if (!task) throw new Error('Failed to create refined translation task.');
    this.appendRefinedTranslationLog(input.id, 'info', `已创建任务快照：${input.chapters.length} 章，等待确认术语表。`);
    return task;
  }

  listRefinedTranslationTasks(includeDeleted = false): StoredRefinedTranslationTaskRow[] {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    return this.#database.prepare(`SELECT * FROM refined_translation_tasks ${where} ORDER BY updated_at DESC`).all()
      .map((row) => mapRefinedTaskRow(row as RefinedTaskRow));
  }

  listResumableRefinedTranslationTasks(): StoredRefinedTranslationTaskRow[] {
    return this.#database.prepare(`SELECT * FROM refined_translation_tasks WHERE deleted_at IS NULL AND status = 'running' ORDER BY updated_at ASC`).all()
      .map((row) => mapRefinedTaskRow(row as RefinedTaskRow));
  }

  getRefinedTranslationTask(taskId: string): StoredRefinedTranslationTaskRow | null {
    const row = this.#database.prepare('SELECT * FROM refined_translation_tasks WHERE task_id = ?').get(taskId) as RefinedTaskRow | undefined;
    return row ? mapRefinedTaskRow(row) : null;
  }

  updateRefinedTranslationTask(taskId: string, input: { name?: string | undefined; sourceLang?: string | undefined; targetLang?: string | undefined; status?: RefinedTranslationTaskStatus | undefined; stage?: RefinedTranslationStage | undefined; modelConfig?: RefinedTranslationModelConfig | undefined }): StoredRefinedTranslationTaskRow | null {
    const current = this.getRefinedTranslationTask(taskId); if (!current) return null;
    const now = new Date().toISOString();
    this.#database.prepare(`UPDATE refined_translation_tasks SET task_name = ?, source_lang = ?, target_lang = ?, status = ?, stage = ?, model_config_json = ?, updated_at = ? WHERE task_id = ?`)
      .run(input.name?.trim() || current.name, input.sourceLang?.trim() || current.sourceLang, input.targetLang?.trim() || current.targetLang, input.status ?? current.status, input.stage ?? current.stage, JSON.stringify(input.modelConfig ?? current.modelConfig), now, taskId);
    return this.getRefinedTranslationTask(taskId);
  }

  updateRefinedTranslationMetadata(taskId: string, input: Partial<StoredRefinedTranslationTaskRow['translatedMetadata']>): StoredRefinedTranslationTaskRow | null {
    const current = this.getRefinedTranslationTask(taskId); if (!current) return null;
    const next = { ...current.translatedMetadata, ...input, tags: input.tags ?? current.translatedMetadata.tags };
    this.#database.prepare('UPDATE refined_translation_tasks SET translated_metadata_json = ?, updated_at = ? WHERE task_id = ?')
      .run(JSON.stringify(next), new Date().toISOString(), taskId);
    return this.getRefinedTranslationTask(taskId);
  }

  markRefinedTranslationTaskDeleted(taskId: string): StoredRefinedTranslationTaskRow | null {
    const task = this.getRefinedTranslationTask(taskId); if (!task || task.deletedAt) return null;
    const now = new Date().toISOString();
    this.#database.prepare(`UPDATE refined_translation_tasks SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE task_id = ?`).run(now, now, taskId);
    return this.getRefinedTranslationTask(taskId);
  }

  restoreRefinedTranslationTask(taskId: string): StoredRefinedTranslationTaskRow | null {
    const task = this.getRefinedTranslationTask(taskId); if (!task || !task.deletedAt) return null;
    const now = new Date().toISOString();
    this.#database.prepare(`UPDATE refined_translation_tasks SET status = 'paused', deleted_at = NULL, updated_at = ? WHERE task_id = ?`).run(now, taskId);
    return this.getRefinedTranslationTask(taskId);
  }

  purgeRefinedTranslationTask(taskId: string): boolean {
    const result = this.#database.prepare(`DELETE FROM refined_translation_tasks
      WHERE task_id = ? AND deleted_at IS NOT NULL
        AND datetime(deleted_at, '+15 days') <= datetime('now')`).run(taskId);
    return result.changes > 0;
  }

  getRefinedTranslationPurgeStatus(taskId: string): { canPurge: boolean; remainingDays: number; deletedAt: string | null } | null {
    const task = this.getRefinedTranslationTask(taskId);
    if (!task) return null;
    if (!task.deletedAt) return { canPurge: false, remainingDays: 15, deletedAt: null };
    const elapsedMs = Math.max(0, Date.now() - Date.parse(task.deletedAt));
    const remainingDays = Math.max(0, Math.ceil((15 * 24 * 60 * 60 * 1000 - elapsedMs) / (24 * 60 * 60 * 1000)));
    return { canPurge: remainingDays === 0, remainingDays, deletedAt: task.deletedAt };
  }

  listRefinedTranslationChapters(taskId: string): StoredRefinedTranslationChapterRow[] {
    return this.#database.prepare('SELECT * FROM refined_translation_chapters WHERE task_id = ? ORDER BY chapter_index').all(taskId)
      .map((row) => mapRefinedChapterRow(row as RefinedChapterRow));
  }

  getRefinedTranslationChapter(taskId: string, chapterId: string): StoredRefinedTranslationChapterRow | null {
    const row = this.#database.prepare('SELECT * FROM refined_translation_chapters WHERE task_id = ? AND chapter_id = ?').get(taskId, chapterId) as RefinedChapterRow | undefined;
    return row ? mapRefinedChapterRow(row) : null;
  }

  listRefinedTranslationSegments(taskId: string, chapterId: string): StoredRefinedTranslationSegmentRow[] {
    return this.#database.prepare('SELECT * FROM refined_translation_segments WHERE task_id = ? AND chapter_id = ? ORDER BY paragraph_index').all(taskId, chapterId)
      .map((row) => mapRefinedSegmentRow(row as RefinedSegmentRow));
  }

  updateRefinedTranslationSegment(taskId: string, chapterId: string, paragraphIndex: number, translatedText: string | null, status: RefinedTranslationSegmentStatus): StoredRefinedTranslationSegmentRow | null {
    const now = new Date().toISOString();
    const result = this.#database.prepare(`UPDATE refined_translation_segments SET translated_text = ?, status = ?, updated_at = ? WHERE task_id = ? AND chapter_id = ? AND paragraph_index = ?`)
      .run(translatedText, status, now, taskId, chapterId, paragraphIndex);
    if (!result.changes) return null;
    this.#database.prepare(`UPDATE refined_translation_chapters SET status = CASE WHEN EXISTS(SELECT 1 FROM refined_translation_segments WHERE task_id = ? AND chapter_id = ? AND status = 'failed') THEN 'failed' WHEN NOT EXISTS(SELECT 1 FROM refined_translation_segments WHERE task_id = ? AND chapter_id = ? AND status = 'pending') THEN 'translated' ELSE 'pending' END, updated_at = ? WHERE task_id = ? AND chapter_id = ?`)
      .run(taskId, chapterId, taskId, chapterId, now, taskId, chapterId);
    const row = this.#database.prepare('SELECT * FROM refined_translation_segments WHERE task_id = ? AND chapter_id = ? AND paragraph_index = ?').get(taskId, chapterId, paragraphIndex) as RefinedSegmentRow | undefined;
    return row ? mapRefinedSegmentRow(row) : null;
  }

  updateRefinedTranslationChapterTitle(taskId: string, chapterId: string, translatedTitle: string | null): StoredRefinedTranslationChapterRow | null {
    const result = this.#database.prepare('UPDATE refined_translation_chapters SET translated_title = ?, updated_at = ? WHERE task_id = ? AND chapter_id = ?')
      .run(translatedTitle?.trim() || null, new Date().toISOString(), taskId, chapterId);
    return result.changes ? this.getRefinedTranslationChapter(taskId, chapterId) : null;
  }

  listRefinedTranslationTerms(taskId: string): StoredRefinedTranslationTermRow[] {
    return this.#database.prepare('SELECT * FROM refined_translation_terms WHERE task_id = ? ORDER BY priority DESC, source_term COLLATE NOCASE').all(taskId)
      .map((row) => mapRefinedTermRow(row as RefinedTermRow));
  }

  createRefinedTranslationTerm(taskId: string, input: { sourceTerm: string; targetTerm?: string | null; entityType?: string | null; priority?: number; suggestion?: string | null; status?: RefinedTranslationTermStatus }): StoredRefinedTranslationTermRow {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.#database.prepare(`INSERT INTO refined_translation_terms (term_id, task_id, source_term, target_term, entity_type, priority, suggestion, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, taskId, input.sourceTerm.trim(), input.targetTerm ?? null, input.entityType ?? null, input.priority ?? 0, input.suggestion ?? null, input.status ?? 'pending', now);
    const row = this.#database.prepare('SELECT * FROM refined_translation_terms WHERE term_id = ?').get(id) as RefinedTermRow;
    return mapRefinedTermRow(row);
  }

  updateRefinedTranslationTerm(taskId: string, termId: string, input: { targetTerm?: string | null; entityType?: string | null; priority?: number; suggestion?: string | null; status?: RefinedTranslationTermStatus }): StoredRefinedTranslationTermRow | null {
    const existing = this.#database.prepare('SELECT * FROM refined_translation_terms WHERE task_id = ? AND term_id = ?').get(taskId, termId) as RefinedTermRow | undefined;
    if (!existing) return null;
    const now = new Date().toISOString();
    this.#database.prepare(`UPDATE refined_translation_terms SET target_term = ?, entity_type = ?, priority = ?, suggestion = ?, status = ?, updated_at = ? WHERE task_id = ? AND term_id = ?`)
      .run(input.targetTerm !== undefined ? input.targetTerm : existing.target_term, input.entityType !== undefined ? input.entityType : existing.entity_type, input.priority ?? existing.priority, input.suggestion !== undefined ? input.suggestion : existing.suggestion, input.status ?? existing.status, now, taskId, termId);
    const row = this.#database.prepare('SELECT * FROM refined_translation_terms WHERE task_id = ? AND term_id = ?').get(taskId, termId) as RefinedTermRow;
    return mapRefinedTermRow(row);
  }

  deleteRefinedTranslationTerm(taskId: string, termId: string): boolean {
    return this.#database.prepare('DELETE FROM refined_translation_terms WHERE task_id = ? AND term_id = ?').run(taskId, termId).changes > 0;
  }

  deleteRefinedTranslationTerms(taskId: string, termIds: string[]): string[] {
    const uniqueIds = [...new Set(termIds.filter(Boolean))];
    if (!uniqueIds.length) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const existing = this.#database.prepare(`SELECT term_id FROM refined_translation_terms WHERE task_id = ? AND term_id IN (${placeholders})`)
      .all(taskId, ...uniqueIds) as Array<{ term_id: string }>;
    if (!existing.length) return [];
    const existingIds = new Set(existing.map((row) => row.term_id));
    const deletedIds = uniqueIds.filter((termId) => existingIds.has(termId));
    this.#database.prepare(`DELETE FROM refined_translation_terms WHERE task_id = ? AND term_id IN (${deletedIds.map(() => '?').join(', ')})`)
      .run(taskId, ...deletedIds);
    return deletedIds;
  }

  listRefinedTranslationReviews(taskId: string, chapterId?: string): StoredRefinedTranslationReviewRow[] {
    const rows = chapterId
      ? this.#database.prepare('SELECT * FROM refined_translation_reviews WHERE task_id = ? AND chapter_id = ? ORDER BY created_at DESC').all(taskId, chapterId)
      : this.#database.prepare('SELECT * FROM refined_translation_reviews WHERE task_id = ? ORDER BY created_at DESC').all(taskId);
    return rows.map((row) => mapRefinedReviewRow(row as RefinedReviewRow));
  }

  createRefinedTranslationReview(input: Omit<StoredRefinedTranslationReviewRow, 'id' | 'createdAt'>): StoredRefinedTranslationReviewRow {
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    this.#database.prepare(`INSERT INTO refined_translation_reviews (review_id, task_id, chapter_id, review_round, severity, paragraph_indices_json, scores_json, suggestion, replacement_text, force_change, resolved, resolution, resolution_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.taskId, input.chapterId, input.reviewRound, input.severity, JSON.stringify(input.paragraphIndices), JSON.stringify(input.scores), input.suggestion, input.replacementText, input.forceChange ? 1 : 0, input.resolved ? 1 : 0, input.resolution, input.resolutionNote, createdAt);
    return { id, ...input, createdAt };
  }

  updateRefinedTranslationReview(taskId: string, reviewId: string, resolution: RefinedTranslationReviewResolution, resolutionNote: string | null = null): boolean {
    return this.#database.prepare('UPDATE refined_translation_reviews SET resolved = ?, resolution = ?, resolution_note = ? WHERE task_id = ? AND review_id = ?').run(resolution === 'open' ? 0 : 1, resolution, resolutionNote, taskId, reviewId).changes > 0;
  }

  supersedeOpenRefinedTranslationReviews(taskId: string, chapterId: string): number {
    return this.#database.prepare("UPDATE refined_translation_reviews SET resolved = 1, resolution = 'superseded' WHERE task_id = ? AND chapter_id = ? AND resolution = 'open'").run(taskId, chapterId).changes;
  }

  updateRefinedTranslationChapterReview(taskId: string, chapterId: string, input: { reviewRound: number; reviewScore: number | null; status: RefinedTranslationChapterStatus }): StoredRefinedTranslationChapterRow | null {
    const result = this.#database.prepare(`UPDATE refined_translation_chapters SET review_round = ?, review_score = ?, status = ?, updated_at = ? WHERE task_id = ? AND chapter_id = ?`)
      .run(input.reviewRound, input.reviewScore, input.status, new Date().toISOString(), taskId, chapterId);
    return result.changes ? this.getRefinedTranslationChapter(taskId, chapterId) : null;
  }

  appendRefinedTranslationLog(taskId: string, level: StoredRefinedTranslationLogRow['level'], message: string): StoredRefinedTranslationLogRow {
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    this.#database.prepare('INSERT INTO refined_translation_logs (log_id, task_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)').run(id, taskId, level, message, createdAt);
    return { id, taskId, level, message, createdAt };
  }

  listRefinedTranslationLogs(taskId: string): StoredRefinedTranslationLogRow[] {
    return this.#database.prepare('SELECT * FROM refined_translation_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 200').all(taskId)
      .map((row) => { const value = row as { log_id: string; task_id: string; level: StoredRefinedTranslationLogRow['level']; message: string; created_at: string }; return { id: value.log_id, taskId: value.task_id, level: value.level, message: value.message, createdAt: value.created_at }; }).reverse();
  }

  appendRefinedTranslationTransition(input: Omit<StoredRefinedTranslationTransitionRow, 'id' | 'createdAt'>): StoredRefinedTranslationTransitionRow {
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    this.#database.prepare('INSERT INTO refined_translation_transitions (transition_id, task_id, from_stage, to_stage, condition_text, chapter_id, review_round, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.taskId, input.fromStage, input.toStage, input.condition, input.chapterId, input.reviewRound, createdAt);
    return { id, ...input, createdAt };
  }

  listRefinedTranslationTransitions(taskId: string): StoredRefinedTranslationTransitionRow[] {
    return this.#database.prepare('SELECT transition_id, task_id, from_stage, to_stage, condition_text, chapter_id, review_round, created_at FROM refined_translation_transitions WHERE task_id = ? ORDER BY created_at ASC, transition_id ASC').all(taskId)
      .map((row) => { const value = row as { transition_id: string; task_id: string; from_stage: RefinedTranslationStage | null; to_stage: RefinedTranslationStage; condition_text: string; chapter_id: string | null; review_round: number | null; created_at: string }; return { id: value.transition_id, taskId: value.task_id, fromStage: value.from_stage, toStage: value.to_stage, condition: value.condition_text, chapterId: value.chapter_id, reviewRound: value.review_round, createdAt: value.created_at }; });
  }

  saveRefinedTranslationCheckpoint(taskId: string, stage: RefinedTranslationStage, state: Record<string, unknown>): void {
    this.#database.prepare(`INSERT INTO refined_translation_checkpoints (task_id, stage, state_json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id, stage) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
      .run(taskId, stage, JSON.stringify(state), new Date().toISOString());
  }

  getRefinedTranslationCheckpoint(taskId: string, stage: RefinedTranslationStage): { stage: RefinedTranslationStage; state: Record<string, unknown>; updatedAt: string } | null {
    const row = this.#database.prepare('SELECT stage, state_json, updated_at FROM refined_translation_checkpoints WHERE task_id = ? AND stage = ?').get(taskId, stage) as { stage: RefinedTranslationStage; state_json: string; updated_at: string } | undefined;
    if (!row) return null;
    try { const state = JSON.parse(row.state_json) as unknown; return { stage: row.stage, state: state && typeof state === 'object' && !Array.isArray(state) ? state as Record<string, unknown> : {}, updatedAt: row.updated_at }; } catch { return { stage: row.stage, state: {}, updatedAt: row.updated_at }; }
  }

  listRefinedTranslationCheckpoints(taskId: string): Array<{ stage: RefinedTranslationStage; state: Record<string, unknown>; updatedAt: string }> {
    return this.#database.prepare('SELECT stage, state_json, updated_at FROM refined_translation_checkpoints WHERE task_id = ? ORDER BY updated_at DESC').all(taskId)
      .flatMap((row) => {
        const value = row as { stage: RefinedTranslationStage; state_json: string; updated_at: string };
        try {
          const parsed = JSON.parse(value.state_json) as unknown;
          return [{ stage: value.stage, state: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}, updatedAt: value.updated_at }];
        } catch { return [{ stage: value.stage, state: {}, updatedAt: value.updated_at }]; }
      });
  }

  private migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS novels (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        chapter_count INTEGER NOT NULL,
        info_page_url TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id)
      );

      CREATE TABLE IF NOT EXISTS chapters (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        volume_title TEXT,
        url TEXT NOT NULL,
        content TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, chapter_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id)
      );

      CREATE TABLE IF NOT EXISTS task_history (
        task_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS novel_aliases (
        alias_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_id, novel_id, normalized_alias),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS reading_progress (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        current_chapter_id TEXT NOT NULL,
        current_chapter_index INTEGER NOT NULL,
        current_updated_at TEXT NOT NULL,
        highest_chapter_id TEXT NOT NULL,
        highest_chapter_index INTEGER NOT NULL,
        highest_updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        bookmark_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        volume_title TEXT,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_novel_aliases_lookup
        ON novel_aliases(source_id, novel_id, normalized_alias);

      CREATE INDEX IF NOT EXISTS idx_bookmarks_lookup
        ON bookmarks(source_id, novel_id, chapter_index, created_at);

      CREATE TABLE IF NOT EXISTS novel_graph_profiles (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chat_provider_id TEXT NOT NULL,
        chat_model_id TEXT NOT NULL,
        extraction_models_json TEXT NOT NULL DEFAULT '[]',
        embedding_provider_id TEXT NOT NULL,
        embedding_model_id TEXT NOT NULL,
        rerank_provider_id TEXT NOT NULL,
        rerank_model_id TEXT NOT NULL,
        extraction_concurrency INTEGER NOT NULL DEFAULT 2,
        neo4j_enabled INTEGER NOT NULL DEFAULT 0,
        neo4j_uri TEXT NOT NULL DEFAULT '',
        neo4j_username TEXT NOT NULL DEFAULT '',
        neo4j_password TEXT NOT NULL DEFAULT '',
        neo4j_database TEXT NOT NULL DEFAULT '',
        config_locked INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_graph_builds (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        progress_percent INTEGER NOT NULL,
        message TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        last_built_at TEXT,
        synced_to_neo4j_at TEXT,
        entity_count INTEGER NOT NULL DEFAULT 0,
        relation_count INTEGER NOT NULL DEFAULT 0,
        model_stats_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_graph_build_logs (
        log_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_graph_build_checkpoints (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        extraction_json TEXT NOT NULL,
        warning_message TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, chunk_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS knowledge_graph_entities (
        entity_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        prominence REAL NOT NULL,
        mention_count INTEGER NOT NULL,
        mention_chapter_ids_json TEXT NOT NULL,
        first_chapter_id TEXT,
        last_chapter_id TEXT,
        aliases_json TEXT NOT NULL,
        embedding_json TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS knowledge_graph_relations (
        relation_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        weight REAL NOT NULL,
        chapter_ids_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS knowledge_graph_chunks (
        chunk_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        summary TEXT NOT NULL,
        event_summary TEXT NOT NULL,
        content TEXT NOT NULL,
        entity_names_json TEXT NOT NULL,
        keyword_hints_json TEXT NOT NULL,
        embedding_json TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_graph_entities_lookup
        ON knowledge_graph_entities(source_id, novel_id, prominence DESC, mention_count DESC);

      CREATE INDEX IF NOT EXISTS idx_knowledge_graph_relations_lookup
        ON knowledge_graph_relations(source_id, novel_id, weight DESC);

      CREATE INDEX IF NOT EXISTS idx_knowledge_graph_chunks_lookup
        ON knowledge_graph_chunks(source_id, novel_id, chapter_index ASC, chunk_index ASC);

      CREATE TABLE IF NOT EXISTS knowledge_graph_summaries (
        summary_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        summary_type TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        chapter_ids_json TEXT NOT NULL,
        entity_ids_json TEXT NOT NULL,
        relation_ids_json TEXT NOT NULL,
        embedding_json TEXT,
        source_fingerprint TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, novel_id, summary_type, stable_key),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_graph_summaries_lookup
        ON knowledge_graph_summaries(source_id, novel_id, summary_type, stable_key);

      CREATE INDEX IF NOT EXISTS idx_novel_graph_build_logs_lookup
        ON novel_graph_build_logs(source_id, novel_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS scheduled_novels (
        source_id         TEXT NOT NULL,
        novel_id          TEXT NOT NULL,
        enabled           INTEGER NOT NULL DEFAULT 0,
        auto_translate    INTEGER NOT NULL DEFAULT 0,
        auto_summarize    INTEGER NOT NULL DEFAULT 0,
        summarize_model_json TEXT,
        last_checked_at   TEXT,
        last_check_result TEXT,
        last_check_message TEXT,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scheduled_check_runs (
        id                 TEXT NOT NULL PRIMARY KEY,
        started_at         TEXT NOT NULL,
        completed_at       TEXT,
        status             TEXT NOT NULL DEFAULT 'running',
        total_checked      INTEGER NOT NULL DEFAULT 0,
        new_chapters_found INTEGER NOT NULL DEFAULT 0,
        skipped            INTEGER NOT NULL DEFAULT 0,
        errored            INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS scheduled_summaries (
        summary_id        TEXT NOT NULL PRIMARY KEY,
        run_id            TEXT NOT NULL,
        source_id         TEXT NOT NULL,
        novel_id          TEXT NOT NULL,
        chapter_ids_json  TEXT NOT NULL,
        summary           TEXT NOT NULL,
        provider_id       TEXT NOT NULL,
        model_id          TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_summaries_run_lookup
        ON scheduled_summaries(run_id, created_at DESC);
    `);

    this.ensureColumnExists('knowledge_graph_entities', 'embedding_json', 'TEXT');
    this.ensureColumnExists('knowledge_graph_chunks', 'embedding_json', 'TEXT');
    this.ensureColumnExists('knowledge_graph_summaries', 'embedding_json', 'TEXT');
    this.ensureColumnExists('novel_graph_profiles', 'extraction_models_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumnExists('novel_graph_profiles', 'extraction_concurrency', 'INTEGER NOT NULL DEFAULT 2');
    this.ensureColumnExists('novel_graph_builds', 'model_stats_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumnExists('novel_graph_build_checkpoints', 'status', "TEXT NOT NULL DEFAULT 'success'");
    this.ensureColumnExists('scheduled_novels', 'auto_translate', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('scheduled_novels', 'auto_summarize', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('scheduled_novels', 'summarize_model_json', 'TEXT');

    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS reader_typography (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        font_size REAL NOT NULL,
        font_size_preset TEXT NOT NULL,
        line_height REAL NOT NULL,
        paragraph_spacing REAL NOT NULL,
        font_family_preset TEXT NOT NULL,
        font_family_custom TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      -- 翻译流水线

      CREATE TABLE IF NOT EXISTS novel_translation_profiles (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        source_lang TEXT NOT NULL DEFAULT 'ja',
        target_lang TEXT NOT NULL DEFAULT 'zh-CN',
        term_extraction_model_json TEXT,
        translation_models_json TEXT NOT NULL DEFAULT '[]',
        review_model_json TEXT,
        translation_concurrency INTEGER NOT NULL DEFAULT 2,
        quality_threshold REAL NOT NULL DEFAULT 0.8,
        auto_reject_untranslated_terms INTEGER NOT NULL DEFAULT 1,
        default_export_mode TEXT NOT NULL DEFAULT 'original',
        config_locked INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_translation_terms (
        term_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        source_term TEXT NOT NULL,
        target_term TEXT,
        entity_type TEXT,
        note TEXT,
        extracted_from_chapter_id TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_id, novel_id, source_term),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_translation_builds (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        progress_percent INTEGER NOT NULL,
        message TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        model_stats_json TEXT NOT NULL DEFAULT '[]',
        translated_chapters INTEGER NOT NULL DEFAULT 0,
        reviewed_chapters INTEGER NOT NULL DEFAULT 0,
        failed_chapters INTEGER NOT NULL DEFAULT 0,
        glossary_version INTEGER NOT NULL DEFAULT 0,
        profile_version INTEGER NOT NULL DEFAULT 0,
        current_chapter_title TEXT,
        current_chapter_paragraphs INTEGER NOT NULL DEFAULT 0,
        current_chapter_translated_paragraphs INTEGER NOT NULL DEFAULT 0,
        total_translated_paragraphs INTEGER NOT NULL DEFAULT 0,
        total_paragraph_estimate INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_translation_build_logs (
        log_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS novel_translation_build_checkpoints (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        stage TEXT NOT NULL,
        pipeline_state_json TEXT NOT NULL,
        warning_message TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, chapter_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chapter_translations (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        translated_title TEXT,
        status TEXT NOT NULL,
        overall_quality_score REAL,
        translator_model_id TEXT,
        reviewer_model_id TEXT,
        token_usage_json TEXT,
        source_content_hash TEXT NOT NULL,
        glossary_version INTEGER NOT NULL DEFAULT 0,
        profile_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, chapter_id, source_lang, target_lang),
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chapter_translation_paragraphs (
        paragraph_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        paragraph_index INTEGER NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT,
        confidence REAL,
        applied_term_ids_json TEXT NOT NULL DEFAULT '[]',
        model_id TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chapter_translation_qa (
        qa_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        check_type TEXT NOT NULL,
        score REAL NOT NULL,
        severity TEXT NOT NULL DEFAULT 'low',
        suggestion TEXT,
        paragraph_indices_json TEXT NOT NULL DEFAULT '[]',
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_novel_translation_terms_lookup
        ON novel_translation_terms(source_id, novel_id, priority DESC, source_term COLLATE NOCASE ASC);

      CREATE INDEX IF NOT EXISTS idx_novel_translation_build_logs_lookup
        ON novel_translation_build_logs(source_id, novel_id, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_chapter_translations_lookup
        ON chapter_translations(source_id, novel_id, status, chapter_id);

      CREATE INDEX IF NOT EXISTS idx_chapter_translation_paragraphs_lookup
        ON chapter_translation_paragraphs(source_id, novel_id, chapter_id, paragraph_index ASC);

      CREATE INDEX IF NOT EXISTS idx_chapter_translation_qa_lookup
        ON chapter_translation_qa(source_id, novel_id, chapter_id, check_type);
    `);

    // 翻译构建——段落级进度追踪（幂等迁移：仅对旧库补列）
    this.ensureColumnExists('novel_translation_builds', 'current_chapter_title', 'TEXT');
    this.ensureColumnExists('novel_translation_builds', 'current_chapter_paragraphs', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('novel_translation_builds', 'current_chapter_translated_paragraphs', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('novel_translation_builds', 'total_translated_paragraphs', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('novel_translation_builds', 'total_paragraph_estimate', 'INTEGER NOT NULL DEFAULT 0');

    // 精翻任务：不设置 novels 外键，保证源小说删除后任务快照仍可查看与导出。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS refined_translation_tasks (
        task_id TEXT NOT NULL PRIMARY KEY, source_id TEXT, novel_id TEXT,
        task_name TEXT NOT NULL, novel_title TEXT NOT NULL, author TEXT NOT NULL, source_metadata_json TEXT NOT NULL DEFAULT '{}', translated_metadata_json TEXT NOT NULL DEFAULT '{}',
        source_lang TEXT NOT NULL, target_lang TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
        model_config_json TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refined_translation_chapters (
        task_id TEXT NOT NULL, chapter_id TEXT NOT NULL, chapter_index INTEGER NOT NULL, title TEXT NOT NULL,
        volume_title TEXT, source_content TEXT NOT NULL, translated_title TEXT, status TEXT NOT NULL,
        review_round INTEGER NOT NULL DEFAULT 0, review_score REAL, updated_at TEXT NOT NULL,
        PRIMARY KEY(task_id, chapter_id), FOREIGN KEY(task_id) REFERENCES refined_translation_tasks(task_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refined_translation_segments (
        segment_id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, chapter_id TEXT NOT NULL, paragraph_index INTEGER NOT NULL,
        source_text TEXT NOT NULL, translated_text TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(task_id, chapter_id, paragraph_index),
        FOREIGN KEY(task_id, chapter_id) REFERENCES refined_translation_chapters(task_id, chapter_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refined_translation_terms (
        term_id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, source_term TEXT NOT NULL, target_term TEXT,
        entity_type TEXT, priority INTEGER NOT NULL DEFAULT 0, suggestion TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(task_id, source_term), FOREIGN KEY(task_id) REFERENCES refined_translation_tasks(task_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refined_translation_reviews (
        review_id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, chapter_id TEXT NOT NULL, review_round INTEGER NOT NULL,
        severity TEXT NOT NULL, paragraph_indices_json TEXT NOT NULL, scores_json TEXT NOT NULL, suggestion TEXT NOT NULL, replacement_text TEXT,
        force_change INTEGER NOT NULL DEFAULT 0, resolved INTEGER NOT NULL DEFAULT 0, resolution TEXT NOT NULL DEFAULT 'open', resolution_note TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(task_id, chapter_id) REFERENCES refined_translation_chapters(task_id, chapter_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refined_translation_logs (
        log_id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES refined_translation_tasks(task_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refined_translation_checkpoints (
        task_id TEXT NOT NULL, stage TEXT NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(task_id, stage), FOREIGN KEY(task_id) REFERENCES refined_translation_tasks(task_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refined_translation_transitions (
        transition_id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, from_stage TEXT, to_stage TEXT NOT NULL, condition_text TEXT NOT NULL,
        chapter_id TEXT, review_round INTEGER, created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES refined_translation_tasks(task_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_refined_translation_tasks_lookup ON refined_translation_tasks(deleted_at, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_refined_translation_transitions_task ON refined_translation_transitions(task_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_refined_translation_segments_lookup ON refined_translation_segments(task_id, chapter_id, paragraph_index);
      CREATE INDEX IF NOT EXISTS idx_refined_translation_terms_lookup ON refined_translation_terms(task_id, status, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_refined_translation_reviews_lookup ON refined_translation_reviews(task_id, chapter_id, created_at DESC);
    `);
    this.ensureColumnExists('refined_translation_tasks', 'source_metadata_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumnExists('refined_translation_tasks', 'translated_metadata_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumnExists('refined_translation_reviews', 'resolution', "TEXT NOT NULL DEFAULT 'open'");
    this.ensureColumnExists('refined_translation_reviews', 'replacement_text', 'TEXT');
    this.ensureColumnExists('refined_translation_reviews', 'resolution_note', 'TEXT');

    // ── OPDS: novels 表新增列 ──
    this.ensureColumnExists('novels', 'opds_visible', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('novels', 'content_updated_at', 'TEXT');
    this.ensureColumnExists('novels', 'epub_compiled_at', 'TEXT');
    this.ensureColumnExists('novels', 'deleted_at', 'TEXT');
    this.ensureColumnExists('novels', 'deleted_scheduling_json', 'TEXT');
    this.ensureColumnExists('novels', 'deleted_opds_visible', 'INTEGER');

    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS novel_metadata_versions (
        source_id TEXT NOT NULL, novel_id TEXT NOT NULL, version INTEGER NOT NULL,
        title TEXT NOT NULL, author TEXT NOT NULL, description TEXT NOT NULL, tags_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, version),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS chapter_versions (
        source_id TEXT NOT NULL, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, version INTEGER NOT NULL,
        title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, chapter_id, version),
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_novels_trash ON novels(deleted_at);
      CREATE TABLE IF NOT EXISTS manual_volumes (
        novel_id TEXT NOT NULL, volume_title TEXT NOT NULL, sort_index INTEGER NOT NULL,
        PRIMARY KEY (novel_id, volume_title)
      );
      INSERT OR IGNORE INTO novel_metadata_versions (source_id, novel_id, version, title, author, description, tags_json, created_at)
        SELECT source_id, novel_id, 0, title, author, description, tags_json, updated_at
        FROM novels WHERE source_id <> 'manual';
      INSERT OR IGNORE INTO chapter_versions (source_id, novel_id, chapter_id, version, title, content, created_at)
        SELECT source_id, novel_id, chapter_id, 0, title, content, COALESCE(downloaded_at, updated_at)
        FROM chapters WHERE content IS NOT NULL;
      INSERT OR IGNORE INTO manual_volumes (novel_id, volume_title, sort_index)
        SELECT novel_id, volume_title, MIN(chapter_index)
        FROM chapters WHERE source_id='manual' AND volume_title IS NOT NULL AND TRIM(volume_title) <> ''
        GROUP BY novel_id, volume_title;
    `);

    // 首次迁移时回填 content_updated_at = MAX(chapters.updated_at)
    this.#database.exec(`
      UPDATE novels
      SET content_updated_at = (
        SELECT MAX(c.updated_at)
        FROM chapters c
        WHERE c.source_id = novels.source_id
          AND c.novel_id = novels.novel_id
      )
      WHERE content_updated_at IS NULL
        AND EXISTS (
          SELECT 1 FROM chapters c
          WHERE c.source_id = novels.source_id
            AND c.novel_id = novels.novel_id
        )
    `);

    // ── OPDS: 制品生成审计表 ──
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS opds_compilation_runs (
        id                 TEXT NOT NULL PRIMARY KEY,
        started_at         TEXT NOT NULL,
        completed_at       TEXT,
        status             TEXT NOT NULL DEFAULT 'running',
        total_scanned      INTEGER NOT NULL DEFAULT 0,
        compiled           INTEGER NOT NULL DEFAULT 0,
        skipped            INTEGER NOT NULL DEFAULT 0,
        errored            INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  private ensureColumnExists(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.#database
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.#database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private assertNovelExists(sourceId: string, novelId: string): void {
    const row = this.#database
      .prepare(
        `
          SELECT 1
          FROM novels
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as { 1: number } | undefined;

    if (!row) {
      throw new Error(`Library novel ${sourceId}/${novelId} was not found.`);
    }
  }

  #nextMetadataVersion(sourceId: string, novelId: string): number {
    const row = this.#database.prepare(`SELECT COALESCE(MAX(version), -1) AS version FROM novel_metadata_versions WHERE source_id=? AND novel_id=?`).get(sourceId, novelId) as { version: number };
    return row.version + 1;
  }

  #nextChapterVersion(sourceId: string, novelId: string, chapterId: string): number {
    const row = this.#database.prepare(`SELECT COALESCE(MAX(version), -1) AS version FROM chapter_versions WHERE source_id=? AND novel_id=? AND chapter_id=?`).get(sourceId, novelId, chapterId) as { version: number };
    return row.version + 1;
  }

  #recordMetadataVersion(sourceId: string, novelId: string, version: number, title: string, author: string, description: string, tags: string[], createdAt: string): void {
    this.#database.prepare(`INSERT INTO novel_metadata_versions (source_id, novel_id, version, title, author, description, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sourceId, novelId, version, title, author, description, JSON.stringify(tags), createdAt);
  }

  #recordChapterVersion(sourceId: string, novelId: string, chapterId: string, version: number, title: string, content: string, createdAt: string): void {
    this.#database.prepare(`INSERT INTO chapter_versions (source_id, novel_id, chapter_id, version, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(sourceId, novelId, chapterId, version, title, content, createdAt);
  }

  #reindexManualChapters(novelId: string): void {
    const rows = this.#database.prepare(`SELECT chapter_id FROM chapters WHERE source_id='manual' AND novel_id=? AND chapter_id NOT GLOB '__*' ORDER BY chapter_index, chapter_id`).all(novelId) as Array<{ chapter_id: string }>;
    const transaction = this.#database.transaction(() => {
      rows.forEach((row, index) => this.#database.prepare(`UPDATE chapters SET chapter_index=? WHERE source_id='manual' AND novel_id=? AND chapter_id=?`).run(index + 1, novelId, row.chapter_id));
      this.#database.prepare(`UPDATE novels SET chapter_count=?, updated_at=? WHERE source_id='manual' AND novel_id=?`).run(rows.length, new Date().toISOString(), novelId);
    });
    transaction();
  }

  #ensureManualVolume(novelId: string, title: string): void {
    const existing = this.#database.prepare(`SELECT 1 FROM manual_volumes WHERE novel_id=? AND volume_title=?`).get(novelId, title);
    if (existing) return;
    const row = this.#database.prepare(`SELECT COALESCE(MAX(sort_index), 0) + 1 AS sort_index FROM manual_volumes WHERE novel_id=?`).get(novelId) as { sort_index: number };
    this.#database.prepare(`INSERT INTO manual_volumes (novel_id, volume_title, sort_index) VALUES (?, ?, ?)`).run(novelId, title, row.sort_index);
  }

  private buildAliasMap(): Map<string, StoredNovelAliasRow[]> {
    const rows = this.#database
      .prepare(
        `
          SELECT alias_id, source_id, novel_id, alias_value, normalized_alias, created_at, updated_at
          FROM novel_aliases
          ORDER BY updated_at DESC, alias_value COLLATE NOCASE ASC
        `,
      )
      .all() as NovelAliasRow[];

    const aliasMap = new Map<string, StoredNovelAliasRow[]>();

    for (const row of rows) {
      const key = buildNovelKey(row.source_id, row.novel_id);
      const existing = aliasMap.get(key) ?? [];
      existing.push(mapNovelAliasRow(row));
      aliasMap.set(key, existing);
    }

    return aliasMap;
  }

  private buildReadingProgressMap(): Map<string, StoredReadingProgressRow> {
    const rows = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            current_chapter_id,
            current_chapter_index,
            current_updated_at,
            highest_chapter_id,
            highest_chapter_index,
            highest_updated_at
          FROM reading_progress
        `,
      )
      .all() as ReadingProgressRow[];

    return new Map(rows.map((row) => [buildNovelKey(row.source_id, row.novel_id), mapReadingProgressRow(row)]));
  }

  private buildBookmarkCountMap(): Map<string, number> {
    const rows = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, COUNT(*) AS bookmark_count
          FROM bookmarks
          GROUP BY source_id, novel_id
        `,
      )
      .all() as Array<{ source_id: string; novel_id: string; bookmark_count: number }>;

    return new Map(rows.map((row) => [buildNovelKey(row.source_id, row.novel_id), row.bookmark_count]));
  }
}

function mapNovelRow(row: NovelRow): NovelMetadata {
  return {
    novelId: row.novel_id,
    title: row.title,
    author: row.author,
    description: row.description,
    tags: JSON.parse(row.tags_json) as string[],
    chapterCount: row.chapter_count,
    infoPageUrl: row.info_page_url,
  };
}

function mapChapterRow(row: ChapterRow): StoredChapterRecord {
  return {
    id: row.chapter_id,
    index: row.chapter_index,
    title: row.title,
    url: row.url,
    content: row.content,
    status: row.status,
    errorMessage: row.error_message,
    downloadedAt: row.downloaded_at,
    updatedAt: row.updated_at,
    ...(row.volume_title ? { volumeTitle: row.volume_title } : {}),
  };
}

function mapNovelAliasRow(row: NovelAliasRow): StoredNovelAliasRow {
  return {
    id: row.alias_id,
    alias: row.alias_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReadingProgressRow(row: ReadingProgressRow): StoredReadingProgressRow {
  return {
    currentChapterId: row.current_chapter_id,
    currentChapterIndex: row.current_chapter_index,
    currentUpdatedAt: row.current_updated_at,
    highestChapterId: row.highest_chapter_id,
    highestChapterIndex: row.highest_chapter_index,
    highestUpdatedAt: row.highest_updated_at,
  };
}

function mapBookmarkRow(row: BookmarkRow): StoredBookmarkRow {
  return {
    id: row.bookmark_id,
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    chapterTitle: row.chapter_title,
    volumeTitle: row.volume_title,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReaderTypographyRow(row: ReaderTypographyRow): StoredReaderTypographyOverrideRow {
  return {
    sourceId: row.source_id,
    novelId: row.novel_id,
    fontSize: row.font_size,
    fontSizePreset: row.font_size_preset,
    lineHeight: row.line_height,
    paragraphSpacing: row.paragraph_spacing,
    fontFamilyPreset: row.font_family_preset,
    fontFamilyCustom: row.font_family_custom,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeGraphProfileRow(row: KnowledgeGraphProfileRow): StoredKnowledgeGraphProfileRow {
  return {
    sourceId: row.source_id,
    novelId: row.novel_id,
    chatProviderId: row.chat_provider_id,
    chatModelId: row.chat_model_id,
    extractionModels: parseKnowledgeGraphExtractionModelsJson(row.extraction_models_json),
    embeddingProviderId: row.embedding_provider_id,
    embeddingModelId: row.embedding_model_id,
    rerankProviderId: row.rerank_provider_id,
    rerankModelId: row.rerank_model_id,
    extractionConcurrency: row.extraction_concurrency,
    neo4jEnabled: Boolean(row.neo4j_enabled),
    neo4jUri: row.neo4j_uri,
    neo4jUsername: row.neo4j_username,
    neo4jPassword: row.neo4j_password,
    neo4jDatabase: row.neo4j_database,
    configLocked: Boolean(row.config_locked),
    lockedAt: row.locked_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeGraphBuildRow(row: KnowledgeGraphBuildRow): StoredKnowledgeGraphBuildRow {
  return {
    status: row.status,
    stage: row.stage,
    progressPercent: row.progress_percent,
    message: row.message,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastBuiltAt: row.last_built_at,
    syncedToNeo4jAt: row.synced_to_neo4j_at,
    entityCount: row.entity_count,
    relationCount: row.relation_count,
    modelStats: parseKnowledgeGraphBuildModelStatsJson(row.model_stats_json),
    updatedAt: row.updated_at,
  };
}

function parseKnowledgeGraphBuildModelStatsJson(value: string): KnowledgeGraphBuildModelStat[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Partial<KnowledgeGraphBuildModelStat>;
      if (typeof candidate.providerId !== 'string' || typeof candidate.modelId !== 'string') {
        return [];
      }

      return [{
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        source: candidate.source === 'global' ? 'global' : 'novel',
        maxConcurrency: typeof candidate.maxConcurrency === 'number' ? candidate.maxConcurrency : 0,
        attemptCount: typeof candidate.attemptCount === 'number' ? candidate.attemptCount : 0,
        llmSuccessCount: typeof candidate.llmSuccessCount === 'number' ? candidate.llmSuccessCount : 0,
        failureCount: typeof candidate.failureCount === 'number' ? candidate.failureCount : 0,
        fallbackCount: typeof candidate.fallbackCount === 'number' ? candidate.fallbackCount : 0,
        handoffInCount: typeof candidate.handoffInCount === 'number' ? candidate.handoffInCount : 0,
        handoffOutCount: typeof candidate.handoffOutCount === 'number' ? candidate.handoffOutCount : 0,
        inFlightCount: typeof candidate.inFlightCount === 'number' ? candidate.inFlightCount : 0,
        consecutiveFailures: typeof candidate.consecutiveFailures === 'number' ? candidate.consecutiveFailures : 0,
        circuitState: candidate.circuitState === 'open' || candidate.circuitState === 'half-open' ? candidate.circuitState : 'closed',
        circuitOpenedCount: typeof candidate.circuitOpenedCount === 'number' ? candidate.circuitOpenedCount : 0,
        cooldownUntil: typeof candidate.cooldownUntil === 'string' ? candidate.cooldownUntil : null,
        firstAttemptAt: typeof candidate.firstAttemptAt === 'string' ? candidate.firstAttemptAt : null,
        lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
        lastStartedAt: typeof candidate.lastStartedAt === 'string' ? candidate.lastStartedAt : null,
        lastCompletedAt: typeof candidate.lastCompletedAt === 'string' ? candidate.lastCompletedAt : null,
        recentSuccessAt: Array.isArray(candidate.recentSuccessAt)
          ? candidate.recentSuccessAt.filter((entry): entry is string => typeof entry === 'string').slice(-12)
          : [],
        failureRate: typeof candidate.failureRate === 'number' ? candidate.failureRate : 0,
        throughputPerMinute: typeof candidate.throughputPerMinute === 'number' ? candidate.throughputPerMinute : 0,
      } satisfies KnowledgeGraphBuildModelStat];
    });
  } catch {
    return [];
  }
}

function mapKnowledgeGraphBuildLogRow(row: KnowledgeGraphBuildLogRow): StoredKnowledgeGraphBuildLogRow {
  return {
    id: row.log_id,
    stage: row.stage,
    level: row.level,
    message: row.message,
    createdAt: row.created_at,
  };
}

function mapKnowledgeGraphBuildCheckpointRow(row: KnowledgeGraphBuildCheckpointRow): StoredKnowledgeGraphBuildCheckpointRow {
  return {
    chunkId: row.chunk_id,
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    chunkIndex: row.chunk_index,
    chapterTitle: row.chapter_title,
    extractionJson: row.extraction_json,
    warningMessage: row.warning_message,
    status: (row.status === 'failed' ? 'failed' : 'success'),
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeGraphEntityRow(row: KnowledgeGraphEntityRow): StoredKnowledgeGraphEntityRow {
  return {
    id: row.entity_id,
    name: row.entity_name,
    entityType: row.entity_type,
    summary: row.summary,
    prominence: row.prominence,
    mentionCount: row.mention_count,
    mentionChapterIds: JSON.parse(row.mention_chapter_ids_json) as string[],
    firstChapterId: row.first_chapter_id,
    lastChapterId: row.last_chapter_id,
    aliases: JSON.parse(row.aliases_json) as string[],
    embedding: row.embedding_json ? JSON.parse(row.embedding_json) as number[] : null,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeGraphRelationRow(row: KnowledgeGraphRelationRow): StoredKnowledgeGraphRelationRow {
  return {
    id: row.relation_id,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    relationType: row.relation_type,
    summary: row.summary,
    weight: row.weight,
    chapterIds: JSON.parse(row.chapter_ids_json) as string[],
    evidence: JSON.parse(row.evidence_json) as string[],
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeGraphChunkRow(row: KnowledgeGraphChunkRow): StoredKnowledgeGraphChunkRow {
  return {
    id: row.chunk_id,
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    chunkIndex: row.chunk_index,
    chapterTitle: row.chapter_title,
    summary: row.summary,
    eventSummary: row.event_summary,
    content: row.content,
    entityNames: JSON.parse(row.entity_names_json) as string[],
    keywordHints: JSON.parse(row.keyword_hints_json) as string[],
    embedding: row.embedding_json ? JSON.parse(row.embedding_json) as number[] : null,
    updatedAt: row.updated_at,
  };
}

function parseTagsJson(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function areTagsEquivalent(left: string[], right: string[]): boolean {
  const normalize = (tags: string[]) => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, 'zh-CN'));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

interface RefinedTaskRow { task_id: string; source_id: string | null; novel_id: string | null; task_name: string; novel_title: string; author: string; source_metadata_json: string | null; translated_metadata_json: string | null; source_lang: string; target_lang: string; status: RefinedTranslationTaskStatus; stage: RefinedTranslationStage; model_config_json: string; deleted_at: string | null; created_at: string; updated_at: string; }
interface RefinedChapterRow { task_id: string; chapter_id: string; chapter_index: number; title: string; volume_title: string | null; source_content: string; translated_title: string | null; status: RefinedTranslationChapterStatus; review_round: number; review_score: number | null; updated_at: string; }
interface RefinedSegmentRow { segment_id: string; task_id: string; chapter_id: string; paragraph_index: number; source_text: string; translated_text: string | null; status: RefinedTranslationSegmentStatus; updated_at: string; }
interface RefinedTermRow { term_id: string; task_id: string; source_term: string; target_term: string | null; entity_type: string | null; priority: number; suggestion: string | null; status: RefinedTranslationTermStatus; updated_at: string; }
interface RefinedReviewRow { review_id: string; task_id: string; chapter_id: string; review_round: number; severity: string; paragraph_indices_json: string; scores_json: string; suggestion: string; replacement_text: string | null; force_change: number; resolved: number; resolution: RefinedTranslationReviewResolution | null; resolution_note: string | null; created_at: string; }

function mapKnowledgeGraphSummaryRow(row: KnowledgeGraphSummaryRow): StoredKnowledgeGraphSummaryRow {
  return {
    id: row.summary_id,
    summaryType: row.summary_type,
    stableKey: row.stable_key,
    title: row.title,
    summary: row.summary,
    chapterIds: JSON.parse(row.chapter_ids_json) as string[],
    entityIds: JSON.parse(row.entity_ids_json) as string[],
    relationIds: JSON.parse(row.relation_ids_json) as string[],
    embedding: row.embedding_json ? JSON.parse(row.embedding_json) as number[] : null,
    sourceFingerprint: row.source_fingerprint,
    updatedAt: row.updated_at,
  };
}

// ── 翻译流水线映射函数 ──

function mapTranslationProfileRow(row: TranslationProfileRow): StoredTranslationProfileRow {
  return {
    sourceId: row.source_id,
    novelId: row.novel_id,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    termExtractionModel: row.term_extraction_model_json ? JSON.parse(row.term_extraction_model_json) as TranslationModelRoute : null,
    translationModels: parseTranslationModelRoutesJson(row.translation_models_json),
    reviewModel: row.review_model_json ? JSON.parse(row.review_model_json) as TranslationModelRoute : null,
    translationConcurrency: row.translation_concurrency,
    qualityThreshold: row.quality_threshold,
    autoRejectUntranslatedTerms: row.auto_reject_untranslated_terms !== 0,
    defaultExportMode: row.default_export_mode as TranslationExportMode,
    configLocked: row.config_locked !== 0,
    lockedAt: row.locked_at,
    updatedAt: row.updated_at,
  };
}

function mapTranslationTermRow(row: TranslationTermRow): StoredTranslationTermRow {
  return {
    id: row.term_id,
    sourceId: row.source_id,
    novelId: row.novel_id,
    sourceTerm: row.source_term,
    targetTerm: row.target_term,
    entityType: row.entity_type,
    note: row.note,
    extractedFromChapterId: row.extracted_from_chapter_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTranslationBuildRow(row: TranslationBuildRow): StoredTranslationBuildRow {
  return {
    status: row.status as TranslationBuildStatus,
    stage: row.stage as TranslationBuildStage,
    progressPercent: row.progress_percent,
    message: row.message,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    modelStatsJson: row.model_stats_json,
    translatedChapters: row.translated_chapters,
    reviewedChapters: row.reviewed_chapters,
    failedChapters: row.failed_chapters,
    glossaryVersion: row.glossary_version,
    profileVersion: row.profile_version,
    currentChapterTitle: row.current_chapter_title,
    currentChapterParagraphs: row.current_chapter_paragraphs,
    currentChapterTranslatedParagraphs: row.current_chapter_translated_paragraphs,
    totalTranslatedParagraphs: row.total_translated_paragraphs,
    totalParagraphEstimate: row.total_paragraph_estimate,
    updatedAt: row.updated_at,
  };
}

function mapTranslationBuildLogRow(row: TranslationBuildLogRow): StoredTranslationBuildLogRow {
  return {
    id: row.log_id,
    stage: row.stage as TranslationBuildStage,
    level: row.level as StoredTranslationBuildLogLevel,
    message: row.message,
    createdAt: row.created_at,
  };
}

function mapTranslationBuildCheckpointRow(row: TranslationBuildCheckpointRow): StoredTranslationBuildCheckpointRow {
  return {
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    stage: row.stage as TranslationChapterStatus,
    pipelineStateJson: row.pipeline_state_json,
    warningMessage: row.warning_message,
    updatedAt: row.updated_at,
  };
}

function mapChapterTranslationRow(row: ChapterTranslationRow): StoredChapterTranslationRow {
  return {
    sourceId: row.source_id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    translatedTitle: row.translated_title,
    status: row.status as TranslationChapterStatus,
    overallQualityScore: row.overall_quality_score,
    translatorModelId: row.translator_model_id,
    reviewerModelId: row.reviewer_model_id,
    tokenUsageJson: row.token_usage_json,
    sourceContentHash: row.source_content_hash,
    glossaryVersion: row.glossary_version,
    profileVersion: row.profile_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapterTranslationParagraphRow(row: ChapterTranslationParagraphRow): StoredChapterTranslationParagraphRow {
  return {
    id: row.paragraph_id,
    sourceId: row.source_id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    paragraphIndex: row.paragraph_index,
    sourceText: row.source_text,
    translatedText: row.translated_text,
    confidence: row.confidence,
    appliedTermIds: JSON.parse(row.applied_term_ids_json) as string[],
    modelId: row.model_id,
    updatedAt: row.updated_at,
  };
}

function mapChapterTranslationQaRow(row: ChapterTranslationQaRow): StoredChapterTranslationQaRow {
  return {
    id: row.qa_id,
    sourceId: row.source_id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    checkType: row.check_type,
    score: row.score,
    severity: row.severity,
    suggestion: row.suggestion,
    paragraphIndices: JSON.parse(row.paragraph_indices_json) as number[],
    resolved: row.resolved !== 0,
    createdAt: row.created_at,
  };
}

function mapRefinedTaskRow(row: RefinedTaskRow): StoredRefinedTranslationTaskRow {
  return { id: row.task_id, sourceId: row.source_id, novelId: row.novel_id, name: row.task_name, novelTitle: row.novel_title, author: row.author, sourceMetadata: parseRefinedSourceMetadata(row.source_metadata_json, row.novel_title, row.author), translatedMetadata: parseRefinedTranslatedMetadata(row.translated_metadata_json), sourceLang: row.source_lang, targetLang: row.target_lang, status: row.status, stage: row.stage, modelConfig: parseRefinedModelConfig(row.model_config_json), deletedAt: row.deleted_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapRefinedChapterRow(row: RefinedChapterRow): StoredRefinedTranslationChapterRow {
  return { taskId: row.task_id, chapterId: row.chapter_id, chapterIndex: row.chapter_index, title: row.title, volumeTitle: row.volume_title, sourceContent: row.source_content, translatedTitle: row.translated_title, status: row.status, reviewRound: row.review_round, reviewScore: row.review_score, updatedAt: row.updated_at };
}
function mapRefinedSegmentRow(row: RefinedSegmentRow): StoredRefinedTranslationSegmentRow {
  return { id: row.segment_id, taskId: row.task_id, chapterId: row.chapter_id, paragraphIndex: row.paragraph_index, sourceText: row.source_text, translatedText: row.translated_text, status: row.status, updatedAt: row.updated_at };
}
function mapRefinedTermRow(row: RefinedTermRow): StoredRefinedTranslationTermRow {
  return { id: row.term_id, taskId: row.task_id, sourceTerm: row.source_term, targetTerm: row.target_term, entityType: row.entity_type, priority: row.priority, suggestion: row.suggestion, status: row.status, updatedAt: row.updated_at };
}
function mapRefinedReviewRow(row: RefinedReviewRow): StoredRefinedTranslationReviewRow {
  const resolution = row.resolution === 'accepted' || row.resolution === 'partially_accepted' || row.resolution === 'rejected' || row.resolution === 'resolved' || row.resolution === 'ignored' || row.resolution === 'superseded' ? row.resolution : row.resolved !== 0 ? 'resolved' : 'open';
  return { id: row.review_id, taskId: row.task_id, chapterId: row.chapter_id, reviewRound: row.review_round, severity: row.severity, paragraphIndices: parseNumberArray(row.paragraph_indices_json), scores: parseScoreObject(row.scores_json), suggestion: row.suggestion, replacementText: row.replacement_text, forceChange: row.force_change !== 0, resolved: resolution !== 'open', resolution, resolutionNote: row.resolution_note, createdAt: row.created_at };
}
function parseRefinedModelConfig(raw: string): RefinedTranslationModelConfig {
  const fallback: RefinedTranslationModelConfig = { termExtractionModel: null, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 2, maxReviewRounds: 5 };
  try {
    const value = JSON.parse(raw) as Partial<RefinedTranslationModelConfig>;
    return { ...fallback, ...value, translationModels: Array.isArray(value.translationModels) ? value.translationModels : [] };
  } catch { return fallback; }
}
function parseRefinedSourceMetadata(raw: string | null, title: string, author: string): StoredRefinedTranslationTaskRow['sourceMetadata'] {
  const fallback: StoredRefinedTranslationTaskRow['sourceMetadata'] = { title, author, description: '', tags: [], infoPageUrl: '' };
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<typeof fallback>;
    return {
      title: typeof value.title === 'string' && value.title.trim() ? value.title : title,
      author: typeof value.author === 'string' && value.author.trim() ? value.author : author,
      description: typeof value.description === 'string' ? value.description : '',
      tags: Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === 'string') : [],
      infoPageUrl: typeof value.infoPageUrl === 'string' ? value.infoPageUrl : '',
    };
  } catch { return fallback; }
}
function parseRefinedTranslatedMetadata(raw: string | null): StoredRefinedTranslationTaskRow['translatedMetadata'] {
  const fallback: StoredRefinedTranslationTaskRow['translatedMetadata'] = { title: null, author: null, description: null, tags: [] };
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<typeof fallback>;
    return {
      title: typeof value.title === 'string' && value.title.trim() ? value.title : null,
      author: typeof value.author === 'string' && value.author.trim() ? value.author : null,
      description: typeof value.description === 'string' && value.description.trim() ? value.description : null,
      tags: Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [],
    };
  } catch { return fallback; }
}
function parseNumberArray(raw: string): number[] { try { const value = JSON.parse(raw) as unknown; return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : []; } catch { return []; } }
function parseScoreObject(raw: string): Record<string, number> { try { const value = JSON.parse(raw) as unknown; if (!value || typeof value !== 'object') return {}; return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')); } catch { return {}; } }

function parseTranslationModelRoutesJson(value: string): TranslationModelRoute[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.providerId !== 'string' || typeof record.modelId !== 'string') {
        return [];
      }

      return [{
        providerId: record.providerId,
        modelId: record.modelId,
        maxConcurrency: typeof record.maxConcurrency === 'number' && Number.isFinite(record.maxConcurrency)
          ? Math.trunc(record.maxConcurrency)
          : 1,
      }];
    });
  } catch {
    return [];
  }
}

function parseStoredModelRoute(raw: string | null): LlmModelGatewayRoute | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const providerId = typeof parsed.providerId === 'string' ? parsed.providerId.trim() : '';
    const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : '';
    if (!providerId || !modelId) {
      return null;
    }

    return { providerId, modelId };
  } catch {
    return null;
  }
}

function serializeStoredModelRoute(route: LlmModelGatewayRoute | null): string | null {
  if (!route) {
    return null;
  }

  return JSON.stringify(route);
}

function parseChapterIdsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function buildNovelKey(sourceId: string, novelId: string): string {
  return `${sourceId}\u0000${novelId}`;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function parseKnowledgeGraphExtractionModelsJson(value: string): Array<{
  providerId: string;
  modelId: string;
  maxConcurrency: number;
}> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.providerId !== 'string' || typeof record.modelId !== 'string') {
        return [];
      }

      return [{
        providerId: record.providerId,
        modelId: record.modelId,
        maxConcurrency: typeof record.maxConcurrency === 'number' && Number.isFinite(record.maxConcurrency)
          ? Math.trunc(record.maxConcurrency)
          : 1,
      }];
    });
  } catch {
    return [];
  }
}
