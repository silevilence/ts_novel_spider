import { createHash } from 'node:crypto';
import { defaultProcessingSettings, processingSettingsSchema, type ProcessingJob, type ProcessingSettings } from '../contracts/library-processing';
import type { SqliteNovelRepository } from './novel-repository';
import type { LibraryTermExtractionService } from './library-term-extraction';
import type { TranslationService } from './translation-service';

export function chapterContentKey(chapter: { title: string; content?: string | null }): string {
  return createHash('sha256').update(JSON.stringify([chapter.title, chapter.content])).digest('hex');
}

/** Durable per-book orchestration. Each tick advances at most one persisted step. */
export class LibraryProcessingService {
  #timer: ReturnType<typeof setInterval> | undefined;
  constructor(readonly repository: SqliteNovelRepository, readonly extraction: LibraryTermExtractionService, readonly translation: TranslationService) {}

  start(): void { this.#timer ??= setInterval(() => this.tick(), 1000); this.#timer.unref(); }
  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = undefined; }
  settings(sourceId: string, novelId: string): ProcessingSettings { return this.repository.getProcessingSettings(sourceId, novelId) ?? { ...defaultProcessingSettings }; }
  configure(sourceId: string, novelId: string, input: unknown): ProcessingSettings {
    const settings = processingSettingsSchema.parse(input); this.repository.saveProcessingSettings(sourceId, novelId, settings); return settings;
  }
  hashes(sourceId: string, novelId: string): Record<string, string> {
    return Object.fromEntries((this.repository.getSnapshot(sourceId, novelId)?.chapters ?? []).filter((chapter) => chapter.content?.trim()).map((chapter) => [chapter.id, chapterContentKey(chapter)]));
  }
  /** Only successfully persisted changes enter the queue; repeated events share a stable ID. */
  enqueue(sourceId: string, novelId: string, origin: ProcessingJob['origin'], before: Record<string, string>, allowedIds?: string[]): boolean {
    const settings = this.settings(sourceId, novelId);
    if (!settings.extractTerms && !settings.translate) return false;
    const chapterHashes = Object.fromEntries(Object.entries(this.hashes(sourceId, novelId)).filter(([id, hash]) => before[id] !== hash && (!allowedIds || allowedIds.includes(id))));
    if (!Object.keys(chapterHashes).length) return true;
    const id = createHash('sha256').update(JSON.stringify([sourceId, novelId, Object.entries(chapterHashes).sort(), settings, this.languageKey(sourceId, novelId)])).digest('hex');
    if (this.repository.listProcessingJobs(sourceId, novelId).some((job) => job.id === id)) return true;
    const now = new Date().toISOString();
    this.repository.saveProcessingJob({ id, sourceId, novelId, origin, chapterHashes, settings, languageKey: this.languageKey(sourceId, novelId), status: 'queued', stage: settings.extractTerms ? 'extraction' : 'translation', message: '等待处理', createdAt: now, updatedAt: now, candidateIds: [], extractionRunId: null, termRunId: null, translationStartedAt: null });
    return true;
  }
  control(sourceId: string, novelId: string, id: string, action: 'pause' | 'resume' | 'cancel'): ProcessingJob {
    const job = this.repository.listProcessingJobs(sourceId, novelId).find((item) => item.id === id);
    if (!job) throw new Error('后处理任务不存在。');
    if (job.status === 'completed') throw new Error('任务已经完成。');
    if (action !== 'resume') {
      this.#cancelChildren(job);
      job.status = action === 'pause' ? 'paused' : 'cancelled';
      job.message = action === 'pause' ? '已暂停，保留完成结果' : '已取消，保留完成结果';
    } else {
      if (job.status === 'cancelled') throw new Error('已取消任务不可继续，请发起新的处理。');
      if (!this.current(job)) throw new Error('目标原文已变化，请从章节入口处理最新版本。');
      job.status = 'queued'; job.message = '等待继续'; job.retryRequested = true;
      // Keep IDs until their terminal result is inspected, preserving newly added candidates.
    }
    this.save(job); return job;
  }
  #cancelChildren(job: ProcessingJob): void {
    const { sourceId, novelId } = job;
    if (this.extraction.getRun(sourceId, novelId)?.id === job.extractionRunId) this.extraction.cancel(sourceId, novelId);
    if (this.translation.getTermTranslation(sourceId, novelId)?.id === job.termRunId) this.translation.cancelTermTranslation(sourceId, novelId);
    if (job.translationStartedAt && this.translation.getTranslationBuild(sourceId, novelId)?.startedAt === job.translationStartedAt && this.translation.isRunning(sourceId, novelId)) this.translation.cancelTranslation(sourceId, novelId);
  }
  private save(job: ProcessingJob): void { job.updatedAt = new Date().toISOString(); this.repository.saveProcessingJob(job); }
  private languageKey(sourceId: string, novelId: string): string { const profile = this.translation.getTranslationProfile(sourceId, novelId); return JSON.stringify([profile?.sourceLang, profile?.targetLang]); }
  private current(job: ProcessingJob): boolean {
    const hashes = this.hashes(job.sourceId, job.novelId);
    return (!job.languageKey || job.languageKey === this.languageKey(job.sourceId, job.novelId)) && Object.entries(job.chapterHashes).every(([id, hash]) => hashes[id] === hash);
  }
  tick(): void {
    const occupied = new Set<string>();
    for (const job of this.repository.listProcessingJobs()) {
      if (['paused', 'cancelled', 'failed', 'completed'].includes(job.status)) continue;
      const key = `${job.sourceId}/${job.novelId}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      try {
        if (this.repository.getNovelPurgeStatus(job.sourceId, job.novelId)?.deletedAt) { this.#cancelChildren(job); job.status = 'paused'; job.message = '小说已在回收站'; }
        else if (!this.current(job)) { this.#cancelChildren(job); job.status = 'failed'; job.message = '原文或语言已变化，已停止旧任务，请重新处理。'; }
        else this.advance(job);
      } catch (error) { job.status = 'failed'; job.message = error instanceof Error ? error.message : '后处理失败'; }
      this.save(job);
    }
  }
  private advance(job: ProcessingJob): void {
    const { sourceId, novelId } = job;
    const ids = Object.keys(job.chapterHashes);
    job.status = 'waiting';
    if (job.stage === 'extraction') {
      const activeRun = this.extraction.getRun(sourceId, novelId);
      const run = this.repository.getTermExtractionHistory(sourceId, novelId).find((item) => item.id === job.extractionRunId) ?? activeRun;
      if (run?.id === job.extractionRunId) {
        job.candidateIds = [...new Set([...job.candidateIds, ...run.addedTermIds ?? []])];
        if (run.status === 'running') { job.message = '正在提取更新章节术语'; return; }
        if (run.status === 'completed') { job.stage = 'confirmation'; job.extractionRunId = null; return; }
        if (!job.retryRequested && !run.errorMessage?.includes('服务重启')) throw new Error(run.errorMessage ?? '术语提取已取消，请继续');
      }
      if (activeRun?.status === 'running' || this.translation.isRunning(sourceId, novelId)) { job.message = '等待本书已有任务完成'; return; }
      const started = this.extraction.start(sourceId, novelId, { chapterIds: ids, incremental: true });
      job.extractionRunId = started.id; job.retryRequested = false; job.status = 'running'; job.message = '正在提取更新章节术语'; return;
    }
    if (job.stage === 'confirmation') {
      if (this.translation.isRunning(sourceId, novelId)) { job.message = '等待本书翻译完成后确认术语'; return; }
      const pending = this.repository.listTranslationTerms(sourceId, novelId, 'pending').filter((term) => job.candidateIds.includes(term.id));
      if (pending.length && job.settings.candidatePolicy === 'manual') { job.message = `等待确认本轮 ${pending.length} 条候选术语`; return; }
      if (pending.length) this.repository.bulkUpdateTranslationTermStatus(sourceId, novelId, pending.map((term) => term.id), 'confirmed');
      if (!job.settings.translate) { job.stage = 'completed'; job.status = 'completed'; job.message = '术语提取与确认已完成'; return; }
      job.stage = 'terms'; return;
    }
    if (job.stage === 'terms') {
      if (this.translation.isRunning(sourceId, novelId)) { job.message = '等待本书翻译完成后翻译术语'; return; }
      const sources = this.repository.listTermChapterSources(sourceId, novelId);
      const chapters = this.repository.getSnapshot(sourceId, novelId)!.chapters.filter((chapter) => ids.includes(chapter.id));
      const missing = this.repository.listMissingTranslationTerms(sourceId, novelId).filter((term) => sources.some((source) => source.termId === term.id && ids.includes(source.chapterId)) || chapters.some((chapter) => `${chapter.title}\n${chapter.content}`.includes(term.sourceTerm)));
      if (!missing.length) { job.stage = 'translation'; job.termRunId = null; return; }
      const run = this.translation.getTermTranslation(sourceId, novelId);
      if (run?.status === 'running') { job.message = '等待术语翻译完成'; return; }
      if (run?.id === job.termRunId && !job.retryRequested && !run.errorMessage?.includes('服务重启')) throw new Error(run.errorMessage ?? '相关术语仍缺译，请重试');
      job.termRunId = this.translation.startTermTranslation(sourceId, novelId, missing.map((term) => term.id)).id;
      job.retryRequested = false;
      job.status = 'running'; job.message = '正在翻译相关缺译术语'; return;
    }
    if (job.stage === 'translation') {
      const build = this.translation.getTranslationBuild(sourceId, novelId);
      if (this.translation.isRunning(sourceId, novelId)) { job.message = '等待本书翻译完成'; return; }
      if (job.translationStartedAt && build?.startedAt === job.translationStartedAt) {
        if (build.status === 'completed') { job.stage = 'completed'; job.status = 'completed'; job.message = '本轮更新译文已准备完成'; return; }
        if (build.status === 'failed' && !job.retryRequested) throw new Error(build.errorMessage ?? '章节翻译失败，请继续');
      }
      try { job.translationStartedAt = this.translation.startTranslation(sourceId, novelId, undefined, false, ids).startedAt; }
      catch (error) { if (error instanceof Error && error.message.includes('无需继续')) { job.stage = 'completed'; job.status = 'completed'; job.message = '目标章节已翻译完成'; return; } throw error; }
      job.retryRequested = false; job.status = 'running'; job.message = '正在翻译更新章节';
    }
  }
}
