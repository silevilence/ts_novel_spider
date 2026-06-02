import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Syosetu18SpiderAdapter } from '../adapters/spider/syosetu-18-spider-adapter';
import { SyosetuSpiderAdapter } from '../adapters/spider/syosetu-spider-adapter';
import { SpiderLogDispatcher, type SpiderLogAdapter, type SpiderLogEvent } from './logging';
import {
  createProxyAwareHtmlFetcher,
  NetworkProxyService,
  type NetworkProxyConfigInput,
  type NetworkProxyState,
} from './network-proxy';
import {
  SystemPreferencesService,
  type LlmDiscoveredModel,
  type LlmModelGatewayConfig,
  type LlmPreferencesState,
  type LlmProviderConfigInput,
  type Neo4jConfigInput,
  type Neo4jPreferencesState,
  type ReaderTypographyConfigInput,
  type ReaderTypographyResolved,
  type ReaderTypographyState,
  type TranslationPreferencesInput,
  type TranslationPreferencesState,
  resolveEffectiveReaderTypography,
} from './system-preferences';
import {
  searchLibraryNovels,
} from './library-search';
import {
  OfflineLibraryAssetService,
  type LibraryBookmark,
  type LibraryChapterDetail,
  type LibraryNovelAlias,
  type LibraryNovelDetail,
  type LibraryNovelSummary,
  type LibraryReadingProgress,
} from './offline-library';
import {
  LibraryIntelligenceService,
  type AskLibraryAssistantInput,
  type LibraryAssistantResponse,
  type LibraryKnowledgeGraphBuild,
  type KnowledgeGraphBuildMode,
  type Neo4jGraphStore,
  type LibraryKnowledgeGraphProfile,
  type LibraryKnowledgeGraphProfileInput,
  type LibraryKnowledgeGraphState,
} from './library-intelligence';
import {
  TranslationService,
  type TranslationProfile,
  type TranslationProfileInput,
  type TranslationBuild,
  type TranslationChapterDetail,
} from './translation-service';
import type { StoredTranslationTermRow } from './novel-repository';
import {
  LocalExportEngine,
  type GeneratedLibraryExport,
  type LibraryExportFormat,
  type LibraryExportTranslationMode,
  type TranslatedParagraph,
} from './export-engine';
import { SqliteNovelRepository, type StoredNovelLibraryRow } from './novel-repository';
import { SpiderRunner } from './spider-runner';
import {
  type ChapterIndexEntry,
  toError,
  type CrawlNovelOptions,
  type NovelMetadata,
  type ResolvedChapterState,
  type SpiderAdapter,
  type SpiderRunFailure,
  type StoredNovelSnapshot,
} from './spider';

export interface SpiderSourceDescriptor {
  sourceId: string;
  label: string;
  description: string;
  defaultNovelId: string;
}

export interface SpiderRegistryEntry {
  descriptor: SpiderSourceDescriptor;
  spider: SpiderAdapter;
}

export interface PreviewNovelInput {
  sourceId: string;
  novelId: string;
}

export interface TaskExecutionInput extends PreviewNovelInput {
  chapterIds?: string[];
  forceRefetch?: boolean;
  chapterConcurrency?: number;
  chapterRetryCount?: number;
}

export type CrawlTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CrawlTaskProgress {
  catalogChapters: number;
  queuedChapters: number;
  completedChapters: number;
  failedChapters: number;
  percent: number;
}

export interface CrawlTaskSnapshot {
  id: string;
  sourceId: string;
  novelId: string;
  status: CrawlTaskStatus;
  runId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  options: Required<TaskExecutionOptionsSnapshot>;
  progress: CrawlTaskProgress;
  metadata: NovelMetadata | null;
  chapters: ResolvedChapterState[];
  failures: SpiderRunFailure[];
  snapshotSummary: SnapshotSummary | null;
  events: SpiderLogEvent[];
}

export interface PreviewNovelResult {
  source: SpiderSourceDescriptor;
  metadata: NovelMetadata;
  chapters: ResolvedChapterState[];
  snapshotSummary: SnapshotSummary | null;
  activeTask: CrawlTaskSnapshot | null;
}

export interface SnapshotSummary {
  downloadedChapters: number;
  failedChapters: number;
  indexedChapters: number;
  newChapters: number;
  updatedAt: string;
}

interface TaskExecutionOptionsSnapshot {
  chapterIds?: string[];
  chapterConcurrency?: number;
  chapterRetryCount?: number;
  forceRefetch?: boolean;
}

interface CrawlTaskState {
  id: string;
  sourceId: string;
  novelId: string;
  status: CrawlTaskStatus;
  runId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  options: Required<TaskExecutionOptionsSnapshot>;
  progress: CrawlTaskProgress;
  metadata: NovelMetadata | null;
  chapters: ResolvedChapterState[];
  failures: SpiderRunFailure[];
  snapshotSummary: SnapshotSummary | null;
  events: SpiderLogEvent[];
  listeners: Set<(event: ControlCenterStreamEvent) => void>;
}

export type ControlCenterStreamEvent =
  | {
      type: 'task_updated';
      task: CrawlTaskSnapshot;
    }
  | {
      type: 'task_log';
      taskId: string;
      event: SpiderLogEvent;
    };

export interface ControlCenterServiceOptions {
  databasePath?: string;
  repository?: SqliteNovelRepository;
  spiders?: SpiderRegistryEntry[];
  networkProxy?: NetworkProxyService;
  systemPreferences?: SystemPreferencesService;
  neo4jGraphStore?: Neo4jGraphStore;
  offlineAssetStoragePath?: string;
  exportStoragePath?: string;
  assetFetchImpl?: typeof fetch;
}

const MAX_STORED_EVENTS = 200;
const MAX_STORED_TASKS = 100;

export class ControlCenterService {
  readonly #repository: SqliteNovelRepository;
  readonly #ownsRepository: boolean;
  readonly #networkProxy: NetworkProxyService;
  readonly #ownsNetworkProxy: boolean;
  readonly #systemPreferences: SystemPreferencesService;
  readonly #ownsSystemPreferences: boolean;
  readonly #registry: Map<string, SpiderRegistryEntry>;
  readonly #tasks = new Map<string, CrawlTaskState>();
  readonly #offlineLibrary: OfflineLibraryAssetService;
  readonly #exportEngine: LocalExportEngine;
  readonly #libraryIntelligence: LibraryIntelligenceService;
  readonly #translation: TranslationService;

  constructor(options: ControlCenterServiceOptions = {}) {
    const databasePath = options.databasePath ?? defaultDatabasePath();
    this.#ownsRepository = options.repository === undefined;
    this.#ownsNetworkProxy = options.networkProxy === undefined;
    this.#ownsSystemPreferences = options.systemPreferences === undefined;
    this.#repository = options.repository ?? new SqliteNovelRepository(databasePath);
    this.#networkProxy =
      options.networkProxy ?? new NetworkProxyService({ storageFilePath: defaultNetworkProxyConfigPath() });
    this.#systemPreferences =
      options.systemPreferences ?? new SystemPreferencesService({ storageFilePath: defaultSystemPreferencesPath() });
    this.#offlineLibrary = new OfflineLibraryAssetService({
      ...(options.offlineAssetStoragePath ? { storageRoot: options.offlineAssetStoragePath } : {}),
      ...(options.assetFetchImpl ? { fetchImpl: options.assetFetchImpl } : {}),
    });
    this.#exportEngine = new LocalExportEngine({
      ...(options.exportStoragePath ? { outputRoot: options.exportStoragePath } : { outputRoot: defaultExportStoragePath() }),
      assetService: this.#offlineLibrary,
    });
    this.#libraryIntelligence = new LibraryIntelligenceService({
      repository: this.#repository,
      preferences: this.#systemPreferences,
      ...(options.neo4jGraphStore ? { neo4jGraphStore: options.neo4jGraphStore } : {}),
    });
    this.#translation = new TranslationService(this.#repository, this.#systemPreferences);
    this.#registry = new Map(
      (options.spiders ?? createDefaultSpiderRegistry(this.#networkProxy)).map((entry) => [entry.descriptor.sourceId, entry]),
    );

    this.restoreTaskHistory();
  }

  close(): void {
    for (const task of this.#tasks.values()) {
      task.listeners.clear();
    }

    if (this.#ownsRepository) {
      this.#repository.close();
    }

    if (this.#ownsNetworkProxy) {
      this.#networkProxy.close();
    }

    if (this.#ownsSystemPreferences) {
      // Reserved for future resources managed by the preference service.
    }
  }

  listSources(): SpiderSourceDescriptor[] {
    return [...this.#registry.values()].map((entry) => entry.descriptor);
  }

  listLibraryNovels(query?: string): LibraryNovelSummary[] {
    const libraryNovels = this.#repository.listNovels().map((novel) => ({
      sourceId: novel.sourceId,
      metadata: novel.metadata,
      updatedAt: novel.updatedAt,
      downloadedChapters: novel.downloadedChapters,
      failedChapters: novel.failedChapters,
      indexedChapters: novel.indexedChapters,
      latestDownloadedAt: novel.latestDownloadedAt,
      aliases: novel.aliases.map((alias) => ({
        id: alias.id,
        alias: alias.alias,
        createdAt: alias.createdAt,
        updatedAt: alias.updatedAt,
      })),
      readingProgress: novel.readingProgress
        ? {
            currentChapterId: novel.readingProgress.currentChapterId,
            currentChapterIndex: novel.readingProgress.currentChapterIndex,
            currentChapterTitle: null,
            currentUpdatedAt: novel.readingProgress.currentUpdatedAt,
            highestChapterId: novel.readingProgress.highestChapterId,
            highestChapterIndex: novel.readingProgress.highestChapterIndex,
            highestChapterTitle: null,
            highestUpdatedAt: novel.readingProgress.highestUpdatedAt,
          }
        : null,
      bookmarkCount: novel.bookmarkCount,
    }));

    if (!query?.trim()) {
      return libraryNovels;
    }

    return searchLibraryNovels(libraryNovels, query);
  }

  getLibraryNovel(sourceId: string, novelId: string): LibraryNovelDetail | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    return snapshot
      ? this.#offlineLibrary.buildNovelDetail(snapshot, {
          aliases: this.#repository.listNovelAliases(sourceId, novelId),
          readingProgress: this.#repository.getReadingProgress(sourceId, novelId),
          bookmarks: this.#repository.listBookmarks(sourceId, novelId),
        })
      : null;
  }

  getLibraryChapter(sourceId: string, novelId: string, chapterId: string): LibraryChapterDetail | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    return snapshot
      ? this.#offlineLibrary.buildChapterDetail(snapshot, chapterId, {
          aliases: this.#repository.listNovelAliases(sourceId, novelId),
          readingProgress: this.#repository.getReadingProgress(sourceId, novelId),
          bookmarks: this.#repository.listBookmarks(sourceId, novelId),
        })
      : null;
  }

  createLibraryAlias(sourceId: string, novelId: string, alias: string): LibraryNovelAlias {
    const createdAlias = this.#repository.createNovelAlias(sourceId, novelId, alias);
    return {
      id: createdAlias.id,
      alias: createdAlias.alias,
      createdAt: createdAlias.createdAt,
      updatedAt: createdAlias.updatedAt,
    };
  }

  updateLibraryAlias(sourceId: string, novelId: string, aliasId: string, alias: string): LibraryNovelAlias | null {
    const updatedAlias = this.#repository.updateNovelAlias(sourceId, novelId, aliasId, alias);
    return updatedAlias
      ? {
          id: updatedAlias.id,
          alias: updatedAlias.alias,
          createdAt: updatedAlias.createdAt,
          updatedAt: updatedAlias.updatedAt,
        }
      : null;
  }

  deleteLibraryAlias(sourceId: string, novelId: string, aliasId: string): boolean {
    return this.#repository.deleteNovelAlias(sourceId, novelId, aliasId);
  }

  updateLibraryReadingProgress(sourceId: string, novelId: string, chapterId: string): LibraryReadingProgress | null {
    const progress = this.#repository.updateReadingProgress(sourceId, novelId, chapterId);
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);

    if (!progress || !snapshot) {
      return null;
    }

    return this.#offlineLibrary.buildNovelDetail(snapshot, {
      readingProgress: progress,
    }).readingProgress;
  }

  createLibraryBookmark(sourceId: string, novelId: string, chapterId: string, note: string): LibraryBookmark | null {
    const bookmark = this.#repository.createBookmark(sourceId, novelId, chapterId, note);
    return bookmark
      ? {
          id: bookmark.id,
          chapterId: bookmark.chapterId,
          chapterIndex: bookmark.chapterIndex,
          chapterTitle: bookmark.chapterTitle,
          volumeTitle: bookmark.volumeTitle,
          note: bookmark.note,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        }
      : null;
  }

  updateLibraryBookmark(sourceId: string, novelId: string, bookmarkId: string, note: string): LibraryBookmark | null {
    const bookmark = this.#repository.updateBookmark(sourceId, novelId, bookmarkId, note);
    return bookmark
      ? {
          id: bookmark.id,
          chapterId: bookmark.chapterId,
          chapterIndex: bookmark.chapterIndex,
          chapterTitle: bookmark.chapterTitle,
          volumeTitle: bookmark.volumeTitle,
          note: bookmark.note,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        }
      : null;
  }

  deleteLibraryBookmark(sourceId: string, novelId: string, bookmarkId: string): boolean {
    return this.#repository.deleteBookmark(sourceId, novelId, bookmarkId);
  }

  getLibraryReaderTypography(sourceId: string, novelId: string): ReaderTypographyResolved {
    const global = this.#systemPreferences.getReaderTypography().config;
    const overrideRow = this.#repository.getReaderTypographyOverride(sourceId, novelId);
    const override: import('./system-preferences').ReaderTypographyConfig | null = overrideRow
      ? {
          fontSize: overrideRow.fontSize,
          fontSizePreset: overrideRow.fontSizePreset as ReaderTypographyConfigInput['fontSizePreset'] ?? global.fontSizePreset,
          lineHeight: overrideRow.lineHeight,
          paragraphSpacing: overrideRow.paragraphSpacing,
          fontFamilyPreset: overrideRow.fontFamilyPreset as ReaderTypographyConfigInput['fontFamilyPreset'] ?? global.fontFamilyPreset,
          fontFamilyCustom: overrideRow.fontFamilyCustom,
        }
      : null;

    return resolveEffectiveReaderTypography(global, override);
  }

  updateLibraryReaderTypography(
    sourceId: string,
    novelId: string,
    input: import('./system-preferences').ReaderTypographyConfig,
  ): ReaderTypographyResolved | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    const global = this.#systemPreferences.getReaderTypography().config;
    this.#repository.saveReaderTypographyOverride({
      sourceId,
      novelId,
      fontSize: input.fontSize,
      fontSizePreset: input.fontSizePreset,
      lineHeight: input.lineHeight,
      paragraphSpacing: input.paragraphSpacing,
      fontFamilyPreset: input.fontFamilyPreset,
      fontFamilyCustom: input.fontFamilyCustom,
      updatedAt: new Date().toISOString(),
    });

    return resolveEffectiveReaderTypography(global, input);
  }

  deleteLibraryReaderTypography(sourceId: string, novelId: string): ReaderTypographyResolved | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      return null;
    }

    this.#repository.deleteReaderTypographyOverride(sourceId, novelId);
    const global = this.#systemPreferences.getReaderTypography().config;
    return resolveEffectiveReaderTypography(global, null);
  }

  async cacheLibraryChapterMedia(
    sourceId: string,
    novelId: string,
    chapterId: string,
    mediaId: string,
  ) {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);

    if (!snapshot) {
      return null;
    }

    return this.#offlineLibrary.cacheMediaAsset(snapshot, chapterId, mediaId);
  }

  async cacheLibraryNovelMedia(sourceId: string, novelId: string) {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);

    if (!snapshot) {
      return null;
    }

    return this.#offlineLibrary.cacheNovelMediaAssets(snapshot);
  }

  getLibraryMediaFilePath(
    sourceId: string,
    novelId: string,
    chapterId: string,
    mediaId: string,
  ): string | null {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);

    if (!snapshot) {
      return null;
    }

    return this.#offlineLibrary.getCachedMediaFilePath(snapshot, chapterId, mediaId);
  }

  getLibraryActiveTask(sourceId: string, novelId: string): CrawlTaskSnapshot | null {
    return this.findActiveTask(sourceId, novelId);
  }

  async exportLibraryNovel(
    sourceId: string,
    novelId: string,
    format: LibraryExportFormat,
    translationMode?: LibraryExportTranslationMode,
    sourceLang?: string,
    targetLang?: string,
  ): Promise<GeneratedLibraryExport | null> {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);

    if (!snapshot) {
      return null;
    }

    // 如果指定了翻译模式，从 SQLite 加载翻译数据
    if (translationMode && translationMode !== 'original' && sourceLang && targetLang) {
      const translatedParagraphsByChapterId = new Map<string, TranslatedParagraph[]>();
      const translatedVolumeTitles = new Map<string, string>();
      const translatedChapterTitles = new Map<string, string>();

      // 1. 加载小说元数据翻译（__novel_meta__ 单元）
      const metaTranslation = this.#repository.getChapterTranslation(sourceId, novelId, '__novel_meta__', sourceLang, targetLang);
      let translatedNovelTitle: string | null = null;
      let translatedDescriptionParagraphs: TranslatedParagraph[] | undefined;

      if (metaTranslation) {
        translatedNovelTitle = metaTranslation.translatedTitle;
        const metaParagraphs = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, '__novel_meta__');
        if (metaParagraphs.length > 0) {
          translatedDescriptionParagraphs = metaParagraphs.map((p) => ({
            paragraphIndex: p.paragraphIndex,
            sourceText: p.sourceText,
            translatedText: p.translatedText,
            confidence: p.confidence,
          }));
        }
      }

      // 2. 加载各单元翻译
      for (const chapter of snapshot.chapters) {
        const translation = this.#repository.getChapterTranslation(sourceId, novelId, chapter.id, sourceLang, targetLang);
        if (translation && translation.translatedTitle) {
          translatedChapterTitles.set(chapter.id, translation.translatedTitle);
        }

        // 正文段落（仅真实章节有）
        const paragraphs = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, chapter.id);
        if (paragraphs.length > 0) {
          translatedParagraphsByChapterId.set(chapter.id, paragraphs.map((p) => ({
            paragraphIndex: p.paragraphIndex,
            sourceText: p.sourceText,
            translatedText: p.translatedText,
            confidence: p.confidence,
          })));
        }
      }

      // 3. 加载卷标题翻译（__volume_{N}__ 单元）
      let volumeIndex = 0;
      let lastVolumeRaw = '';
      for (const chapter of snapshot.chapters) {
        const volumeRaw = chapter.volumeTitle?.trim() || '';
        if (volumeRaw && volumeRaw !== lastVolumeRaw) {
          volumeIndex++;
          lastVolumeRaw = volumeRaw;
          const volTranslation = this.#repository.getChapterTranslation(sourceId, novelId, `__volume_${volumeIndex}__`, sourceLang, targetLang);
          if (volTranslation && volTranslation.translatedTitle) {
            translatedVolumeTitles.set(volumeRaw, volTranslation.translatedTitle);
          }
        }
      }

      return this.#exportEngine.generate(snapshot, format, {
        mode: translationMode,
        translatedParagraphsByChapterId,
        translatedNovelTitle,
        translatedDescriptionParagraphs,
        translatedVolumeTitles,
        translatedChapterTitles,
      });
    }

    return this.#exportEngine.generate(snapshot, format);
  }

  getLibraryKnowledgeGraph(sourceId: string, novelId: string): LibraryKnowledgeGraphState | null {
    return this.#libraryIntelligence.getNovelKnowledgeGraph(sourceId, novelId);
  }

  updateLibraryKnowledgeGraphProfile(
    sourceId: string,
    novelId: string,
    input: LibraryKnowledgeGraphProfileInput,
  ): LibraryKnowledgeGraphProfile | null {
    return this.#libraryIntelligence.updateNovelKnowledgeGraphProfile(sourceId, novelId, input);
  }

  buildLibraryKnowledgeGraph(
    sourceId: string,
    novelId: string,
    options?: { mode?: KnowledgeGraphBuildMode },
  ): LibraryKnowledgeGraphBuild | null {
    return this.#libraryIntelligence.startNovelKnowledgeGraphBuild(sourceId, novelId, options);
  }

  pauseLibraryKnowledgeGraph(sourceId: string, novelId: string): LibraryKnowledgeGraphBuild | null {
    return this.#libraryIntelligence.pauseNovelKnowledgeGraphBuild(sourceId, novelId);
  }

  resumeLibraryKnowledgeGraph(sourceId: string, novelId: string): LibraryKnowledgeGraphBuild | null {
    return this.#libraryIntelligence.resumeNovelKnowledgeGraphBuild(sourceId, novelId);
  }

  clearLibraryKnowledgeGraph(sourceId: string, novelId: string): Promise<LibraryKnowledgeGraphState | null> {
    return this.#libraryIntelligence.clearNovelKnowledgeGraph(sourceId, novelId);
  }

  retryFailedKnowledgeGraphChunks(
    sourceId: string,
    novelId: string,
    options?: {
      modelOverrides?: Array<{ providerId: string; modelId: string }>;
    },
  ): Promise<{
    retriedCount: number;
    successCount: number;
    stillFailedCount: number;
  } | null> {
    return this.#libraryIntelligence.retryFailedKnowledgeGraphChunks(sourceId, novelId, options);
  }

  syncLibraryKnowledgeGraphToNeo4j(
    sourceId: string,
    novelId: string,
  ): Promise<{ synced: boolean; message: string; entityCount: number; relationCount: number }> {
    return this.#libraryIntelligence.syncNovelKnowledgeGraphToNeo4j(sourceId, novelId);
  }

  askLibraryAssistant(input: AskLibraryAssistantInput): Promise<LibraryAssistantResponse> {
    return this.#libraryIntelligence.askLibraryAssistant(input);
  }

  // ── 翻译 ──

  getLibraryTranslationProfile(sourceId: string, novelId: string): TranslationProfile | null {
    return this.#translation.getTranslationProfile(sourceId, novelId);
  }

  updateLibraryTranslationProfile(sourceId: string, novelId: string, input: TranslationProfileInput): TranslationProfile | null {
    return this.#translation.updateTranslationProfile(sourceId, novelId, input);
  }

  getLibraryTranslationBuild(sourceId: string, novelId: string): TranslationBuild | null {
    return this.#translation.getTranslationBuild(sourceId, novelId);
  }

  getLibraryTranslationChapter(
    sourceId: string,
    novelId: string,
    chapterId: string,
    sourceLang: string,
    targetLang: string,
  ): TranslationChapterDetail | null {
    return this.#translation.getChapterTranslationDetail(sourceId, novelId, chapterId, sourceLang, targetLang);
  }

  listLibraryTranslationTerms(sourceId: string, novelId: string): StoredTranslationTermRow[] {
    return this.#translation.listTerms(sourceId, novelId);
  }

  createLibraryTranslationTerm(sourceId: string, novelId: string, input: {
    sourceTerm: string;
    targetTerm?: string | null;
    entityType?: string | null;
    note?: string | null;
    priority?: number;
  }): StoredTranslationTermRow {
    return this.#translation.createTerm(sourceId, novelId, input);
  }

  updateLibraryTranslationTerm(sourceId: string, novelId: string, termId: string, updates: {
    targetTerm?: string | null;
    entityType?: string | null;
    note?: string | null;
    priority?: number;
  }): StoredTranslationTermRow | null {
    return this.#translation.updateTerm(sourceId, novelId, termId, updates);
  }

  deleteLibraryTranslationTerm(sourceId: string, novelId: string, termId: string): boolean {
    return this.#translation.deleteTerm(sourceId, novelId, termId);
  }

  listLibraryMissingTranslationTerms(sourceId: string, novelId: string): StoredTranslationTermRow[] {
    return this.#translation.listMissingTerms(sourceId, novelId);
  }

  startLibraryTranslation(sourceId: string, novelId: string, modelOverride?: string, fromScratch?: boolean): TranslationBuild {
    return this.#translation.startTranslation(sourceId, novelId, modelOverride, fromScratch);
  }

  cancelLibraryTranslation(sourceId: string, novelId: string): TranslationBuild | null {
    return this.#translation.cancelTranslation(sourceId, novelId);
  }

  getNetworkProxyState(): NetworkProxyState {
    return this.#networkProxy.getState();
  }

  updateNetworkProxy(input: NetworkProxyConfigInput): NetworkProxyState {
    this.#networkProxy.updateConfig(input);
    return this.#networkProxy.getState();
  }

  async validateNetworkProxy(targetUrl?: string): Promise<NetworkProxyState> {
    await this.#networkProxy.validate(targetUrl);
    return this.#networkProxy.getState();
  }

  getLlmPreferences(): LlmPreferencesState {
    return this.#systemPreferences.getLlmState();
  }

  updateLlmPreferences(inputs: LlmProviderConfigInput[]): LlmPreferencesState {
    return this.#systemPreferences.updateLlmProviders(inputs);
  }

  async discoverLlmProviderModels(input: LlmProviderConfigInput): Promise<LlmDiscoveredModel[]> {
    return this.#systemPreferences.discoverLlmProviderModels(input);
  }

  async validateLlmPreferenceModel(providerId: string, modelId: string): Promise<LlmPreferencesState> {
    return this.#systemPreferences.validateLlmModel(providerId, modelId);
  }

  getNeo4jPreferences(): Neo4jPreferencesState {
    return this.#systemPreferences.getNeo4jState();
  }

  updateNeo4jPreferences(input: Neo4jConfigInput): Neo4jPreferencesState {
    return this.#systemPreferences.updateNeo4j(input);
  }

  async validateNeo4jPreferences(): Promise<Neo4jPreferencesState> {
    return this.#systemPreferences.validateNeo4j();
  }

  getReaderTypography(): ReaderTypographyState {
    return this.#systemPreferences.getReaderTypography();
  }

  updateReaderTypography(input: ReaderTypographyConfigInput): ReaderTypographyState {
    return this.#systemPreferences.updateReaderTypography(input);
  }

  getTranslationPreferences(): TranslationPreferencesState {
    return this.#systemPreferences.getTranslationState();
  }

  updateTranslationPreferences(input: TranslationPreferencesInput): TranslationPreferencesState {
    return this.#systemPreferences.updateTranslationPreferences(input);
  }

  getModelGateway(): LlmModelGatewayConfig {
    return this.#systemPreferences.getModelGateway();
  }

  updateModelGateway(input: LlmModelGatewayConfig): LlmModelGatewayConfig {
    return this.#systemPreferences.updateModelGateway(input);
  }

  async previewNovel(input: PreviewNovelInput): Promise<PreviewNovelResult> {
    const source = this.getSource(input.sourceId);
    const previousSnapshot = this.#repository.getSnapshot(source.descriptor.sourceId, input.novelId);
    const metadata = await source.spider.fetchMetadata({ novelId: input.novelId });
    const chapterIndex = await source.spider.fetchChapterIndex({ novelId: input.novelId }, metadata);
    const chapters = resolveChapterStates(chapterIndex, previousSnapshot);

    return {
      source: source.descriptor,
      metadata,
      chapters,
      snapshotSummary: summarizeSnapshot(previousSnapshot, chapters),
      activeTask: this.findActiveTask(input.sourceId, input.novelId),
    };
  }

  createTask(input: TaskExecutionInput): CrawlTaskSnapshot {
    const source = this.getSource(input.sourceId);
    const task = createTaskState(source.descriptor.sourceId, input);
    this.#tasks.set(task.id, task);
    this.emitTaskUpdate(task);

    queueMicrotask(() => {
      void this.runTask(task);
    });

    return serializeTask(task);
  }

  listTasks(limit = 20): CrawlTaskSnapshot[] {
    return [...this.#tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((task) => serializeTask(task));
  }

  getTask(taskId: string): CrawlTaskSnapshot | null {
    const task = this.#tasks.get(taskId);
    return task ? serializeTask(task) : null;
  }

  subscribeToTask(
    taskId: string,
    listener: (event: ControlCenterStreamEvent) => void,
  ): (() => void) | null {
    const task = this.#tasks.get(taskId);

    if (!task) {
      return null;
    }

    task.listeners.add(listener);
    listener({
      type: 'task_updated',
      task: serializeTask(task),
    });

    return () => {
      task.listeners.delete(listener);
    };
  }

  private findActiveTask(sourceId: string, novelId: string): CrawlTaskSnapshot | null {
    const task = [...this.#tasks.values()]
      .filter((candidate) => candidate.sourceId === sourceId && candidate.novelId === novelId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .find((candidate) => candidate.status === 'queued' || candidate.status === 'running');

    return task ? serializeTask(task) : null;
  }

  private async runTask(task: CrawlTaskState): Promise<void> {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    this.emitTaskUpdate(task);

    const source = this.getSource(task.sourceId);
    const logAdapter: SpiderLogAdapter = {
      log: async (event) => {
        this.handleTaskLog(task, event);
      },
    };

    const runner = new SpiderRunner({
      spider: source.spider,
      repository: this.#repository,
      logger: new SpiderLogDispatcher([logAdapter]),
    });

    const options: CrawlNovelOptions = {
      novelId: task.novelId,
      forceRefetch: task.options.forceRefetch,
      chapterConcurrency: task.options.chapterConcurrency,
      chapterRetryCount: task.options.chapterRetryCount,
      ...(task.options.chapterIds.length > 0 ? { chapterIds: task.options.chapterIds } : {}),
    };

    try {
      const result = await runner.crawlNovel(options);
      const currentSnapshot = this.#repository.getSnapshot(task.sourceId, task.novelId);

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.metadata = result.metadata;
      task.chapters = result.chapters;
      task.failures = result.failures;
      task.snapshotSummary = summarizeSnapshot(currentSnapshot, result.chapters);
      task.progress.catalogChapters = result.chapters.length;
      task.progress.percent = 100;
      this.emitTaskUpdate(task);
    } catch (error) {
      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      task.errorMessage = toError(error).message;
      this.emitTaskUpdate(task);
    }
  }

  private handleTaskLog(task: CrawlTaskState, event: SpiderLogEvent): void {
    task.runId = event.context.runId;
    task.events.push(event);

    if (task.events.length > MAX_STORED_EVENTS) {
      task.events.splice(0, task.events.length - MAX_STORED_EVENTS);
    }

    if (event.type === 'catalog_fetched') {
      const totalChapters = readNumericPayload(event.payload, 'totalChapters');
      if (totalChapters !== null) {
        task.progress.catalogChapters = totalChapters;
      }
    }

    if (event.type === 'chapter_started') {
      task.progress.queuedChapters += 1;
    }

    if (event.type === 'chapter_persisted') {
      task.progress.completedChapters += 1;
    }

    if (event.type === 'chapter_failed') {
      task.progress.failedChapters += 1;
    }

    task.progress.percent = calculateProgress(task.progress);

    for (const listener of task.listeners) {
      listener({
        type: 'task_log',
        taskId: task.id,
        event,
      });
    }

    this.emitTaskUpdate(task);
  }

  private emitTaskUpdate(task: CrawlTaskState): void {
    const snapshot = serializeTask(task);

    this.#repository.saveTaskSnapshot(snapshot, snapshot, MAX_STORED_TASKS);

    for (const listener of task.listeners) {
      listener({
        type: 'task_updated',
        task: snapshot,
      });
    }
  }

  private getSource(sourceId: string): SpiderRegistryEntry {
    const source = this.#registry.get(sourceId);

    if (!source) {
      throw new Error(`Unsupported spider source: ${sourceId}`);
    }

    return source;
  }

  private restoreTaskHistory(): void {
    const storedTasks = this.#repository.listTaskSnapshots(MAX_STORED_TASKS);

    if (storedTasks.length === 0) {
      this.bootstrapTaskHistoryFromLibrary();
      return;
    }

    for (const storedTask of storedTasks) {
      const snapshot = JSON.parse(storedTask.snapshotJson) as CrawlTaskSnapshot;
      const task = restoreTaskState(snapshot);
      this.#tasks.set(task.id, task);
    }
  }

  private bootstrapTaskHistoryFromLibrary(): void {
    const libraryNovels = this.#repository
      .listNovels()
      .filter((novel) => novel.downloadedChapters > 0 || novel.failedChapters > 0)
      .slice(0, MAX_STORED_TASKS);

    for (const novel of libraryNovels) {
      const task = createHistoricalTaskState(novel);
      this.#tasks.set(task.id, task);
      this.#repository.saveTaskSnapshot(serializeTask(task), serializeTask(task), MAX_STORED_TASKS);
    }
  }
}

export function createDefaultSpiderRegistry(networkProxy = new NetworkProxyService()): SpiderRegistryEntry[] {
  const fetchHtml = createProxyAwareHtmlFetcher({ proxyService: networkProxy });

  return [
    {
      descriptor: {
        sourceId: 'syosetu',
        label: '小説家になろう（全年龄）',
        description: '日本网文主站，适合全年龄作品。请输入作品编号，例如 n9669bk。',
        defaultNovelId: 'n9669bk',
      },
      spider: new SyosetuSpiderAdapter({ fetchHtml }),
    },
    {
      descriptor: {
        sourceId: 'syosetu18',
        label: 'ノクターンノベルズ（成人向）',
        description: '成人向分站。请输入作品编号，例如 n1557gm。',
        defaultNovelId: 'n1557gm',
      },
      spider: new Syosetu18SpiderAdapter({ fetchHtml }),
    },
  ];
}

function createTaskState(sourceId: string, input: TaskExecutionInput): CrawlTaskState {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sourceId,
    novelId: input.novelId,
    status: 'queued',
    runId: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    options: {
      chapterIds: dedupeChapterIds(input.chapterIds),
      chapterConcurrency: input.chapterConcurrency ?? 4,
      chapterRetryCount: input.chapterRetryCount ?? 1,
      forceRefetch: input.forceRefetch ?? false,
    },
    progress: {
      catalogChapters: 0,
      queuedChapters: 0,
      completedChapters: 0,
      failedChapters: 0,
      percent: 0,
    },
    metadata: null,
    chapters: [],
    failures: [],
    snapshotSummary: null,
    events: [],
    listeners: new Set(),
  };
}

function createHistoricalTaskState(novel: StoredNovelLibraryRow): CrawlTaskState {
  const attemptedChapters = novel.downloadedChapters + novel.failedChapters;
  const timestamp = novel.latestDownloadedAt ?? novel.updatedAt;
  const snapshot: CrawlTaskSnapshot = {
    id: createHistoricalTaskId(novel),
    sourceId: novel.sourceId,
    novelId: novel.metadata.novelId,
    status: novel.failedChapters > 0 ? 'failed' : 'completed',
    runId: null,
    createdAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    errorMessage: novel.failedChapters > 0 ? `历史记录包含 ${novel.failedChapters} 个失败章节。` : null,
    options: {
      chapterIds: [],
      chapterConcurrency: 4,
      chapterRetryCount: 1,
      forceRefetch: false,
    },
    progress: {
      catalogChapters: novel.metadata.chapterCount,
      queuedChapters: attemptedChapters,
      completedChapters: novel.downloadedChapters,
      failedChapters: novel.failedChapters,
      percent: attemptedChapters > 0 ? 100 : 0,
    },
    metadata: novel.metadata,
    chapters: [],
    failures: [],
    snapshotSummary: {
      downloadedChapters: novel.downloadedChapters,
      failedChapters: novel.failedChapters,
      indexedChapters: novel.indexedChapters,
      newChapters: 0,
      updatedAt: novel.updatedAt,
    },
    events: [],
  };

  return restoreTaskState(snapshot);
}

function createHistoricalTaskId(novel: StoredNovelLibraryRow): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${novel.sourceId}:${novel.metadata.novelId}:${novel.updatedAt}`)
    .digest('hex')
    .slice(0, 16);

  return `historic-${digest}`;
}

function resolveChapterStates(
  chapterIndex: ChapterIndexEntry[],
  previousSnapshot: StoredNovelSnapshot | null,
): ResolvedChapterState[] {
  const snapshotMap = new Map(previousSnapshot?.chapters.map((chapter) => [chapter.id, chapter]));

  return mapChapterIndex(chapterIndex).map((chapter) => {
    const storedChapter = snapshotMap.get(chapter.id);

    return {
      ...chapter,
      wasDownloaded: storedChapter?.status === 'downloaded',
      isNew: storedChapter === undefined,
      status: storedChapter?.status ?? 'indexed',
    } satisfies ResolvedChapterState;
  });
}

function mapChapterIndex(chapterIndex: ChapterIndexEntry[]): ChapterIndexEntry[] {
  return chapterIndex;
}

function summarizeSnapshot(
  snapshot: StoredNovelSnapshot | null,
  chapters: ResolvedChapterState[],
): SnapshotSummary | null {
  if (!snapshot) {
    return chapters.length > 0
      ? {
          downloadedChapters: 0,
          failedChapters: 0,
          indexedChapters: chapters.length,
          newChapters: chapters.filter((chapter) => chapter.isNew).length,
          updatedAt: '',
        }
      : null;
  }

  return {
    downloadedChapters: snapshot.chapters.filter((chapter) => chapter.status === 'downloaded').length,
    failedChapters: snapshot.chapters.filter((chapter) => chapter.status === 'failed').length,
    indexedChapters: snapshot.chapters.filter((chapter) => chapter.status === 'indexed').length,
    newChapters: chapters.filter((chapter) => chapter.isNew).length,
    updatedAt: snapshot.updatedAt,
  };
}

function calculateProgress(progress: CrawlTaskProgress): number {
  if (progress.queuedChapters === 0) {
    return progress.catalogChapters === 0 ? 0 : 5;
  }

  const settledChapters = progress.completedChapters + progress.failedChapters;
  return Math.min(100, Math.round((settledChapters / progress.queuedChapters) * 100));
}

function readNumericPayload(
  payload: SpiderLogEvent['payload'],
  key: string,
): number | null {
  if (!payload) {
    return null;
  }

  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

function dedupeChapterIds(chapterIds: string[] | undefined): string[] {
  return chapterIds ? [...new Set(chapterIds.filter((chapterId) => chapterId.trim().length > 0))] : [];
}

function serializeTask(task: CrawlTaskState): CrawlTaskSnapshot {
  return {
    id: task.id,
    sourceId: task.sourceId,
    novelId: task.novelId,
    status: task.status,
    runId: task.runId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    errorMessage: task.errorMessage,
    options: {
      chapterIds: [...task.options.chapterIds],
      chapterConcurrency: task.options.chapterConcurrency,
      chapterRetryCount: task.options.chapterRetryCount,
      forceRefetch: task.options.forceRefetch,
    },
    progress: {
      ...task.progress,
    },
    metadata: task.metadata,
    chapters: [...task.chapters],
    failures: [...task.failures],
    snapshotSummary: task.snapshotSummary,
    events: [...task.events],
  };
}

function restoreTaskState(snapshot: CrawlTaskSnapshot): CrawlTaskState {
  const wasInterrupted = snapshot.status === 'queued' || snapshot.status === 'running';
  const completedAt = wasInterrupted ? snapshot.completedAt ?? new Date().toISOString() : snapshot.completedAt;

  return {
    id: snapshot.id,
    sourceId: snapshot.sourceId,
    novelId: snapshot.novelId,
    status: wasInterrupted ? 'failed' : snapshot.status,
    runId: snapshot.runId,
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt,
    completedAt,
    errorMessage: wasInterrupted
      ? snapshot.errorMessage ?? '任务在服务重启后无法继续，已标记为中断。'
      : snapshot.errorMessage,
    options: {
      chapterIds: [...snapshot.options.chapterIds],
      chapterConcurrency: snapshot.options.chapterConcurrency,
      chapterRetryCount: snapshot.options.chapterRetryCount,
      forceRefetch: snapshot.options.forceRefetch,
    },
    progress: {
      ...snapshot.progress,
    },
    metadata: snapshot.metadata,
    chapters: [...snapshot.chapters],
    failures: [...snapshot.failures],
    snapshotSummary: snapshot.snapshotSummary,
    events: [...snapshot.events],
    listeners: new Set(),
  };
}

function defaultDatabasePath(): string {
  const databaseDir = path.resolve(process.cwd(), '.data');
  fs.mkdirSync(databaseDir, { recursive: true });
  return path.join(databaseDir, 'novels.db');
}

function defaultNetworkProxyConfigPath(): string {
  const dataDir = path.resolve(process.cwd(), '.data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'network-proxy.json');
}

function defaultSystemPreferencesPath(): string {
  const dataDir = path.resolve(process.cwd(), '.data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'system-preferences.json');
}

function defaultExportStoragePath(): string {
  const exportDir = path.resolve(process.cwd(), 'data', 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  return exportDir;
}

