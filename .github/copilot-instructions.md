# TS Novel Spider - Copilot 辅助开发指南

> **🚫 Git 提交禁令**：除非用户在当前对话中**显式要求**提交（如"提交"、"commit"、"push"），否则**绝对禁止**执行任何 git 提交或推送操作。包括但不限于：`git commit`、`git push`、`git add` + `git commit`。允许的操作：`git status`、`git log`、`git diff` 等只读或用户明确要求的操作。此规则适用于所有场景——日常改代码、触发技能（brainstorming/writing-plans/executing-plans/finishing-a-development-branch 等）、子代理执行，无一例外。

> 提问时优先使用相关工具

## 1. 项目概述 (Project Overview)

- **核心定位**：基于 TypeScript 的自动化小说爬虫与多格式导出工具。
- **主要功能**：通过 Web 管控界面调度爬虫，抓取小说内容并持久化至本地 SQLite，支持离线阅读、多格式导出（Markdown、EPUB、TXT）、AI 翻译与知识图谱分析。
- **架构模式**：前后端分离但合并部署的 B/S 架构。
  - **前端 (src/web)**：纯视图层，负责参数配置、目录浏览、实时监控与任务调度。
  - **后端 (src/server)**：核心执行层，负责爬虫调度、网页解析、SQLite 持久化、文件导出与 SSE 事件推送。后端任务完全独立于前端会话，前端关闭不影响任务执行。

## 2. 技术栈 (Tech Stack)

| 层 | 技术 |
|---|---|
| 后端 | Node.js ≥ 20, Express 5, `better-sqlite3`, `cheerio` |
| 前端 | React 19, Mantine v7, `@emotion/react`, `@emotion/styled`, `@tabler/icons-react`, Vite 6, TypeScript strict 模式 |
| AI / 图谱 / 翻译 | `ai` (Vercel AI SDK), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `ai-sdk-ollama`, `@langchain/core`, `@langchain/langgraph`, `neo4j-driver`, `zod`, `jsonrepair` |
| 导出 | `jszip`（EPUB 打包） |
| 工程化 | `tsx` (watch + test runner), `concurrently`, Docker multi-stage build |

**禁止降级**：不得将 Express 5 降回 v4；不得关闭 TypeScript strict 模式；不得将 Mantine 降回 v6 或更早版本。

## 3. 目录结构规范 (Directory Structure)

```text
.
├── src/
│   ├── server/
│   │   ├── adapters/
│   │   │   ├── log/               # 日志适配器（InMemoryLogAdapter 等）
│   │   │   └── spider/            # 站点爬虫适配器
│   │   │       ├── syosetu-18-spider-adapter.ts   # Syosetu18 具体实现
│   │   │       ├── syosetu-spider-adapter.ts      # Syosetu（继承 Syosetu18）
│   │   │       ├── syosetu-spider-adapter.test.ts # 爬虫适配器测试
│   │   │       └── mock-html-spider-adapter.ts    # 测试用 Mock
│   │   ├── core/
│   │   │   ├── spider.ts              # SpiderAdapter 接口 + BaseHtmlSpiderAdapter 抽象类
│   │   │   ├── spider-runner.ts       # 批量抓取调度器（含并发、重试、异常隔离）
│   │   │   ├── control-center.ts      # ControlCenterService（任务生命周期、Spider 注册表）
│   │   │   ├── novel-repository.ts    # SQLite ORM（SqliteNovelRepository，含图谱/偏好/书签/翻译等表）
│   │   │   ├── offline-library.ts     # 离线书库服务（章节详情、媒体资产、别名、书签、进度）
│   │   │   ├── export-engine.ts       # 本地导出引擎（Markdown / EPUB / TXT，含翻译模式）
│   │   │   ├── network-proxy.ts       # 网络代理服务（持久化至 .data/network-proxy.json）
│   │   │   ├── logging.ts             # SpiderLogDispatcher + SpiderLogAdapter 接口
│   │   │   ├── system-preferences.ts  # 系统偏好服务（LLM 配置、模型网关、Neo4j、阅读排版、翻译偏好）
│   │   │   ├── library-intelligence.ts # 知识图谱与 AI 伴读核心服务
│   │   │   ├── library-intelligence-rag.ts # 图谱提取与 RAG 检索底层实现
│   │   │   ├── library-search.ts      # 本地书库多维度搜索与相关性排序
│   │   │   ├── translation-pipeline.ts # LangGraph 翻译流水线（分段→翻译→组装→定稿）
│   │   │   ├── translation-runner.ts  # 翻译任务调度器（并发、重试、异常隔离）
│   │   │   ├── translation-service.ts # 翻译生命周期管理（启动/取消/进度查询/术语库 CRUD）
│   │   │   ├── translation-state.ts   # 翻译状态类型定义（段落、草稿、术语条目）
│   │   │   └── translation/           # 翻译流水线子节点
│   │   │       └── nodes/             # segment / translate / assemble / review / finalize / history-manager / llm-logger
│   │   ├── routes/
│   │   │   ├── control-center.ts  # /api/control 路由
│   │   │   ├── library.ts         # /api/library 路由
│   │   │   └── health.ts          # /api/health 路由
│   │   ├── app.ts                 # createServerApp()，挂载路由与静态资源
│   │   └── index.ts               # HTTP 监听入口
│   └── web/
│       ├── components/
│       │   ├── app-shell.tsx              # 全局壳层（导航、摘要卡片、通知）
│       │   ├── control-console.tsx        # 开始抓取页面
│       │   ├── chapter-directory.tsx      # 章节目录（含增量状态高亮）
│       │   ├── metadata-board.tsx         # 小说元数据展示
│       │   ├── library-workspace.tsx      # 书库路由壳层
│       │   ├── library-list-view.tsx      # 书库列表页
│       │   ├── library-detail-view.tsx    # 书库详情页（含工具标签页）
│       │   ├── library-reader-view.tsx    # 阅读器页（含双语模式）
│       │   ├── library-intelligence-panel.tsx # AI 伴读对话面板
│       │   ├── library-shared.ts          # 书库模块共享类型与工具
│       │   ├── monitor-dashboard.tsx      # 任务进度监控大盘
│       │   ├── system-preferences.tsx     # 全局设置页（含各子面板路由）
│       │   ├── llm-provider-panel.tsx     # 大模型服务商配置面板
│       │   ├── model-gateway-panel.tsx    # 模型网关（按能力路由）
│       │   ├── neo4j-panel.tsx            # Neo4j 图数据库连接配置
│       │   ├── network-proxy-panel.tsx    # 网络代理配置
│       │   ├── reader-typography-panel.tsx # 阅读器排版偏好
│       │   ├── font-family-picker.tsx     # 字体族选择器
│       │   ├── language-picker.tsx        # 翻译源/目标语言选择器
│       │   ├── reader-fab-bar.tsx         # 阅读器悬浮快捷按钮栏
│       │   ├── scrollspy-nav.tsx          # 页面导航高亮指示
│       │   ├── status-panel.tsx           # 状态摘要卡片
│       │   ├── translation-launch-panel.tsx  # 翻译任务发起面板
│       │   └── translation-profile-panel.tsx # 翻译配置与进度面板
│       ├── services/              # API 封装（api.ts）+ 视图模型
│       ├── theme.ts               # Mantine 主题定义（暖色纸质暗调）
│       ├── styles.css             # 全局样式
│       ├── App.tsx                # 路由配置入口
│       └── vite.config.ts
├── scripts/ci/                    # CI 发布准备脚本
├── docs/                          # UX 设计规范与开发备忘
├── data/
│   ├── exports/                   # 导出文件输出目录
│   └── offline-assets/            # 离线图片缓存
├── .data/                         # 运行时数据（SQLite、代理配置、系统偏好）— 不提交 Git
├── Dockerfile                     # 生产镜像（multi-stage）
├── Dockerfile.dev                 # 开发镜像（国内加速源）
├── docker-compose.yml             # 生产编排（消费 ghcr.io 镜像）
├── docker-compose.dev.yml         # 本地开发编排
├── tsconfig.json                  # 根 TS 配置（前端路径映射）
└── tsconfig.server.json           # 后端 TS 配置（输出至 dist/server）
```

## 4. 核心架构与关键约束 (Architecture & Constraints)

### 4.1 策略模式：SpiderAdapter

- 所有站点适配器必须继承 `BaseHtmlSpiderAdapter`（定义于 `src/server/core/spider.ts`）。
- 必须实现：`sourceId`、`getInfoPageUrl()`、`fetchMetadata()`、`fetchChapterIndex()`、`fetchChapter()`。
- 注入 `fetchHtml` 函数（`SpiderHtmlFetcher` 类型）实现请求与解析解耦，测试时传入本地 fixture HTML，线上使用 `createProxyAwareHtmlFetcher`。
- 新增站点爬虫时，在 `src/server/adapters/spider/` 下创建文件，并在 `ControlCenterService` 构造函数的 spider 注册表中追加条目。

### 4.2 日志适配器：SpiderLogAdapter

- 接口定义在 `src/server/core/logging.ts`，通过 `SpiderLogDispatcher` 分发到多个适配器。
- `InMemoryLogAdapter`（`src/server/adapters/log/`）用于测试和任务快照存储。
- SSE 推送通过订阅 `ControlCenterService` 的任务事件实现，**SSE 流必须在 `subscribeToTask` 之前设置好响应头**，因为订阅会同步触发当前快照推送。

### 4.3 后台运行与异常隔离

- 批量抓取逻辑在 `SpiderRunner` 中，每章独立 `try/catch`，单章失败不中断整体任务。
- 任务 Promise 链不依赖 HTTP 请求保活，前端断连后任务继续运行。

### 4.4 增量更新

- `PreviewNovelResult` 中的 `chapters` 字段使用 `ResolvedChapterState`，包含 `persistStatus`（`'indexed' | 'downloaded' | 'failed'`）字段，标识本地缓存状态。
- 前端在选章时依据此状态高亮区分"新增"与"已下载"章节。

### 4.5 网络代理

- 全局代理状态由 `NetworkProxyService` 管理，代理配置持久化至 `.data/network-proxy.json`，服务器启动时自动恢复。
- Spider 适配器通过 `createProxyAwareHtmlFetcher` 获得代理感知的 fetch 函数，不得直接硬编码 `fetch`。

### 4.6 Express 5 注意事项

- SPA 回退路由使用 `app.use(fallback)` 中间件，**不得使用** `app.get('*', ...)` （Express 5 已弃用）。

### 4.7 系统偏好：SystemPreferencesService

- `SystemPreferencesService`（`src/server/core/system-preferences.ts`）管理五类全局配置，均持久化至 `.data/system-preferences.json`：
  - **LLM 提供商配置**（`LlmProviderConfig`）：支持 openai-compatible / anthropic / google-generative-ai / ollama 四种类型，每个提供商可配置多个模型，每个模型可手动或自动映射能力标签（chat / embedding / rerank）。
  - **模型网关配置**（`LlmModelGatewayConfig`）：为 chat / embedding / rerank 三种能力分别指定默认模型路由，AI 功能（伴读、图谱、翻译）按能力自动选择相应模型。
  - **Neo4j 图数据库连接**（`Neo4jConfig`）：URI、用户名、密码，支持连接验证。
  - **阅读器排版偏好**（`ReaderTypographyConfig`）：全局默认字体族、字号、行高、段间距。
  - **翻译偏好**（`TranslationPreferencesConfig`）：默认源语言、目标语言、翻译模型、段落并发数等。
- LLM API Key 以明文存储于 JSON 文件中，注意安全边界。
- 模型能力检测通过发送轻量 API 请求验证，结果缓存在内存中。

### 4.8 知识图谱与 AI 伴读：LibraryIntelligenceService

- `LibraryIntelligenceService`（`src/server/core/library-intelligence.ts`）编排知识图谱构建与 AI 问答。
- 底层抽取与检索逻辑位于 `src/server/core/library-intelligence-rag.ts`，使用 Vercel AI SDK 调用 LLM 进行实体/关系抽取和 RAG 检索。
- 图谱构建支持 **full**（全量重建）、**incremental**（增量追加）、**rebuild**（先清空再全量）三种模式。
- 构建过程可暂停/恢复，状态持久化至 SQLite。每个小说可独立配置抽取模型池与并发数。
- LLM 提取失败时不再回退到本地启发式规则（已移除 `extractChunkHeuristically` 调用路径），失败片段标记 `status='failed'`，可通过 `POST .../graph/retry-failed` 端点单独重试。
- `knowledge_graph_build_checkpoints` 表有 `status` 字段（`'success' | 'failed'`），构建入口强制要求至少配置一个提取模型。
- AI 伴读采用混合检索：元数据 + 图谱子图 + 章节块（关键词评分 + 向量余弦相似度 + 可选重排序）。
- OpenAI 兼容接口需确保 base URL 包含 `/v1` 路径（若原始 URL 无 path 则自动补齐）。
- 支持将本地图谱数据同步至 Neo4j 图数据库（`POST .../graph/sync-neo4j`），用于与外部工具联动分析。
- 图谱功能为 **实验性**，未经用户明确要求不得主动启用或宣传为稳定功能。

### 4.9 书库搜索：LibrarySearch

- `searchLibraryNovels()`（`src/server/core/library-search.ts`）实现结构化查询解析器。
- 支持字段限定搜索（`name:`、`author:`、`tag:`、`site:`、`alias:` 等），逻辑运算符 `+`（与）、`,`（或）、`-`（非），以及括号分组。
- 搜索结果按相关性评分降序排列，同分按更新时间倒序。

### 4.10 翻译流水线：TranslationService

- `TranslationService`（`src/server/core/translation-service.ts`）管理翻译任务的全生命周期：启动、取消、进度查询、术语库管理。
- `TranslationRunner`（`src/server/core/translation-runner.ts`）负责调度翻译任务，控制并发数与重试策略，单章失败不阻塞整体任务。
- `TranslationPipeline`（`src/server/core/translation-pipeline.ts`）使用 LangGraph 实现分段→翻译→组装→定稿的流水线。
- 流水线子节点位于 `src/server/core/translation/nodes/`：
  - `segment-node.ts`：按自然段拆分原文
  - `translate-node.ts`：调用 LLM 逐段翻译（含术语注入与上下文历史管理）
  - `assemble-node.ts`：组装译文章节级结构
  - `finalize-node.ts`：落盘译文至 SQLite
  - `history-manager.ts`：管理翻译上下文窗口（按 Token 数截断历史记录）
  - `llm-logger.ts`：记录 LLM 交互日志，便于调试与审计
- 翻译状态类型定义在 `src/server/core/translation-state.ts`，涵盖段落草稿（`ParagraphDraft`）、章节翻译进度、术语条目（`TranslationTermEntry`），以及翻译单元类型（`TranslationUnitKind`：`'meta'` / `'volume'` / `'chapter'`）。
- 每本小说拥有独立的术语库，支持 CRUD 操作（`GET/POST/PUT/DELETE .../translate/terms`），也支持从知识图谱实体导入术语（`POST .../translate/terms/import-from-graph`）。
- 翻译任务支持 `fromScratch` 参数从零重译，可覆盖指定模型（`modelOverride`）。
- 翻译调度使用 `processUnits` 单元式迭代，按顺序依次处理：小说元数据（书名+简介）→ 各卷标题 → 各真实章节。进度百分比计算：启动时传递 `totalChapterCount`（`downloadedChapters.length`）作为分母，运行中所有 `progressPercent` 计算必须以 `totalChapterCount` 为分母，**不得**使用 `chapterIds.length`（剩余章节数）。恢复翻译时历史已译章节数计入分子，分母永远是总章节数。
- 导出引擎（`export-engine.ts`）支持三种翻译导出模式：`original`（原文）、`translated`（纯译文）、`bilingual`（双语对照），通过 `?mode=` 查询参数控制。
- 翻译相关测试集中在 `src/server/core/translation.test.ts`，应使用 SQLite 内存数据库，**不得**依赖真实 LLM 调用。

## 5. API 路由速查 (API Routes)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康探针 |
| GET | `/api/control/sources` | 获取注册的爬虫来源列表 |
| POST | `/api/control/preview` | 预览小说元数据与目录（含增量状态） |
| POST | `/api/control/tasks` | 创建并启动抓取任务 |
| GET | `/api/control/tasks/:id` | 获取任务快照 |
| GET | `/api/control/tasks/:id/stream` | SSE：实时任务日志流 |
| GET/PUT | `/api/control/network-proxy` | 读取/更新代理配置 |
| POST | `/api/control/network-proxy/validate` | 验证代理连通性 |
| GET/PUT | `/api/control/preferences/llm-providers` | 读取/更新 LLM 提供商配置 |
| POST | `/api/control/preferences/llm-providers/:providerId/models/:modelId/validate` | 验证单个 LLM 模型 |
| GET/PUT | `/api/control/preferences/model-gateway` | 读取/更新模型网关配置 |
| GET/PUT | `/api/control/preferences/neo4j` | 读取/更新 Neo4j 连接配置 |
| POST | `/api/control/preferences/neo4j/validate` | 验证 Neo4j 连接 |
| GET/PUT | `/api/control/preferences/reader-typography` | 读取/更新全局阅读排版偏好 |
| GET/PUT | `/api/control/preferences/translation` | 读取/更新翻译偏好配置 |
| GET | `/api/library/novels` | 书库列表（支持 `?q=` 搜索） |
| GET | `/api/library/novels/:sourceId/:novelId` | 书库单本详情（含知识图谱状态） |
| GET | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId` | 章节内容 |
| GET | `/api/library/novels/:sourceId/:novelId/exports/:format/download` | 下载导出文件（markdown/txt/epub） |
| GET | `/api/library/novels/:sourceId/:novelId/graph` | 获取知识图谱状态 |
| PUT | `/api/library/novels/:sourceId/:novelId/graph/profile` | 更新图谱构建配置 |
| POST | `/api/library/novels/:sourceId/:novelId/graph/build` | 启动图谱构建 |
| POST | `/api/library/novels/:sourceId/:novelId/graph/pause` | 暂停图谱构建 |
| POST | `/api/library/novels/:sourceId/:novelId/graph/resume` | 恢复图谱构建 |
| POST | `/api/library/novels/:sourceId/:novelId/graph/retry-failed` | 重试失败的图谱提取片段 |
| DELETE | `/api/library/novels/:sourceId/:novelId/graph` | 清除图谱数据 |
| POST | `/api/library/novels/:sourceId/:novelId/graph/sync-neo4j` | 同步本地图谱至 Neo4j |
| POST | `/api/library/novels/:sourceId/:novelId/assistant/chat` | AI 伴读问答 |
| POST | `/api/library/novels/:sourceId/:novelId/aliases` | 创建书籍别名 |
| PUT | `/api/library/novels/:sourceId/:novelId/aliases/:aliasId` | 更新别名 |
| DELETE | `/api/library/novels/:sourceId/:novelId/aliases/:aliasId` | 删除别名 |
| PUT | `/api/library/novels/:sourceId/:novelId/progress` | 更新阅读进度 |
| POST | `/api/library/novels/:sourceId/:novelId/bookmarks` | 创建书签 |
| PUT | `/api/library/novels/:sourceId/:novelId/bookmarks/:bookmarkId` | 更新书签备注 |
| DELETE | `/api/library/novels/:sourceId/:novelId/bookmarks/:bookmarkId` | 删除书签 |
| GET/PUT | `/api/library/novels/:sourceId/:novelId/reader-typography` | 单本阅读排版偏好 |
| DELETE | `/api/library/novels/:sourceId/:novelId/reader-typography` | 恢复全局排版默认值 |
| POST | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId/media/:mediaId/cache` | 缓存单张图片 |
| POST | `/api/library/novels/:sourceId/:novelId/media/cache` | 批量缓存全书图片 |
| GET | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId/media/:mediaId/file` | 获取缓存图片文件 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/start` | 启动翻译任务 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/cancel` | 取消翻译任务 |
| GET | `/api/library/novels/:sourceId/:novelId/translate/build` | 获取翻译任务状态与进度 |
| GET/PUT | `/api/library/novels/:sourceId/:novelId/translate/profile` | 读取/更新翻译配置 |
| GET | `/api/library/novels/:sourceId/:novelId/translate/chapters/:chapterId` | 获取章节翻译详情 |
| GET | `/api/library/novels/:sourceId/:novelId/translate/terms` | 获取术语库列表 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/terms` | 创建术语条目 |
| PUT | `/api/library/novels/:sourceId/:novelId/translate/terms/:termId` | 更新术语条目 |
| DELETE | `/api/library/novels/:sourceId/:novelId/translate/terms/:termId` | 删除术语条目 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/terms/import-from-graph` | 从知识图谱实体导入术语 |

## 6. 编码规范 (Coding Standards)

1. **类型安全**：禁止使用 `any`。API 响应、数据库模型、爬虫中间态数据必须定义 `interface` 或 `type`。
2. **异步处理**：统一使用 `async/await`。
3. **注释**：核心接口方法、复杂 CSS 选择器必须添加 JSDoc 注释。
4. **命名**：文件/目录用 `kebab-case`；类用 `PascalCase`；变量/函数用 `camelCase`。
5. **请求头**：爬虫发起的所有 HTTP 请求必须带 `User-Agent`、`Accept-Language`、`Accept` 等基础请求头。
6. **私有字段**：类的内部状态优先使用 `#privateField` 语法（ES2022 私有字段），而非 `private` 关键字。
7. **CSS 全局样式安全**：`styles.css` 中的全局 `input`、`select`、`textarea` 选择器必须使用 `:not([type="checkbox"]):not([type="radio"])` 排除复选框和单选框，避免 Mantine 组件内部 input 被误伤。移动端布局常量（底栏高度、浮窗间距、键盘检测阈值）应提取为模块级常量，与 AppShell 的 `footer` 高度对齐，禁止散落 magic number。

## 7. 测试规范 (Testing)

- 测试文件与被测文件同目录，后缀为 `.test.ts`。
- 运行命令：`npm run test:server`（服务端）、`npm run test:web`（前端）、`npm run test:ci`（CI 脚本）。
- Spider 适配器测试通过注入本地 HTML fixture 进行，**不得**发起真实网络请求。
- **完成验收**：代码变更必须通过 `npm run typecheck` 和 `npm run build`，无类型错误和编译错误，并且相关测试通过。

## 8. 文档更新规范 (Documentation)

- **禁止自动修改** `ROADMAP.md`。
- 未经用户明确要求，**禁止修改** `README.md` 和本文件（`copilot-instructions.md`）。
- 纯配置或文档变更至少需完成与改动直接相关的可执行验证（如 Docker build、healthcheck 等）。

## 9. 默认行为 (Default AI Behaviors)

- **新增爬虫**：在 `src/server/adapters/spider/` 下创建适配器文件，继承 `BaseHtmlSpiderAdapter`，并在 `ControlCenterService` 注册表中追加，同时补充测试。
- **前端组件**：默认使用 React Hooks + Mantine v7 组件库，通过 `src/web/services/api.ts` 调用后端接口。视觉风格遵循 `theme.ts` 中定义的暖色纸质暗调（`warmPaperDark`）。全局通知统一使用 `@mantine/notifications`（`notifications.show()`），不得自行实现通知中心组件。组件交互模式遵循：加载状态 → 草稿态编辑 → 验证反馈（✅/❌ 标识）→ 保存并通知。
- **前端路由**：四个主路由定义在 `src/web/services/app-routes.ts`（采集工作台 `/`、本地书库 `/library`、任务大盘 `/monitor`、全局设置 `/settings`）。书库模块由 `LibraryWorkspace` 壳层按子路由分发到 `LibraryListView` / `LibraryDetailView` / `LibraryReaderView`。
- **网络请求**：爬虫 HTTP 请求默认带完整 Headers，并经由 `createProxyAwareHtmlFetcher` 发出。
- **知识图谱与 AI 伴读**：相关功能为实验性，未经用户明确要求不得主动启用。新增图谱相关代码时需同步更新 `novel-repository.ts` 中的表结构与迁移逻辑。构建入口强制要求至少配置一个提取模型（无模型时直接拒绝并给出清晰提示）。LLM 失败不再回退本地规则，改为标记失败 + 重试。图谱构建测试应使用 SQLite 内存数据库，不得依赖真实 Neo4j 或 LLM 调用。
- **模型网关**：新增 AI 功能需通过 `resolveCapabilityRoute` / `resolveExtractionRoutes` 获取模型路由，不得硬编码模型选择。网关配置变更需同步更新 `system-preferences.ts` 中的 `LlmModelGatewayConfig` 类型与持久化逻辑。
- **系统偏好**：新增偏好字段需在 `SystemPreferencesService` 中定义接口与持久化逻辑，并在前端 `SystemPreferences` 组件中提供对应 UI。偏好迁移策略（新增字段默认值）需在 `system-preferences.ts` 的 `loadPersistedPreferences` 中显式处理。
- **书库搜索**：搜索语法变更需同步更新 `library-search.ts` 中的分词器与解析器，并补充测试覆盖。
- **翻译流水线**：新增翻译节点或修改流水线逻辑时，需同步更新 `translation-pipeline.ts` 中的 LangGraph 状态图定义（使用 `Annotation.Root()` API）以及 `translation-state.ts` 中的类型。翻译任务调度变更需同步更新 `translation-runner.ts`。术语库相关变更需同步更新 `translation-service.ts` 与 `novel-repository.ts` 中的表结构。从知识图谱实体导入术语（`importGraphEntitiesToTerms`）需要校验目标小说存在且术语表已就绪。翻译功能为 **已发布**，不属于实验性功能，但应在实现变更时提供测试覆盖。
- **移动端布局**：采集页底部操作浮窗（`control-console.tsx`）的移动端版本必须单独渲染，使用紧凑布局（`p="xs"`、`compact-xs` 按钮、`wrap="nowrap"`），不得复用桌面端大卡片。移动端浮窗只需保留「解析目录」和「下发采集」两个按钮，「全局设置」按钮仅在桌面端出现。浮窗位置使用常量公式：`MOBILE_FOOTER_HEIGHT + MOBILE_AFFIX_GAP`，与 AppShell 的 `footer={{ height: isMobile ? 56 : 0 }}` 对齐。
- **键盘检测**：`control-console.tsx` 中的移动端键盘检测必须使用基准高度差值模型（记录 `visualViewport.height` 初始值，差值超过 140px 则判定键盘打开），并配合 `focusin`/`focusout` 事件兜底（输入框获焦点即判定键盘打开）。不得使用比例判断（如 `viewport.height < window.innerHeight * 0.78`），因为安卓浏览器中两个值可能同时变化导致检测失效。检测阈值应提取为模块级常量。
- *原 Python 参考项目地址：`C:\Users\silev\Documents\GitHub\PyNovelSpider`*
