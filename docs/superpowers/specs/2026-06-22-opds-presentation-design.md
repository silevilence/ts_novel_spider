# OPDS 表现层 —— 设计规格

> 日期：2026-06-22 | 状态：待实施
> 父特性：OPDS 书源服务构建与分发（ROADMAP 🚧 开发中）
> 子项目编号：③ 表现层（前端 OPDS 配置面板 + 可见性管理 Modal + 可观测性看板）
> 依赖：子项目 ① 基础层 + ② 协议层（已实现）

## 1. 概述

在基础层与协议层之上，构建前端 OPDS 管理界面：独立路由页面 `OpdsDashboard`（含启用开关、Cron 扫描周期配置、上架书单管理 Modal、统计卡片、审计日志列表），以及在书库详情页快捷操作卡片内新增单书 OPDS 可见性 Toggle。

### 1.1 关键决策

| 决策点 | 选择 |
|---|---|
| 面板布局 | 新建独立路由页面 `/opds-dashboard` |
| 可观测性范围 | 面板内嵌统计卡片 + 审计日志列表（分页） |
| 单书可见性 | 详情页快捷操作卡片内 Toggle（与定时更新开关同级） |
| 统计卡片版本分布 | 按翻译状态推算（original=可见书籍数，translated/bilingual=有翻译的书籍数） |
| 视图模型 | 独立 `opds-dashboard-model.ts` 封装 API 调用与状态管理 |

## 2. 架构

### 2.1 新增模块

**`OpdsDashboard`**（`src/web/components/opds-dashboard.tsx`）

独立 OPDS 管理页面组件，包含：
- 启用开关 + Cron 扫描周期配置（复用 `CronEditor`）
- 管理上架书单 Modal（复用 `SchedulingPanel` 的 Modal 模式）
- 统计卡片（上架书籍数、版本分布、最近扫描轮次）
- 审计日志列表（分页展示 `opds_compilation_runs`）

**`opds-dashboard-model.ts`**（`src/web/services/opds-dashboard-model.ts`）

OPDS 仪表盘视图模型，封装 API 调用与状态管理。

### 2.2 扩展现有模块

| 模块 | 变更 |
|---|---|
| `api.ts` | 新增 OPDS 相关 API 函数与类型 |
| `app-routes.ts` | 新增 `/opds-dashboard` 路由常量 |
| `App.tsx` | 注册新路由 |
| `app-shell.tsx` | 导航栏新增「OPDS 书源」入口 |
| `library-detail-view.tsx` | 快捷操作卡片内新增 OPDS 可见性 Toggle |

### 2.3 依赖关系

```
OpdsDashboard ← app-routes / App.tsx / app-shell.tsx
     ↑
opds-dashboard-model ← api.ts（新增 OPDS API）
     
LibraryDetailView（新增 OPDS Toggle）← api.ts
```

## 3. API 扩展与视图模型

### 3.1 `api.ts` 新增类型与函数

```ts
export interface OpdsConfig {
  enabled: boolean;
  scanCronExpression: string;
  updatedAt: string | null;
  lastRun: OpdsCompilationRun | null;
}

export interface OpdsCompilationRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalScanned: number;
  compiled: number;
  skipped: number;
  errored: number;
}

export interface OpdsNovelEntry {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface OpdsNovelsPayload {
  novels: OpdsNovelEntry[];
}

export interface OpdsRunsPayload {
  runs: OpdsCompilationRun[];
}

export interface NovelOpdsStatus {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export async function fetchOpdsConfig(): Promise<OpdsConfig>
export async function updateOpdsConfig(input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>): Promise<OpdsConfig>
export async function fetchOpdsNovels(): Promise<OpdsNovelsPayload>
export async function updateOpdsNovels(entries: Array<{ sourceId: string; novelId: string; visible: boolean }>): Promise<{ ok: boolean }>
export async function fetchOpdsRuns(limit?: number, offset?: number): Promise<OpdsRunsPayload>
export async function fetchNovelOpdsStatus(sourceId: string, novelId: string): Promise<NovelOpdsStatus>
export async function updateNovelOpdsVisible(sourceId: string, novelId: string, visible: boolean): Promise<NovelOpdsStatus>
```

### 3.2 `opds-dashboard-model.ts` 视图模型

```ts
export interface OpdsDashboardModel {
  config: OpdsConfig | null;
  novels: OpdsNovelEntry[];
  runs: OpdsCompilationRun[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateConfig: (input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>) => Promise<void>;
  updateNovels: (entries: Array<{ sourceId: string; novelId: string; visible: boolean }>) => Promise<void>;
  loadMoreRuns: () => Promise<void>;
}
```

视图模型封装：
- 初始加载：并行 `fetchOpdsConfig` + `fetchOpdsNovels` + `fetchOpdsRuns(20, 0)`
- `updateConfig`：调用 `updateOpdsConfig` 后刷新 config
- `updateNovels`：调用 `updateOpdsNovels` 后刷新 novels
- `loadMoreRuns`：分页加载更多审计日志（offset += 20）

### 3.3 统计卡片数据

从 `novels` 与 `config.lastRun` 计算：
- **上架书籍数**：`novels.filter(n => n.opdsVisible).length`
- **版本分布**：遍历可见书籍，统计 `hasTranslation` 的数量，推算 original/translated/bilingual 制品数（original = 可见书籍数，translated/bilingual = 有翻译的书籍数）
- **最近扫描轮次**：`config.lastRun`（与 SchedulingPanel 的 lastCheckRun 模式一致）

## 4. OpdsDashboard 组件布局

### 4.1 页面结构

```
OpdsDashboard
├── 页面标题区（Paper 卡片，与 SystemPreferences 风格一致）
│   ├── 标题「OPDS 书源服务」+ 图标
│   └── 说明文字「将书库中的作品通过 OPDS 协议分发给阅读器应用。」
│
├── 配置区（Paper 卡片）
│   ├── 启用开关（Switch）
│   ├── Cron 扫描周期（CronEditor + 预览，与 SchedulingPanel cron 模式一致）
│   └── 管理上架书单按钮（打开 Modal）
│
├── 统计卡片区（Grid，3 列）
│   ├── 上架书籍数（Badge + 数字）
│   ├── 版本分布（original / translated / bilingual 各多少）
│   └── 最近扫描轮次（时间 + 扫描/生成/跳过/出错统计）
│
├── 审计日志列表（Paper 卡片）
│   ├── 表格：开始时间 / 完成时间 / 扫描数 / 生成数 / 跳过数 / 出错数 / 状态
│   └── 加载更多按钮（分页）
│
└── 上架书单 Modal
    ├── ScrollArea.Autosize + Checkbox 列表（复用 MemoizedCheckboxItem 模式）
    └── 取消 / 保存按钮
```

### 4.2 视觉风格

- 遵循 `theme.ts` 的 `warmPaperDark` 暖色纸质暗调
- Paper 卡片背景：`rgba(31, 21, 16, 0.78)` + `border: 1px solid rgba(168,133,96,0.22)`
- 标题区与 SystemPreferences 的页面说明卡片风格一致
- 统计卡片用 Grid + Paper，数字用 Title order={2}，标签用 Text size="xs" c="dimmed"
- Badge 颜色：已开启=green，已关闭=gray，有翻译=blue，无翻译=gray

### 4.3 交互模式

- **加载状态**：`loading=true` 时显示 `<Text size="sm" c="dimmed">加载中...</Text>`
- **草稿态编辑**：Cron 表达式变更即时调用 `updateConfig`（与 SchedulingPanel 一致）
- **验证反馈**：操作成功/失败用 `onNotify`（`notifications.show()`）通知
- **Modal 交互**：打开时回填当前可见性状态，保存后通知并关闭

### 4.4 审计日志表格

```tsx
<Table>
  <thead>
    <tr>
      <th>开始时间</th>
      <th>完成时间</th>
      <th>扫描</th>
      <th>生成</th>
      <th>跳过</th>
      <th>出错</th>
      <th>状态</th>
    </tr>
  </thead>
  <tbody>
    {runs.map(run => (
      <tr key={run.id}>
        <td>{formatTimeAgo(run.startedAt)}</td>
        <td>{run.completedAt ? formatTimeAgo(run.completedAt) : '—'}</td>
        <td>{run.totalScanned}</td>
        <td>{run.compiled}</td>
        <td>{run.skipped}</td>
        <td>{run.errored}</td>
        <td><Badge color={run.status === 'completed' ? 'green' : 'yellow'}>{run.status}</Badge></td>
      </tr>
    ))}
  </tbody>
</Table>
```

- 时间用 `formatTimeAgo`（与 SchedulingPanel 一致）
- 空列表显示「暂无审计记录」

## 5. 路由注册与详情页 Toggle

### 5.1 路由注册

**`app-routes.ts`** 新增：

```ts
export const OPDS_DASHBOARD_ROUTE = '/opds-dashboard';
```

**`App.tsx`** 新增路由项（与现有 4 个主路由同级）：

```tsx
<Route path={OPDS_DASHBOARD_ROUTE} element={<OpdsDashboard onNotify={handleNotify} />} />
```

**`app-shell.tsx`** 导航栏新增入口：

```tsx
{ label: 'OPDS 书源', path: OPDS_DASHBOARD_ROUTE, icon: <IconBookShare size={18} /> }
```

- 图标用 `@tabler/icons-react` 的 `IconBookShare`
- 导航顺序：采集工作台 → 本地书库 → 任务大盘 → OPDS 书源 → 全局设置

### 5.2 LibraryDetailView OPDS Toggle

在「元数据与快捷操作」聚合卡片中新增 OPDS 可见性 Toggle，与定时更新开关同级：

```tsx
<Switch
  label="OPDS 公开分发"
  description="开启后，本书将通过 OPDS 书源服务对阅读器应用可见"
  checked={opdsStatus?.opdsVisible ?? false}
  onChange={async (event) => {
    try {
      const updated = await updateNovelOpdsVisible(sourceId, novelId, event.currentTarget.checked);
      setOpdsStatus(updated);
      onNotify({ tone: 'success', title: '已更新', message: event.currentTarget.checked ? '已加入 OPDS 分发' : '已移出 OPDS 分发' });
    } catch {
      onNotify({ tone: 'error', title: '操作失败', message: '无法更新 OPDS 可见性' });
    }
  }}
/>
```

- 初始加载时调用 `fetchNovelOpdsStatus(sourceId, novelId)` 获取状态
- 与定时更新 Toggle 并列展示
- 开启时显示 Badge「已上架」，关闭时无额外标识

## 6. 测试策略

### 6.1 测试文件

- `src/web/components/opds-dashboard.test.ts` — 组件渲染与交互测试
- `src/web/services/api.test.ts`（扩展）— OPDS API 函数测试

### 6.2 测试约束

- 前端测试用 `tsx --test`，与现有 `test:web` 一致
- API 函数测试用 mock `fetch`（与现有 `api.test.ts` 模式一致）
- 组件测试验证渲染输出与回调调用（不依赖真实后端）

### 6.3 核心测试用例

- `OpdsDashboard` 渲染标题与说明
- `OpdsDashboard` loading 状态显示「加载中...」
- `OpdsDashboard` 启用开关切换调用 `updateConfig`
- `OpdsDashboard` 统计卡片显示正确数字
- `OpdsDashboard` 审计日志表格渲染 runs
- `OpdsDashboard` 空审计日志显示「暂无审计记录」
- `fetchOpdsConfig` 调用正确 URL
- `updateOpdsConfig` 发送 PUT 请求
- `fetchOpdsRuns` 带 limit/offset 参数

### 6.4 验收标准

- `npm run typecheck` 无错误
- `npm run build` 无错误
- `npm run test:web` 全部通过
- `npm run test:server` 无回归
- 新增测试覆盖核心用例

## 7. 范围边界

**本子项目包含**：
- `OpdsDashboard` 独立页面组件
- `opds-dashboard-model.ts` 视图模型
- `api.ts` OPDS API 函数与类型
- 路由注册与导航入口
- LibraryDetailView OPDS Toggle
- 前端测试

**本子项目不包含**：
- 后端变更（基础层与协议层已完成所有后端 API）
- OPDS feed 内容定制（如分类导航、搜索等高级特性）
