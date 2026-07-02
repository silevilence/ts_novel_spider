import crypto from 'node:crypto';
import CronExpressionParser from 'cron-parser';

import {
  SqliteNovelRepository,
  type StoredScheduledNovelRow,
} from './novel-repository';
import {
  SystemPreferencesService,
  type SchedulingConfig,
} from './system-preferences';
import { SpiderLogDispatcher } from './logging';
import { SpiderRunner } from './spider-runner';
import type { ChapterIndexEntry, StoredChapterRecord } from './spider';
import type { ControlCenterService, SpiderRegistryEntry } from './control-center';
import type { AutoTranslationReadiness, TranslationBuild } from './translation-service';
import type { AutoSummaryReadiness, SchedulingSummaryResult } from './scheduling-summary';

export interface SchedulingTranslationCoordinator {
  getAutoTranslationReadiness(sourceId: string, novelId: string): AutoTranslationReadiness;
  startTranslation(sourceId: string, novelId: string, modelOverride?: string, fromScratch?: boolean): TranslationBuild;
}

export interface SchedulingSummaryCoordinator {
  getAutoSummaryReadiness(novel: StoredScheduledNovelRow): AutoSummaryReadiness;
  summarizeNewChapters(input: {
    sourceId: string;
    novelId: string;
    novel: StoredScheduledNovelRow;
    chapters: StoredChapterRecord[];
  }): Promise<SchedulingSummaryResult>;
}

export interface SchedulingServiceDependencies {
  repository: SqliteNovelRepository;
  preferences: SystemPreferencesService;
  spiderRegistry: SpiderRegistryEntry[];
  controlCenter: ControlCenterService;
  logger: SpiderLogDispatcher;
  translation: SchedulingTranslationCoordinator;
  summary: SchedulingSummaryCoordinator;
}

const TICK_INTERVAL_MS = 60_000; // 每分钟 tick 一次

export class SchedulingService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #spiderRegistry: Map<string, SpiderRegistryEntry>;
  readonly #controlCenter: ControlCenterService;
  readonly #logger: SpiderLogDispatcher;
  readonly #translation: SchedulingTranslationCoordinator;
  readonly #summary: SchedulingSummaryCoordinator;

  #timer: ReturnType<typeof setInterval> | null = null;
  #nextTickAt: number | null = null;
  #running = false;

  constructor(deps: SchedulingServiceDependencies) {
    this.#repository = deps.repository;
    this.#preferences = deps.preferences;
    this.#spiderRegistry = new Map(
      deps.spiderRegistry.map((entry) => [entry.descriptor.sourceId, entry]),
    );
    this.#controlCenter = deps.controlCenter;
    this.#logger = deps.logger;
    this.#translation = deps.translation;
    this.#summary = deps.summary;
  }

  /** 服务启动时调用：恢复状态并启动定时器 */
  start(): void {
    this.#repository.recoverIncompleteCheckRuns();
    const config = this.#preferences.getScheduling();

    if (!config.enabled) {
      void this.#logger.dispatch({
        type: 'scheduling_round_started',
        level: 'info',
        message: '定时更新已禁用，调度器空闲。',
        context: { sourceId: 'scheduler', novelId: '-', runId: '-' },
        payload: {},
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.scheduleNextTick(config);
    this.#timer = setInterval(() => void this.#tick(), TICK_INTERVAL_MS);
  }

  /** 停止调度器 */
  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** 重新加载策略（配置变更时调用） */
  reload(): void {
    const config = this.#preferences.getScheduling();
    this.stop();
    if (config.enabled) {
      this.scheduleNextTick(config);
      this.#timer = setInterval(() => void this.#tick(), TICK_INTERVAL_MS);
    }
  }

  /** 每分钟 tick：检查是否到触发时间 */
  #tick(): void {
    if (this.#running) return;
    if (this.#nextTickAt === null) return;
    if (Date.now() < this.#nextTickAt) return;

    const config = this.#preferences.getScheduling();
    if (!config.enabled) return;

    this.#running = true;
    this.#runCheckAll(config)
      .finally(() => {
        this.#running = false;
        this.scheduleNextTick(config);
      });
  }

  /** 计算并设置下次触发时间 */
  scheduleNextTick(config: SchedulingConfig): void {
    this.#nextTickAt = calculateNextTriggerTime(config);
  }

  /** 执行一轮完整检查 */
  async #runCheckAll(config: SchedulingConfig): Promise<void> {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    this.#repository.createScheduledCheckRun(runId, startedAt);

    await this.#logger.dispatch({
      type: 'scheduling_round_started',
      level: 'info',
      message: '定时更新轮次开始。',
      context: { sourceId: 'scheduler', novelId: '-', runId },
      payload: { mode: config.mode },
      timestamp: startedAt,
    });

    let totalChecked = 0;
    let newChaptersFound = 0;
    let skipped = 0;
    let errored = 0;

    const enabledNovels = this.#repository.getEnabledScheduledNovels();
    const activeNovelKeys = this.#controlCenter.getActiveTaskNovelKeys();
    const activeKeySet = new Set(activeNovelKeys.map((k) => `${k.sourceId}:${k.novelId}`));

    for (const novel of enabledNovels) {
      const novelKey = `${novel.sourceId}:${novel.novelId}`;

      // 跳过活跃任务
      if (activeKeySet.has(novelKey)) {
        skipped++;
        await this.#logger.dispatch({
          type: 'scheduling_novel_skipped',
          level: 'info',
          message: `跳过 ${novel.sourceId}/${novel.novelId}：有活跃任务。`,
          context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
          payload: {},
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      try {
        await this.#checkSingleNovel(novel, runId);
        totalChecked++;
        const updated = this.#repository.getScheduledNovel(novel.sourceId, novel.novelId);
        if (updated?.lastCheckResult === 'new_chapters') {
          newChaptersFound++;
        }
      } catch (error) {
        errored++;
        const message = error instanceof Error ? error.message : String(error);
        this.#repository.updateScheduledNovelCheckResult(
          novel.sourceId, novel.novelId, 'error', message,
        );
        await this.#logger.dispatch({
          type: 'scheduling_novel_error',
          level: 'error',
          message: `检查失败 ${novel.sourceId}/${novel.novelId}: ${message}`,
          context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
          payload: { error: message },
          timestamp: new Date().toISOString(),
        });
      }
    }

    const completedAt = new Date().toISOString();
    this.#repository.completeScheduledCheckRun(
      runId, completedAt, totalChecked, newChaptersFound, skipped, errored,
    );

    await this.#logger.dispatch({
      type: 'scheduling_round_completed',
      level: 'info',
      message: `定时更新轮次完成：检查 ${totalChecked} 本，发现 ${newChaptersFound} 本更新，跳过 ${skipped} 本，出错 ${errored} 本。`,
      context: { sourceId: 'scheduler', novelId: '-', runId },
      payload: { totalChecked, newChaptersFound, skipped, errored },
      timestamp: completedAt,
    });
  }

  /** 检查单本书：拉目录 → 差分 → 触发下载 */
  async #checkSingleNovel(
    novel: StoredScheduledNovelRow,
    runId: string,
  ): Promise<void> {
    await this.#logger.dispatch({
      type: 'scheduling_novel_checking',
      level: 'info',
      message: `检查 ${novel.sourceId}/${novel.novelId}`,
      context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
      payload: {},
      timestamp: new Date().toISOString(),
    });

    const entry = this.#spiderRegistry.get(novel.sourceId);
    if (!entry) {
      throw new Error(`未找到数据源 ${novel.sourceId}`);
    }

    const spider = entry.spider;

    // 拉远端目录
    const metadata = await spider.fetchMetadata({ novelId: novel.novelId });
    const remoteIndex = await spider.fetchChapterIndex({ novelId: novel.novelId }, metadata);

    // 取本地快照
    const localChapters = this.#repository.getChapterIndex(novel.sourceId, novel.novelId);
    const localIdSet = new Set(localChapters.map((c) => c.id));

    // 找新章节
    const newChapters = remoteIndex.filter((c: ChapterIndexEntry) => !localIdSet.has(c.id));

    if (newChapters.length === 0) {
      this.#repository.updateScheduledNovelCheckResult(
        novel.sourceId, novel.novelId, 'up_to_date', '已是最新',
      );
      await this.#logger.dispatch({
        type: 'scheduling_novel_checked',
        level: 'info',
        message: `${novel.sourceId}/${novel.novelId}：已是最新`,
        context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
        payload: { newChapterCount: 0 },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 有新增：触发增量下载
    const newChapterIds = newChapters.map((c: ChapterIndexEntry) => c.id);
    this.#repository.updateScheduledNovelCheckResult(
      novel.sourceId, novel.novelId, 'new_chapters',
      `发现 ${newChapters.length} 个新章节`,
    );

    await this.#logger.dispatch({
      type: 'scheduling_novel_checked',
      level: 'info',
      message: `${novel.sourceId}/${novel.novelId}：发现 ${newChapters.length} 个新章节`,
      context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
      payload: { newChapterCount: newChapters.length },
      timestamp: new Date().toISOString(),
    });

    // 使用 SpiderRunner 增量下载
    const runner = new SpiderRunner({
      spider,
      repository: this.#repository,
      logger: this.#logger,
    });

    await this.#logger.dispatch({
      type: 'scheduling_download_triggered',
      level: 'info',
      message: `触发增量下载 ${novel.sourceId}/${novel.novelId}：${newChapters.length} 章`,
      context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
      payload: { chapterCount: newChapters.length },
      timestamp: new Date().toISOString(),
    });

    await runner.crawlNovel({
      novelId: novel.novelId,
      chapterIds: newChapterIds,
      forceRefetch: false,
    });

    const downloadedNewChapters = newChapterIds
      .map((chapterId) => this.#repository.getChapter(novel.sourceId, novel.novelId, chapterId))
      .filter((chapter): chapter is StoredChapterRecord => Boolean(chapter && chapter.status === 'downloaded' && chapter.content));

    if (novel.autoSummarize) {
      const readiness = this.#summary.getAutoSummaryReadiness(novel);
      if (!readiness.ready) {
        await this.#logger.dispatch({
          type: 'scheduling_novel_skipped',
          level: 'warn',
          message: `跳过更新总结 ${novel.sourceId}/${novel.novelId}：${readiness.reason ?? '条件未满足。'}`,
          context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
          payload: { phase: 'auto_summary', reason: readiness.reason ?? null },
          timestamp: new Date().toISOString(),
        });
      } else if (downloadedNewChapters.length === 0) {
        await this.#logger.dispatch({
          type: 'scheduling_novel_skipped',
          level: 'warn',
          message: `跳过更新总结 ${novel.sourceId}/${novel.novelId}：没有可用的新章节正文。`,
          context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
          payload: { phase: 'auto_summary', chapterCount: 0 },
          timestamp: new Date().toISOString(),
        });
      } else {
        try {
          const summaryResult = await this.#summary.summarizeNewChapters({
            sourceId: novel.sourceId,
            novelId: novel.novelId,
            novel,
            chapters: downloadedNewChapters,
          });
          this.#repository.createScheduledSummary({
            runId,
            sourceId: novel.sourceId,
            novelId: novel.novelId,
            chapterIds: downloadedNewChapters.map((chapter) => chapter.id),
            summary: summaryResult.summary,
            providerId: summaryResult.providerId,
            modelId: summaryResult.modelId,
          });
          await this.#logger.dispatch({
            type: 'scheduling_novel_checked',
            level: 'info',
            message: `已生成更新总结 ${novel.sourceId}/${novel.novelId}`,
            context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
            payload: {
              phase: 'auto_summary',
              chapterCount: downloadedNewChapters.length,
              modelId: summaryResult.modelId,
            },
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.#logger.dispatch({
            type: 'scheduling_novel_error',
            level: 'warn',
            message: `更新总结生成失败 ${novel.sourceId}/${novel.novelId}：${message}`,
            context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
            payload: { phase: 'auto_summary', error: message },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    if (!novel.autoTranslate) {
      return;
    }

    const readiness = this.#translation.getAutoTranslationReadiness(novel.sourceId, novel.novelId);
    if (!readiness.ready) {
      await this.#logger.dispatch({
        type: 'scheduling_novel_skipped',
        level: 'warn',
        message: `跳过自动翻译 ${novel.sourceId}/${novel.novelId}：${readiness.reason ?? '条件未满足。'}`,
        context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
        payload: { phase: 'auto_translate', reason: readiness.reason ?? null },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      this.#translation.startTranslation(novel.sourceId, novel.novelId);
      await this.#logger.dispatch({
        type: 'scheduling_novel_checked',
        level: 'info',
        message: `已自动触发翻译 ${novel.sourceId}/${novel.novelId}`,
        context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
        payload: { phase: 'auto_translate', chapterCount: newChapters.length },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#logger.dispatch({
        type: 'scheduling_novel_error',
        level: 'warn',
        message: `自动翻译启动失败 ${novel.sourceId}/${novel.novelId}：${message}`,
        context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
        payload: { phase: 'auto_translate', error: message },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// ── 工具函数 ──

export function calculateNextTriggerTime(config: SchedulingConfig): number {
  const now = Date.now();

  switch (config.mode) {
    case 'interval': {
      return now + config.intervalHours * 3600 * 1000;
    }

    case 'cron': {
      try {
        const interval = CronExpressionParser.parse(config.cronExpression, { currentDate: new Date(now) });
        return interval.next().getTime();
      } catch {
        // 表达式无效，回退到 24 小时
        return now + 24 * 3600 * 1000;
      }
    }

    case 'weekly': {
      return calculateNextWeeklyTime(config.weeklyDays, config.weeklyTime, now);
    }

    default: {
      return now + 6 * 3600 * 1000;
    }
  }
}

function calculateNextWeeklyTime(days: number[], time: string, from: number): number {
  if (days.length === 0) {
    return from + 7 * 24 * 3600 * 1000;
  }

    const parts = time.split(':');
  const hourStr = parts[0] ?? '00';
  const minuteStr = parts[1] ?? '00';
  const targetHour = parseInt(hourStr, 10);
  const targetMinute = parseInt(minuteStr, 10);

  const current = new Date(from);
  const currentDay = current.getDay();

  const sortedDays = [...days].sort((a, b) => a - b);

  for (let offset = 0; offset <= 7; offset++) {
    const checkDay = (currentDay + offset) % 7;
    if (sortedDays.includes(checkDay)) {
      const target = new Date(from);
      target.setDate(target.getDate() + offset);
      target.setHours(targetHour, targetMinute, 0, 0);

      if (offset === 0 && target.getTime() <= from) {
        continue;
      }

      return target.getTime();
    }
  }

  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(targetHour, targetMinute, 0, 0);
  return fallback.getTime();
}
