import type { TranslationPipelineEvent, TranslationPipelineState } from './translation-state';
import type { TranslationChapterStatus, TranslationBuildStage } from './novel-repository';
import type { SystemPreferencesService } from './system-preferences';

/** 翻译任务进度快照 */
export interface TranslationTaskProgress {
  totalChapters: number;
  queuedChapters: number;
  translatedChapters: number;
  reviewedChapters: number;
  failedChapters: number;
  percent: number;
  currentChapterTitle: string | null;
}

/** 翻译任务状态 */
export type TranslationTaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed';

/** 翻译任务快照 */
export interface TranslationTaskSnapshot {
  taskId: string;
  sourceId: string;
  novelId: string;
  sourceLang: string;
  targetLang: string;
  status: TranslationTaskStatus;
  stage: TranslationBuildStage;
  progress: TranslationTaskProgress;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  glossaryVersion: number;
  profileVersion: number;
  createdAt: string;
}

/** 翻译任务创建输入 */
export interface TranslationTaskInput {
  sourceId: string;
  novelId: string;
  sourceLang: string;
  targetLang: string;
  chapterIds?: string[];
  concurrency?: number;
  glossaryVersion: number;
  profileVersion: number;
}

/** 翻译章节失败记录 */
export interface TranslationChapterFailure {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  errorMessage: string;
  timestamp: string;
}

/**
 * 翻译运行器——编排单本小说的章节级翻译生命周期。
 *
 * 职责：
 * - 章节级并发控制
 * - 异常隔离（单章失败不整体阻断）
 * - 暂停/恢复
 * - 事件发射（供 ControlCenterService -> SSE 消费）
 * - 检查点恢复
 */
export class TranslationRunner {
  readonly #preferences: SystemPreferencesService;
  #paused = false;
  #aborted = false;

  constructor(preferences: SystemPreferencesService) {
    this.#preferences = preferences;
  }

  /** 请求暂停 */
  pause(): void {
    this.#paused = true;
  }

  /** 请求恢复 */
  resume(): void {
    this.#paused = false;
  }

  /** 请求中止 */
  abort(): void {
    this.#aborted = true;
  }

  get isPaused(): boolean {
    return this.#paused;
  }

  /** 计算进度百分比 */
  static calculateProgress(completed: number, failed: number, total: number): number {
    if (total === 0) {
      return 0;
    }

    return Math.round(((completed + failed) / total) * 100);
  }
}

/** 检查是否是可恢复的翻译任务状态 */
export function isResumableTranslationStatus(status: string): status is 'queued' | 'running' {
  return status === 'queued' || status === 'running';
}

/** 检查是否是翻译任务终态 */
export function isTranslationTerminalStatus(status: string): status is 'completed' | 'failed' {
  return status === 'completed' || status === 'failed';
}
