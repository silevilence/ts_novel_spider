import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import type { KnowledgeGraphBuildModelStat } from './library-intelligence-rag';

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
            updated_at
          FROM novel_graph_build_checkpoints
          WHERE source_id = ? AND novel_id = ?
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
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id, chunk_id) DO UPDATE SET
            chapter_id = excluded.chapter_id,
            chapter_index = excluded.chapter_index,
            chunk_index = excluded.chunk_index,
            chapter_title = excluded.chapter_title,
            extraction_json = excluded.extraction_json,
            warning_message = excluded.warning_message,
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
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  replaceKnowledgeGraph(
    sourceId: string,
    novelId: string,
    entities: Array<Omit<StoredKnowledgeGraphEntityRow, 'updatedAt'>>,
    relations: Array<Omit<StoredKnowledgeGraphRelationRow, 'updatedAt'>>,
    chunks: Array<Omit<StoredKnowledgeGraphChunkRow, 'updatedAt'>>,
  ): void {
    this.assertNovelExists(sourceId, novelId);

    const timestamp = new Date().toISOString();
    const insertEntity = this.#database.prepare(
      `
        INSERT INTO knowledge_graph_entities (
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
        INSERT INTO knowledge_graph_relations (
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
        INSERT INTO knowledge_graph_chunks (
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

    const transaction = this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM knowledge_graph_chunks WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_relations WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);
      this.#database.prepare('DELETE FROM knowledge_graph_entities WHERE source_id = ? AND novel_id = ?').run(sourceId, novelId);

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
            failed_chapters, glossary_version, profile_version, updated_at
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
  }): StoredTranslationBuildRow {
    this.assertNovelExists(input.sourceId, input.novelId);

    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `
          INSERT INTO novel_translation_builds (
            source_id, novel_id, status, stage, progress_percent, message, error_message,
            started_at, completed_at, model_stats_json, translated_chapters, reviewed_chapters,
            failed_chapters, glossary_version, profile_version, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.sourceId, input.novelId, input.status, input.stage,
        input.progressPercent, input.message, input.errorMessage,
        input.startedAt, input.completedAt, input.modelStatsJson,
        input.translatedChapters, input.reviewedChapters, input.failedChapters,
        input.glossaryVersion, input.profileVersion, updatedAt,
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

      CREATE INDEX IF NOT EXISTS idx_novel_graph_build_logs_lookup
        ON novel_graph_build_logs(source_id, novel_id, created_at ASC);
    `);

    this.ensureColumnExists('knowledge_graph_entities', 'embedding_json', 'TEXT');
    this.ensureColumnExists('knowledge_graph_chunks', 'embedding_json', 'TEXT');
    this.ensureColumnExists('novel_graph_profiles', 'extraction_models_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumnExists('novel_graph_profiles', 'extraction_concurrency', 'INTEGER NOT NULL DEFAULT 2');
    this.ensureColumnExists('novel_graph_builds', 'model_stats_json', "TEXT NOT NULL DEFAULT '[]'");

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