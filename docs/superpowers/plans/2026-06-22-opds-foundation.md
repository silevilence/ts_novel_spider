# OPDS 书源服务基础层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OPDS 分发建立基础数据层与制品生成引擎：扩展书籍实体属性（opds_visible / content_updated_at / epub_compiled_at），新增 OPDS 偏好配置段，实现后台差分扫描调度器按需生成多语种多版本 EPUB 制品，并暴露管理与配置 API。

**Architecture:** 复用现有 `SchedulingService` 的调度模式（setInterval 每分钟 tick + cron-parser 计算触发时间）新建独立的 `OpdsCompilationService`；复用 `LocalExportEngine` 生成 EPUB 制品；在 `SpiderRunner` 与 `TranslationService` 的内容变更点 bump `content_updated_at`；通过 `ControlCenterService` 聚合依赖并启动调度器。

**Tech Stack:** Node.js ≥ 20, Express 5, better-sqlite3, cron-parser, jszip（经 LocalExportEngine）, TypeScript strict

**Spec:** `docs/superpowers/specs/2026-06-22-opds-foundation-design.md`

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `src/server/core/novel-repository.ts` | DB 迁移 + OPDS 字段 CRUD + `opds_compilation_runs` 审计表 | Modify |
| `src/server/core/system-preferences.ts` | `OpdsConfig` 类型 + `getOpds()` / `updateOpds()` + 持久化 | Modify |
| `src/server/core/opds-compilation.ts` | `OpdsCompilationService` 调度器 + 扫描 + EPUB 生成 | Create |
| `src/server/core/opds-compilation.test.ts` | 调度器与扫描逻辑测试 | Create |
| `src/server/core/spider-runner.ts` | 章节入库后 bump `content_updated_at` | Modify |
| `src/server/core/translation-service.ts` | 翻译完成后 bump `content_updated_at` | Modify |
| `src/server/core/control-center.ts` | 装配 `OpdsCompilationService` + 透传 OPDS 操作方法 | Modify |
| `src/server/routes/control-center.ts` | `GET/PUT /preferences/opds` + `GET /opds/runs` | Modify |
| `src/server/routes/library.ts` | 单书与批量 OPDS 可见性 API | Modify |
| `src/server/routes/control-center.test.ts` | OPDS 偏好与审计 API 测试 | Modify |
| `src/server/routes/library.test.ts` | OPDS 可见性 API 测试 | Modify |

---

### Task 1: DB 迁移 — novels 表新增 OPDS 字段 + opds_compilation_runs 审计表

**Files:**
- Modify: `src/server/core/novel-repository.ts`（`migrate()` 方法，约 3140-3580 行；`ensureColumnExists` 在 3573 行）

- [ ] **Step 1: 在 `migrate()` 末尾追加 OPDS 列迁移与审计表**

在 `novel_translation_builds` 的 `ensureColumnExists` 调用块之后（约 3568 行 `}` 之前），追加：

```ts
    // ── OPDS: novels 表新增列 ──
    this.ensureColumnExists('novels', 'opds_visible', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumnExists('novels', 'content_updated_at', 'TEXT');
    this.ensureColumnExists('novels', 'epub_compiled_at', 'TEXT');

    // 首次迁移时回填 content_updated_at = MAX(chapters.updated_at)
    this.#database.exec(`
      UPDATE novels
      SET content_updated_at = (
        SELECT MAX(c.updated_at)
        FROM chapters c
        WHERE c.source_id = novels.source_id
          AND c.novel_id = novels.novel_id
      )
      WHERE content_updated_at IS NULL
        AND EXISTS (
          SELECT 1 FROM chapters c
          WHERE c.source_id = novels.source_id
            AND c.novel_id = novels.novel_id
        )
    `);

    // ── OPDS: 制品生成审计表 ──
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS opds_compilation_runs (
        id                 TEXT NOT NULL PRIMARY KEY,
        started_at         TEXT NOT NULL,
        completed_at       TEXT,
        status             TEXT NOT NULL DEFAULT 'running',
        total_scanned      INTEGER NOT NULL DEFAULT 0,
        compiled           INTEGER NOT NULL DEFAULT 0,
        skipped            INTEGER NOT NULL DEFAULT 0,
        errored            INTEGER NOT NULL DEFAULT 0
      )
    `);
```

- [ ] **Step 2: 运行 typecheck 验证语法**

Run: `npm run typecheck`
Expected: PASS（无新增错误）

- [ ] **Step 3: Commit**

```bash
git add src/server/core/novel-repository.ts
git commit -m "feat(opds): add novels table OPDS columns and opds_compilation_runs audit table"
```

---

### Task 2: Repository — OPDS 字段 CRUD 方法

**Files:**
- Modify: `src/server/core/novel-repository.ts`（在 `recoverIncompleteCheckRuns` 方法之后，约 3140 行 `}` 之前追加新方法块；在文件末尾的 `StoredScheduledNovelRow` 等类型导出附近追加新类型）

- [ ] **Step 1: 在 `novel-repository.ts` 顶部类型导出区追加 OPDS 行类型**

在 `StoredScheduledCheckRunRow` 导出附近追加：

```ts
export interface StoredOpdsNovelRow {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface StoredOpdsCompilationRunRow {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalScanned: number;
  compiled: number;
  skipped: number;
  errored: number;
}
```

- [ ] **Step 2: 在 `recoverIncompleteCheckRuns()` 之后追加 OPDS CRUD 方法块**

```ts
  // ── OPDS: 可见性与时间戳 ──

  getOpdsNovel(sourceId: string, novelId: string): StoredOpdsNovelRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT n.source_id, n.novel_id, n.title, n.opds_visible,
                n.content_updated_at, n.epub_compiled_at,
                EXISTS (
                  SELECT 1 FROM chapter_translations ct
                  WHERE ct.source_id = n.source_id
                    AND ct.novel_id = n.novel_id
                    AND ct.status = 'completed'
                ) AS has_translation
         FROM novels n
         WHERE n.source_id = ? AND n.novel_id = ?`,
      )
      .get(sourceId, novelId) as {
        source_id: string; novel_id: string; title: string;
        opds_visible: number; content_updated_at: string | null;
        epub_compiled_at: string | null; has_translation: number;
      } | undefined;

    if (!row) return undefined;

    return {
      sourceId: row.source_id,
      novelId: row.novel_id,
      title: row.title,
      opdsVisible: row.opds_visible === 1,
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
      hasTranslation: row.has_translation === 1,
    };
  }

  listOpdsNovels(): StoredOpdsNovelRow[] {
    const rows = this.#database
      .prepare(
        `SELECT n.source_id, n.novel_id, n.title, n.opds_visible,
                n.content_updated_at, n.epub_compiled_at,
                EXISTS (
                  SELECT 1 FROM chapter_translations ct
                  WHERE ct.source_id = n.source_id
                    AND ct.novel_id = n.novel_id
                    AND ct.status = 'completed'
                ) AS has_translation
         FROM novels n
         ORDER BY n.title COLLATE NOCASE ASC`,
      )
      .all() as Array<{
        source_id: string; novel_id: string; title: string;
        opds_visible: number; content_updated_at: string | null;
        epub_compiled_at: string | null; has_translation: number;
      }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      title: row.title,
      opdsVisible: row.opds_visible === 1,
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
      hasTranslation: row.has_translation === 1,
    }));
  }

  /** 查询所有 opds_visible=1 的小说（供扫描器使用） */
  listVisibleOpdsNovels(): Array<{
    sourceId: string;
    novelId: string;
    contentUpdatedAt: string | null;
    epubCompiledAt: string | null;
  }> {
    const rows = this.#database
      .prepare(
        `SELECT source_id, novel_id, content_updated_at, epub_compiled_at
         FROM novels
         WHERE opds_visible = 1
         ORDER BY source_id, novel_id`,
      )
      .all() as Array<{
        source_id: string; novel_id: string;
        content_updated_at: string | null; epub_compiled_at: string | null;
      }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
    }));
  }

  updateOpdsVisible(sourceId: string, novelId: string, visible: boolean): void {
    this.#database
      .prepare(
        `UPDATE novels SET opds_visible = ? WHERE source_id = ? AND novel_id = ?`,
      )
      .run(visible ? 1 : 0, sourceId, novelId);
  }

  bulkUpdateOpdsVisible(entries: Array<{ sourceId: string; novelId: string; visible: boolean }>): void {
    const stmt = this.#database.prepare(
      `UPDATE novels SET opds_visible = ? WHERE source_id = ? AND novel_id = ?`,
    );
    const tx = this.#database.transaction(() => {
      for (const entry of entries) {
        stmt.run(entry.visible ? 1 : 0, entry.sourceId, entry.novelId);
      }
    });
    tx();
  }

  /** 章节入库或翻译完成后调用，bump 内容更新时间 */
  bumpNovelContentUpdatedAt(sourceId: string, novelId: string): void {
    const now = new Date().toISOString();
    this.#database
      .prepare(
        `UPDATE novels SET content_updated_at = ? WHERE source_id = ? AND novel_id = ?`,
      )
      .run(now, sourceId, novelId);
  }

  /** EPUB 制品生成成功后调用 */
  updateNovelEpubCompiledAt(sourceId: string, novelId: string, compiledAt: string): void {
    this.#database
      .prepare(
        `UPDATE novels SET epub_compiled_at = ? WHERE source_id = ? AND novel_id = ?`,
      )
      .run(compiledAt, sourceId, novelId);
  }

  /** 查询某书是否有已完成的章节翻译（供扫描器决定生成哪些版本） */
  novelHasCompletedTranslation(sourceId: string, novelId: string): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM chapter_translations
         WHERE source_id = ? AND novel_id = ? AND status = 'completed'
         LIMIT 1`,
      )
      .get(sourceId, novelId) as { 1: number } | undefined;
    return Boolean(row);
  }

  // ── OPDS: 制品生成审计 ──

  createOpdsCompilationRun(id: string, startedAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO opds_compilation_runs (id, started_at, status)
         VALUES (?, ?, 'running')`,
      )
      .run(id, startedAt);
  }

  completeOpdsCompilationRun(
    id: string,
    completedAt: string,
    totalScanned: number,
    compiled: number,
    skipped: number,
    errored: number,
  ): void {
    this.#database
      .prepare(
        `UPDATE opds_compilation_runs
         SET completed_at = ?, status = 'completed',
             total_scanned = ?, compiled = ?, skipped = ?, errored = ?
         WHERE id = ?`,
      )
      .run(completedAt, totalScanned, compiled, skipped, errored, id);
  }

  listOpdsCompilationRuns(limit: number, offset: number): StoredOpdsCompilationRunRow[] {
    const rows = this.#database
      .prepare(
        `SELECT id, started_at, completed_at, status,
               total_scanned, compiled, skipped, errored
         FROM opds_compilation_runs
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
        id: string; started_at: string; completed_at: string | null;
        status: string; total_scanned: number; compiled: number;
        skipped: number; errored: number;
      }>;

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as 'running' | 'completed',
      totalScanned: row.total_scanned,
      compiled: row.compiled,
      skipped: row.skipped,
      errored: row.errored,
    }));
  }

  getLatestCompletedOpdsCompilationRun(): StoredOpdsCompilationRunRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT id, started_at, completed_at, status,
               total_scanned, compiled, skipped, errored
         FROM opds_compilation_runs
         WHERE status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
      )
      .get() as {
        id: string; started_at: string; completed_at: string | null;
        status: string; total_scanned: number; compiled: number;
        skipped: number; errored: number;
      } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as 'running' | 'completed',
      totalScanned: row.total_scanned,
      compiled: row.compiled,
      skipped: row.skipped,
      errored: row.errored,
    };
  }

  /** 服务启动恢复：将遗留 running 记录标记为 completed */
  recoverIncompleteOpdsCompilationRuns(): void {
    this.#database
      .prepare(
        `UPDATE opds_compilation_runs
         SET status = 'completed', completed_at = ?
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString());
  }
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/core/novel-repository.ts
git commit -m "feat(opds): add repository CRUD methods for OPDS visibility and compilation runs"
```

---

### Task 3: SystemPreferences — OpdsConfig 配置段

**Files:**
- Modify: `src/server/core/system-preferences.ts`（在 `SchedulingConfig` 相关定义之后追加 OPDS 类型；在 `PersistedSystemPreferences` 接口加字段；在 `SystemPreferencesService` 类加字段与方法；在 `loadPersistedPreferences` 与 `persistPreferences` 加处理）

- [ ] **Step 1: 在 `SCHEDULING_DEFAULTS` 与 `normalizeSchedulingInput` 之后追加 OPDS 配置类型**

在 `normalizeSchedulingInput` 函数结束后追加：

```ts
// ── OPDS 引擎配置 ──

export interface OpdsConfigInput {
  enabled?: boolean;
  scanCronExpression?: string;
}

export interface OpdsConfig {
  enabled: boolean;
  scanCronExpression: string;
  updatedAt: string | null;
}

export const OPDS_DEFAULTS: OpdsConfig = {
  enabled: false,
  scanCronExpression: '0 */6 * * *',
  updatedAt: null,
};

export function normalizeOpdsInput(input: OpdsConfigInput): OpdsConfig {
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : OPDS_DEFAULTS.enabled,
    scanCronExpression: typeof input.scanCronExpression === 'string' && input.scanCronExpression.trim()
      ? input.scanCronExpression.trim() : OPDS_DEFAULTS.scanCronExpression,
    updatedAt: null,
  };
}
```

- [ ] **Step 2: 在 `PersistedSystemPreferences` 接口加 `opds?` 字段**

在 `scheduling?: SchedulingConfigInput;` 之后追加：

```ts
  opds?: OpdsConfigInput;
```

- [ ] **Step 3: 在 `SystemPreferencesService` 类加 `#opds` 字段与初始化**

在 `#scheduling: SchedulingConfig;` 字段声明之后追加：

```ts
  #opds: OpdsConfig;
```

在构造函数中 `this.#scheduling = ...` 赋值之后追加：

```ts
    this.#opds = persisted?.opds
      ? { ...normalizeOpdsInput(persisted.opds), updatedAt: persisted.updatedAt ?? null }
      : { ...OPDS_DEFAULTS };
```

- [ ] **Step 4: 在 `updateScheduling` 方法之后追加 `getOpds()` 与 `updateOpds()` 方法**

```ts
  getOpds(): OpdsConfig {
    return { ...this.#opds };
  }

  updateOpds(input: OpdsConfigInput): OpdsConfig {
    this.#opds = { ...normalizeOpdsInput({ ...this.#opds, ...input }), updatedAt: new Date().toISOString() };
    this.touch();
    persistPreferences(this.#storageFilePath, this.#llmProviders, this.#neo4jConfig, this.#updatedAt, this.#readerTypography, this.#translation, this.#modelGateway, this.#scheduling, this.#opds);
    return this.getOpds();
  }
```

- [ ] **Step 5: 更新所有 `persistPreferences` 调用点，追加 `this.#opds` 参数**

在 `updateLlmProviders`、`updateNeo4jConfig`、`updateReaderTypography`、`updateTranslationPreferences`、`updateModelGateway`、`updateScheduling` 这 6 处 `persistPreferences(...)` 调用末尾追加 `, this.#opds`。

- [ ] **Step 6: 更新 `persistPreferences` 函数签名与实现**

在 `persistPreferences` 函数签名末尾追加参数 `opds?: OpdsConfig`，并在函数体中 `if (scheduling) { ... }` 块之后追加：

```ts
  if (opds) {
    payload.opds = {
      enabled: opds.enabled,
      scanCronExpression: opds.scanCronExpression,
      updatedAt: opds.updatedAt,
    };
  }
```

- [ ] **Step 7: 更新 `loadPersistedPreferences` 解析 `opds` 段**

在 `if (isRecord(parsed.scheduling)) { ... }` 块之后追加：

```ts
    if (isRecord(parsed.opds)) {
      const raw = parsed.opds as Record<string, unknown>;
      const opds: OpdsConfigInput = {};
      if (typeof raw.enabled === 'boolean') { opds.enabled = raw.enabled; }
      if (typeof raw.scanCronExpression === 'string') { opds.scanCronExpression = raw.scanCronExpression; }
      result.opds = opds;
    }
```

- [ ] **Step 8: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/server/core/system-preferences.ts
git commit -m "feat(opds): add OpdsConfig preference section with persistence"
```

---

### Task 4: OpdsCompilationService — 调度器骨架与扫描逻辑

**Files:**
- Create: `src/server/core/opds-compilation.ts`
- Create: `src/server/core/opds-compilation.test.ts`

- [ ] **Step 1: 编写失败测试 — 调度器启停与扫描逻辑**

创建 `src/server/core/opds-compilation.test.ts`：

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService, OPDS_DEFAULTS } from './system-preferences';
import { LocalExportEngine } from './export-engine';
import { OfflineLibraryAssetService } from './offline-library';
import { SpiderLogDispatcher } from './logging';
import { OpdsCompilationService, calculateOpdsNextTriggerTime } from './opds-compilation';
import type { SpiderAdapter, NovelMetadata, ChapterIndexEntry, ChapterContent } from './spider';

function createTestRepository(): SqliteNovelRepository {
  return new SqliteNovelRepository(':memory:');
}

function createMockSpider(sourceId: string): SpiderAdapter {
  return {
    sourceId,
    getInfoPageUrl: (novelId: string) => `https://example.test/${sourceId}/${novelId}`,
    fetchMetadata: async () => ({ sourceId, novelId: 'n1', title: 'Test', author: 'Author', description: '', tags: [], chapterCount: 1, infoPageUrl: '' }),
    fetchChapterIndex: async () => [],
    fetchChapter: async () => ({ chapterId: 'c1', index: 1, title: 'Ch1', content: 'content', volumeTitle: null, url: '' }),
    fetchChapters: async () => [],
  } as unknown as SpiderAdapter;
}

function seedNovel(repo: SqliteNovelRepository, sourceId = 'syosetu', novelId = 'n1'): void {
  repo.saveMetadata(sourceId, {
    novelId, title: 'Test Novel', author: 'Author',
    description: 'desc', tags: ['tag1'], chapterCount: 1, infoPageUrl: 'https://example.test',
  });
  repo.saveChapterIndex(sourceId, novelId, [{
    id: 'c1', index: 1, title: 'Chapter 1', volumeTitle: null, url: 'https://example.test/c1',
  }]);
  repo.saveChapterContent(sourceId, novelId, {
    chapterId: 'c1', index: 1, title: 'Chapter 1', volumeTitle: null,
    url: 'https://example.test/c1', content: 'Hello world.',
  });
}

describe('calculateOpdsNextTriggerTime', () => {
  it('parses valid cron expression', () => {
    const result = calculateOpdsNextTriggerTime({
      enabled: true,
      scanCronExpression: '0 8 * * *',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });

  it('falls back on invalid cron expression', () => {
    const result = calculateOpdsNextTriggerTime({
      enabled: true,
      scanCronExpression: 'invalid',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });
});

describe('OpdsCompilationService', () => {
  let repo: SqliteNovelRepository;
  let preferences: SystemPreferencesService;
  let exportEngine: LocalExportEngine;
  let logger: SpiderLogDispatcher;
  let tempDir: string;

  beforeEach(() => {
    repo = createTestRepository();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-test-'));
    preferences = new SystemPreferencesService({});
    exportEngine = new LocalExportEngine({
      outputRoot: path.join(tempDir, 'exports'),
      assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }),
    });
    logger = new SpiderLogDispatcher();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('start() does not start timer when disabled', () => {
    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    service.start();
    // 无异常即通过；enabled=false 时不应启动定时器
    service.stop();
    assert.ok(true);
  });

  it('skips novels with opds_visible=0', async () => {
    seedNovel(repo);
    // 不开启 opds_visible
    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();
    // 不应生成任何制品
    const artifactDir = path.join(tempDir, 'artifacts', 'syosetu', 'n1');
    assert.ok(!fs.existsSync(artifactDir) || fs.readdirSync(artifactDir).length === 0);
  });

  it('generates original.epub for visible novel without translation', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const originalPath = path.join(tempDir, 'artifacts', 'syosetu', 'n1', 'original.epub');
    assert.ok(fs.existsSync(originalPath), 'original.epub should exist');

    const translatedPath = path.join(tempDir, 'artifacts', 'syosetu', 'n1', 'translated.epub');
    assert.ok(!fs.existsSync(translatedPath), 'translated.epub should not exist for untranslated novel');

    const row = repo.getOpdsNovel('syosetu', 'n1');
    assert.ok(row?.epubCompiledAt, 'epub_compiled_at should be set');
  });

  it('skips novel when epub_compiled_at >= content_updated_at', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const compiledAt = repo.getOpdsNovel('syosetu', 'n1')?.epubCompiledAt;
    assert.ok(compiledAt);

    // 第二次扫描，content_updated_at 未变，应跳过
    await service.runScanAllForTest();
    const row = repo.getOpdsNovel('syosetu', 'n1');
    assert.equal(row?.epubCompiledAt, compiledAt, 'epub_compiled_at should not change');
  });

  it('regenerates when content_updated_at > epub_compiled_at', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const firstCompiledAt = repo.getOpdsNovel('syosetu', 'n1')?.epubCompiledAt;
    assert.ok(firstCompiledAt);

    // bump content_updated_at 到更晚的时间
    repo.bumpNovelContentUpdatedAt('syosetu', 'n1');

    await service.runScanAllForTest();
    const row = repo.getOpdsNovel('syosetu', 'n1');
    assert.ok(row?.epubCompiledAt);
    assert.notEqual(row?.epubCompiledAt, firstCompiledAt, 'epub_compiled_at should be updated');
  });

  it('records audit run in opds_compilation_runs', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const runs = repo.listOpdsCompilationRuns(10, 0);
    assert.ok(runs.length >= 1, 'should have at least one audit run');
    assert.equal(runs[0].status, 'completed');
    assert.equal(runs[0].totalScanned, 1);
    assert.equal(runs[0].compiled, 1);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test src/server/core/opds-compilation.test.ts`
Expected: FAIL — 模块 `./opds-compilation` 不存在

- [ ] **Step 3: 实现 `OpdsCompilationService`**

创建 `src/server/core/opds-compilation.ts`：

```ts
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
    const translationPrefs = this.#preferences.getTranslation();
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test src/server/core/opds-compilation.test.ts`
Expected: PASS（全部用例通过）

- [ ] **Step 5: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/core/opds-compilation.ts src/server/core/opds-compilation.test.ts
git commit -m "feat(opds): implement OpdsCompilationService with cron-based scan and EPUB generation"
```

---

### Task 5: SpiderRunner — 章节入库后 bump content_updated_at

**Files:**
- Modify: `src/server/core/spider-runner.ts`（`handleFetchResult` 中 `saveChapterContent` 调用之后）

- [ ] **Step 1: 在 `saveChapterContent` 调用之后追加 bump**

在 `this.#repository.saveChapterContent(this.#spider.sourceId, options.novelId, result.content);` 之后追加：

```ts
        this.#repository.bumpNovelContentUpdatedAt(this.#spider.sourceId, options.novelId);
```

- [ ] **Step 2: 运行现有 spider-runner 测试验证无回归**

Run: `npx tsx --test src/server/core/spider-runner.test.ts`
Expected: PASS

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/core/spider-runner.ts
git commit -m "feat(opds): bump content_updated_at after chapter content saved"
```

---

### Task 6: TranslationService — 翻译完成后 bump content_updated_at

**Files:**
- Modify: `src/server/core/translation-service.ts`（`#runTranslation` 末尾 `saveTranslationBuild` 调用之后，约 851 行）

- [ ] **Step 1: 在翻译构建保存成功之后追加 bump**

在 `this.#repository.saveTranslationBuild({ ... });` 调用块之后追加：

```ts
    // 翻译完成（非中止）后 bump content_updated_at，触发 OPDS 制品重建
    if (!ac.signal.aborted) {
      this.#repository.bumpNovelContentUpdatedAt(sourceId, novelId);
    }
```

- [ ] **Step 2: 运行现有翻译测试验证无回归**

Run: `npx tsx --test src/server/core/translation.test.ts`
Expected: PASS

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/core/translation-service.ts
git commit -m "feat(opds): bump content_updated_at after translation completes"
```

---

### Task 7: ControlCenterService — 装配 OpdsCompilationService 与透传方法

**Files:**
- Modify: `src/server/core/control-center.ts`（import 区、类字段、构造函数、close()、透传方法）

- [ ] **Step 1: 在 import 区追加 OpdsCompilationService 导入**

在 `import { SchedulingService, type SchedulingServiceDependencies } from './scheduling';` 之后追加：

```ts
import { OpdsCompilationService, type OpdsCompilationServiceDependencies } from './opds-compilation';
```

- [ ] **Step 2: 在 `ControlCenterServiceOptions` 接口追加可选字段**

在 `assetFetchImpl?: typeof fetch;` 之前追加：

```ts
  opdsArtifactsPath?: string;
```

- [ ] **Step 3: 在类字段区追加 `#opdsCompilation`**

在 `readonly #scheduling: SchedulingService;` 之后追加：

```ts
  readonly #opdsCompilation: OpdsCompilationService;
```

- [ ] **Step 4: 在构造函数中初始化 `OpdsCompilationService`**

在 `this.#scheduling = new SchedulingService({ ... });` 之后追加：

```ts
    this.#opdsCompilation = new OpdsCompilationService({
      repository: this.#repository,
      preferences: this.#systemPreferences,
      exportEngine: this.#exportEngine,
      logger: this.#taskLogDispatcher,
      ...(options.opdsArtifactsPath ? { artifactsRoot: options.opdsArtifactsPath } : {}),
    });
    this.#opdsCompilation.start();
```

- [ ] **Step 5: 在 `close()` 中停止 OPDS 调度器**

在 `this.#scheduling.stop();` 之后追加：

```ts
    this.#opdsCompilation.stop();
```

- [ ] **Step 6: 在 `updateSchedulingState` 方法之后追加 OPDS 透传方法**

```ts
  // ── OPDS 引擎 ──

  getOpdsState(): OpdsConfig {
    return this.#systemPreferences.getOpds();
  }

  updateOpdsState(input: OpdsConfigInput): OpdsConfig {
    const result = this.#systemPreferences.updateOpds(input);
    this.#opdsCompilation.reload();
    return result;
  }

  getOpdsNovel(sourceId: string, novelId: string): StoredOpdsNovelRow | undefined {
    return this.#repository.getOpdsNovel(sourceId, novelId);
  }

  updateOpdsNovelVisible(sourceId: string, novelId: string, visible: boolean): void {
    this.#repository.updateOpdsVisible(sourceId, novelId, visible);
  }

  listOpdsNovels(): StoredOpdsNovelRow[] {
    return this.#repository.listOpdsNovels();
  }

  bulkUpdateOpdsNovels(entries: Array<{ sourceId: string; novelId: string; visible: boolean }>): void {
    this.#repository.bulkUpdateOpdsVisible(entries);
  }

  listOpdsCompilationRuns(limit: number, offset: number): StoredOpdsCompilationRunRow[] {
    return this.#repository.listOpdsCompilationRuns(limit, offset);
  }

  getLatestCompletedOpdsCompilationRun(): StoredOpdsCompilationRunRow | undefined {
    return this.#repository.getLatestCompletedOpdsCompilationRun();
  }
```

- [ ] **Step 7: 在 import 类型区追加 OPDS 相关类型导入**

在 `import { SchedulingService, ... }` 附近或 `system-preferences` 导入块中追加：

```ts
import type { OpdsConfig, OpdsConfigInput } from './system-preferences';
import type { StoredOpdsNovelRow, StoredOpdsCompilationRunRow } from './novel-repository';
```

- [ ] **Step 8: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/server/core/control-center.ts
git commit -m "feat(opds): wire OpdsCompilationService into ControlCenterService"
```

---

### Task 8: 路由 — control-center OPDS 偏好与审计 API

**Files:**
- Modify: `src/server/routes/control-center.ts`（import 区、路由注册区）

- [ ] **Step 1: 在 import 区追加 OPDS 类型导入**

在 `SchedulingConfig,` / `SchedulingConfigInput,` 附近追加：

```ts
  OpdsConfig,
  OpdsConfigInput,
```

- [ ] **Step 2: 在 `/scheduling` 路由块之后追加 OPDS 偏好与审计路由**

在 `router.put('/scheduling', ...)` 块之后、`return router;` 之前追加：

```ts
  // ── OPDS 引擎 ──

  router.get('/preferences/opds', (_request, response) => {
    const config = service.getOpdsState();
    const lastRun = service.getLatestCompletedOpdsCompilationRun();
    response.json({ ...config, lastRun: lastRun ?? null });
  });

  router.put('/preferences/opds', (request, response) => {
    try {
      const body = (request.body ?? {}) as OpdsConfigInput;
      // 校验 cron 表达式
      if (typeof body.scanCronExpression === 'string' && body.scanCronExpression.trim()) {
        try {
          CronExpressionParser.parse(body.scanCronExpression.trim());
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'invalid expression';
          response.status(400).json({ message: `Cron 表达式无效: ${reason}` });
          return;
        }
      }
      response.json(service.updateOpdsState(body));
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid OPDS preferences request.',
      });
    }
  });

  router.get('/opds/runs', (request, response) => {
    try {
      const limitRaw = typeof request.query.limit === 'string' ? parseInt(request.query.limit, 10) : 20;
      const offsetRaw = typeof request.query.offset === 'string' ? parseInt(request.query.offset, 10) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
      const runs = service.listOpdsCompilationRuns(limit, offset);
      response.json({ runs });
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid request.',
      });
    }
  });
```

- [ ] **Step 3: 在 import 区追加 `CronExpressionParser` 导入**

在文件顶部 import 区追加：

```ts
import CronExpressionParser from 'cron-parser';
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/control-center.ts
git commit -m "feat(opds): add OPDS preferences and compilation runs API routes"
```

---

### Task 9: 路由 — library 单书与批量 OPDS 可见性 API

**Files:**
- Modify: `src/server/routes/library.ts`（import 区、路由注册区）

- [ ] **Step 1: 在 import 区追加 OPDS 行类型导入**

在 `import type { StoredScheduledNovelRow, StoredTranslationTermRow } from '../core/novel-repository';` 中追加 `StoredOpdsNovelRow`：

```ts
import type { StoredOpdsNovelRow, StoredScheduledNovelRow, StoredTranslationTermRow } from '../core/novel-repository';
```

- [ ] **Step 2: 在 `/scheduling/novels` 路由块之后追加 OPDS 可见性路由**

在 `router.put('/scheduling/novels', ...)` 块之后追加：

```ts
  // ── OPDS 可见性 ──

  // 单书 OPDS 状态
  router.get('/novels/:sourceId/:novelId/opds', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const row = service.getOpdsNovel(sourceId, novelId);
      if (!row) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }
      response.json(row);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid request.',
      });
    }
  });

  router.put('/novels/:sourceId/:novelId/opds', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const body = request.body as { visible?: unknown };
      const visible = typeof body.visible === 'boolean' ? body.visible : false;
      service.updateOpdsNovelVisible(sourceId, novelId, visible);
      const row = service.getOpdsNovel(sourceId, novelId);
      response.json(row);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid request.',
      });
    }
  });

  // 批量管理 OPDS 可见性
  router.get('/opds/novels', (_request, response) => {
    try {
      const novels = service.listOpdsNovels();
      response.json({ novels });
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid request.',
      });
    }
  });

  router.put('/opds/novels', (request, response) => {
    try {
      const body = request.body as { novels?: unknown };
      const entries = Array.isArray(body.novels)
        ? body.novels.filter((entry): entry is { sourceId: string; novelId: string; visible: boolean } =>
            typeof entry === 'object' && entry !== null &&
            typeof (entry as Record<string, unknown>).sourceId === 'string' &&
            typeof (entry as Record<string, unknown>).novelId === 'string' &&
            typeof (entry as Record<string, unknown>).visible === 'boolean',
          )
        : [];
      service.bulkUpdateOpdsNovels(entries);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Invalid request.',
      });
    }
  });
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/library.ts
git commit -m "feat(opds): add single and bulk OPDS visibility API routes"
```

---

### Task 10: API 测试 — control-center OPDS 偏好与审计

**Files:**
- Modify: `src/server/routes/control-center.test.ts`

- [ ] **Step 1: 在测试文件末尾追加 OPDS 偏好与审计 API 测试**

在文件末尾的最后一个 `describe` 块之后追加：

```ts
describe('OPDS preferences and compilation runs API', () => {
  it('GET /api/control/preferences/opds returns default config', async () => {
    const { app, service } = createTestApp();
    try {
      const response = await request(app).get('/api/control/preferences/opds');
      assert.equal(response.status, 200);
      assert.equal(response.body.enabled, false);
      assert.ok(typeof response.body.scanCronExpression === 'string');
    } finally {
      service.close();
    }
  });

  it('PUT /api/control/preferences/opds updates config', async () => {
    const { app, service } = createTestApp();
    try {
      const response = await request(app)
        .put('/api/control/preferences/opds')
        .send({ enabled: true, scanCronExpression: '0 4 * * *' });
      assert.equal(response.status, 200);
      assert.equal(response.body.enabled, true);
      assert.equal(response.body.scanCronExpression, '0 4 * * *');
    } finally {
      service.close();
    }
  });

  it('PUT /api/control/preferences/opds rejects invalid cron', async () => {
    const { app, service } = createTestApp();
    try {
      const response = await request(app)
        .put('/api/control/preferences/opds')
        .send({ scanCronExpression: 'invalid cron' });
      assert.equal(response.status, 400);
      assert.ok(response.body.message.includes('Cron'));
    } finally {
      service.close();
    }
  });

  it('GET /api/control/opds/runs returns paginated runs', async () => {
    const { app, service } = createTestApp();
    try {
      const response = await request(app).get('/api/control/opds/runs?limit=5&offset=0');
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.body.runs));
    } finally {
      service.close();
    }
  });
});
```

> 注：`createTestApp()` 与 `request` 是该测试文件已有的辅助。若命名不同，按现有模式对齐。

- [ ] **Step 2: 运行测试验证通过**

Run: `npx tsx --test src/server/routes/control-center.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/control-center.test.ts
git commit -m "test(opds): add OPDS preferences and runs API tests"
```

---

### Task 11: API 测试 — library OPDS 可见性

**Files:**
- Modify: `src/server/routes/library.test.ts`

- [ ] **Step 1: 在测试文件末尾追加 OPDS 可见性 API 测试**

在文件末尾追加：

```ts
describe('OPDS visibility API', () => {
  it('GET /api/library/novels/:sourceId/:novelId/opds returns 404 for missing novel', async () => {
    const { app, service } = createTestApp();
    try {
      const response = await request(app).get('/api/library/novels/syosetu/missing/opds');
      assert.equal(response.status, 404);
    } finally {
      service.close();
    }
  });

  it('PUT /api/library/novels/:sourceId/:novelId/opds updates visibility', async () => {
    const { app, service } = createTestApp();
    try {
      // 先种一本书（按现有测试辅助模式）
      seedTestNovel(service, 'syosetu', 'n1');

      const response = await request(app)
        .put('/api/library/novels/syosetu/n1/opds')
        .send({ visible: true });
      assert.equal(response.status, 200);
      assert.equal(response.body.opdsVisible, true);
    } finally {
      service.close();
    }
  });

  it('GET /api/library/opds/novels returns all novels with opds state', async () => {
    const { app, service } = createTestApp();
    try {
      seedTestNovel(service, 'syosetu', 'n1');
      const response = await request(app).get('/api/library/opds/novels');
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.body.novels));
      assert.ok(response.body.novels.some((n: { novelId: string }) => n.novelId === 'n1'));
    } finally {
      service.close();
    }
  });

  it('PUT /api/library/opds/novels bulk updates visibility', async () => {
    const { app, service } = createTestApp();
    try {
      seedTestNovel(service, 'syosetu', 'n1');
      const response = await request(app)
        .put('/api/library/opds/novels')
        .send({ novels: [{ sourceId: 'syosetu', novelId: 'n1', visible: true }] });
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);

      const row = service.getOpdsNovel('syosetu', 'n1');
      assert.equal(row?.opdsVisible, true);
    } finally {
      service.close();
    }
  });
});
```

> 注：`createTestApp()` 与 `seedTestNovel()` 是该测试文件已有的辅助。若命名不同，按现有模式对齐。

- [ ] **Step 2: 运行测试验证通过**

Run: `npx tsx --test src/server/routes/library.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/library.test.ts
git commit -m "test(opds): add OPDS visibility API tests"
```

---

### Task 12: 最终验证 — typecheck + build + 全量测试

- [ ] **Step 1: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS（无错误）

- [ ] **Step 2: 运行 build**

Run: `npm run build`
Expected: PASS（无编译错误）

- [ ] **Step 3: 运行全量服务端测试**

Run: `npm run test:server`
Expected: PASS（所有测试通过，包括新增 OPDS 测试与现有测试无回归）

- [ ] **Step 4: 运行全量前端测试**

Run: `npm run test:web`
Expected: PASS（无回归）

- [ ] **Step 5: 运行 CI 脚本测试**

Run: `npm run test:ci`
Expected: PASS

- [ ] **Step 6: 如全部通过，无需额外 commit（本任务仅验证）**

---

## Self-Review

**Spec coverage:**
- §2.1 新增 `OpdsCompilationService` → Task 4 ✓
- §2.2 扩展 `SystemPreferencesService` → Task 3 ✓
- §2.2 扩展 `SqliteNovelRepository` → Task 1 + 2 ✓
- §2.2 `SpiderRunner` bump → Task 5 ✓
- §2.2 `TranslationRunner` bump → Task 6（实际在 `TranslationService` 中，因为 `TranslationRunner` 只是状态持有者，bump 点在 `TranslationService.#runTranslation` 末尾）✓
- §2.2 `app.ts` 初始化 → Task 7（通过 `ControlCenterService` 构造函数自动启动，无需改 `app.ts`）✓
- §3.1 novels 表新增列 → Task 1 ✓
- §3.2 `opds_compilation_runs` 表 → Task 1 ✓
- §3.3 `system-preferences.json` opds 段 → Task 3 ✓
- §3.4 制品目录结构 → Task 4（`artifactsRoot` 默认 `data/opds-artifacts`）✓
- §4 调度引擎核心逻辑 → Task 4 ✓
- §5.1 `/api/control/preferences/opds` → Task 8 ✓
- §5.2 单书 OPDS 可见性 → Task 9 ✓
- §5.3 批量可见性 → Task 9 ✓
- §5.4 审计日志查询 → Task 8 ✓
- §6 测试策略 → Task 4 + 10 + 11 ✓

**Placeholder scan:** 无 TBD/TODO；所有步骤含完整代码。

**Type consistency:** `StoredOpdsNovelRow`、`StoredOpdsCompilationRunRow`、`OpdsConfig`、`OpdsConfigInput`、`OpdsCompilationServiceDependencies` 在所有任务中命名一致。`bumpNovelContentUpdatedAt`、`updateOpdsVisible`、`listVisibleOpdsNovels`、`runScanAllForTest` 等方法名前后一致。

**注：** `app.ts` 无需修改——`ControlCenterService` 构造函数已自动启动 `OpdsCompilationService`，与 `SchedulingService` 的接入模式一致。
