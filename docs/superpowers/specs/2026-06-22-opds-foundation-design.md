# OPDS 书源服务基础层 —— 设计规格

> 日期：2026-06-22 | 状态：待实施
> 父特性：OPDS 书源服务构建与分发（ROADMAP 🚧 开发中）
> 子项目编号：① 基础层（元数据可见性 + EPUB 制品生命周期）

## 1. 概述

为 TS Novel Spider 引入 OPDS 分发所需的**基础数据层与制品生成引擎**：扩展书籍实体属性以支持 OPDS 可见性控制，建立双时间戳跟踪机制（内容更新时间 vs EPUB 制品生成时间），实现轻量级后台调度引擎定时扫描启用 OPDS 的书籍并按需生成多语种多版本 EPUB 制品。

本子项目是 OPDS 协议端点（子项目 ②）与前端管理看板（子项目 ③）的地基，不涉及 OPDS feed 生成与前端 UI。

### 1.1 拆分背景

OPDS 功能包含 5 个子领域，按依赖关系拆为 3 个子项目：

| 顺序 | 子项目 | 依赖 |
|---|---|---|
| ① 基础层（本规格） | 元数据可见性 + EPUB 制品生命周期 | 无（复用现有导出引擎） |
| ② 协议层 | OPDS v1/v2 端点 + 多版本交付 | ① |
| ③ 表现层 | 前端管理看板 + 可观测性 | ①② |

### 1.2 关键决策

| 决策点 | 选择 |
|---|---|
| OPDS 库选型 | 手写 feed 生成器（协议层实现，本层不涉及） |
| 端点鉴权 | 暂不鉴权，依赖网络层隔离（协议层实现，本层不涉及） |
| EPUB 制品存储 | 独立 `data/opds-artifacts/<sourceId>/<novelId>/` 目录，按版本固定文件名 |
| 调度器组织 | 新建独立 `OpdsCompilationService`，模式与 `SchedulingService` 对齐 |
| 制品生成时机 | 纯按需（差分扫描触发），不提供立即重建端点 |
| 多版本制品范围 | 按翻译状态自动决定：未翻译只生成 original；已翻译生成 original + translated + bilingual |

## 2. 架构

### 2.1 新增模块

**`OpdsCompilationService`**（`src/server/core/opds-compilation.ts`）

后台差分扫描调度器，模式与 `SchedulingService` 完全对齐（`setInterval` 每分钟 tick + `cron-parser` 计算触发时间）。

```
服务启动 → 读 opds 配置
  → enabled=false：日志记录空闲，不启动定时器
  → enabled=true：scheduleNextTick() + setInterval(每分钟 tick)
配置变更 → reload()：停旧定时器，按新配置重启
服务停止 → stop()：clearInterval
```

**依赖注入**（构造函数）：

```ts
interface OpdsCompilationServiceDependencies {
  repository: SqliteNovelRepository;
  preferences: SystemPreferencesService;
  exportEngine: LocalExportEngine;
  logger: SpiderLogDispatcher;
}
```

### 2.2 扩展现有模块

| 模块 | 变更 |
|---|---|
| `SystemPreferencesService` | 新增 `opds` 配置段：`enabled`、`scanCronExpression`、`updatedAt`；`getOpds()` / `updateOpds()` |
| `SqliteNovelRepository` | `novels` 表新增 `opds_visible`、`content_updated_at`、`epub_compiled_at` 三列（迁移）；新增 `opds_compilation_runs` 审计表；CRUD 方法 |
| `SpiderRunner` | 章节入库后 bump 关联小说的 `content_updated_at`（增量下载/单章补录都触发） |
| `TranslationRunner` | 翻译完成后 bump `content_updated_at`（译文也是内容变化，需触发 bilingual/translated 制品重建） |
| `routes/control-center.ts` | 新增 `GET/PUT /api/control/preferences/opds`、`GET /api/control/opds/runs` |
| `routes/library.ts` | 新增 `GET/PUT /api/library/novels/:sourceId/:novelId/opds`、`GET/PUT /api/library/opds/novels` |
| `app.ts` | `createServerApp()` 初始化 `OpdsCompilationService`，传入依赖 |

## 3. 数据模型

### 3.1 `novels` 表新增列（迁移）

```sql
ALTER TABLE novels ADD COLUMN opds_visible INTEGER NOT NULL DEFAULT 0;   -- 0/1，默认不公开
ALTER TABLE novels ADD COLUMN content_updated_at TEXT;                   -- ISO 时间戳，章节入库时 bump
ALTER TABLE novels ADD COLUMN epub_compiled_at TEXT;                     -- ISO 时间戳，制品生成时更新
```

- `opds_visible` 默认 `0`，符合 ROADMAP「默认不公开分发」
- `content_updated_at` 初始值 = 该书最近一次 `MAX(chapters.updated_at)`（迁移时回填一次）
- `epub_compiled_at` 初始 `NULL`，表示尚未生成过制品 → 首次扫描必然触发生成

### 3.2 新增审计表 `opds_compilation_runs`

```sql
CREATE TABLE IF NOT EXISTS opds_compilation_runs (
  id                 TEXT NOT NULL PRIMARY KEY,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed'
  total_scanned      INTEGER NOT NULL DEFAULT 0,
  compiled           INTEGER NOT NULL DEFAULT 0,       -- 实际生成/更新制品的书数
  skipped            INTEGER NOT NULL DEFAULT 0,       -- 已是最新，跳过
  errored            INTEGER NOT NULL DEFAULT 0
);
```

### 3.3 `system-preferences.json` 新增段

```json
{
  "opds": {
    "enabled": false,
    "scanCronExpression": "0 */6 * * *",
    "updatedAt": null
  }
}
```

- 只用 `cron` 一种模式（OPDS 扫描不需要 interval/weekly 那么多花样，cron 已能表达任意周期）
- `enabled` 为总开关，关闭时调度器空闲
- 前端复用现有 `CronEditor` 组件做表达式编辑与预览（表现层实现）
- 偏好迁移策略：`loadPersistedPreferences` 中对缺失的 `opds` 段填充上述默认值

### 3.4 制品目录结构

```
data/opds-artifacts/
  <sourceId>/<novelId>/
    original.epub
    translated.epub      -- 仅当该书有翻译时存在
    bilingual.epub       -- 仅当该书有翻译时存在
```

- 固定文件名，OPDS 端点可稳定引用
- 重新生成时直接覆盖同名文件
- 删除书籍或关闭 `opds_visible` 时**不自动清理**制品文件（避免误删，留作手动导出备份）；可观测性看板可显示「制品存在但已下架」状态

## 4. 调度引擎核心逻辑

### 4.1 `#tick()` 每分钟检查

```
if (running) return          -- 上一轮未完成，跳过
if (now < nextTickAt) return -- 未到触发时间
if (!enabled) return
running = true
runScanAll() → finally: running=false, scheduleNextTick()
```

### 4.2 `#runScanAll()` 单轮扫描

```
1. 创建 opds_compilation_runs 记录（status='running'）
2. 查询所有 opds_visible=1 的小说
3. 串行遍历每本书：
   a. 取 content_updated_at 与 epub_compiled_at
   b. 若 epub_compiled_at IS NULL 或 content_updated_at > epub_compiled_at：
      - 判断翻译状态（查 chapter_translations 是否有已完成译文的章节）
      - 未翻译：仅生成 original.epub
      - 已翻译：生成 original + translated + bilingual 三件套
      - 调用 LocalExportEngine 生成 EPUB，写入 data/opds-artifacts/<sourceId>/<novelId>/
      - 成功：更新 epub_compiled_at = now，compiled++
      - 失败：errored++，日志记录错误，继续下一本（单本失败不中断）
   c. 否则：skipped++
4. 更新 opds_compilation_runs：completed_at、status='completed'、各计数
5. 全链路日志通过 SpiderLogDispatcher 推送
```

### 4.3 `content_updated_at` 的 bump 时机

- `SpiderRunner`：增量下载新章节入库后、单章补录/重试成功入库后
- `TranslationRunner`：翻译任务完成后（译文也是内容变化，需触发 bilingual/translated 制品重建）

### 4.4 并发与冲突保护

- 扫描器内部 `#running` 标志保证单轮串行
- 不查询 `ControlCenterService` 活跃任务（EPUB 生成是本地操作，不与网络爬虫冲突）
- 同一本书的三个版本制品串行生成（避免并发写同目录）
- 制品生成失败时该书的 `epub_compiled_at` **不更新**，下一轮扫描会重试

### 4.5 与 `LocalExportEngine` 的集成

复用现有 `export-engine.ts` 的 EPUB 策略，传入 `translationMode` 参数：
- `original` → `translationMode: 'original'`
- `translated` → `translationMode: 'translated'`（需注入 `translatedParagraphsByChapterId`）
- `bilingual` → `translationMode: 'bilingual'`

翻译数据从 `SqliteNovelRepository` 查询 `chapter_translations` + `chapter_translation_paragraphs` 组装，逻辑与现有 `/api/library/.../exports/epub/download?mode=translated` 路由一致（实现时抽取复用，避免重复代码）。

## 5. API 路由

基础层只暴露管理与配置 API，OPDS feed 端点在子项目 ②。

### 5.1 系统偏好（`routes/control-center.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/control/preferences/opds` | 读取 OPDS 引擎配置（`enabled`、`scanCronExpression`） |
| PUT | `/api/control/preferences/opds` | 更新 OPDS 引擎配置；校验 cron 表达式；触发 `OpdsCompilationService.reload()` |

### 5.2 单书 OPDS 可见性（`routes/library.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/library/novels/:sourceId/:novelId/opds` | 读取单书 OPDS 状态：`visible`、`contentUpdatedAt`、`epubCompiledAt`、制品文件存在性 |
| PUT | `/api/library/novels/:sourceId/:novelId/opds` | 更新单书 `opds_visible` 开关；body: `{ visible: boolean }` |

不提供「立即重建」端点（按 §1.2 决策，纯按需扫描）。

### 5.3 批量可见性管理（`routes/library.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/library/opds/novels` | 获取全量书籍的 OPDS 公开状态列表（含 `visible`、`hasTranslation`、`epubCompiledAt`） |
| PUT | `/api/library/opds/novels` | 批量更新可见性；body: `{ items: [{ sourceId, novelId, visible }] }` |

与现有 `/api/library/scheduling/novels` 模式完全对齐，前端复用同款 Modal 勾选交互（表现层实现）。

### 5.4 审计日志查询（`routes/control-center.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/control/opds/runs` | 分页查询 `opds_compilation_runs` 审计记录（`?limit=20&offset=0`） |

供子项目 ③ 可观测性看板消费。基础层先建好数据与接口，前端面板后续实现。

### 5.5 响应体约定

所有 API 遵循现有 `{ message, ... }` 错误格式与 `{ data: ... }` 成功格式（对齐 `library.ts` 现有风格）。Cron 校验失败返回 `400 { message: 'Cron 表达式无效: <reason>' }`。

## 6. 测试策略

### 6.1 测试文件

- `src/server/core/opds-compilation.test.ts` — 调度器核心逻辑
- `src/server/routes/library.test.ts`（扩展）— OPDS 可见性 API
- `src/server/routes/control-center.test.ts`（扩展）— OPDS 偏好与审计 API

### 6.2 测试约束

- **SQLite 内存数据库**（`:memory:`），与 `scheduling.test.ts`、`translation.test.ts` 一致
- **不得**依赖真实 LLM、真实网络、真实文件系统写盘（制品生成用 `LocalExportEngine` 的内存模式或临时目录 + 测试后清理）
- **不得**依赖真实 cron 触发——直接调用内部 `#runScanAll()` 或暴露 `runScanAllForTest()` 测试钩子

### 6.3 核心测试用例

**调度器**
- `enabled=false` 时 `start()` 不启动定时器
- `enabled=true` 时 `start()` 启动定时器并计算 `nextTickAt`
- `reload()` 停旧定时器并按新配置重启
- `#running` 标志防止并发重入
- cron 表达式无效时 `updateOpds()` 拒绝并抛错

**扫描逻辑**
- `opds_visible=0` 的书不被扫描
- `epub_compiled_at IS NULL` 的书首次扫描触发生成
- `content_updated_at > epub_compiled_at` 触发生成
- `content_updated_at <= epub_compiled_at` 跳过（skipped++）
- 未翻译书只生成 `original.epub`
- 已翻译书生成 `original + translated + bilingual` 三件套
- 单本生成失败不中断整体轮次（errored++，`epub_compiled_at` 不更新）
- 生成成功后 `epub_compiled_at` 更新为当前时间
- 审计记录正确写入 `opds_compilation_runs`

**`content_updated_at` bump**
- `SpiderRunner` 章节入库后 bump
- `TranslationRunner` 翻译完成后 bump

**API**
- `GET/PUT /api/control/preferences/opds` 读写配置
- `PUT` 无效 cron 返回 400
- `GET/PUT /api/library/novels/:sourceId/:novelId/opds` 读写单书状态
- `GET/PUT /api/library/opds/novels` 批量管理
- `GET /api/control/opds/runs` 分页查询审计

### 6.4 验收标准

- `npm run typecheck` 无错误
- `npm run build` 无错误
- `npm run test:server` 全部通过
- 新增测试覆盖所有核心用例

## 7. 范围边界

**本子项目包含**：
- DB 迁移与 CRUD
- `OpdsCompilationService` 调度器
- `content_updated_at` bump 点接入
- 管理与配置 API
- 后端测试

**本子项目不包含**（留给后续子项目）：
- OPDS v1/v2 feed 生成与端点（子项目 ②）
- 前端管理看板与可观测性面板（子项目 ③）
- 制品文件清理策略（后续视需要补充）
- 立即重建端点（后续视需要在表现层补充）
