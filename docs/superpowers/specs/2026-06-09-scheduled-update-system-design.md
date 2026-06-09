# 自动化定时更新调度体系 —— 设计规格

> 日期：2026-06-09 | 状态：待实施

## 1. 概述

为 TS Novel Spider 引入自动化定时更新调度能力。用户可在全局设置中配置调度策略（固定间隔 / Cron / 每周定时），指定参与更新的书籍范围；系统按策略周期检查远端目录，发现新章节后自动触发增量下载。同时提供单书快捷开关，让用户对具体书籍的参与状态一目了然。

### 1.1 关键决策

| 决策点 | 选择 |
|---|---|
| 运行方式 | 服务器进程内置调度器（`setInterval`），随 HTTP 服务启停 |
| 状态持久化 | SQLite（`scheduled_novels`、`scheduled_check_runs`） |
| 检查粒度 | 先轻量目录差分，有变化才触发 `SpiderRunner` 增量下载 |
| 并发冲突 | 跳过有活跃任务的书籍，等下一轮 |
| 调度架构 | 统一轮询循环，串行检查所有启用书籍 |

## 2. 架构

### 2.1 新增模块

**`SchedulingService`**（`src/server/core/scheduling.ts`）

```
服务启动 → 从 SQLite 恢复状态 → 读 scheduling 策略 → 计算下次触发时间
         → setInterval（每分钟 tick 检查是否到点）
         → 触发 checkAll() → 记录审计日志 → 循环
```

**依赖注入**（构造函数）：

```ts
interface SchedulingServiceDependencies {
  repository: SqliteNovelRepository;
  preferences: SystemPreferencesService;
  spiderRegistry: SpiderRegistryEntry[];
  controlCenter: ControlCenterService;  // 查询活跃任务
  logger: SpiderLogDispatcher;
}
```

### 2.2 扩展现有模块

| 模块 | 变更 |
|---|---|
| `SystemPreferencesService` | 新增 `scheduling` 配置段：`enabled`、`mode`、`intervalHours`、`cronExpression`、`weeklyDays`、`weeklyTime`；`getScheduling()` / `updateScheduling()` |
| `SqliteNovelRepository` | 新增 `scheduled_novels`、`scheduled_check_runs` 表及 CRUD |
| `ControlCenterService` | 新增 `getActiveTaskNovelKeys()` 查询活跃任务；透传调度状态 |
| `routes/control-center.ts` | 新增 `GET/PUT /api/control/scheduling` |
| `routes/library.ts` | 新增 `GET/PUT /api/library/novels/:sourceId/:novelId/scheduling`、`GET/PUT /api/library/scheduling/novels` |
| `app.ts` | 在 `createServerApp()` 中初始化 `SchedulingService`，传入依赖 |

## 3. 数据模型

### 3.1 SQLite 新增表

**`scheduled_novels`**

```sql
CREATE TABLE IF NOT EXISTS scheduled_novels (
  source_id         TEXT NOT NULL,
  novel_id          TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  last_checked_at   TEXT,
  last_check_result TEXT,  -- 'new_chapters' | 'up_to_date' | 'error' | NULL
  last_check_message TEXT,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (source_id, novel_id)
);
```

**`scheduled_check_runs`**

```sql
CREATE TABLE IF NOT EXISTS scheduled_check_runs (
  id                 TEXT NOT NULL PRIMARY KEY,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed'
  total_checked      INTEGER NOT NULL DEFAULT 0,
  new_chapters_found INTEGER NOT NULL DEFAULT 0,
  skipped            INTEGER NOT NULL DEFAULT 0,
  errored            INTEGER NOT NULL DEFAULT 0
);
```

### 3.2 system-preferences.json 新增段

```json
{
  "scheduling": {
    "enabled": false,
    "mode": "interval",
    "intervalHours": 6,
    "cronExpression": "0 */6 * * *",
    "weeklyDays": [1, 3, 5],
    "weeklyTime": "08:00",
    "updatedAt": null
  }
}
```

- 三种 `mode` 互斥：`'interval'` | `'cron'` | `'weekly'`
- 切换模式时保留其他模式的参数值（不丢失用户之前的配置）
- `enabled` 为全局总开关
- `weeklyDays` 使用 JS `Date.getDay()` 约定：`0`=周日，`1`=周一，...，`6`=周六
- Cron 表达式需服务端校验（`cron-parser.parseExpression()` 抛异常则拒绝），前端也做预校验

## 4. 调度引擎核心逻辑

### 4.1 checkAll() 单轮检查

```
1. 查询所有 enabled=1 的 scheduled_novels
2. 调用 ControlCenterService.getActiveTaskNovelKeys() 获取活跃任务列表
3. 过滤：跳过有活跃任务的书籍（skipped++）
4. 串行遍历每本书：
   a. 调用 SpiderAdapter.fetchChapterIndex() 拉远端目录
   b. 调用 repository.getChapterIndex() 取本地快照
   c. 比较章节 ID：找出本地不存在的 ID
   d. 若有新章节 → SpiderRunner.crawlNovel({ chapterIds: [newIds], forceRefetch: false })
   e. 更新 scheduled_novels 状态（last_checked_at、last_check_result、last_check_message）
   f. 单章失败不阻塞整本书，整本书失败不阻塞整轮
5. 写入 scheduled_check_runs 审计记录
6. 推送 SSE 日志事件
```

### 4.2 下次触发时间计算

- **interval**：`lastCompletedAt + intervalHours * 3600 * 1000`
- **cron**：使用 `cron-parser` 解析表达式，取 `now` 后下一次匹配时间
- **weekly**：取 `weeklyDays` 中 `now` 之后最近的匹配日 + `weeklyTime` 组合为 `Date`

### 4.3 服务启动恢复

- 若有 `status='running'` 的 `scheduled_check_runs` 记录（上次异常退出），标记为 `completed` 并备注中断
- 基于 `scheduled_check_runs` 最后一条 `completed` 记录的时间计算下次触发
- 若策略配置变更（`updatedAt` > 上次完成时间），立即重新计算下次触发时间

## 5. API 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/control/scheduling` | 读取全局调度策略 + 当前轮次状态 |
| `PUT` | `/api/control/scheduling` | 更新全局调度策略，重置下次触发时间 |
| `GET` | `/api/library/novels/:sourceId/:novelId/scheduling` | 读取单书定时更新状态 |
| `PUT` | `/api/library/novels/:sourceId/:novelId/scheduling` | `{ enabled: boolean }` 开关单书 |
| `GET` | `/api/library/scheduling/novels` | 列出所有书籍的 `{ sourceId, novelId, title, enabled }` |
| `PUT` | `/api/library/scheduling/novels` | `{ novels: [{ sourceId, novelId, enabled }] }` 批量更新 |

### 5.1 路由归属

- 全局配置走 `routes/control-center.ts`（与 network-proxy、preferences 一致）
- 单书和批量管理走 `routes/library.ts`（与 aliases、bookmarks 一致）

## 6. 前端 UI

### 6.1 全局设置面板（`SystemPreferences` 新增 Accordion 项）

- **折叠态**：显示"定时更新"标题 + 状态 Badge（已开启/已关闭）+ "管理书单"按钮
- **展开态**：
  - 全局开关 Toggle
  - 调度模式 SegmentedControl（固定间隔 / Cron / 每周定时）
  - 根据模式渲染对应配置控件：
    - 固定间隔：`NumberInput`（小时）+ 下次触发时间预览
    - Cron：`TextInput` + 合法性校验 + 未来 5 次预览 + Quick Config 按钮
    - 每周定时：星期多选 `Chip` 组 + `TimeInput`
- 遵循现有 Mantine v7 + 暖色纸质暗调风格
- 全局通知使用 `@mantine/notifications`

### 6.2 管理书单 Modal

- 从设置面板"管理书单"按钮唤起
- 全量本地书籍列表 + `Checkbox` 勾选
- 自动回填当前 `enabled` 状态
- "保存"/"取消"按钮

### 6.3 单书详情页 Toggle

- 位置：`LibraryDetailView` 的"元数据与快捷操作"聚合卡片内
- 外观：独立控件，使用品牌色 `#ffd166` 边框区分
- 状态文案：
  - `NULL`（从未检查）→ "等待首次检查"
  - `new_chapters` → "上次检查发现 N 个新章节 · 已自动下载"（绿色）
  - `up_to_date` → "上次检查 Xh 前 · 已是最新"（灰色）
  - `error` → "上次检查失败，下轮重试"（红色）

## 7. 日志与可观测性

调度引擎全链路输出结构化日志事件，接入 `SpiderLogDispatcher`，在监控大盘实时可见：

| 事件类型 | 触发时机 |
|---|---|
| `scheduling_round_started` | 每轮检查开始 |
| `scheduling_novel_checking` | 开始检查某本书 |
| `scheduling_novel_checked` | 某本书检查完成（含结果摘要） |
| `scheduling_novel_skipped` | 某本书因活跃任务跳过 |
| `scheduling_novel_error` | 某本书检查出错 |
| `scheduling_download_triggered` | 触发增量下载 |
| `scheduling_round_completed` | 本轮检查结束（含汇总统计） |

## 8. 依赖

- **新增 npm 依赖**：`cron-parser`（Cron 表达式解析与下次时间计算）
- **无新增系统依赖**

## 9. 测试策略

| 测试文件 | 覆盖内容 |
|---|---|
| `src/server/core/scheduling.test.ts`（新增） | 策略解析、下次触发计算、差分检测、冲突跳过、异常隔离；SQLite 内存数据库 |
| `src/server/core/system-preferences.ts`（扩展） | `scheduling` 序列化/反序列化、默认值迁移 |
| `src/server/routes/control-center.test.ts`（扩展） | `GET/PUT /api/control/scheduling` |
| `src/server/routes/library.test.ts`（扩展） | 单书开关 + 批量管理端点 |
| 前端 | 模式切换、输入校验、Modal 回填、Toggle 状态 |

## 10. 文件变更清单

| 文件 | 操作 |
|---|---|
| `src/server/core/scheduling.ts` | 新增 |
| `src/server/core/scheduling.test.ts` | 新增 |
| `src/server/core/system-preferences.ts` | 扩展（scheduling 配置段） |
| `src/server/core/novel-repository.ts` | 扩展（新表 + 迁移 + CRUD） |
| `src/server/core/control-center.ts` | 扩展（活跃任务查询 + 调度状态透传） |
| `src/server/routes/control-center.ts` | 扩展（scheduling 全局端点） |
| `src/server/routes/library.ts` | 扩展（单书 + 批量端点） |
| `src/server/app.ts` | 扩展（初始化 SchedulingService） |
| `src/web/components/system-preferences.tsx` | 扩展（新增定时更新面板） |
| `src/web/components/library-detail-view.tsx` | 扩展（新增 Toggle 控件） |
| `src/web/services/api.ts` | 扩展（新增 API 调用） |
| `src/web/services/control-center-model.ts` | 扩展（相关类型） |
| `src/web/services/library-model.ts` | 扩展（相关类型） |
