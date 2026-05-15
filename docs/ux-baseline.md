# UX Baseline — 页面-组件-交互责任表 & 视觉 Token 规则

> Phase 1 / Step 1 交付物。只记录现状，不做优劣判断。
> 生成日期: 2026-05-15

---

## 1. 页面清单与路由拓扑

| 路由 ID | 路径 | 标签 | 页面标题 | 主组件 | 子视图 |
|---------|------|------|---------|--------|--------|
| `control` | `/` | 开始抓取 | 开始抓取 | `ControlConsole` | — |
| `library` | `/library` | 本地书库 | 本地书库 | `LibraryWorkspace` | 总览页 / 详情页 / 阅读器 |
| `monitor` | `/monitor` | 任务进度 | 任务进度 | `MonitorDashboard` | — |
| `settings` | `/settings` | 下载设置 | 下载设置 | `SystemPreferences` | — |

**Library 子视图路由**:
- `/library/:sourceId/:novelId` → `view: 'detail'`（单本详情）
- `/library/:sourceId/:novelId/read/:chapterId` → `view: 'reader'`（阅读器）

**路由机制**: 自定义 `window.history.pushState` + `popstate` 事件，无 React Router。

---

## 2. 页面-组件-交互责任矩阵

### 2.1 全局壳层 (`App` + `AppShell`)

| 交互元素 | 负责组件 | 文件 | 说明 |
|---------|---------|------|------|
| 全局布局容器 | `AppShell` | `app-shell.tsx` | `display: grid; gap: 1.5rem; padding: 1.6rem 1.25rem 6.5rem` |
| 品牌标识 + 页面标题 + 副文案 | `AppShell` > `shell-header` > `route-header` | `app-shell.tsx:37-42` | eyebrow "TS Novel Spider" + h1 标题 + hero-copy 描述 |
| 主导航 (4 按钮) | `AppShell` > `shell-nav` | `app-shell.tsx:44-51` | flex wrap，`shell-nav-button` active 态渐变高亮 |
| 状态摘要卡片 (4 列) | `AppShell` > `shell-summary` | `app-shell.tsx:53-70` | 服务状态/当前任务/可用站点/最近更新 |
| 全局通知 | `NotificationCenter` | `notification-center.tsx` | 右上角 fixed toast-stack，z-index: 20，4.2s 自动消失 |
| 页面内容区 | `AppShell` > `page-content` | `app-shell.tsx:73` | children 注入点，display: grid; gap: 1.25rem |

**约束**: 导航按钮无 sticky/fixed 定位，头部在文档流内。

### 2.2 控制台页 (`ControlConsole`)

| 交互元素 | 组件/文件 | 说明 |
|---------|----------|------|
| 页面标题区 | `hero route-hero` | eyebrow "开始抓取" + h2 + route-copy |
| 摘要条 (3 列) | `route-summary-strip` > `summary-tile` × 3 | 当前站点 / 待抓取章节 / 下载设置 |
| 表单 (站点选择 + 作品编号) | `control-form` > `control-form-grid` (2 列) | onSubmit → preview，含更多设置链接 + 策略说明 |
| 元数据看板 | `MetadataBoard` | 4 列 grid：标题、章数、原站链接、简介、标签、本地快照 |
| 章节目录 | `ChapterDirectory` (mode='select') | 卷折叠、搜索过滤、全选/多选/清空、状态徽章 |
| 底部操作栏 | `action-dock` (sticky, bottom: 1rem) | 已选章数 + 打开设置/解析目录/下发抓取 |

### 2.3 书库页 (`LibraryWorkspace`)

| 视图 | 交互元素 | 说明 |
|------|---------|------|
| 总览 | 标题区 + 摘要条 (3 列: 已入库/已下载/未下载) | hero route-hero |
| 总览 | 搜索工具栏 (输入框 + 语法提示 + 清空) | library-search-toolbar |
| 总览 | 语法提示展开区 | 可折叠 card，含示例按钮 |
| 总览 | 操作按钮行 (去抓取新作品 / 刷新书库) | action-row |
| 总览 | 书库网格 (auto-fit, minmax 260px) | library-grid，每卡含标题/作者/简介预览/标签/状态/继续阅读 |
| 详情 | 元数据区 + 目录 + 别名管理 + 书签面板 + 导出 | 多个 panel section |
| 阅读器 | 标题区 + 操作栏 (返回/上章/下章/目录/书签) | hero route-hero |
| 阅读器 | 正文 + 媒体摘要 + 图片画廊 | reader-layout, reader-copy |
| 阅读器 | 目录抽屉 (FAB 唤起) | reader-directory-fab (fixed, z-index: 12) + overlay (z-index: 14) |
| 阅读器 | 排版悬浮面板 | `isReaderTypographyOpen` 控制的 popover |
| 阅读器 | 脚部导航 (上章/下章) | reader-footer-nav |

### 2.4 监控页 (`MonitorDashboard`)

| 交互元素 | 组件/文件 | 说明 |
|---------|----------|------|
| 页面标题区 | hero route-hero | eyebrow "任务进度" + h2 + route-copy |
| 摘要条 (3 列) | route-summary-strip | 实时同步状态 / 最近任务数 / 失败章节 |
| 运行总览面板 | `StatusPanel` | 服务状态/可用站点/当前任务/最近更新 (auto-fit grid) |
| 任务监控面板 | `TaskMonitor` | 两栏布局: 当前任务进度 + 最近任务历史列表 |

### 2.5 设置页 (`SystemPreferences`)

| 交互元素 | 组件/文件 | 说明 |
|---------|----------|------|
| 页面标题区 | hero route-hero | eyebrow "系统偏好" + h2 + route-copy |
| 摘要条 (3 列) | settings-summary-strip | 默认并发 / 重试次数 / 目录策略 |
| 折叠卡片 × 5 | `fold-card` | 任务选项(默认展开) / 代理 / LLM / Neo4j / 阅读器排版 |

---

## 3. 关键滚动容器

| 容器 | 位置 | 滚动行为 |
|------|------|---------|
| `body` / `#root` | 全局 | 主滚动容器 |
| `.app-shell` | 全局壳层 | `padding-bottom: 6.5rem` 为底部操作栏留空间 |
| `.log-list` | 监控页 | `max-height: 360px; overflow: auto` |
| `.reader-directory-drawer` | 阅读器 | `height: 100vh; overflow: auto` |
| `.description-dialog-body` | 书库 | `max-height: calc(100vh - 13rem); overflow: auto` |
| `.export-dialog` | 书库 | `max-height: calc(100vh - 2rem); overflow: auto` |

---

## 4. 固定/悬浮/粘性元素清单

| 元素 | 类名 | 定位方式 | z-index | 触发条件 |
|------|------|---------|---------|---------|
| 全局通知 | `.toast-stack` | fixed, top/right 1.1rem | 20 | 有通知时渲染 |
| 阅读器 FAB | `.reader-directory-fab` | fixed, right/bottom 1.5rem | 12 | 阅读器视图始终显示 |
| 目录抽屉遮罩 | `.reader-directory-overlay` | fixed, inset 0 | 14 | 目录打开时 |
| 底部操作栏 | `.action-dock` | sticky, bottom 1rem | 5 | 控制台页始终显示 |
| 网格纹理背景 | `body::before` | fixed, inset 0 | — | 始终存在 (pointer-events: none) |

---

## 5. 折叠点清单

| 折叠对象 | 组件/文件 | 状态管理 | 初始状态 |
|---------|----------|---------|---------|
| 章节目录分组 | `ChapterDirectory` | `collapsedGroups: Record<string, boolean>` | 全部展开 |
| 设置-任务选项 | `SystemPreferences` | `crawlOpen: boolean` | 展开 |
| 设置-代理 | `SystemPreferences` | `proxyOpen: boolean` | 折叠 |
| 设置-LLM | `SystemPreferences` | `llmOpen: boolean` | 折叠 |
| 设置-Neo4j | `SystemPreferences` | `neo4jOpen: boolean` | 折叠 |
| 设置-阅读器排版 | `SystemPreferences` | `readerOpen: boolean` | 折叠 |
| 书库-语法提示 | `LibraryWorkspace` | `isSearchGuideOpen: boolean` | 折叠 |
| 书库-导出对话框 | `LibraryWorkspace` | `isExportDialogOpen: boolean` | 折叠 |
| 书库-简介全文 | `LibraryWorkspace` | `descriptionDialog` (nullable) | 折叠 |
| 阅读器-目录抽屉 | `LibraryWorkspace` | `isReaderDirectoryOpen: boolean` | 折叠 |
| 阅读器-排版面板 | `LibraryWorkspace` | `isReaderTypographyOpen: boolean` | 折叠 |
| AI 伴读面板 | `LibraryIntelligencePanel` | 多个内部折叠状态 | — |

---

## 6. 主要按钮类型清单

| 类型 | CSS 类 | 视觉特征 | 使用场景 |
|------|--------|---------|---------|
| 主操作按钮 | `.primary-button` | 橙色渐变, 阴影, 深色文字 | 下发任务/下载/保存/确认 |
| 主操作链接 | `.primary-link` | 同 primary-button, `<a>` 标签 | 导出下载链接 |
| 次要按钮 | `.secondary-button` | 暗色背景 + 边框 | 继续阅读/解析目录/上一章 |
| 弱操作按钮 | `.ghost-button` | 暗色背景 + 边框 | 设置/筛选/折叠/导航 |
| 弱操作 subtle | `.ghost-button.subtle` | 灰色文字 | 次要设置入口 |
| 弱操作 danger | `.ghost-button.danger` | 红色文字 + 红背景 | 删除操作 |
| 文本按钮 | `.text-button` | 无背景无边框, 蓝色文字 | 查看全文/展开 |
| 导航按钮 | `.shell-nav-button` | 暗色背景 + 边框, active 渐变 | 主导航 |
| 折叠切换 | `.volume-toggle` | 全宽透明, 文字左对齐 | 卷组折叠 |
| 历史按钮 | `.history-button` | 全宽, 左右分布 | 任务历史列表 |
| 章节链接 | `.chapter-link-button` | 全宽透明, 文字左对齐 | inspect 模式章节导航 |
| 预设芯片 | `.preset-chip` | 圆角标签 | 字号/字体预设切换 |

---

## 7. 视觉 Token 速查

### 7.1 色彩系统

| Token | 值 | 语义 |
|-------|-----|------|
| `--bg` | `#06121f` | 页面背景 |
| `--bg-soft` | `#0c2032` | 软背景 |
| `--panel` | `rgba(8,24,39,0.84)` | 面板背景 |
| `--panel-strong` | `rgba(13,33,51,0.96)` | 面板强调 |
| `--panel-muted` | `rgba(12,27,43,0.7)` | 面板弱化 |
| `--ink` | `#f4f7fb` | 主文本 |
| `--muted` | `#9eb1c4` | 辅助文本 |
| `--accent` | `#ff8c42` | 主强调 (橙) |
| `--accent-strong` | `#ffd166` | 强强调 (金黄) |
| `--accent-soft` | `rgba(255,140,66,0.14)` | 强调弱化 |
| `--line` | `rgba(158,177,196,0.16)` | 边框浅 |
| `--line-strong` | `rgba(158,177,196,0.28)` | 边框深 |
| `--ok` | `#61d4a6` | 成功 (绿) |
| `--warn` | `#ffd166` | 警告 (黄) |
| `--danger` | `#ff7b72` | 危险 (红) |

### 7.2 间距节奏

| 间距 | 使用场景 |
|------|---------|
| `0.2rem` | 章节标题内 gap |
| `0.25rem` | dock-copy gap |
| `0.28rem` | badge padding |
| `0.35rem` | panel-heading, label gap |
| `0.42rem` | 章节列表 gap |
| `0.5rem` | badge-row gap |
| `0.65rem` | chapter-row gap |
| `0.75rem` | shell-nav, action-row, volume-list gap |
| `0.8rem` | library-grid gap |
| `0.85rem` | provider-workbench, task-summary-panel gap |
| `0.9rem` | shell-summary gap |
| `1rem` | control-form, reader-copy, fold-content gap |
| `1.1rem` | panel 内部 gap |
| `1.2rem` | shell-hero, route-hero gap |
| `1.25rem` | page-content, shell-header padding |
| `1.5rem` | app-shell gap, hero padding |
| `1.6rem` | app-shell padding-top |

### 7.3 圆角阶梯

| 值 | 用途 |
|----|------|
| `14px` | input/select/textarea, 图片 |
| `16px` | chapter-item, library-search-bar input |
| `18px` | media-card, model-discovery-item, reader-media-summary |
| `20px` | card, shell-stat, summary-tile, volume-card, toast, empty-state |
| `24px` | control-form, action-dock |
| `28px` | panel, shell-header, hero, fold-card, export-dialog |
| `999px` | button, badge, tag, count-chip, link |

### 7.4 Z-Index 层级

| 层级 | 元素 |
|------|------|
| 5 | `action-dock` (sticky 底部操作栏) |
| 12 | `reader-directory-fab` (阅读器 FAB) |
| 14 | `reader-directory-overlay` (目录抽屉遮罩) |
| 20 | `toast-stack` (全局通知) |

### 7.5 字体族

| 用途 | 字体栈 |
|------|--------|
| 全局正文 | `"IBM Plex Sans", "Segoe UI", "PingFang SC", sans-serif` |
| 标题 (h1/h2/h3) | `"Alegreya", "Noto Serif SC", Georgia, serif` |
| 阅读器正文 | 可配置 (sans/serif/monospace/custom) |

### 7.6 过渡动画

| 属性 | 时长 | 缓动 |
|------|------|------|
| button transform/box-shadow/background/border-color | 140ms | ease |
| link hover | 140ms | ease |

---

## 8. 响应式断点

| 断点 | 主要影响 |
|------|---------|
| `max-width: 1220px` | 图表面板布局调整 |
| `max-width: 900px` | 核心响应式: 所有多列 grid → 单列, flex → column, dock/actions 竖向排列 |
| `max-width: 820px` | Neo4j 面板微调 |
| `max-width: 720px` | 紧凑模式: app-shell padding 缩小, 按钮全宽 |

---

## 9. 现有长页面可达性缺陷 (仅记录, 不评价)

| 页面 | 现状 |
|------|------|
| 控制台 | 仅底部 `action-dock` 为 sticky; 无回到顶部/目录锚点 |
| 书库总览 | 无悬浮导航; 依赖浏览器原生滚动 |
| 单本详情 | 无悬浮导航; 别名/书签/导出/目录各区无锚点跳转 |
| 阅读器 | 已有 FAB (目录抽屉) 但无回到顶部/到底部; 章节切换后自动 scrollTo(0,0) |
| 监控页 | 无悬浮导航 |
| 设置页 | 5 个 fold-card 纵向排列; 无折叠全部/展开全部快捷操作 |
