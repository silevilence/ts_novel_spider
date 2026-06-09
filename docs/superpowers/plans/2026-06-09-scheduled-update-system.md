# 自动化定时更新调度体系 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TS Novel Spider 添加自动化定时更新调度能力——全局配置调度策略，标记参与书籍，按策略自动检查更新并增量下载。

**Architecture:** 服务器进程内 `SchedulingService` 通过 `setInterval` 按策略周期运行，串行检查启用书籍的远端目录差分，有变化委托 `SpiderRunner` 增量下载。全局策略存 `system-preferences.json`，调度状态和审计日志存 SQLite。

**Tech Stack:** Node.js ≥ 20, TypeScript strict, `better-sqlite3`, Express 5, `cron-parser`, React 19 + Mantine v7

**Spec:** `docs/superpowers/specs/2026-06-09-scheduled-update-system-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/server/core/novel-repository.ts` | 修改 | 新增 `scheduled_novels`、`scheduled_check_runs` 表及 CRUD |
| `src/server/core/system-preferences.ts` | 修改 | 新增 `scheduling` 配置段类型、读写、持久化、迁移 |
| `src/server/core/scheduling.ts` | **新增** | `SchedulingService` 核心调度引擎 |
| `src/server/core/scheduling.test.ts` | **新增** | 调度引擎单元测试 |
| `src/server/core/control-center.ts` | 修改 | 透传调度状态 + `getActiveTaskNovelKeys()` |
| `src/server/app.ts` | 修改 | 初始化 `SchedulingService` |
| `src/server/routes/control-center.ts` | 修改 | `GET/PUT /api/control/scheduling` |
| `src/server/routes/library.ts` | 修改 | 单书开关 + 批量管理端点 |
| `src/web/services/api.ts` | 修改 | 新增 scheduling 相关 API 调用 |
| `src/web/components/system-preferences.tsx` | 修改 | 新增"定时更新"Accordion 面板 |
| `src/web/components/library-detail-view.tsx` | 修改 | 新增定时更新 Toggle 控件 |

---

### Task 1: SQLite 数据层 —— 新增表与 CRUD

**Files:**
- Modify: `src/server/core/novel-repository.ts`

#### Step 1: 添加导出类型

在 `novel-repository.ts` 顶部已有的 export 区域，添加调度相关类型：

```ts
export interface StoredScheduledNovelRow {
  sourceId: string;
  novelId: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastCheckResult: 'new_chapters' | 'up_to_date' | 'error' | null;
  lastCheckMessage: string | null;
  updatedAt: string;
}

export interface StoredScheduledCheckRunRow {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalChecked: number;
  newChaptersFound: number;
  skipped: number;
  errored: number;
}
```

#### Step 2: 在 `migrate()` 中添加建表语句

在 `migrate()` 方法的 `this.#database.exec(...)` 调用末尾、`ensureColumnExists` 调用之前，追加：

```sql
CREATE TABLE IF NOT EXISTS scheduled_novels (
  source_id         TEXT NOT NULL,
  novel_id          TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  last_checked_at   TEXT,
  last_check_result TEXT,
  last_check_message TEXT,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (source_id, novel_id),
  FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_check_runs (
  id                 TEXT NOT NULL PRIMARY KEY,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'running',
  total_checked      INTEGER NOT NULL DEFAULT 0,
  new_chapters_found INTEGER NOT NULL DEFAULT 0,
  skipped            INTEGER NOT NULL DEFAULT 0,
  errored            INTEGER NOT NULL DEFAULT 0
);
```

#### Step 3: 添加 CRUD 方法到 `SqliteNovelRepository` 类

在类中添加以下方法（放在 `getChapterIndex` 方法附近）：

```ts
// ── 定时更新: scheduled_novels ──

getScheduledNovels(): StoredScheduledNovelRow[] {
  const rows = this.#database
    .prepare(
      `SELECT source_id, novel_id, enabled, last_checked_at, last_check_result, last_check_message, updated_at
       FROM scheduled_novels
       ORDER BY source_id, novel_id`,
    )
    .all() as Array<{
      source_id: string; novel_id: string; enabled: number;
      last_checked_at: string | null; last_check_result: string | null;
      last_check_message: string | null; updated_at: string;
    }>;

  return rows.map((row) => ({
    sourceId: row.source_id,
    novelId: row.novel_id,
    enabled: row.enabled === 1,
    lastCheckedAt: row.last_checked_at,
    lastCheckResult: row.last_check_result as StoredScheduledNovelRow['lastCheckResult'],
    lastCheckMessage: row.last_check_message,
    updatedAt: row.updated_at,
  }));
}

getEnabledScheduledNovels(): StoredScheduledNovelRow[] {
  return this.getScheduledNovels().filter((row) => row.enabled);
}

getScheduledNovel(sourceId: string, novelId: string): StoredScheduledNovelRow | undefined {
  const row = this.#database
    .prepare(
      `SELECT source_id, novel_id, enabled, last_checked_at, last_check_result, last_check_message, updated_at
       FROM scheduled_novels
       WHERE source_id = ? AND novel_id = ?`,
    )
    .get(sourceId, novelId) as {
      source_id: string; novel_id: string; enabled: number;
      last_checked_at: string | null; last_check_result: string | null;
      last_check_message: string | null; updated_at: string;
    } | undefined;

  if (!row) return undefined;

  return {
    sourceId: row.source_id,
    novelId: row.novel_id,
    enabled: row.enabled === 1,
    lastCheckedAt: row.last_checked_at,
    lastCheckResult: row.last_check_result as StoredScheduledNovelRow['lastCheckResult'],
    lastCheckMessage: row.last_check_message,
    updatedAt: row.updated_at,
  };
}

upsertScheduledNovel(sourceId: string, novelId: string, enabled: boolean): void {
  const now = new Date().toISOString();
  this.#database
    .prepare(
      `INSERT INTO scheduled_novels (source_id, novel_id, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source_id, novel_id) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run(sourceId, novelId, enabled ? 1 : 0, now);
}

updateScheduledNovelCheckResult(
  sourceId: string,
  novelId: string,
  result: StoredScheduledNovelRow['lastCheckResult'],
  message: string,
): void {
  const now = new Date().toISOString();
  this.#database
    .prepare(
      `UPDATE scheduled_novels
       SET last_checked_at = ?, last_check_result = ?, last_check_message = ?, updated_at = ?
       WHERE source_id = ? AND novel_id = ?`,
    )
    .run(now, result, message, now, sourceId, novelId);
}

bulkUpsertScheduledNovels(entries: Array<{ sourceId: string; novelId: string; enabled: boolean }>): void {
  const now = new Date().toISOString();
  const upsert = this.#database.prepare(
    `INSERT INTO scheduled_novels (source_id, novel_id, enabled, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id, novel_id) DO UPDATE SET
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  );

  const transaction = this.#database.transaction(() => {
    for (const entry of entries) {
      upsert.run(entry.sourceId, entry.novelId, entry.enabled ? 1 : 0, now);
    }
  });

  transaction();
}

// ── 定时更新: scheduled_check_runs ──

createScheduledCheckRun(id: string, startedAt: string): void {
  this.#database
    .prepare(
      `INSERT INTO scheduled_check_runs (id, started_at, status)
       VALUES (?, ?, 'running')`,
    )
    .run(id, startedAt);
}

completeScheduledCheckRun(
  id: string,
  completedAt: string,
  totalChecked: number,
  newChaptersFound: number,
  skipped: number,
  errored: number,
): void {
  this.#database
    .prepare(
      `UPDATE scheduled_check_runs
       SET completed_at = ?, status = 'completed',
           total_checked = ?, new_chapters_found = ?, skipped = ?, errored = ?
       WHERE id = ?`,
    )
    .run(completedAt, totalChecked, newChaptersFound, skipped, errored, id);
}

getLatestCompletedCheckRun(): StoredScheduledCheckRunRow | undefined {
  const row = this.#database
    .prepare(
      `SELECT id, started_at, completed_at, status, total_checked, new_chapters_found, skipped, errored
       FROM scheduled_check_runs
       WHERE status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
    )
    .get() as {
      id: string; started_at: string; completed_at: string | null;
      status: string; total_checked: number; new_chapters_found: number;
      skipped: number; errored: number;
    } | undefined;

  if (!row) return undefined;

  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status as 'running' | 'completed',
    totalChecked: row.total_checked,
    newChaptersFound: row.new_chapters_found,
    skipped: row.skipped,
    errored: row.errored,
  };
}

/** 服务启动恢复：将遗留的 running 记录标记为 completed */
recoverIncompleteCheckRuns(): void {
  this.#database
    .prepare(
      `UPDATE scheduled_check_runs
       SET status = 'completed', completed_at = ?
       WHERE status = 'running'`,
    )
    .run(new Date().toISOString());
}
```

#### Step 4: 导出新类型

确保 `StoredScheduledNovelRow` 和 `StoredScheduledCheckRunRow` 在文件顶部 export 区域可被外部引用。

---

### Task 2: 系统偏好 —— scheduling 配置段

**Files:**
- Modify: `src/server/core/system-preferences.ts`

#### Step 1: 添加调度策略类型

在其他偏好类型旁添加：

```ts
// ── 定时更新调度策略 ──

export type SchedulingMode = 'interval' | 'cron' | 'weekly';

export interface SchedulingConfigInput {
  enabled?: boolean;
  mode?: SchedulingMode;
  intervalHours?: number;
  cronExpression?: string;
  weeklyDays?: number[];
  weeklyTime?: string;
}

export interface SchedulingConfig {
  enabled: boolean;
  mode: SchedulingMode;
  intervalHours: number;
  cronExpression: string;
  weeklyDays: number[];
  weeklyTime: string;
  updatedAt: string | null;
}

export const SCHEDULING_DEFAULTS: SchedulingConfig = {
  enabled: false,
  mode: 'interval',
  intervalHours: 6,
  cronExpression: '0 */6 * * *',
  weeklyDays: [1, 3, 5],
  weeklyTime: '08:00',
  updatedAt: null,
};

export function normalizeSchedulingInput(input: SchedulingConfigInput): SchedulingConfig {
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : SCHEDULING_DEFAULTS.enabled,
    mode: input.mode === 'interval' || input.mode === 'cron' || input.mode === 'weekly'
      ? input.mode : SCHEDULING_DEFAULTS.mode,
    intervalHours: typeof input.intervalHours === 'number' && Number.isFinite(input.intervalHours)
      ? Math.max(1, Math.trunc(input.intervalHours)) : SCHEDULING_DEFAULTS.intervalHours,
    cronExpression: typeof input.cronExpression === 'string' && input.cronExpression.trim().length > 0
      ? input.cronExpression.trim() : SCHEDULING_DEFAULTS.cronExpression,
    weeklyDays: Array.isArray(input.weeklyDays)
      ? input.weeklyDays.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
      : SCHEDULING_DEFAULTS.weeklyDays,
    weeklyTime: typeof input.weeklyTime === 'string' && /^\d{2}:\d{2}$/.test(input.weeklyTime)
      ? input.weeklyTime : SCHEDULING_DEFAULTS.weeklyTime,
    updatedAt: null,
  };
}
```

#### Step 2: 在 `PersistedSystemPreferences` 接口中添加字段

```ts
interface PersistedSystemPreferences {
  // ... existing fields ...
  scheduling?: SchedulingConfigInput;
  updatedAt: string | null;
}
```

#### Step 3: 在 `SystemPreferencesService` 类中添加私有字段和方法

在类中添加 `#scheduling` 私有字段：

```ts
#scheduling: SchedulingConfig;
```

在构造函数中初始化：

```ts
this.#scheduling = persisted?.scheduling
  ? normalizeSchedulingInput(persisted.scheduling)
  : { ...SCHEDULING_DEFAULTS };
```

添加 getter/updater：

```ts
getScheduling(): SchedulingConfig {
  return { ...this.#scheduling };
}

updateScheduling(input: SchedulingConfigInput): SchedulingConfig {
  this.#scheduling = normalizeSchedulingInput(input);
  this.#scheduling = { ...this.#scheduling, updatedAt: new Date().toISOString() };
  this.touch();
  persistPreferences(
    this.#storageFilePath, this.#llmProviders, this.#neo4jConfig,
    this.#updatedAt, this.#readerTypography, this.#translation, this.#modelGateway,
    this.#scheduling,
  );
  return this.getScheduling();
}
```

#### Step 4: 更新 `loadPersistedPreferences` 读取 scheduling

在函数中添加 scheduling 解析：

```ts
if (isRecord(parsed.scheduling)) {
  result.scheduling = {
    enabled: typeof parsed.scheduling.enabled === 'boolean' ? parsed.scheduling.enabled : undefined,
    mode: typeof parsed.scheduling.mode === 'string' ? parsed.scheduling.mode as SchedulingMode : undefined,
    intervalHours: typeof parsed.scheduling.intervalHours === 'number' ? parsed.scheduling.intervalHours : undefined,
    cronExpression: typeof parsed.scheduling.cronExpression === 'string' ? parsed.scheduling.cronExpression : undefined,
    weeklyDays: Array.isArray(parsed.scheduling.weeklyDays) ? parsed.scheduling.weeklyDays : undefined,
    weeklyTime: typeof parsed.scheduling.weeklyTime === 'string' ? parsed.scheduling.weeklyTime : undefined,
  };
}
```

#### Step 5: 更新 `persistPreferences` 写入 scheduling

在函数签名中添加 `scheduling?: SchedulingConfig` 参数，在 payload 构建中添加：

```ts
if (scheduling) {
  payload.scheduling = {
    enabled: scheduling.enabled,
    mode: scheduling.mode,
    intervalHours: scheduling.intervalHours,
    cronExpression: scheduling.cronExpression,
    weeklyDays: scheduling.weeklyDays,
    weeklyTime: scheduling.weeklyTime,
    updatedAt: scheduling.updatedAt,
  };
}
```

同步更新所有调用 `persistPreferences` 的地方，添加 `this.#scheduling` 参数。

---

### Task 3: 核心调度引擎 —— SchedulingService

**Files:**
- Create: `src/server/core/scheduling.ts`

```ts
import crypto from 'node:crypto';
import { parseExpression } from 'cron-parser';

import {
  SqliteNovelRepository,
  type StoredScheduledNovelRow,
  type StoredScheduledCheckRunRow,
} from './novel-repository';
import {
  SystemPreferencesService,
  type SchedulingConfig,
  type SchedulingMode,
} from './system-preferences';
import { SpiderLogDispatcher, type SpiderLogContext } from './logging';
import { SpiderRunner } from './spider-runner';
import type { SpiderAdapter, SpiderRegistryEntry } from './spider';
import type { ControlCenterService } from './control-center';

export interface SchedulingServiceDependencies {
  repository: SqliteNovelRepository;
  preferences: SystemPreferencesService;
  spiderRegistry: SpiderRegistryEntry[];
  controlCenter: ControlCenterService;
  logger: SpiderLogDispatcher;
}

const TICK_INTERVAL_MS = 60_000; // 每分钟 tick 一次

export class SchedulingService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #spiderRegistry: Map<string, SpiderRegistryEntry>;
  readonly #controlCenter: ControlCenterService;
  readonly #logger: SpiderLogDispatcher;

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
  }

  /** 服务启动时调用：恢复状态并启动定时器 */
  start(): void {
    this.#repository.recoverIncompleteCheckRuns();
    const config = this.#preferences.getScheduling();

    if (!config.enabled) {
      this.#logger.dispatch({
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
    this.#timer = setInterval(() => this.#tick(), TICK_INTERVAL_MS);
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
    if (!config.enabled) {
      this.stop();
      return;
    }
    this.scheduleNextTick(config);
  }

  /** 每分钟 tick：检查是否到触发时间 */
  #tick(): void {
    if (this.#running) return; // 上一轮还在跑
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
    this.#repository.completeScheduledCheckRun(runId, completedAt, totalChecked, newChaptersFound, skipped, errored);

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
    const newChapters = remoteIndex.filter((c) => !localIdSet.has(c.id));

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
    const newChapterIds = newChapters.map((c) => c.id);
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
  }
}

// ── 工具函数 ──

export function calculateNextTriggerTime(config: SchedulingConfig): number {
  const now = Date.now();

  switch (config.mode) {
    case 'interval':
      return now + config.intervalHours * 3600 * 1000;

    case 'cron': {
      try {
        const interval = parseExpression(config.cronExpression, { currentDate: new Date(now) });
        return interval.next().getTime();
      } catch {
        // 表达式无效，回退到 24 小时
        return now + 24 * 3600 * 1000;
      }
    }

    case 'weekly': {
      return calculateNextWeeklyTime(config.weeklyDays, config.weeklyTime, now);
    }

    default:
      return now + 6 * 3600 * 1000;
  }
}

function calculateNextWeeklyTime(days: number[], time: string, from: number): number {
  if (days.length === 0) {
    return from + 7 * 24 * 3600 * 1000;
  }

  const [hourStr, minuteStr] = time.split(':');
  const targetHour = parseInt(hourStr, 10);
  const targetMinute = parseInt(minuteStr, 10);

  const current = new Date(from);
  const currentDay = current.getDay(); // 0=Sun

  // 排序 days，找下一个匹配
  const sortedDays = [...days].sort((a, b) => a - b);

  for (let offset = 0; offset <= 7; offset++) {
    const checkDay = (currentDay + offset) % 7;
    if (sortedDays.includes(checkDay)) {
      const target = new Date(from);
      target.setDate(target.getDate() + offset);
      target.setHours(targetHour, targetMinute, 0, 0);

      // 如果是今天但时间已过，跳过
      if (offset === 0 && target.getTime() <= from) {
        continue;
      }

      return target.getTime();
    }
  }

  // fallback: 明天同一时刻
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(targetHour, targetMinute, 0, 0);
  return fallback.getTime();
}
```

---

### Task 4: 调度引擎测试

**Files:**
- Create: `src/server/core/scheduling.test.ts`

编写核心逻辑的单元测试，使用 SQLite 内存数据库，不依赖真实网络。

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { calculateNextTriggerTime } from './scheduling';

describe('calculateNextTriggerTime', () => {
  it('interval mode: returns now + intervalHours', () => {
    const now = 1700000000000;
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'interval',
      intervalHours: 6,
      cronExpression: '0 */6 * * *',
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.equal(result, now + 6 * 3600 * 1000);
  });

  it('cron mode: parses valid expression', () => {
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'cron',
      intervalHours: 6,
      cronExpression: '0 8 * * *', // 每天 08:00
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });

  it('cron mode: falls back on invalid expression', () => {
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'cron',
      intervalHours: 6,
      cronExpression: 'invalid',
      weeklyDays: [],
      weeklyTime: '08:00',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });

  it('weekly mode: finds next matching day', () => {
    // 用固定参考时间：2024-01-01 = 周一 (getDay=1)
    const monday = new Date('2024-01-01T10:00:00Z').getTime();
    const result = calculateNextTriggerTime({
      enabled: true,
      mode: 'weekly',
      intervalHours: 6,
      cronExpression: '',
      weeklyDays: [3], // 周三
      weeklyTime: '08:00',
      updatedAt: null,
    });
    const resultDate = new Date(result);
    assert.equal(resultDate.getUTCDay(), 3);
    assert.equal(resultDate.getUTCHours(), 8);
    assert.equal(resultDate.getUTCMinutes(), 0);
  });
});

describe('SqliteNovelRepository - scheduled novels', () => {
  function createTestRepo(): SqliteNovelRepository {
    const db = new Database(':memory:');
    return new SqliteNovelRepository(db);
  }

  it('upsertScheduledNovel creates and updates', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.ok(row);
    assert.equal(row.enabled, true);

    repo.upsertScheduledNovel('syosetu', 'n123', false);
    const updated = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(updated?.enabled, false);
  });

  it('getEnabledScheduledNovels filters correctly', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n1', true);
    repo.upsertScheduledNovel('syosetu', 'n2', false);
    repo.upsertScheduledNovel('syosetu18', 'n3', true);

    const enabled = repo.getEnabledScheduledNovels();
    assert.equal(enabled.length, 2);
  });

  it('updateScheduledNovelCheckResult sets check state', () => {
    const repo = createTestRepo();
    repo.upsertScheduledNovel('syosetu', 'n123', true);
    repo.updateScheduledNovelCheckResult('syosetu', 'n123', 'new_chapters', '发现 3 章');

    const row = repo.getScheduledNovel('syosetu', 'n123');
    assert.equal(row?.lastCheckResult, 'new_chapters');
    assert.equal(row?.lastCheckMessage, '发现 3 章');
    assert.ok(row?.lastCheckedAt);
  });

  it('bulkUpsertScheduledNovels batch updates', () => {
    const repo = createTestRepo();
    repo.bulkUpsertScheduledNovels([
      { sourceId: 'syosetu', novelId: 'n1', enabled: true },
      { sourceId: 'syosetu', novelId: 'n2', enabled: false },
    ]);

    assert.equal(repo.getScheduledNovel('syosetu', 'n1')?.enabled, true);
    assert.equal(repo.getScheduledNovel('syosetu', 'n2')?.enabled, false);
  });
});

describe('SqliteNovelRepository - scheduled check runs', () => {
  function createTestRepo(): SqliteNovelRepository {
    const db = new Database(':memory:');
    return new SqliteNovelRepository(db);
  }

  it('create + complete check run lifecycle', () => {
    const repo = createTestRepo();
    repo.createScheduledCheckRun('run-1', '2024-01-01T00:00:00Z');
    repo.completeScheduledCheckRun('run-1', '2024-01-01T00:05:00Z', 10, 3, 2, 1);

    const latest = repo.getLatestCompletedCheckRun();
    assert.ok(latest);
    assert.equal(latest.id, 'run-1');
    assert.equal(latest.totalChecked, 10);
    assert.equal(latest.newChaptersFound, 3);
    assert.equal(latest.skipped, 2);
    assert.equal(latest.errored, 1);
  });

  it('recoverIncompleteCheckRuns marks running as completed', () => {
    const repo = createTestRepo();
    repo.createScheduledCheckRun('run-1', '2024-01-01T00:00:00Z');
    repo.recoverIncompleteCheckRuns();

    const latest = repo.getLatestCompletedCheckRun();
    assert.ok(latest);
    assert.equal(latest.status, 'completed');
  });
});
```

---

### Task 5: ControlCenterService 集成

**Files:**
- Modify: `src/server/core/control-center.ts`

#### Step 1: 导入 SchedulingService

```ts
import { SchedulingService, type SchedulingServiceDependencies } from './scheduling';
```

#### Step 2: 添加私有字段

在 `ControlCenterService` 类中添加：

```ts
readonly #scheduling: SchedulingService;
```

#### Step 3: 在构造函数中初始化

在构造函数末尾、`restoreTaskHistory()` 调用之后添加：

```ts
this.#scheduling = new SchedulingService({
  repository: this.#repository,
  preferences: this.#systemPreferences,
  spiderRegistry: this.#registry.values(),
  controlCenter: this,
  logger: this.#taskLogDispatcher,
});
this.#scheduling.start();
```

> **注意**：`#taskLogDispatcher` 需要检查是否已存在。如果不存在，需要添加一个 `SpiderLogDispatcher` 实例字段。查看现有代码中日志分发器的用法。

#### Step 4: 添加公开方法

```ts
/** 查询当前活跃任务的 (sourceId, novelId) 列表 */
getActiveTaskNovelKeys(): Array<{ sourceId: string; novelId: string }> {
  const result: Array<{ sourceId: string; novelId: string }> = [];
  for (const task of this.#tasks.values()) {
    if (task.status === 'running' || task.status === 'queued') {
      result.push({ sourceId: task.sourceId, novelId: task.novelId });
    }
  }
  return result;
}

/** 获取调度状态 */
getSchedulingState(): SchedulingConfig {
  return this.#systemPreferences.getScheduling();
}

/** 更新调度策略并重载 */
updateSchedulingState(input: SchedulingConfigInput): SchedulingConfig {
  const result = this.#systemPreferences.updateScheduling(input);
  this.#scheduling.reload();
  return result;
}

// ── 定时更新：单书调度状态（透传给 library 路由） ──

getScheduledNovel(sourceId: string, novelId: string): StoredScheduledNovelRow | undefined {
  return this.#repository.getScheduledNovel(sourceId, novelId);
}

upsertScheduledNovel(sourceId: string, novelId: string, enabled: boolean): void {
  this.#repository.upsertScheduledNovel(sourceId, novelId, enabled);
}

getAllScheduledNovels(): StoredScheduledNovelRow[] {
  return this.#repository.getScheduledNovels();
}

bulkUpsertScheduledNovels(entries: Array<{ sourceId: string; novelId: string; enabled: boolean }>): void {
  this.#repository.bulkUpsertScheduledNovels(entries);
}

/** 列出所有书库书籍（供调度 Modal 使用） */
listLibraryNovelEntries(): Array<{ sourceId: string; novelId: string; title: string }> {
  return this.#repository.listNovels().map((novel) => ({
    sourceId: novel.sourceId,
    novelId: novel.metadata.novelId,
    title: novel.metadata.title,
  }));
}
```

#### Step 5: 添加 `close()` 清理

在 `close()` 方法中添加：

```ts
this.#scheduling.stop();
```

---

### Task 6: API 路由

**Files:**
- Modify: `src/server/routes/control-center.ts`
- Modify: `src/server/routes/library.ts`

#### Step 6a: control-center.ts —— GET/PUT `/scheduling`

导入类型：
```ts
import type { SchedulingConfig, SchedulingConfigInput } from '../core/system-preferences';
```

添加路由（在 `router.get('/preferences/translation', ...)` 之后）：

```ts
router.get('/scheduling', (_request, response) => {
  response.json(service.getSchedulingState());
});

router.put('/scheduling', (request, response) => {
  try {
    const body = (request.body ?? {}) as SchedulingConfigInput;
    response.json(service.updateSchedulingState(body));
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Invalid scheduling request.',
    });
  }
});
```

#### Step 6b: library.ts —— 单书开关 + 批量管理

导入类型：
```ts
import type { StoredScheduledNovelRow } from '../core/novel-repository';
```

在 library router 中添加（可放在 aliases 端点附近）：

```ts
// 单书定时更新状态
router.get('/novels/:sourceId/:novelId/scheduling', (request, response) => {
  try {
    const { sourceId, novelId } = request.params;
    const row = service.getScheduledNovel(sourceId, novelId);
    response.json(row ?? { sourceId, novelId, enabled: false, lastCheckedAt: null, lastCheckResult: null, lastCheckMessage: null, updatedAt: '' });
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Invalid request.',
    });
  }
});

router.put('/novels/:sourceId/:novelId/scheduling', (request, response) => {
  try {
    const { sourceId, novelId } = request.params;
    const body = request.body as { enabled?: unknown };
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : false;

    service.upsertScheduledNovel(sourceId, novelId, enabled);
    const row = service.getScheduledNovel(sourceId, novelId);
    response.json(row);
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Invalid request.',
    });
  }
});

// 批量管理书单
router.get('/scheduling/novels', (_request, response) => {
  try {
    const novels = service.listLibraryNovelEntries();
    const scheduledMap = new Map(
      service.getAllScheduledNovels().map((row) => [`${row.sourceId}:${row.novelId}`, row]),
    );

    const result = novels.map((novel) => {
      const key = `${novel.sourceId}:${novel.novelId}`;
      const scheduled = scheduledMap.get(key);
      return {
        sourceId: novel.sourceId,
        novelId: novel.novelId,
        title: novel.title,
        enabled: scheduled?.enabled ?? false,
      };
    });

    response.json({ novels: result });
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Invalid request.',
    });
  }
});

router.put('/scheduling/novels', (request, response) => {
  try {
    const body = request.body as { novels?: unknown };
    const entries = Array.isArray(body.novels)
      ? body.novels.filter((entry): entry is { sourceId: string; novelId: string; enabled: boolean } =>
          typeof entry === 'object' && entry !== null &&
          typeof (entry as Record<string, unknown>).sourceId === 'string' &&
          typeof (entry as Record<string, unknown>).novelId === 'string' &&
          typeof (entry as Record<string, unknown>).enabled === 'boolean',
        )
      : [];

    service.bulkUpsertScheduledNovels(entries);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Invalid request.',
    });
  }
});
```

> **注意**：`ControlCenterService` 需要暴露一个 `getRepository()` 方法（或直接使用已有的 `#repository`）。检查现有代码中已有方式。

---

### Task 7: 前端 API 客户端

**Files:**
- Modify: `src/web/services/api.ts`

追加以下函数：

```ts
// ── 定时更新调度 ──

export interface SchedulingConfig {
  enabled: boolean;
  mode: 'interval' | 'cron' | 'weekly';
  intervalHours: number;
  cronExpression: string;
  weeklyDays: number[];
  weeklyTime: string;
  updatedAt: string | null;
}

export interface SchedulingNovelEntry {
  sourceId: string;
  novelId: string;
  title: string;
  enabled: boolean;
}

export interface SchedulingNovelDetail {
  sourceId: string;
  novelId: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastCheckResult: 'new_chapters' | 'up_to_date' | 'error' | null;
  lastCheckMessage: string | null;
  updatedAt: string;
}

export interface SchedulingNovelsPayload {
  novels: SchedulingNovelEntry[];
}

export async function fetchSchedulingConfig(): Promise<SchedulingConfig> {
  const response = await fetch('/api/control/scheduling');
  if (!response.ok) {
    throw new Error(`获取调度配置失败 (${response.status})`);
  }
  return response.json();
}

export async function updateSchedulingConfig(input: Partial<SchedulingConfig>): Promise<SchedulingConfig> {
  const response = await fetch('/api/control/scheduling', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`更新调度配置失败 (${response.status})`);
  }
  return response.json();
}

export async function fetchNovelScheduling(sourceId: string, novelId: string): Promise<SchedulingNovelDetail> {
  const response = await fetch(`/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/scheduling`);
  if (!response.ok) {
    throw new Error(`获取书籍调度状态失败 (${response.status})`);
  }
  return response.json();
}

export async function updateNovelScheduling(sourceId: string, novelId: string, enabled: boolean): Promise<SchedulingNovelDetail> {
  const response = await fetch(`/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/scheduling`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`更新书籍调度状态失败 (${response.status})`);
  }
  return response.json();
}

export async function fetchSchedulingNovels(): Promise<SchedulingNovelsPayload> {
  const response = await fetch('/api/library/scheduling/novels');
  if (!response.ok) {
    throw new Error(`获取调度书单失败 (${response.status})`);
  }
  return response.json();
}

export async function updateSchedulingNovels(entries: Array<{ sourceId: string; novelId: string; enabled: boolean }>): Promise<void> {
  const response = await fetch('/api/library/scheduling/novels', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novels: entries }),
  });
  if (!response.ok) {
    throw new Error(`更新调度书单失败 (${response.status})`);
  }
}
```

---

### Task 8: 前端 —— 定时更新设置面板

**Files:**
- Modify: `src/web/components/system-preferences.tsx`

在 `panels` 数组中追加新的 Accordion 项。关键实现要点：

1. **导入**: 添加 `fetchSchedulingConfig`、`updateSchedulingConfig`、`fetchSchedulingNovels`、`updateSchedulingNovels` 等 API 函数
2. **状态管理**: 使用 `useState` 管理 `schedulingConfig`、`schedulingNovels`、`modalOpen`
3. **面板内容 UI**:
   - 全局 Toggle Switch
   - SegmentedControl 切换三种模式
   - 固定间隔：`NumberInput` + 下次触发时间预览文本
   - Cron：`TextInput` + 校验 + 未来 5 次预览（用 `cron-parser` 在前端也解析一次进行预览）
   - 每周：`Chip.Group` 多选星期 + `TimeInput`
4. **管理书单 Modal**: 点击按钮→唤起 Modal→内部 `Checkbox` 列表→保存/取消

由于此组件较复杂（约 200 行新增），实施时参考现有 `system-preferences.tsx` 中的 Accordion 模式——每个面板 `content` 是独立的 JSX 块。

---

### Task 9: 前端 —— 单书详情页 Toggle

**Files:**
- Modify: `src/web/components/library-detail-view.tsx`

在 `LibraryDetailView` 组件的"元数据与快捷操作"聚合卡片区域追加一个 Toggle 控件：

```tsx
// 在组件内添加状态
const [schedulingEnabled, setSchedulingEnabled] = useState(false);
const [schedulingDetail, setSchedulingDetail] = useState<SchedulingNovelDetail | null>(null);

// 加载状态
useEffect(() => {
  if (!detail) return;
  fetchNovelScheduling(detail.sourceId, detail.metadata.novelId)
    .then(setSchedulingDetail)
    .catch(() => {});
}, [detail?.sourceId, detail?.metadata.novelId]);

// 在快捷操作卡片中添加
<Paper
  p="sm"
  radius="md"
  style={{
    border: '1px solid rgba(255,209,102,0.30)',
    background: 'rgba(255,209,102,0.04)',
  }}
>
  <Group justify="space-between" align="flex-start">
    <Stack gap={2}>
      <Text size="xs" fw={600} style={{ color: '#ffd166' }}>
        🕐 定时更新
      </Text>
      <Text size="xs" c="dimmed">
        {schedulingEnabled ? '自动追更中' : '开启后自动追更'}
      </Text>
    </Stack>
    <Switch
      checked={schedulingEnabled}
      onChange={(event) => {
        const next = event.currentTarget.checked;
        setSchedulingEnabled(next);
        updateNovelScheduling(detail.sourceId, detail.metadata.novelId, next)
          .then(setSchedulingDetail)
          .catch(() => setSchedulingEnabled(!next));
      }}
    />
  </Group>
  {schedulingDetail && (
    <Text size="xs" mt={4} c={statusColor(schedulingDetail)}>
      {statusMessage(schedulingDetail)}
    </Text>
  )}
</Paper>
```

辅助函数：
```tsx
function statusColor(detail: SchedulingNovelDetail): string {
  switch (detail.lastCheckResult) {
    case 'new_chapters': return '#4caf50';
    case 'error': return '#f44336';
    default: return 'dimmed';
  }
}

function statusMessage(detail: SchedulingNovelDetail): string {
  if (detail.lastCheckResult === null) return '等待首次检查';
  if (detail.lastCheckResult === 'new_chapters') return detail.lastCheckMessage ?? '已自动下载';
  if (detail.lastCheckResult === 'up_to_date') return `上次检查 ${formatTimeAgo(detail.lastCheckedAt)} · 已是最新`;
  if (detail.lastCheckResult === 'error') return '上次检查失败，下轮重试';
  return '';
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '未知时间';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diff / 3600000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}h 前`;
  return `${Math.round(hours / 24)}d 前`;
}
```

---

### Task 10: 安装依赖 & 验证

#### Step 1: 安装 cron-parser

```bash
npm install cron-parser
```

#### Step 2: 运行类型检查

```bash
npm run typecheck
```

#### Step 3: 运行调度相关测试

```bash
npx tsx --test src/server/core/scheduling.test.ts
```

#### Step 4: 运行全量服务端测试

```bash
npm run test:server
```

#### Step 5: 构建验证

```bash
npm run build
```

---
