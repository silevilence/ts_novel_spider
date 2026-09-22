import { randomUUID } from 'node:crypto';
import type { SqliteNovelRepository, StoredTermExtractionRun } from './novel-repository';
import type { SystemPreferencesService } from './system-preferences';
import { resolveCapabilityRoute } from './library-intelligence';
import { buildGlossaryExtractionPrompt, buildGlossarySourceWindows, parseGlossaryCandidates, type GlossarySourceChapter } from './glossary-extraction';
import { generateRefinedTranslationText } from './translation/nodes/translate-node';

/** Owns background extraction independently of HTTP requests and translation runs. */
export class LibraryTermExtractionService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #generateText: typeof generateRefinedTranslationText;
  readonly #controllers = new Map<string, AbortController>();

  constructor(
    repository: SqliteNovelRepository,
    preferences: SystemPreferencesService,
    generateText = generateRefinedTranslationText,
  ) {
    this.#repository = repository;
    this.#preferences = preferences;
    this.#generateText = generateText;
  }

  recoverInterruptedRuns(): void {
    this.#repository.recoverTermExtractionRuns();
  }

  getRun(sourceId: string, novelId: string) {
    return this.#repository.getTermExtractionRun(sourceId, novelId);
  }

  start(sourceId: string, novelId: string): StoredTermExtractionRun {
    const previous = this.getRun(sourceId, novelId);
    if (previous?.status === 'running') throw new Error('术语提取正在运行。');
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot || this.#repository.getNovelPurgeStatus(sourceId, novelId)?.deletedAt) throw new Error('小说不存在或已在回收站。');
    const chapters = snapshot.chapters.flatMap((chapter) => chapter.content?.trim()
      ? [{ id: chapter.id, index: chapter.index, title: chapter.title, content: chapter.content }] : []);
    if (!chapters.length) throw new Error('没有已下载的原文可用于提取术语。');
    const local = this.#repository.getTranslationProfile(sourceId, novelId);
    const global = this.#preferences.getTranslationState().config;
    const override = local?.termExtractionModel ?? global.termExtractionModel;
    const route = override?.providerId && override.modelId ? { providerId: override.providerId, modelId: override.modelId } : null;
    const resolved = resolveCapabilityRoute(this.#preferences.getLlmState(), 'chat', route, this.#preferences.getModelGateway());
    if (!resolved || (override && (!route || resolved.source !== 'novel')) || !resolved.provider.isConfigured || !resolved.model.isConfigured || !resolved.model.resolvedCapabilities.includes('chat')) {
      throw new Error('术语提取模型不可用，请检查单本配置、全局翻译偏好或默认对话模型。');
    }
    const windows = buildGlossarySourceWindows(chapters);
    const now = new Date().toISOString();
    const run: StoredTermExtractionRun = { id: randomUUID(), sourceId, novelId, status: 'running', totalBatches: windows.length, completedBatches: 0, candidates: 0, added: 0, startedAt: now, updatedAt: now, errorMessage: null };
    this.#repository.saveTermExtractionRun(run);
    const controller = new AbortController();
    this.#controllers.set(run.id, controller);
    void this.#execute(run, windows, chapters, local?.sourceLang ?? global.sourceLang,
      { providerId: resolved.provider.id, modelId: resolved.model.modelId }, controller);
    return run;
  }

  cancel(sourceId: string, novelId: string): StoredTermExtractionRun | null {
    const run = this.getRun(sourceId, novelId);
    if (!run || run.status !== 'running') return run;
    this.#controllers.get(run.id)?.abort();
    const cancelled = { ...run, status: 'cancelled' as const, updatedAt: new Date().toISOString() };
    this.#repository.saveTermExtractionRun(cancelled);
    return cancelled;
  }

  async #execute(run: StoredTermExtractionRun, windows: ReturnType<typeof buildGlossarySourceWindows>, chapters: GlossarySourceChapter[], sourceLang: string, route: { providerId: string; modelId: string }, controller: AbortController) {
    try {
      for (const window of windows) {
        controller.signal.throwIfAborted();
        const response = await this.#generateText(this.#preferences, route, buildGlossaryExtractionPrompt(sourceLang), window.source, controller.signal);
        controller.signal.throwIfAborted();
        if (this.#repository.getNovelPurgeStatus(run.sourceId, run.novelId)?.deletedAt) throw new Error('小说已移入回收站，提取已停止。');
        // A malformed model response is a failed batch, never a successful empty scan.
        const payload = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { terms?: unknown };
        if (!Array.isArray(payload.terms)) throw new Error('提取模型未返回有效的 terms 数组。');
        const terms = parseGlossaryCandidates(response).map((candidate) => ({
          sourceTerm: candidate.sourceTerm, entityType: candidate.entityType, priority: candidate.priority,
          note: candidate.suggestion, status: 'pending' as const,
          extractedFromChapterId: chapters.find((chapter) => window.chapterIds.includes(chapter.id) && `${chapter.title}\n${chapter.content}`.includes(candidate.sourceTerm))?.id ?? window.chapterIds[0] ?? null,
        }));
        run = this.#repository.saveTermExtractionBatch(run, terms);
      }
      this.#repository.saveTermExtractionRun({ ...run, status: 'completed', updatedAt: new Date().toISOString() });
    } catch (error) {
      // Cancelled requests may finish late; they must never overwrite a subsequent run.
      if (!controller.signal.aborted && this.getRun(run.sourceId, run.novelId)?.id === run.id) {
        this.#repository.saveTermExtractionRun({ ...run, status: 'failed', errorMessage: error instanceof Error ? error.message : '术语提取失败。', updatedAt: new Date().toISOString() });
      }
    } finally {
      this.#controllers.delete(run.id);
    }
  }
}
