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
import { stripTranslationNumberPrefix, TRANSLATION_PREFIX_PATTERN } from './translation/nodes/translate-node';
import { TranslationRunner } from './translation-runner';
import type {
  TranslationTaskInput,
  TranslationTaskSnapshot,
  TranslationTaskProgress,
  TranslationTaskStatus,
  TranslationChapterFailure,
} from './translation-runner';
import { createTranslationPipelineGraph, resolveTranslationModel } from './translation-pipeline';
import type { TranslationPipelineState, TranslationUnitKind } from './translation-state';

/** 翻译单元：表示一个需要翻译的独立数据块 */
interface TranslationUnit {
  id: string;
  kind: TranslationUnitKind;
  index: number;
  title: string;
  content: string;
  volumeTitle?: string | undefined;
}
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
        translatedText: p.translatedText
          ? stripTranslationNumberPrefix(p.sourceText, p.translatedText)
          : null,
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

  /** 批量导入术语（仅源词，不修改不删除已有条目） */
  batchImportTerms(sourceId: string, novelId: string, terms: Array<{ sourceTerm: string; entityType?: string | null }>): { created: number; updated: number; skipped: number } {
    return this.#repository.upsertTranslationTerms(
      sourceId,
      novelId,
      terms.map((t) => {
        const term: { sourceTerm: string; entityType?: string | null } = { sourceTerm: t.sourceTerm };
        if (t.entityType !== undefined) term.entityType = t.entityType;
        return term;
      }),
    );
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

  /**
   * 构建有序翻译单元队列。
   *
   * 顺序：小说元数据 → 各卷标题 → 各真实章节
   * 对于真实章节，content 已 prepend 章节标题作为首段；
   * 对于卷标题，content 仅为卷标题文本；
   * 对于元数据，content 为 "小说标题\\n\\n小说简介"。
   */
  static buildTranslationUnits(
    snapshot: { chapters: Array<{ id: string; index: number; title: string; content?: string | null; volumeTitle?: string | null }>; metadata: { title: string; description: string } },
    sourceLang: string,
    targetLang: string,
  ): TranslationUnit[] {
    const units: TranslationUnit[] = [];

    // 第 0 单元：小说元数据（标题 + 简介）
    units.push({
      id: '__novel_meta__',
      kind: 'meta',
      index: 0,
      title: snapshot.metadata.title,
      content: `${snapshot.metadata.title}\n\n${snapshot.metadata.description || ''}`,
    });

    // 按卷顺序构建单元
    let currentVolumeRaw = '';
    let volumeIndex = 0;
    const chapters = snapshot.chapters.filter(
      (c) => typeof c.content === 'string' && c.content.trim().length > 0,
    );

    for (const chapter of chapters) {
      const volumeRaw = chapter.volumeTitle?.trim() || '';
      if (volumeRaw && volumeRaw !== currentVolumeRaw) {
        // 新卷：先插入卷标题单元
        currentVolumeRaw = volumeRaw;
        volumeIndex++;
        units.push({
          id: `__volume_${volumeIndex}__`,
          kind: 'volume',
          index: volumeIndex,
          title: volumeRaw,
          content: volumeRaw,
        });
      }

      // 真实章节：标题作为首段拼入 content
      units.push({
        id: chapter.id,
        kind: 'chapter',
        index: chapter.index,
        title: chapter.title,
        content: `${chapter.title}\n\n${chapter.content}`,
        volumeTitle: volumeRaw || undefined,
      });
    }

    return units;
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

    // 构建完整翻译单元队列（元数据→卷→章节）
    const allUnits = TranslationService.buildTranslationUnits(
      { chapters: downloadedChapters, metadata: snapshot!.metadata },
      profile.sourceLang,
      profile.targetLang,
    );

    // 如果之前有暂停/完成且有已翻译单元，跳过已完成的继续翻译
    const canResume = !fromScratch && existingBuild && (existingBuild.status === 'paused' || existingBuild.status === 'completed');
    const startedTranslated = canResume ? (existingBuild?.translatedChapters ?? 0) : 0;
    const startedFailed = canResume ? (existingBuild?.failedChapters ?? 0) : 0;
    const remainingUnits = canResume
      ? allUnits.filter((u) => {
          const t = this.#repository.getChapterTranslation(sourceId, novelId, u.id, profile.sourceLang, profile.targetLang);
          const skip = t && t.status === 'completed';
          if (skip) console.log(`[translation] 跳过已完成的翻译单元: ${u.kind}「${u.title}」(id=${u.id})`);
          return !skip;
        })
      : [...allUnits];

    console.log(`[translation] ${canResume ? '继续翻译' : '全新翻译'}：下载 ${downloadedChapters.length} 章，共 ${allUnits.length} 个翻译单元，剩余 ${remainingUnits.length} 单元`);

    const isResuming = canResume;
    const completedUnitCount = allUnits.length - remainingUnits.length;

    if (remainingUnits.length === 0) {
      throw new Error('所有内容均已翻译完成，无需继续。');
    }

    console.log(`[translation] ${isResuming ? '继续翻译' : '开始翻译'}，剩余 ${remainingUnits.length} 单元`);

    const build = this.#repository.saveTranslationBuild({
      sourceId,
      novelId,
      status: 'running',
      stage: 'translating',
      progressPercent: isResuming ? Math.round((completedUnitCount / allUnits.length) * 100) : 0,
      message: `${isResuming ? '继续' : '准备'}翻译 ${remainingUnits.length} 个单元`,
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
      currentChapterTitle: remainingUnits[0]?.title ?? null,
      currentChapterParagraphs: 0,
      currentChapterTranslatedParagraphs: 0,
      totalTranslatedParagraphs: isResuming ? (existingBuild?.totalTranslatedParagraphs ?? 0) : 0,
    });

    // 在后台启动章节翻译
    const totalUnitCount = allUnits.length;
    const realChapterCount = downloadedChapters.length;
    queueMicrotask(() => {
      void this.processUnits(sourceId, novelId, remainingUnits, totalUnitCount, realChapterCount, profile.sourceLang, profile.targetLang, glossaryVersion, profileVersion, completedUnitCount, startedTranslated, startedFailed, canResume ? (existingBuild?.totalTranslatedParagraphs ?? 0) : 0, modelOverride);
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

  private async processUnits(
    sourceId: string,
    novelId: string,
    units: TranslationUnit[],
    totalUnitCount: number,
    realChapterCount: number,
    sourceLang: string,
    targetLang: string,
    glossaryVersion: number,
    profileVersion: number,
    startCompletedUnits = 0,
    startTranslated = 0,
    startFailed = 0,
    startTotalParagraphs = 0,
    modelOverride?: string,
  ): Promise<void> {
    const terms = this.#repository.listTranslationTerms(sourceId, novelId);
    const profile = this.getTranslationProfile(sourceId, novelId);
    const paragraphsPerBatch = profile?.translationConcurrency ?? 2;

    // 解析翻译模型的上下文窗口设置（若配置了则按 Token 截断，否则按条目数）
    let contextWindowTokens = 0;
    try {
      const llmState = this.#preferences.getLlmState();
      const modelRoute = resolveTranslationModel(this.#preferences, modelOverride);
      if (modelRoute) {
        const provider = llmState.providers.find((p) => p.id === modelRoute.providerId);
        const model = provider?.models.find((m) => m.id === modelRoute.modelId);
        contextWindowTokens = model?.contextWindowTokens ?? 0;
      }
    } catch { /* ignore */ }

    const historyManager = new TranslationHistoryManager(
      contextWindowTokens > 0 ? 999999 : 200, // Token 模式：极大条目数，由 Token 限制控制
      contextWindowTokens,
    );
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
    for (const unit of units) {
      if (unit.kind === 'chapter' && unit.content) {
        totalParagraphEstimate += unit.content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0).length;
      }
    }

    console.log(`[translation] 开始翻译 ${sourceId}/${novelId}，共 ${units.length} 单元 (${realChapterCount} 章)，约 ${totalParagraphEstimate} 段，语言对 ${sourceLang}→${targetLang}`);

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
            progressPercent: totalUnitCount > 0 ? Math.round(((translated + failed) / totalUnitCount) * 100) : 0,
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

    // 移除多余的重复日志行
    let completedUnits = startCompletedUnits;

    // 确保合成翻译单元（元数据、卷标题）在 chapters 表中有傀儡记录，避免 FK 约束失败
    for (const unit of units) {
      if (unit.kind === 'meta' || unit.kind === 'volume') {
        this.#repository.ensureSyntheticChapter(sourceId, novelId, unit.id, unit.title, unit.index);
      }
    }

    for (const unit of units) {
      if (ac.signal.aborted) { console.log(`[translation] 翻译已取消`); break; }

      let unitOk = false;
      let unitIndex = 0;
      let unitTitle = unit.title;

      try {
        const contentHash = simpleHash(unit.content);

        const state: TranslationPipelineState = {
          sourceId, novelId,
          chapterId: unit.id,
          unitKind: unit.kind,
          chapterIndex: unit.index,
          chapterTitle: unit.title,
          sourceContent: unit.content,
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

        const label = unit.kind === 'meta' ? '元数据'
          : unit.kind === 'volume' ? `卷「${unit.title}」`
          : `第 ${unit.index} 章「${unit.title}」`;
        console.log(`[translation] 调用 LLM 翻译 ${label}...`);

        // 更新段落进度
        const estParagraphs = unit.content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0).length;
        progressChapterTitle = unit.title;
        progressChapterEstParagraphs = estParagraphs;
        this.#repository.saveTranslationBuild({
          sourceId, novelId, status: 'running', stage: 'translating',
          progressPercent: totalUnitCount > 0 ? Math.round(((completedUnits + failed) / totalUnitCount) * 100) : 0,
          message: `正在翻译 ${label}…`,
          errorMessage: null,
          startedAt: new Date(runStartedAt).toISOString(), completedAt: null,
          modelStatsJson: JSON.stringify({ runStartedAt }),
          translatedChapters: translated, reviewedChapters: 0, failedChapters: failed,
          glossaryVersion, profileVersion,
          currentChapterTitle: unit.title,
          currentChapterParagraphs: estParagraphs,
          currentChapterTranslatedParagraphs: 0,
          totalTranslatedParagraphs: totalParagraphsDone,
          totalParagraphEstimate,
        });

        await pipeline.invoke(state);

        const saved = this.#repository.getChapterTranslation(sourceId, novelId, unit.id, sourceLang, targetLang);
        if (saved && saved.status === 'completed') {
          if (unit.kind === 'chapter') {
            // 验证翻译是否真实发生
            const paragraphs = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, unit.id);
            const hasRealTranslation = paragraphs.length > 0 && paragraphs.some(
              (p) => p.translatedText && p.translatedText !== p.sourceText,
            );
            if (hasRealTranslation) {
              unitOk = true;
              console.log(`[translation] ✅ ${label}完成 (${paragraphs.length} 段)`);
            } else {
              console.log(`[translation] ⚠️ ${label}翻译未生效`);
              try {
                this.#repository.saveChapterTranslation({
                  sourceId, novelId, chapterId: unit.id, sourceLang, targetLang,
                  status: 'failed' as TranslationChapterStatus,
                  sourceContentHash: contentHash,
                  glossaryVersion, profileVersion,
                });
              } catch { /* ignore */ }
            }
          } else {
            // meta / volume 单元：仅需确认 translatedTitle 非空
            unitOk = true;
            console.log(`[translation] ✅ ${label}完成`);
          }
        } else {
          console.log(`[translation] ⚠️ ${label}状态: ${saved?.status ?? 'unknown'}`);
          try {
            this.#repository.saveChapterTranslation({
              sourceId, novelId, chapterId: unit.id, sourceLang, targetLang,
              status: 'failed' as TranslationChapterStatus,
              sourceContentHash: contentHash,
              glossaryVersion, profileVersion,
            });
          } catch { /* ignore */ }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const label = unit.kind === 'meta' ? '元数据'
          : unit.kind === 'volume' ? `卷「${unit.title}」`
          : `第 ${unit.index} 章「${unit.title}」`;
        console.error(`[translation] ❌ ${label}失败:`, errMsg);
      }

      if (unitOk) {
        translated++;
        completedUnits++;
      } else {
        failed++;
      }

      // 段落计数（仅 chapter 单元有段落）
      let unitParagraphs = 0;
      try {
        if (unit.kind === 'chapter') {
          const paras = this.#repository.listChapterTranslationParagraphs(sourceId, novelId, unit.id);
          unitParagraphs = paras.length;
        }
        totalParagraphsDone += unitParagraphs;
      } catch { /* ignore */ }

      const total = translated + failed;
      this.#repository.saveTranslationBuild({
        sourceId, novelId,
        status: 'running',
        stage: 'translating',
        progressPercent: totalUnitCount > 0 ? Math.round((total / totalUnitCount) * 100) : 0,
        message: `已译 ${translated}/${totalUnitCount} 单元 (${unitParagraphs}段)`,
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
        currentChapterTitle: unit.title,
        currentChapterParagraphs: unitParagraphs,
        currentChapterTranslatedParagraphs: unitParagraphs,
        totalTranslatedParagraphs: totalParagraphsDone,
        totalParagraphEstimate,
      });

      this.#repository.appendTranslationBuildLog({
        sourceId, novelId,
        stage: 'translating',
        level: unitOk ? 'info' : 'warn',
        message: `${unit.kind === 'meta' ? '元数据' : unit.kind === 'volume' ? `卷「${unit.title}」` : `第 ${unit.index} 章「${unit.title}」`}: ${unitOk ? '完成' : '失败'}`,
      });
    }

    console.log(`[translation] 翻译结束: ${translated} 成功 / ${failed} 失败`);

    this.#abortControllers.delete(abortKey);
    this.#repository.saveTranslationBuild({
      sourceId, novelId,
      status: ac.signal.aborted ? 'failed' : 'completed',
      stage: ac.signal.aborted ? 'failed' : 'completed',
      progressPercent: 100,
      message: `翻译完成：${translated} 单元成功，${failed} 单元失败`,
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

    // 翻译完成（非中止）后 bump content_updated_at，触发 OPDS 制品重建
    if (!ac.signal.aborted) {
      this.#repository.bumpNovelContentUpdatedAt(sourceId, novelId);
    }
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
