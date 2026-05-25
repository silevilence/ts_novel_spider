import type { SqliteNovelRepository } from './novel-repository';
import type { StoredTranslationProfileInput } from './novel-repository';
import type {
  TranslationPreferencesConfig,
  SystemPreferencesService,
} from './system-preferences';
import type {
  StoredTranslationProfileRow,
  StoredTranslationTermRow,
  StoredTranslationBuildRow,
  StoredTranslationBuildLogRow,
  StoredTranslationBuildCheckpointRow,
  StoredChapterTranslationRow,
  StoredChapterTranslationParagraphRow,
  StoredChapterTranslationQaRow,
  TranslationBuildStatus,
  TranslationBuildStage,
  TranslationChapterStatus,
  TranslationExportMode,
} from './novel-repository';
import { TranslationRunner } from './translation-runner';
import type {
  TranslationTaskInput,
  TranslationTaskSnapshot,
  TranslationTaskProgress,
  TranslationTaskStatus,
  TranslationChapterFailure,
} from './translation-runner';
import { createTranslationPipelineGraph } from './translation-pipeline';
import type { TranslationPipelineState } from './translation-state';
import { TranslationHistoryManager } from './translation/nodes/history-manager';
import { LlmInteractionLogger } from './translation/nodes/llm-logger';

/** 翻译配置（库层面组合全局默认与单本覆盖） */
export interface TranslationProfile {
  sourceId: string;
  novelId: string;
  sourceLang: string;
  targetLang: string;
  termExtractionModel: { providerId?: string; modelId?: string } | null;
  translationModels: Array<{ providerId?: string; modelId?: string; maxConcurrency: number }>;
  translationConcurrency: number;
  autoRejectUntranslatedTerms: boolean;
  defaultExportMode: TranslationExportMode;
  configLocked: boolean;
  lockedAt: string | null;
  updatedAt: string;
}

export interface TranslationProfileInput {
  sourceLang?: string;
  targetLang?: string;
  termExtractionModel?: { providerId?: string; modelId?: string } | null;
  translationModels?: Array<{ providerId?: string; modelId?: string; maxConcurrency?: number }>;
  translationConcurrency?: number;
  autoRejectUntranslatedTerms?: boolean;
  defaultExportMode?: TranslationExportMode;
}

export interface TranslationBuild {
  status: TranslationBuildStatus;
  stage: TranslationBuildStage;
  progressPercent: number;
  message: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  translatedChapters: number;
  failedChapters: number;
  currentChapterParagraphs: number;
  currentChapterTranslatedParagraphs: number;
  totalTranslatedParagraphs: number;
  totalParagraphEstimate?: number;
  glossaryVersion: number;
  profileVersion: number;
  updatedAt: string | null;
}

export interface TranslationChapterDetail {
  chapterId: string;
  sourceLang: string;
  targetLang: string;
  translatedTitle: string | null;
  status: TranslationChapterStatus;
  overallQualityScore: number | null;
  paragraphs: Array<{
    paragraphIndex: number;
    sourceText: string;
    translatedText: string | null;
    confidence: number | null;
    appliedTermIds: string[];
  }>;
  qaRecords: Array<{
    checkType: string;
    score: number;
    severity: string;
    suggestion: string | null;
    paragraphIndices: number[];
    resolved: boolean;
  }>;
}

/** 翻译流水线服务——对 ControlCenterService 暴露的外观 */
export class TranslationService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #abortControllers = new Map<string, AbortController>();

  #runner: TranslationRunner | null = null;

  constructor(repository: SqliteNovelRepository, preferences: SystemPreferencesService) {
    this.#repository = repository;
    this.#preferences = preferences;
  }

  /** 获取单本小说的翻译配置——合并全局默认 */
  getTranslationProfile(sourceId: string, novelId: string): TranslationProfile | null {
    const profile = this.#repository.getTranslationProfile(sourceId, novelId);
    const global = this.#preferences.getTranslationState().config;

    if (!profile) {
      // 返回全局默认作为兜底
      return {
        sourceId,
        novelId,
        sourceLang: global.sourceLang,
        targetLang: global.targetLang,
        termExtractionModel: global.termExtractionModel,
        translationModels: global.translationModels.map((m) => ({
          ...m,
          maxConcurrency: global.translationConcurrency,
        })),
        translationConcurrency: global.translationConcurrency,
        autoRejectUntranslatedTerms: global.autoRejectUntranslatedTerms,
        defaultExportMode: global.defaultExportMode,
        configLocked: false,
        lockedAt: null,
        updatedAt: '',
      };
    }

    return {
      sourceId: profile.sourceId,
      novelId: profile.novelId,
      sourceLang: profile.sourceLang,
      targetLang: profile.targetLang,
      termExtractionModel: profile.termExtractionModel,
      translationModels: profile.translationModels,
      translationConcurrency: profile.translationConcurrency,
      autoRejectUntranslatedTerms: profile.autoRejectUntranslatedTerms,
      defaultExportMode: profile.defaultExportMode,
      configLocked: profile.configLocked,
      lockedAt: profile.lockedAt,
      updatedAt: profile.updatedAt,
    };
  }

  /** 更新单本翻译配置 */
  updateTranslationProfile(sourceId: string, novelId: string, input: TranslationProfileInput): TranslationProfile | null {
    const existing = this.#repository.getTranslationProfile(sourceId, novelId);
    const global = this.#preferences.getTranslationState().config;

    // 如果已有配置被锁定，不允许更新
    if (existing?.configLocked) {
      throw new Error('翻译配置已锁定（已有翻译产物），不可更改。如需修改请先清除翻译数据。');
    }

    const saved = this.#repository.saveTranslationProfile({
      sourceId,
      novelId,
      sourceLang: input.sourceLang ?? existing?.sourceLang ?? global.sourceLang,
      targetLang: input.targetLang ?? existing?.targetLang ?? global.targetLang,
      termExtractionModel: input.termExtractionModel !== undefined
        ? (input.termExtractionModel
          ? {
              providerId: input.termExtractionModel.providerId ?? '',
              modelId: input.termExtractionModel.modelId ?? '',
              maxConcurrency: 1,
            }
          : null)
        : (existing?.termExtractionModel ?? null),
      translationModels: input.translationModels !== undefined
        ? input.translationModels.map((m) => ({
            providerId: m.providerId ?? '',
            modelId: m.modelId ?? '',
            maxConcurrency: m.maxConcurrency ?? 1,
          }))
        : existing?.translationModels ?? [],
      reviewModel: null,
      translationConcurrency: input.translationConcurrency ?? existing?.translationConcurrency ?? global.translationConcurrency,
      qualityThreshold: 0,
      autoRejectUntranslatedTerms: input.autoRejectUntranslatedTerms ?? existing?.autoRejectUntranslatedTerms ?? global.autoRejectUntranslatedTerms,
      defaultExportMode: input.defaultExportMode ?? existing?.defaultExportMode ?? global.defaultExportMode,
      configLocked: existing?.configLocked ?? false,
      lockedAt: existing?.lockedAt ?? null,
    });

    return this.getTranslationProfile(sourceId, novelId);
  }

  /** 获取翻译构建状态 */
  getTranslationBuild(sourceId: string, novelId: string): TranslationBuild | null {
    const build = this.#repository.getTranslationBuild(sourceId, novelId);
    if (!build) {
      return null;
    }

    return {
      status: build.status,
      stage: build.stage,
      progressPercent: build.progressPercent,
      message: build.message,
      errorMessage: build.errorMessage,
      startedAt: build.startedAt,
      completedAt: build.completedAt,
      translatedChapters: build.translatedChapters,
      failedChapters: build.failedChapters,
      currentChapterParagraphs: build.currentChapterParagraphs,
      currentChapterTranslatedParagraphs: build.currentChapterTranslatedParagraphs,
      totalTranslatedParagraphs: build.totalTranslatedParagraphs,
      totalParagraphEstimate: build.totalParagraphEstimate,
      glossaryVersion: build.glossaryVersion,
      profileVersion: build.profileVersion,
      updatedAt: build.updatedAt,
    };
  }

  /** 获取单章翻译详情（含段落绑定和 QA 记录） */
  getChapterTranslationDetail(
    sourceId: string,
    novelId: string,
    chapterId: string,
    sourceLang: string,
    targetLang: string,
  ): TranslationChapterDetail | null {
    const translation = this.#repository.getChapterTranslation(sourceId, novelId, chapterId, sourceLang, targetLang);
    if (!translation) {
      return null;
    }

    const paragraphs = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, chapterId);
    const qaRecords = this.#repository.listChapterTranslationQa(sourceId, novelId, chapterId);

    return {
      chapterId: translation.chapterId,
      sourceLang: translation.sourceLang,
      targetLang: translation.targetLang,
      translatedTitle: translation.translatedTitle,
      status: translation.status,
      overallQualityScore: translation.overallQualityScore,
      paragraphs: paragraphs.map((p) => ({
        paragraphIndex: p.paragraphIndex,
        sourceText: p.sourceText,
        translatedText: p.translatedText,
        confidence: p.confidence,
        appliedTermIds: p.appliedTermIds,
      })),
      qaRecords: qaRecords.map((q) => ({
        checkType: q.checkType,
        score: q.score,
        severity: q.severity,
        suggestion: q.suggestion,
        paragraphIndices: q.paragraphIndices,
        resolved: q.resolved,
      })),
    };
  }

  /** 列出术语表 */
  listTerms(sourceId: string, novelId: string): StoredTranslationTermRow[] {
    return this.#repository.listTranslationTerms(sourceId, novelId);
  }

  /** 创建术语 */
  createTerm(sourceId: string, novelId: string, input: {
    sourceTerm: string;
    targetTerm?: string | null;
    entityType?: string | null;
    note?: string | null;
    priority?: number;
  }): StoredTranslationTermRow {
    return this.#repository.createTranslationTerm({
      sourceId,
      novelId,
      sourceTerm: input.sourceTerm,
      ...(input.targetTerm !== undefined ? { targetTerm: input.targetTerm } : {}),
      ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
  }

  /** 更新术语 */
  updateTerm(sourceId: string, novelId: string, termId: string, updates: {
    targetTerm?: string | null;
    entityType?: string | null;
    note?: string | null;
    priority?: number;
  }): StoredTranslationTermRow | null {
    return this.#repository.updateTranslationTerm(sourceId, novelId, termId, updates);
  }

  /** 删除术语 */
  deleteTerm(sourceId: string, novelId: string, termId: string): boolean {
    return this.#repository.deleteTranslationTerm(sourceId, novelId, termId);
  }

  /** 查找缺译术语 */
  listMissingTerms(sourceId: string, novelId: string): StoredTranslationTermRow[] {
    return this.#repository.listMissingTranslationTerms(sourceId, novelId);
  }

  /** 获取构建日志 */
  getBuildLogs(sourceId: string, novelId: string, limit = 200): StoredTranslationBuildLogRow[] {
    return this.#repository.listTranslationBuildLogs(sourceId, novelId, limit);
  }

  /** 获取章节检查点 */
  getCheckpoints(sourceId: string, novelId: string): StoredTranslationBuildCheckpointRow[] {
    return this.#repository.listTranslationBuildCheckpoints(sourceId, novelId);
  }

  /** 清除翻译数据 */
  clearTranslationData(sourceId: string, novelId: string): void {
    this.#repository.clearTranslationData(sourceId, novelId);
  }

  /** 取消/重置翻译任务 */
  cancelTranslation(sourceId: string, novelId: string): TranslationBuild | null {
    const key = `${sourceId}:${novelId}`;
    this.#abortControllers.get(key)?.abort();
    this.#abortControllers.delete(key);

    const existing = this.#repository.getTranslationBuild(sourceId, novelId);
    if (!existing) return null;

    const build = this.#repository.saveTranslationBuild({
      sourceId, novelId,
      status: 'paused',
      stage: 'failed',
      progressPercent: existing.progressPercent,
      message: '用户手动暂停',
      errorMessage: null,
      startedAt: existing.startedAt,
      completedAt: new Date().toISOString(),
      modelStatsJson: existing.modelStatsJson,
      translatedChapters: existing.translatedChapters,
      reviewedChapters: 0,
      failedChapters: existing.failedChapters,
      glossaryVersion: existing.glossaryVersion,
      profileVersion: existing.profileVersion,
    });

    return {
      status: build.status,
      stage: build.stage,
      progressPercent: build.progressPercent,
      message: build.message,
      errorMessage: build.errorMessage,
      startedAt: build.startedAt,
      completedAt: build.completedAt,
      translatedChapters: build.translatedChapters,
      failedChapters: build.failedChapters,
      currentChapterParagraphs: build.currentChapterParagraphs,
      currentChapterTranslatedParagraphs: build.currentChapterTranslatedParagraphs,
      totalTranslatedParagraphs: build.totalTranslatedParagraphs,
      glossaryVersion: build.glossaryVersion,
      profileVersion: build.profileVersion,
      updatedAt: build.updatedAt,
    };
  }

  /** 启动翻译任务——自动恢复僵尸构建后重新开始 */
  startTranslation(sourceId: string, novelId: string, modelOverride?: string, fromScratch?: boolean): TranslationBuild {
    const profile = this.getTranslationProfile(sourceId, novelId);
    if (!profile) {
      throw new Error('请先在系统偏好中配置翻译默认值。');
    }

    const existingBuild = this.#repository.getTranslationBuild(sourceId, novelId);
    if (existingBuild && (existingBuild.status === 'running' || existingBuild.status === 'queued')) {
      // 僵尸构建恢复：标记为失败后允许重新开始
      console.log(`[translation] 检测到遗留的 ${existingBuild.status} 翻译任务，自动恢复为失败状态后重新开始。`);
      this.#repository.saveTranslationBuild({
        sourceId, novelId,
        status: 'failed',
        stage: 'failed',
        progressPercent: existingBuild.progressPercent,
        message: '任务中断（服务重启或残留状态），已自动恢复。',
        errorMessage: '翻译中断',
        startedAt: existingBuild.startedAt,
        completedAt: new Date().toISOString(),
        modelStatsJson: existingBuild.modelStatsJson,
        translatedChapters: existingBuild.translatedChapters,
        reviewedChapters: 0,
        failedChapters: existingBuild.failedChapters,
        glossaryVersion: existingBuild.glossaryVersion,
        profileVersion: existingBuild.profileVersion,
      });
    }

    const glossaryVersion = (existingBuild?.glossaryVersion ?? 0) + 1;
    const profileVersion = (existingBuild?.profileVersion ?? 0) + 1;

    // 获取已下载章节列表
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    const downloadedChapters = snapshot?.chapters.filter(
      (c) => typeof c.content === 'string' && c.content.trim().length > 0,
    ) ?? [];

    if (downloadedChapters.length === 0) {
      throw new Error('当前没有已下载的章节，请先抓取章节内容后再启动翻译。');
    }

    // 如果之前有暂停/完成且有已翻译章节，跳过已翻译的章节继续翻译
    const canResume = !fromScratch && existingBuild && (existingBuild.status === 'paused' || existingBuild.status === 'completed');
    const remainingChapterIds = canResume
      ? downloadedChapters.filter((c) => {
          const t = this.#repository.getChapterTranslation(sourceId, novelId, c.id, profile.sourceLang, profile.targetLang);
          const skip = t && t.status === 'completed';
          if (skip) console.log(`[translation] 跳过已完成章节: 第 ${c.index} 章「${c.title}」(status=${t!.status})`);
          return !skip;
        }).map((c) => c.id)
      : downloadedChapters.map((c) => c.id);

    console.log(`[translation] ${canResume ? '继续翻译' : '全新翻译'}：下载 ${downloadedChapters.length} 章，剩余 ${remainingChapterIds.length} 章`);

    const isResuming = canResume;

    const startedTranslated = canResume ? (existingBuild?.translatedChapters ?? 0) : 0;
    const startedFailed = canResume ? (existingBuild?.failedChapters ?? 0) : 0;

    if (remainingChapterIds.length === 0) {
      throw new Error('所有章节均已翻译完成，无需继续。');
    }

    console.log(`[translation] ${isResuming ? '继续翻译' : '开始翻译'}，剩余 ${remainingChapterIds.length} 章`);

    const build = this.#repository.saveTranslationBuild({
      sourceId,
      novelId,
      status: 'running',
      stage: 'translating',
      progressPercent: isResuming ? Math.round((startedTranslated / downloadedChapters.length) * 100) : 0,
      message: `${isResuming ? '继续' : '准备'}翻译 ${remainingChapterIds.length} 个章节`,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      modelStatsJson: JSON.stringify({ runStartedAt: new Date().toISOString() }),
      // 恢复时保留旧计数，避免从头计数导致总数重复
      translatedChapters: isResuming ? startedTranslated : 0,
      reviewedChapters: 0,
      failedChapters: isResuming ? startedFailed : 0,
      glossaryVersion,
      profileVersion,
      currentChapterTitle: remainingChapterIds[0] ?? null,
      currentChapterParagraphs: 0,
      currentChapterTranslatedParagraphs: 0,
      totalTranslatedParagraphs: isResuming ? (existingBuild?.totalTranslatedParagraphs ?? 0) : 0,
    });

    // 在后台启动章节翻译
    queueMicrotask(() => {
      void this.processChapters(sourceId, novelId, remainingChapterIds, profile.sourceLang, profile.targetLang, glossaryVersion, profileVersion, startedTranslated, startedFailed, canResume ? (existingBuild?.totalTranslatedParagraphs ?? 0) : 0, modelOverride);
    });

    return {
      status: build.status,
      stage: build.stage,
      progressPercent: build.progressPercent,
      message: build.message,
      errorMessage: build.errorMessage,
      startedAt: build.startedAt,
      completedAt: build.completedAt,
      translatedChapters: build.translatedChapters,
      failedChapters: build.failedChapters,
      currentChapterParagraphs: build.currentChapterParagraphs,
      currentChapterTranslatedParagraphs: build.currentChapterTranslatedParagraphs,
      totalTranslatedParagraphs: build.totalTranslatedParagraphs,
      glossaryVersion: build.glossaryVersion,
      profileVersion: build.profileVersion,
      updatedAt: build.updatedAt,
    };
  }

  private async processChapters(
    sourceId: string,
    novelId: string,
    chapterIds: string[],
    sourceLang: string,
    targetLang: string,
    glossaryVersion: number,
    profileVersion: number,
    startTranslated = 0,
    startFailed = 0,
    startTotalParagraphs = 0,
    modelOverride?: string,
  ): Promise<void> {
    const terms = this.#repository.listTranslationTerms(sourceId, novelId);
    const profile = this.getTranslationProfile(sourceId, novelId);
    const paragraphsPerBatch = profile?.translationConcurrency ?? 2;
    const historyManager = new TranslationHistoryManager();
    const llmLogger = new LlmInteractionLogger(
      undefined,
      this.#preferences.getTranslationState().config.enableLlmInteractionLog,
    );

    const abortKey = `${sourceId}:${novelId}`;
    const ac = new AbortController();
    this.#abortControllers.set(abortKey, ac);

    let translated = startTranslated;
    let failed = startFailed;
    let totalParagraphsDone = startTotalParagraphs;
    const runStartedAt = Date.now();

    // 闭包中引用的可变进度状态
    let progressChapterTitle = '';
    let progressChapterEstParagraphs = 0;

    // 预估总段数
    let totalParagraphEstimate = 0;
    for (const cid of chapterIds) {
      try {
        const ch = this.#repository.getChapter(sourceId, novelId, cid);
        if (ch?.content) totalParagraphEstimate += ch.content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0).length;
      } catch { /* ignore */ }
    }

    console.log(`[translation] 开始翻译 ${sourceId}/${novelId}，共 ${chapterIds.length} 章，约 ${totalParagraphEstimate} 段，语言对 ${sourceLang}→${targetLang}`);

    const pipeline = createTranslationPipelineGraph({
      preferences: this.#preferences,
      repository: this.#repository,
      historyManager,
      paragraphsPerBatch,
      llmLogger,
      abortSignal: ac.signal,
      onBatchProgress: (_batchParagraphs, totalCompleted) => {
        const nowTotal = totalParagraphsDone + totalCompleted;
        try {
          this.#repository.saveTranslationBuild({
            sourceId, novelId, status: 'running', stage: 'translating',
            progressPercent: chapterIds.length > 0 ? Math.round(((translated + failed) / chapterIds.length) * 100) : 0,
            message: `正在翻译… (${totalCompleted}/${progressChapterEstParagraphs}段)`,
            errorMessage: null,
            startedAt: new Date(runStartedAt).toISOString(), completedAt: null,
            modelStatsJson: JSON.stringify({ runStartedAt }),
            translatedChapters: translated, reviewedChapters: 0, failedChapters: failed,
            glossaryVersion, profileVersion,
            currentChapterTitle: progressChapterTitle,
            currentChapterParagraphs: progressChapterEstParagraphs,
            currentChapterTranslatedParagraphs: totalCompleted,
            totalTranslatedParagraphs: nowTotal,
            totalParagraphEstimate,
          });
        } catch { /* ignore */ }
      },
      ...(modelOverride ? { modelOverride } : {}),
    });

    console.log(`[translation] 开始翻译 ${sourceId}/${novelId}，共 ${chapterIds.length} 章，约 ${totalParagraphEstimate} 段，语言对 ${sourceLang}→${targetLang}`);

    for (const chapterId of chapterIds) {
      if (ac.signal.aborted) { console.log(`[translation] 翻译已取消`); break; }
      const chapter = this.#repository.getChapter(sourceId, novelId, chapterId);
      if (!chapter || !chapter.content) continue;

      let chapterOk = false;

      try {
        const contentHash = simpleHash(chapter.content);

        const state: TranslationPipelineState = {
          sourceId, novelId, chapterId,
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          sourceContent: chapter.content,
          sourceLang, targetLang,
          glossary: terms.map((t) => ({
            id: t.id,
            sourceTerm: t.sourceTerm,
            targetTerm: t.targetTerm,
            entityType: t.entityType,
            priority: t.priority,
          })),
          segments: [],
          draftParagraphs: [],
          translatedTitle: null,
          finalParagraphs: [],
          translatorModelId: null,
          tokenUsageJson: null,
          sourceContentHash: contentHash,
          glossaryVersion, profileVersion,
          retryCount: 0,
          maxRetries: 3,
          pauseRequested: false,
          errorMessage: null,
        };

        console.log(`[translation] 调用 LLM 翻译第 ${chapter.index} 章「${chapter.title}」...`);

        // 更新段落进度：新章节开始，当前段数为预估段数
        const estParagraphs = chapter.content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0).length;
        progressChapterTitle = chapter.title;
        progressChapterEstParagraphs = estParagraphs;
        this.#repository.saveTranslationBuild({
          sourceId, novelId, status: 'running', stage: 'translating',
          progressPercent: chapterIds.length > 0 ? Math.round(((translated + failed) / chapterIds.length) * 100) : 0,
          message: `正在翻译第 ${chapter.index} 章…`,
          errorMessage: null,
          startedAt: new Date(runStartedAt).toISOString(), completedAt: null,
          modelStatsJson: JSON.stringify({ runStartedAt }),
          translatedChapters: translated, reviewedChapters: 0, failedChapters: failed,
          glossaryVersion, profileVersion,
          currentChapterTitle: chapter.title,
          currentChapterParagraphs: estParagraphs,
          currentChapterTranslatedParagraphs: 0,
          totalTranslatedParagraphs: totalParagraphsDone,
          totalParagraphEstimate,
        });

        await pipeline.invoke(state);

        const saved = this.#repository.getChapterTranslation(sourceId, novelId, chapterId, sourceLang, targetLang);
        if (saved && saved.status === 'completed') {
          // 验证翻译是否真实发生：检查段落译文与原文字段不同
          const paragraphs = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, chapterId);
          const hasRealTranslation = paragraphs.length > 0 && paragraphs.some(
            (p) => p.translatedText && p.translatedText !== p.sourceText,
          );

          if (hasRealTranslation) {
            chapterOk = true;
            console.log(`[translation] ✅ 第 ${chapter.index} 章完成 (${paragraphs.length} 段, 首段译文: ${paragraphs[0]?.translatedText?.slice(0, 30) ?? '?'}...)`);
          } else {
            console.log(`[translation] ⚠️ 第 ${chapter.index} 章翻译未生效（译文与原文相同，${paragraphs.length} 段），可能未配置 LLM 模型`);
            try {
              this.#repository.saveChapterTranslation({
                sourceId, novelId, chapterId, sourceLang, targetLang,
                status: 'failed' as TranslationChapterStatus,
                sourceContentHash: contentHash,
                glossaryVersion, profileVersion,
              });
            } catch { /* ignore */ }
          }
        } else {
          console.log(`[translation] ⚠️ 第 ${chapter.index} 章状态: ${saved?.status ?? 'unknown'}`);
          try {
            this.#repository.saveChapterTranslation({
              sourceId, novelId, chapterId, sourceLang, targetLang,
              status: 'failed' as TranslationChapterStatus,
              sourceContentHash: contentHash,
              glossaryVersion, profileVersion,
            });
          } catch { /* ignore */ }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[translation] ❌ 第 ${chapter.index} 章失败:`, errMsg);
      }

      if (chapterOk) {
        translated++;
      } else {
        failed++;
      }

      const total = translated + failed;
      // 获取当前章节的段落信息
      let chapterParagraphs = 0;
      try {
        const paras = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, chapterId);
        chapterParagraphs = paras.length;
        totalParagraphsDone += chapterParagraphs;
      } catch { /* ignore */ }

      this.#repository.saveTranslationBuild({
        sourceId, novelId,
        status: 'running',
        stage: 'translating',
        progressPercent: chapterIds.length > 0 ? Math.round((total / chapterIds.length) * 100) : 0,
        message: `已译 ${translated}/${chapterIds.length} 章 (${chapterParagraphs}段)`,
        errorMessage: null,
        startedAt: new Date(runStartedAt).toISOString(),
        completedAt: null,
        modelStatsJson: JSON.stringify({ runStartedAt }),
        translatedChapters: translated,
        reviewedChapters: 0,
        failedChapters: failed,
        glossaryVersion,
        profileVersion,
        // 显示刚完成的章节的段落进度（满格）
        currentChapterTitle: chapter.title,
        currentChapterParagraphs: chapterParagraphs,
        currentChapterTranslatedParagraphs: chapterParagraphs,
        totalTranslatedParagraphs: totalParagraphsDone,
        totalParagraphEstimate,
      });

      this.#repository.appendTranslationBuildLog({
        sourceId, novelId,
        stage: 'translating',
        level: chapterOk ? 'info' : 'warn',
        message: `第 ${chapter.index} 章「${chapter.title}」: ${chapterOk ? '完成' : '失败'}`,
      });
    }

    console.log(`[translation] 翻译结束: ${translated} 成功 / ${failed} 失败`);

    this.#abortControllers.delete(abortKey);
    this.#repository.saveTranslationBuild({
      sourceId, novelId,
      status: ac.signal.aborted ? 'failed' : 'completed',
      stage: ac.signal.aborted ? 'failed' : 'completed',
      progressPercent: 100,
      message: `翻译完成：${translated} 章成功，${failed} 章失败`,
      errorMessage: null,
      startedAt: new Date(runStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      modelStatsJson: JSON.stringify({ runStartedAt }),
      translatedChapters: translated,
      reviewedChapters: 0,
      failedChapters: failed,
      glossaryVersion,
      profileVersion,
      currentChapterTitle: null,
      currentChapterParagraphs: 0,
      currentChapterTranslatedParagraphs: 0,
      totalTranslatedParagraphs: totalParagraphsDone,
    });
  }
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}
