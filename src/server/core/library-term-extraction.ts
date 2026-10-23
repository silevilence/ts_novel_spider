import { createHash, randomUUID } from 'node:crypto';
import { splitTextForContext, textRequestFits, modelContextLimit, contextOutputReserve, textContextTokens } from './llm-context-budget';
import type { SqliteNovelRepository, StoredTermExtractionRun } from './novel-repository';
import type { SystemPreferencesService } from './system-preferences';
import { resolveCapabilityRoute } from './library-intelligence';
import { buildGlossaryExtractionPrompt, buildGlossarySourceWindows, parseGlossaryCandidates, type GlossarySourceChapter } from './glossary-extraction';
import { generateRefinedTranslationText } from './translation/nodes/translate-node';
import { LlmInteractionLogger, type LlmInteractionLoggerOptions } from './translation/nodes/llm-logger';
import { classifyTranslationFailure } from './translation/nodes/translation-failure';
import { redactSecrets } from './translation/nodes/redact-secrets';
import { extractionOptionsSchema, selectDownloadedChapters, type ExtractionOptions } from '../contracts/chapter-processing';

const MAX_EXTRACTION_ATTEMPTS = 3;

export function extractionFingerprint(chapter: { title: string; content: string }, sourceLang: string): string {
  return createHash('sha256').update(JSON.stringify([chapter.title, chapter.content, sourceLang])).digest('hex');
}

/** Owns background extraction independently of HTTP requests and translation runs. */
export class LibraryTermExtractionService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #generateText: typeof generateRefinedTranslationText;
  readonly #controllers = new Map<string, AbortController>();
  readonly #loggerOptions: Pick<LlmInteractionLoggerOptions, 'logDir'>;

  constructor(
    repository: SqliteNovelRepository,
    preferences: SystemPreferencesService,
    generateText = generateRefinedTranslationText,
    loggerOptions: Pick<LlmInteractionLoggerOptions, 'logDir'> = {},
  ) {
    this.#repository = repository;
    this.#preferences = preferences;
    this.#generateText = generateText;
    this.#loggerOptions = loggerOptions;
  }

  recoverInterruptedRuns(): void {
    this.#repository.recoverTermExtractionRuns();
  }

  getRun(sourceId: string, novelId: string) {
    return this.#repository.getTermExtractionRun(sourceId, novelId);
  }

  start(sourceId: string, novelId: string, input: ExtractionOptions = {}): StoredTermExtractionRun {
    const options = extractionOptionsSchema.parse(input);
    if (this.getRun(sourceId, novelId)?.status === 'running') throw new Error('术语提取正在运行。');
    const scopeKey = JSON.stringify(options.chapterIds ? [...options.chapterIds].sort() : null);
    const previous = this.#repository.getTermExtractionHistory(sourceId, novelId).find((run) => JSON.stringify(run.chapterIds ? [...run.chapterIds].sort() : null) === scopeKey)
      ?? (scopeKey === 'null' ? this.getRun(sourceId, novelId) : null);
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot || this.#repository.getNovelPurgeStatus(sourceId, novelId)?.deletedAt) throw new Error('小说不存在或已在回收站。');
    let chapters = selectDownloadedChapters(snapshot.chapters, options.chapterIds).flatMap((chapter) => chapter.content?.trim()
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
    const sourceLang = local?.sourceLang ?? global.sourceLang;
    if (options.incremental && !options.fromScratch) chapters = chapters.filter((chapter) => this.#repository.getChapterExtractionFingerprint(sourceId, novelId, chapter.id) !== extractionFingerprint(chapter, sourceLang));
    const windows = buildGlossarySourceWindows(chapters).flatMap((window) => splitTextForContext(window.source,
      (source) => textRequestFits(resolved.model.contextWindowTokens, buildGlossaryExtractionPrompt(sourceLang), source))
      .map((source) => ({ ...window, source })));
    // Model changes are allowed when retrying failures; only changed source invalidates completed work.
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({ sourceLang, windows })).digest('hex');
    const resumable = !options.fromScratch && previous && previous.status !== 'completed' && previous.sourceFingerprint === sourceFingerprint;
    const now = new Date().toISOString();
    const run: StoredTermExtractionRun = {
      id: randomUUID(), sourceId, novelId, status: 'running', totalBatches: windows.length,
      ...(options.chapterIds ? { chapterIds: options.chapterIds } : {}),
      message: resumable ? '继续有效批次检查点。' : previous && !options.fromScratch && previous.sourceFingerprint !== sourceFingerprint ? '原文或分批条件已变化，本次重新提取所选范围。' : '开始提取所选范围。',
      completedBatches: resumable ? previous.completedBatches : 0,
      candidates: resumable ? previous.candidates : 0, added: resumable ? previous.added : 0,
      addedTermIds: resumable ? previous.addedTermIds ?? [] : [],
      sourceFingerprint, completedBatchIndexes: resumable ? [...previous.completedBatchIndexes ?? []] : [],
      failedBatches: [], startedAt: now, updatedAt: now, errorMessage: null,
    };
    this.#repository.saveTermExtractionRun(run);
    const controller = new AbortController();
    this.#controllers.set(run.id, controller);
    const logger = new LlmInteractionLogger({
      ...this.#loggerOptions, enabled: global.enableLlmInteractionLog,
      secrets: [resolved.provider.apiKey],
      context: { operation: 'term_extraction', runId: run.id, sourceId, novelId, totalBatches: windows.length, thinkingEnabled: local?.termExtractionThinkingEnabled ?? false },
    });
    void this.#execute(run, windows, chapters, sourceLang,
      { providerId: resolved.provider.id, modelId: resolved.model.modelId, thinkingEnabled: local?.termExtractionThinkingEnabled ?? false }, controller, logger);
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

  async #execute(run: StoredTermExtractionRun, windows: ReturnType<typeof buildGlossarySourceWindows>, chapters: GlossarySourceChapter[], sourceLang: string, route: { providerId: string; modelId: string; thinkingEnabled: boolean }, controller: AbortController, logger: LlmInteractionLogger) {
    try {
      for (const [index, window] of windows.entries()) {
        if (run.completedBatchIndexes?.includes(index)) continue;
        controller.signal.throwIfAborted();
        let candidates: ReturnType<typeof parseGlossaryCandidates> | undefined;
        let failure = '';
        for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
          const secrets = this.#preferences.getLlmState().providers.filter((provider) => provider.id === route.providerId).map((provider) => provider.apiKey);
          const batchLogger = logger.withSecrets(secrets).withContext({ batchIndex: index + 1, chapterIds: window.chapterIds });
          const contextLimit = modelContextLimit(this.#preferences, route);
          const logParams = {
            provider: route.providerId, model: route.modelId, callId: randomUUID(), attempt, maxAttempts: MAX_EXTRACTION_ATTEMPTS,
            systemPrompt: buildGlossaryExtractionPrompt(sourceLang), userPrompt: window.source,
            phase: attempt === 1 ? 'batch' as const : 'batch_retry' as const,
            ...(contextLimit > 0 ? { contextWindowTokens: contextLimit, estimatedInputTokens: textContextTokens(buildGlossaryExtractionPrompt(sourceLang), window.source), maxOutputTokens: contextOutputReserve(contextLimit) } : {}),
            ...(!route.thinkingEnabled ? { temperature: 0.2 } : {}),
          };
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
          const startedAt = Date.now();
          let responseText = '';
          let receivedResponse = false;
          let finishReason: string | undefined;
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;
          let errorCategory: string | undefined;
          let errorMessage: string | undefined;
          batchLogger.logCall({ ...logParams, event: 'request', response: '', durationMs: 0 });
          try {
            const response = await this.#generateText(this.#preferences, route, logParams.systemPrompt, window.source, signal, (result) => {
              responseText = result.text;
              receivedResponse = true;
              finishReason = result.finishReason;
              inputTokens = result.inputTokens;
              outputTokens = result.outputTokens;
            });
            if (!receivedResponse) responseText = response;
            receivedResponse = true;
            signal.throwIfAborted();
            candidates = parseGlossaryCandidates(response, true);
            break;
          } catch (error) {
            errorCategory = controller.signal.aborted ? 'cancelled' : signal.aborted ? 'timeout'
              : receivedResponse ? (responseText.trim() ? 'format_mismatch' : 'empty_response') : classifyTranslationFailure(error).category;
            errorMessage = redactSecrets(error instanceof Error ? error.message : '术语提取失败。', secrets);
            failure = errorMessage;
            controller.signal.throwIfAborted();
          } finally {
            const responseLog = {
              ...logParams, event: 'response' as const, response: responseText, durationMs: Date.now() - startedAt,
              finishReason, inputTokens, outputTokens,
              ...(errorCategory ? { errorCategory } : {}), ...(errorMessage ? { error: errorMessage } : {}),
            };
            batchLogger.logCall(responseLog);
            if (errorCategory && (attempt === MAX_EXTRACTION_ATTEMPTS || controller.signal.aborted)) {
              batchLogger.logCall({ ...responseLog, event: 'failure', phase: 'final_failure' });
            }
          }
        }
        controller.signal.throwIfAborted();
        if (this.getRun(run.sourceId, run.novelId)?.id !== run.id) return;
        const novelStatus = this.#repository.getNovelPurgeStatus(run.sourceId, run.novelId);
        if (!novelStatus || novelStatus.deletedAt) throw new Error('小说已删除或移入回收站，提取已停止。');
        for (const chapter of chapters) {
          const current = this.#repository.getChapter(run.sourceId, run.novelId, chapter.id);
          if (!current || current.title !== chapter.title || current.content !== chapter.content) throw new Error('原文已变化，请重新提取；旧响应未写入。');
        }
        if (!candidates) {
          run = { ...run, failedBatches: [...run.failedBatches ?? [], { index, errorMessage: failure }], errorMessage: `第 ${index + 1} 批提取失败（已尝试 ${MAX_EXTRACTION_ATTEMPTS} 次）：${failure}`, updatedAt: new Date().toISOString() };
          this.#repository.saveTermExtractionRun(run);
          continue;
        }
        const terms = candidates.map((candidate) => ({
          sourceTerm: candidate.sourceTerm, entityType: candidate.entityType, priority: candidate.priority,
          note: candidate.suggestion, status: 'pending' as const,
          chapterIds: chapters.filter((chapter) => window.chapterIds.includes(chapter.id) && `${chapter.title}\n${chapter.content}`.includes(candidate.sourceTerm)).map((chapter) => chapter.id),
          extractedFromChapterId: chapters.find((chapter) => window.chapterIds.includes(chapter.id) && `${chapter.title}\n${chapter.content}`.includes(candidate.sourceTerm))?.id ?? window.chapterIds[0] ?? null,
        }));
        run = this.#repository.saveTermExtractionBatch({ ...run, completedBatchIndexes: [...run.completedBatchIndexes ?? [], index] }, terms);
        for (const chapter of chapters) {
          const indexes = windows.flatMap((item, batch) => item.chapterIds.includes(chapter.id) ? [batch] : []);
          if (indexes.length && indexes.every((batch) => run.completedBatchIndexes?.includes(batch))) this.#repository.saveChapterExtractionFingerprint(run.sourceId, run.novelId, chapter.id, extractionFingerprint(chapter, sourceLang));
        }
      }
      this.#repository.saveTermExtractionRun({ ...run, status: run.failedBatches?.length ? 'failed' : 'completed', updatedAt: new Date().toISOString() });
    } catch (error) {
      // Cancelled requests may finish late; they must never overwrite a subsequent run.
      if (!controller.signal.aborted && this.getRun(run.sourceId, run.novelId)?.id === run.id) {
        this.#repository.saveTermExtractionRun({ ...run, status: 'failed', errorMessage: error instanceof Error ? error.message : '术语提取失败。', updatedAt: new Date().toISOString() });
      }
    } finally {
      this.#controllers.delete(run.id);
      logger.close();
    }
  }
}
