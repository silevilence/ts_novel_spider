import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import CronExpressionParser from 'cron-parser';

import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService, type OpdsConfig } from './system-preferences';
import { SpiderLogDispatcher } from './logging';
import { LocalExportEngine, type LibraryExportTranslationMode, type TranslatedParagraph } from './export-engine';
import type { StoredNovelSnapshot } from './spider';

export interface OpdsCompilationServiceDependencies {
  repository: SqliteNovelRepository;
  preferences: SystemPreferencesService;
  exportEngine: LocalExportEngine;
  logger: SpiderLogDispatcher;
  /** OPDS 制品根目录，默认 data/opds-artifacts */
  artifactsRoot?: string;
}

const TICK_INTERVAL_MS = 60_000;

const OPDS_ARTIFACT_VERSIONS: Array<{ mode: LibraryExportTranslationMode; fileName: string }> = [
  { mode: 'original', fileName: 'original.epub' },
  { mode: 'translated', fileName: 'translated.epub' },
  { mode: 'bilingual', fileName: 'bilingual.epub' },
];

export class OpdsCompilationService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #exportEngine: LocalExportEngine;
  readonly #logger: SpiderLogDispatcher;
  readonly #artifactsRoot: string;

  #timer: ReturnType<typeof setInterval> | null = null;
  #nextTickAt: number | null = null;
  #running = false;

  constructor(deps: OpdsCompilationServiceDependencies) {
    this.#repository = deps.repository;
    this.#preferences = deps.preferences;
    this.#exportEngine = deps.exportEngine;
    this.#logger = deps.logger;
    this.#artifactsRoot = deps.artifactsRoot ?? path.resolve(process.cwd(), 'data', 'opds-artifacts');
  }

  /** 服务启动时调用 */
  start(): void {
    this.#repository.recoverIncompleteOpdsCompilationRuns();
    const config = this.#preferences.getOpds();

    if (!config.enabled) {
      void this.#logger.dispatch({
        type: 'opds_compilation_idle',
        level: 'info',
        message: 'OPDS 制品调度已禁用，调度器空闲。',
        context: { sourceId: 'opds-compiler', novelId: '-', runId: '-' },
        payload: {},
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.scheduleNextTick(config);
    this.#timer = setInterval(() => void this.#tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  reload(): void {
    const config = this.#preferences.getOpds();
    this.stop();
    if (config.enabled) {
      this.scheduleNextTick(config);
      this.#timer = setInterval(() => void this.#tick(), TICK_INTERVAL_MS);
    }
  }

  scheduleNextTick(config: OpdsConfig): void {
    this.#nextTickAt = calculateOpdsNextTriggerTime(config);
  }

  #tick(): void {
    if (this.#running) return;
    if (this.#nextTickAt === null) return;
    if (Date.now() < this.#nextTickAt) return;

    const config = this.#preferences.getOpds();
    if (!config.enabled) return;

    this.#running = true;
    void this.#runScanAll()
      .finally(() => {
        this.#running = false;
        this.scheduleNextTick(config);
      });
  }

  /** 单轮扫描（暴露给测试使用） */
  async runScanAllForTest(): Promise<void> {
    return this.#runScanAll();
  }

  async #runScanAll(): Promise<void> {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    this.#repository.createOpdsCompilationRun(runId, startedAt);

    await this.#logger.dispatch({
      type: 'opds_compilation_round_started',
      level: 'info',
      message: 'OPDS 制品扫描轮次开始。',
      context: { sourceId: 'opds-compiler', novelId: '-', runId },
      payload: {},
      timestamp: startedAt,
    });

    let totalScanned = 0;
    let compiled = 0;
    let skipped = 0;
    let errored = 0;

    const visibleNovels = this.#repository.listVisibleOpdsNovels();

    for (const novel of visibleNovels) {
      totalScanned++;
      try {
        const shouldCompile = novel.epubCompiledAt === null
          || (novel.contentUpdatedAt !== null && novel.contentUpdatedAt > novel.epubCompiledAt);

        if (!shouldCompile) {
          skipped++;
          continue;
        }

        await this.#compileNovel(novel.sourceId, novel.novelId, runId);
        compiled++;
      } catch (error) {
        errored++;
        const message = error instanceof Error ? error.message : String(error);
        await this.#logger.dispatch({
          type: 'opds_compilation_novel_error',
          level: 'error',
          message: `OPDS 制品生成失败 ${novel.sourceId}/${novel.novelId}: ${message}`,
          context: { sourceId: novel.sourceId, novelId: novel.novelId, runId },
          payload: { error: message },
          timestamp: new Date().toISOString(),
        });
      }
    }

    const completedAt = new Date().toISOString();
    this.#repository.completeOpdsCompilationRun(
      runId, completedAt, totalScanned, compiled, skipped, errored,
    );

    await this.#logger.dispatch({
      type: 'opds_compilation_round_completed',
      level: 'info',
      message: `OPDS 制品扫描轮次完成：扫描 ${totalScanned} 本，生成 ${compiled} 本，跳过 ${skipped} 本，出错 ${errored} 本。`,
      context: { sourceId: 'opds-compiler', novelId: '-', runId },
      payload: { totalScanned, compiled, skipped, errored },
      timestamp: completedAt,
    });
  }

  async #compileNovel(sourceId: string, novelId: string, runId: string): Promise<void> {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) {
      throw new Error(`Library novel ${sourceId}/${novelId} was not found.`);
    }

    const hasTranslation = this.#repository.novelHasCompletedTranslation(sourceId, novelId);
    const versions = hasTranslation
      ? OPDS_ARTIFACT_VERSIONS
      : OPDS_ARTIFACT_VERSIONS.filter((v) => v.mode === 'original');

    const novelDir = path.join(this.#artifactsRoot, sourceId, novelId);
    fs.mkdirSync(novelDir, { recursive: true });

    for (const version of versions) {
      await this.#generateVersion(snapshot, version.mode, path.join(novelDir, version.fileName), runId);
    }

    this.#repository.updateNovelEpubCompiledAt(sourceId, novelId, new Date().toISOString());

    await this.#logger.dispatch({
      type: 'opds_compilation_novel_compiled',
      level: 'info',
      message: `OPDS 制品生成完成 ${sourceId}/${novelId}：${versions.length} 个版本`,
      context: { sourceId, novelId, runId },
      payload: { versions: versions.map((v) => v.mode) },
      timestamp: new Date().toISOString(),
    });
  }

  async #generateVersion(
    snapshot: StoredNovelSnapshot,
    mode: LibraryExportTranslationMode,
    outputPath: string,
    runId: string,
  ): Promise<void> {
    const sourceId = snapshot.sourceId;
    const novelId = snapshot.metadata.novelId;

    if (mode === 'original') {
      const result = await this.#exportEngine.generate(snapshot, 'epub');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(result.filePath, outputPath);
      return;
    }

    // translated / bilingual：需要翻译数据
    const translationPrefs = this.#preferences.getTranslationState().config;
    const sourceLang = translationPrefs.sourceLang;
    const targetLang = translationPrefs.targetLang;

    const translatedParagraphsByChapterId = new Map<string, TranslatedParagraph[]>();
    const translatedVolumeTitles = new Map<string, string>();
    const translatedChapterTitles = new Map<string, string>();

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

    for (const chapter of snapshot.chapters) {
      const translation = this.#repository.getChapterTranslation(sourceId, novelId, chapter.id, sourceLang, targetLang);
      if (translation && translation.translatedTitle) {
        translatedChapterTitles.set(chapter.id, translation.translatedTitle);
      }
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

    const result = await this.#exportEngine.generate(snapshot, 'epub', {
      mode,
      translatedParagraphsByChapterId,
      translatedNovelTitle,
      translatedDescriptionParagraphs,
      translatedVolumeTitles,
      translatedChapterTitles,
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(result.filePath, outputPath);
  }
}

export function calculateOpdsNextTriggerTime(config: OpdsConfig): number {
  const now = Date.now();
  try {
    const interval = CronExpressionParser.parse(config.scanCronExpression, { currentDate: new Date(now) });
    return interval.next().getTime();
  } catch {
    return now + 24 * 3600 * 1000;
  }
}
