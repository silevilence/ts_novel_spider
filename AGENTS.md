# TS Novel Spider - Copilot 辅助开发指南

> **🚫 Git 提交禁令**：除非用户在当前对话中**显式要求**提交（如"提交"、"commit"、"push"），否则**绝对禁止**执行任何 git 提交或推送操作。包括但不限于：`git commit`、`git push`、`git add` + `git commit`。允许的操作：`git status`、`git log`、`git diff` 等只读或用户明确要求的操作。此规则适用于所有场景——日常改代码、触发技能（brainstorming/writing-plans/executing-plans/finishing-a-development-branch 等）、子代理执行，无一例外。

> 提问时优先使用相关工具

## 1. 项目概述 (Project Overview)

- **核心定位**：基于 TypeScript 的自动化小说爬虫与多格式导出工具。
- **主要功能**：通过 Web 管控界面调度爬虫，抓取小说内容并持久化至本地 SQLite，支持离线阅读、多格式导出（Markdown、EPUB、TXT）、AI 翻译与知识图谱分析。
- **架构模式**：前后端分离但合并部署的 B/S 架构。
  - **前端 (src/web)**：纯视图层，负责参数配置、目录浏览、实时监控与任务调度。
  - **后端 (src/server)**：核心执行层，负责爬虫调度、网页解析、SQLite 持久化、文件导出与 SSE 事件推送。后端任务完全独立于前端会话，前端关闭不影响任务执行。
  - **浏览器扩展 (browser-extension)**：独立构建的 Chromium MV3 扩展，仅作为浏览器采集桥接的传输端（在真实标签页渲染页面并回传 DOM 与状态），**不承担任何解析**。

## 2. 技术栈 (Tech Stack)

| 层 | 技术 |
|---|---|
| 后端 | Node.js ≥ 20, Express 5, `better-sqlite3`, `cheerio` |
| 前端 | React 19, Mantine v7, `@emotion/react`, `@emotion/styled`, `@tabler/icons-react`, Vite 6, TypeScript strict 模式 |
| AI / 图谱 / 翻译 | `ai` (Vercel AI SDK), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `ai-sdk-ollama`, `@langchain/core`, `@langchain/langgraph`, `neo4j-driver`, `zod`, `jsonrepair` |
| 导出 | `jszip`（EPUB 打包） |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-sanitize`（渲染）、`@uiw/react-md-editor`（正文编辑）、`marked`（EPUB/TXT 转换） |
| 工程化 | `tsx` (watch + test runner), `concurrently`, Docker multi-stage build |
| 浏览器扩展 | Chromium Manifest V3（Edge / Chrome 116+）、`vite`、TypeScript |

**禁止降级**：不得将 Express 5 降回 v4；不得关闭 TypeScript strict 模式；不得将 Mantine 降回 v6 或更早版本。

### 2.1 运行、构建与配置

- 使用 npm；根目录与 `browser-extension/` 各有独立的 `package.json` 和 `package-lock.json`。在根目录运行 `npm ci`。Node.js 建议使用 22，与 `.github/workflows/release.yml` 和两个 Dockerfile 一致；`engines.node` 声明为 `>=20`，实际安装还需满足锁定依赖的小版本约束。
- `npm run dev` 同时运行后端 `tsx watch` 与前端 Vite，并通过 `scripts/dev/diagnostic-command.mjs` 将输出及退出信息追加到 `.data/dev-logs/dev-server.log`、`.data/dev-logs/dev-web.log`。单独运行 `dev:server` / `dev:web` 不经过该包装脚本。
- `src/server/index.ts` 默认监听 `HOST=127.0.0.1`、`PORT=3000`；Vite 默认监听 `127.0.0.1:5173`，可通过 `VITE_DEV_HOST`、`VITE_API_PROXY_TARGET`、`VITE_USE_POLLING=true` 调整。Vite 只代理 `/api`；扩展配对与 OPDS Feed 应使用后端地址。
- `npm run build` 依次构建 Web 与服务端，产物为 `dist/web/` 和 `dist/server/`；`npm start` 运行 `dist/server/index.js`。根 `tsconfig.json` 仅聚合项目引用，前后端编译选项分别在 `tsconfig.server.json` 与 `src/web/tsconfig.json`。
- 扩展单独执行 `npm ci --prefix browser-extension`、`npm run typecheck --prefix browser-extension`、`npm run build --prefix browser-extension`，产物为 `browser-extension/dist/`；根 `build` 与 `typecheck` 不包含扩展。
- `docker-compose.yml` 使用 GHCR 镜像；`docker-compose.dev.yml` 从源码构建，但同样运行生产服务，不提供热重载。二者默认复用 `.data/`、`data/` 和宿主机 3000 端口，不要当作独立隔离环境同时运行。

## 3. 目录结构规范 (Directory Structure)

```text
.
├── src/
│   ├── server/
│   │   ├── adapters/
│   │   │   ├── log/               # 日志适配器（InMemoryLogAdapter 等）
│   │   │   └── spider/            # 站点爬虫适配器
│   │   │       ├── kakuyomu-spider-adapter.ts     # Kakuyomu 具体实现（双轨解析）
│   │   │       ├── kakuyomu-spider-adapter.test.ts # Kakuyomu 适配器测试
│   │   │       ├── syosetu-18-spider-adapter.ts   # Syosetu18 具体实现
│   │   │       ├── syosetu-spider-adapter.ts      # Syosetu（继承 Syosetu18）
│   │   │       ├── syosetu-spider-adapter.test.ts # 爬虫适配器测试
│   │   │       └── mock-html-spider-adapter.ts    # 测试用 Mock
│   │   ├── core/                  # 核心逻辑：爬虫调度、SQLite ORM、导出引擎、网络代理、系统偏好、知识图谱、翻译流水线、精翻工作区、定时更新调度、OPDS 编译、浏览器采集桥接
│   │   │   ├── browser-capture.ts            # 桥接服务（配对/串行队列/暂停/审计）
│   │   │   ├── browser-transport-spider.ts   # 浏览器传输适配器包装（委托 + 解析等待重试）
│   │   │   ├── translation-checkpoint.ts     # 翻译段落检查点（中断恢复）
│   │   │   ├── library-term-extraction.ts    # 书库术语候选 AI 提取
│   │   │   ├── library-term-translation.ts   # 缺译术语批量 AI 翻译
│   │   │   ├── refined-translation.ts        # 精翻工作区服务（任务/术语/审核生命周期）
│   │   │   ├── refined-translation-tools.ts   # 精翻 Agent 工具表面（AI SDK ToolSet）
│   │   │   ├── refined-translation-models.ts  # 精翻模型职责与路由校验
│   │   │   ├── refined-revision.ts           # 审核约束规划、逐段修订、复审与直接定稿
│   │   │   ├── llm-context-budget.ts         # 模型上下文预算与请求保护
│   │   │   ├── refined-translation.test.ts    # 精翻工作区测试
│   │   │   ├── library-intelligence-rag.ts    # GraphRAG 检索（摘要召回 + 证据下钻）
│   │   │   ├── scheduling-summary.ts # 更新总结服务（AI 摘要生成）
│   │   ├── routes/
│   │   │   ├── browser-capture.ts      # 桥接配对 API（/api/browser，配对密钥鉴权）
│   │   │   ├── refined-translation.ts       # 精翻工作区 API
│   │   │   ├── control-center.ts       # 管控 API（含 OPDS 偏好/运行记录、浏览器桥接面板与任务控制）
│   │   │   ├── library.ts              # 书库 API（含 OPDS 可见性管理）
│   │   │   ├── opds.ts                 # OPDS 协议路由（v1/v2 Feed + 制品下载）
│   │   │   ├── opds.test.ts            # OPDS 路由测试
│   │   │   ├── health.ts
│   │   │   └── ...
│   │   ├── app.ts                 # createServerApp()，挂载路由与静态资源
│   │   ├── browser-capture-websocket.ts # 桥接 WebSocket 接入（/api/browser/ws）
│   │   ├── contracts/             # 共享契约（小说目标、翻译格式、精翻修订与定稿）
│   │   └── index.ts               # HTTP 监听入口
│   └── web/                       # 前端 React 工程（Mantine v7 + Vite 构建）
│       ├── components/            # UI 组件：控制台、书库列表/详情/阅读器、监控大盘、系统偏好面板、翻译面板、精翻工作区、Cron 编辑器、定时更新面板、OPDS 面板
│       │   ├── library-history-panel.tsx  # 元数据版本历史面板（查看/还原）
│       │   ├── manual-novel-manager.tsx   # 手动小说卷/章管理面板
│       │   ├── refined-translation-workspace.tsx  # 精翻工作区面板
│       │   ├── refined-translation-task-panel.tsx  # 精翻任务详情与状态机流程图
│       │   ├── opds-dashboard.tsx       # OPDS 书源管理面板
│       │   ├── opds-dashboard.test.ts   # OPDS 面板测试
│       │   ├── scheduling-dashboard.tsx # 定时更新管理面板
│       │   ├── scheduling-dashboard.test.ts # 定时更新面板测试
│       │   └── ...
│       ├── services/              # API 封装（api.ts）+ 视图模型
│       │   ├── opds-dashboard-model.ts  # OPDS 面板视图模型
│       │   ├── scheduling-dashboard-model.ts # 定时更新面板视图模型
│       │   └── ...
│       ├── theme.ts               # Mantine 主题定义（暖色纸质暗调）
│       ├── styles.css             # 全局样式
│       ├── App.tsx                # 路由配置入口（含精翻工作区、OPDS、定时更新路由）
│       └── vite.config.ts
├── browser-extension/             # Chromium MV3 扩展工程（浏览器采集桥接，独立 package.json）
│   ├── public/manifest.json       # MV3 清单（version 随发布同步）
│   ├── src/background.ts          # 连接、请求队列、采集走查与开发数据导出
│   ├── src/popup/                 # 弹窗入口（配对状态、任务控制、保存本页）
│   ├── src/options/               # 设置页入口（服务器地址、配对令牌、解除配对）
│   └── src/shared/bridge.ts       # 协议常量、设置读写与进度文案
├── scripts/ci/                    # CI 发布准备脚本
├── scripts/dev/                   # 前后端开发启动诊断与日志包装
├── docs/                          # UX 设计规范与开发备忘
├── data/
│   ├── exports/                   # 导出文件输出目录
│   ├── manual-assets/             # 手动小说上传素材（{novelId}/ 目录）
│   ├── offline-assets/            # 离线图片缓存
│   └── opds-artifacts/            # OPDS EPUB 制品目录
├── .data/                         # 运行时数据（SQLite、代理配置、系统偏好）— 不提交 Git
├── Dockerfile                     # 生产镜像（multi-stage）
├── Dockerfile.dev                 # 开发镜像（国内加速源）
├── docker-compose.yml             # 生产编排（消费 ghcr.io 镜像）
├── docker-compose.dev.yml         # 本地开发编排
├── tsconfig.json                  # 根 TS 配置（前后端项目引用）
└── tsconfig.server.json           # 后端 TS 配置（输出至 dist/server）
```

## 4. 核心架构与关键约束 (Architecture & Constraints)

### 4.1 策略模式：SpiderAdapter

- 所有站点适配器必须继承 `BaseHtmlSpiderAdapter`（定义于 `src/server/core/spider.ts`）。
- 必须实现：`sourceId`、`getInfoPageUrl()`、`fetchMetadata()`、`fetchChapterIndex()`、`fetchChapter()`。
- 注入 `fetchHtml` 函数（`SpiderHtmlFetcher` 类型）实现请求与解析解耦，测试时传入本地 fixture HTML，线上使用 `createProxyAwareHtmlFetcher`。
- Syosetu 站点基于 HTML 选择器解析；Kakuyomu 使用双轨解析（`__NEXT_DATA__` Apollo State 为主，HTML 选择器降级）。
- 新增站点爬虫时，在 `src/server/adapters/spider/` 下创建文件，并在 `ControlCenterService` 构造函数的 spider 注册表中追加条目。
- 作品编号/URL 识别共用 `src/server/contracts/novel-target.ts` 的 `resolveNovelTarget`，只解析已知域名和路径，不发网络请求。支持 Syosetu/Syosetu18 的目录、情报页、章节 URL，以及 Kakuyomu 的作品、章节 URL；URL 自动确定来源，拒绝未知站点、非 http(s)、嵌入凭据和非标准端口。
- 前端 `control-center-model.ts` 在输入、站点或传输方式变化时失效旧预览与选章状态，粘贴 URL 不自动抓取，迟到响应不得恢复旧目标。变更识别规则时同步验证 `contracts/novel-target.test.ts` 与 `web/services/control-center-target.test.ts`。

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
- 当前协议为 `http` / `https`（`NetworkProxyProtocol`），支持认证与绕过主机列表；不要将 SOCKS 描述为已实现能力。
- Spider 适配器通过 `createProxyAwareHtmlFetcher` 获得代理感知的 fetch 函数，不得直接硬编码 `fetch`。

### 4.6 Express 5 注意事项

- SPA 回退路由使用 `app.use(fallback)` 中间件，**不得使用** `app.get('*', ...)` （Express 5 已弃用）。

### 4.7 系统偏好：SystemPreferencesService

- `SystemPreferencesService`（`src/server/core/system-preferences.ts`）管理八类全局配置，均持久化至 `.data/system-preferences.json`：
  - **LLM 提供商配置**（`LlmProviderConfig`）：支持 openai-compatible / anthropic / google-generative-ai / ollama 四种类型，每个提供商可配置多个模型，每个模型可手动或自动映射能力标签（chat / embedding / rerank），并可单独指定**翻译消息格式**（见 4.10）。
  - **模型网关配置**（`LlmModelGatewayConfig`）：为 chat / embedding / rerank 三种能力分别指定默认模型路由，AI 功能（伴读、图谱、翻译）按能力自动选择相应模型。
  - **Neo4j 图数据库连接**（`Neo4jConfig`）：URI、用户名、密码，支持连接验证。
  - **阅读器排版偏好**（`ReaderTypographyConfig`）：全局默认字体族、字号、行高、段间距。
  - **翻译偏好**（`TranslationPreferencesConfig`）：默认源语言、目标语言、翻译模型池与段落并发数、术语提取模型、翻译交互日志开关、默认导出模式等。
  - **定时更新配置**（`SchedulingConfig`）：启用/禁用开关、三种调度模式（`interval` / `cron` / `weekly`）及对应参数（轮询间隔、Cron 表达式、每周几+时刻）。
  - **OPDS 配置**（`OpdsConfig`）：启用/禁用开关、扫描 Cron 表达式。
  - **消息通知配置**：单个 AstrBot 渠道与 UMO 目标、总开关及错误通知开关；读取只返回 `keyConfigured`，密钥保留/替换/清除使用共享契约 `contracts/notification.ts`。
- LLM API Key 以明文存储于 JSON 文件中，注意安全边界。
- 模型能力检测通过发送轻量 API 请求验证，结果缓存在内存中。

#### 模型上下文预算

- 每个模型的 `contextWindowTokens` 表示输入与输出的总预算；存量默认值为 0，表示不启用本地预算限制，不表示提供商无限制。
- 共享实现位于 `src/server/core/llm-context-budget.ts`。使用 `modelContextLimit` 解析实际路由的上限，`withContextBudget` 检查 SDK 请求（包含消息、工具 schema/结果、结构化输出 schema 和输出预留）；embedding/rerank 输入使用 `assertModelInputBudget`。
- Token 估算采用 UTF-8 字节数保守计算，并非提供商 tokenizer 的精确结果。对话裁剪只移除完整旧轮次，保留 system、当前 user 与工具调用链；必要材料超预算时抛出 `ContextBudgetExceededError`，不得静默截断硬性约束或表格。
- 分批逻辑使用 `textRequestFits` / `splitTextForContext` 等共享函数，新增模型调用必须沿用预算保护；测试位于 `llm-context-budget.test.ts`。

### 4.8 知识图谱与 AI 伴读：LibraryIntelligenceService

- `LibraryIntelligenceService`（`src/server/core/library-intelligence.ts`）编排知识图谱构建与 AI 问答。
- 底层抽取与检索逻辑位于 `src/server/core/library-intelligence-rag.ts`，使用 Vercel AI SDK 调用 LLM 进行实体/关系抽取和 RAG 检索。
- 图谱构建支持 **full**（全量重建）、**incremental**（增量追加）、**rebuild**（先清空再全量）三种模式。
- 构建过程可暂停/恢复，状态持久化至 SQLite。每个小说可独立配置抽取模型池与并发数。
- LLM 提取失败时**不再**产出本地启发式抽取结果：失败片段固定写入 `FAILED_EXTRACTION` 并标记 `status='failed'`，可通过 `POST .../graph/retry-failed` 端点单独重试。`extractChunkHeuristically` 仅作为提示词 JSON 路径的字段兜底（`parsePromptedChunkObject` 的 `fallbackObject`）修补模型返回的残缺对象，不作为独立抽取结果使用。
- `novel_graph_build_checkpoints` 表有 `status` 字段（`'success' | 'failed'`），构建入口强制要求至少配置一个提取模型。
- AI 伴读采用 GraphRAG 两阶段检索：先按图谱摘要资产（子图 `subgraph`、章节簇 `chapter_cluster`、社区 `community` 三类）定位相关区域，再下钻证据片段。检索意图自动分类为局部（`local`，优先当前章节 + 子图）与全局（`global`，优先社区 + 章节簇摘要）。
- 摘要资产存储在 `knowledge_graph_summaries` 表，含稳定键、源指纹与向量嵌入；检索时按得分排序后组装两阶段上下文（摘要召回 → 证据下钻）。
- 图谱遍历支持实体对齐 + 1~2 跳邻域扩展，返回带评分的路径与章节证据回溯。
- 前端伴读面板展示检索模式（局部/全局 GraphRAG）、摘要入口与下钻证据、实体对齐与多跳路径、命中子图等追踪信息。
- AI 伴读采用混合检索：元数据 + 图谱子图 + 章节块（关键词评分 + 向量余弦相似度 + 可选重排序）。
- OpenAI 兼容接口需确保 base URL 包含 `/v1` 路径（若原始 URL 无 path 则自动补齐）。
- 支持将本地图谱数据同步至 Neo4j 图数据库（`POST .../graph/sync-neo4j`），用于与外部工具联动分析。
- 本地图谱持久化至 SQLite，Neo4j 为可选同步/查询目标；不要将 Neo4j 连接列为本地图谱构建的必需条件。
- 图谱功能为 **实验性**，未经用户明确要求不得主动启用或宣传为稳定功能。

### 4.9 书库搜索：LibrarySearch

- `searchLibraryNovels()`（`src/server/core/library-search.ts`）实现结构化查询解析器。
- 支持字段限定搜索（`name:`、`author:`、`tag:`、`site:`、`alias:` 等），逻辑运算符 `+`（与）、`,`（或）、`-`（非），以及括号分组。
- 搜索结果按相关性评分降序排列，同分按更新时间倒序。

### 4.10 翻译流水线：TranslationService

- `TranslationService`（`src/server/core/translation-service.ts`）管理翻译任务的全生命周期：启动、取消、进度查询、术语库管理。
- `TranslationRunner`（`src/server/core/translation-runner.ts`）负责调度翻译任务，控制并发数与重试策略，单章失败不阻塞整体任务。
- `TranslationPipeline`（`src/server/core/translation-pipeline.ts`）使用 LangGraph 实现分段→翻译→组装→定稿的流水线。
- `review-node.ts` 虽然存在，但没有接入粗翻状态图；不要将书库粗翻描述为已启用 AI 审校。审核校对由精翻工作区承担。
- 流水线子节点位于 `src/server/core/translation/nodes/`：
  - `segment-node.ts`：按自然段拆分原文
  - `translate-node.ts`：调用 LLM 逐段翻译（含术语注入与上下文历史管理）
  - `assemble-node.ts`：组装译文章节级结构
  - `finalize-node.ts`：落盘译文至 SQLite
  - `history-manager.ts`：管理翻译上下文窗口（按 Token 数截断历史记录）
  - `llm-logger.ts`：记录 LLM 交互日志，便于调试与审计
  - `translation-failure.ts`：失败分类（`empty_response` / `format_mismatch` / `prompt_echo` / `api_error` / `timeout` / `cancelled`），`TranslationFailure` 携带 `category`
  - `translation-prompt-materials.ts`：术语、上下文背景、源文与提示词回显标记的共享渲染
  - `hy-mt2-messages.ts` / `index-translate-messages.ts`：两种专用单轮提示词模板与各自的回显检测
  - `redact-secrets.ts`：日志脱敏（API Key 等凭据一律替换为 `[REDACTED]`）
- **翻译消息格式**：按实际路由到的翻译模型选择，允许值定义于跨端契约 `src/server/contracts/translation-message-format.ts`（`general` 通用 / `hy-mt2` / `bilibili-index-translate`）。前端选项与后端校验**必须**从该契约导入，不得在任一端硬编码；`control-center.ts` 保存模型时按契约校验，存量或未知值统一迁移为 `general`。专用格式使用单轮 user 提示词（不含 system 消息，目标语言用完整语言名），首次请求、重试与逐段回退都必须遵守所选格式；Index-Translate 还需关闭模型思考（`thinkingEnabled: false` 且 `chatTemplateThinking: false`）。
- 翻译状态类型定义在 `src/server/core/translation-state.ts`，涵盖段落草稿（`ParagraphDraft`）、章节翻译进度、术语条目（`TranslationTermEntry`），以及翻译单元类型（`TranslationUnitKind`：`'meta'` / `'volume'` / `'chapter'`）。
- 每本小说拥有独立的术语库，支持 CRUD 操作（`GET/POST/PUT/DELETE .../translate/terms`），也支持从知识图谱实体导入术语（`POST .../translate/terms/import-from-graph`）。
- 翻译任务支持 `fromScratch` 参数从零重译，可覆盖指定模型（`modelOverride`）。
- 翻译调度使用 `processUnits` 单元式迭代，按顺序依次处理：小说元数据（书名+简介）→ 各卷标题 → 各真实章节。进度百分比的分母固定为本轮全部翻译单元数（`totalUnitCount = allUnits.length`，含元数据与卷标题单元），分子为已译与失败单元之和，**不得**改用剩余单元数；恢复翻译时已完成单元计入分子，分母不变，失败数按本轮重新统计。
- 翻译明细通过 `GET .../translate/units` 返回元数据、卷标题与章节单元，前端 `translation-units-modal.tsx` 按已译/失败/待译展示与分页。部分失败章节仍展示有效段落译文，缺译段保留原文；保持 `reader-translation.ts` 的原文匹配检查。
- 导出引擎（`export-engine.ts`）支持三种翻译导出模式：`original`（原文）、`translated`（纯译文）、`bilingual`（双语对照），通过 `?mode=` 查询参数控制。
- 失败处理与重试：单批最多 4 次尝试（`maxAttempts = 4`），单次请求超时 120s（`AbortSignal.timeout`）；仅 `format_mismatch` / `prompt_echo` 会触发逐段回退，回退后的单段请求只携带当前段落正文；失败段落保留既有译文、记录 `[类别] 段落 …：原因` 且不计为成功，其他单元按既有隔离规则继续。
- 中断恢复（`translation-checkpoint.ts`）：每次 translate 节点后把非空译文草稿写入 `novel_translation_build_checkpoints`，finalize 成功且未请求暂停时写 `completed` 并清空草稿。仅在继续翻译时（非 `fromScratch` 且既有构建为 `paused` / `completed` / `failed`）恢复草稿；原文、语言对、术语表或模型签名（provider / baseUrl / 消息格式）任一变化即判定检查点失效。清除译文数据时一并清除检查点。
- LLM 交互日志（`llm-logger.ts`）：由翻译偏好的「保存翻译模型交互日志」开关控制，写入 `.data/llm-logs/{YYYY-MM-DD}.log` 并保留 7 天。每条记录包含执行轮次、章节/单元标识、阶段（`batch` / `batch_retry` / `single` / `single_retry` / `fallback` / `final_failure`）、尝试次数与上限、错误类别、结束原因与 token 用量，提供商未返回的字段记为 `unavailable`；日志**必须**经 `redactSecrets` 脱敏，禁止写入 API Key。
- 翻译相关测试集中在 `src/server/core/translation.test.ts`，应使用 SQLite 内存数据库，**不得**依赖真实 LLM 调用。

### 4.10.1 精翻工作区：RefinedTranslationService

- `RefinedTranslationService`（`src/server/core/refined-translation.ts`）管理精翻任务的全生命周期：创建、术语提取/翻译、正文初翻、遗漏检查、审核校对、审核修订、导出、回收站。
- 精翻任务与书库粗翻（`TranslationService`）**彼此独立**：每本小说可创建独立精翻任务，自动快照原文与术语候选，不修改书库原始数据。
- **原文同步**：`syncSource()` / `syncRefinedTranslationSource` 把书库中最新已下载的原文与元数据增量并入任务（不触发任何远端抓取）。要求任务未在运行；按段落比对保留未变段落的译文、把新增/变化段落置为待译、重置受影响章节的审核状态，书库中已不存在的章节仍保留在任务内。同步结果返回新增/更新章节数、保留/带入/待译段落数与元数据是否变化。
- **译文复用**：创建任务（`reuseTaskId`）或同步原文时可带入另一份同源、同语言任务的译文，仅填补原文完全一致的段落；被带入的章节若段落全部已译，则跳过正文初翻、只翻译章节标题后直接进入审核（工作流决策 `reuse_review`）。
- 六阶段流水线：`glossary_setup`（术语确认）→ `glossary_translation`（术语翻译）→ `translating`（正文初翻）→ `checking`（遗漏检查）→ `reviewing`（审核校对）→ `revising`（审核修订）→ `completed`。各阶段可暂停/继续/下一步骤，失败段落可重试。
- 任务数据持久化至 SQLite（`refined_translation_tasks`、`refined_translation_chapters`、`refined_translation_segments`、`refined_translation_terms`、`refined_translation_reviews`、`refined_translation_logs`、`refined_translation_transitions`、`refined_translation_checkpoints` 表）。
- **工具表面**：`createRefinedTranslationTools(service, scope)`（`src/server/core/refined-translation-tools.ts`）返回 AI SDK `ToolSet`，通过 `scope` 绑定 `taskId`、`chapterIds` 白名单、`writable` 标志，防止 Agent 越权访问其他任务或章节。写入工具在章节聊天编辑路径启用 `needsApproval`，产出待用户确认的提案。
- **模型职责**：`refined-translation-models.ts` 校验角色并解析普通对话模型；术语提取/翻译、遗漏判断、审核和章节聊天使用 `general` 模型，专用翻译模型用于初翻与段落修订。Index-Translate 走单轮翻译模板且关闭思考，不能承担 JSON 决策或工具代理。
- **工具代理**：`runRefinedTranslationToolAgent`（`src/server/core/translation/nodes/translate-node.ts`）使用 AI SDK `generateText` + `stepCountIs(8)` 限步运行工具调用循环，`prepareStep` 强制首步读取任务物料。章节聊天、普通模型正文初翻与章节审核通过 `#tryRunToolAgent` 尝试工具代理并保留确定性回退；非 `general` 格式跳过工具代理。术语翻译直接生成标量译文，审核修订走 `refined-revision.ts`，不得笼统描述为所有阶段均使用工具代理。
- **章节 Agent**：`chatAboutChapter` 支持只读（`read`）与编辑（`edit_review` / `edit_skip_review`）两种模式；编辑模式下 Agent 产出的修改需用户通过 `applyChapterAgentEdits` 确认后才写入任务。
- **审核修订**：`reviseRefinedChapter`（`refined-revision.ts`）按「审核模型规划 hard/soft 约束 → 翻译模型逐段修订 → 审核模型复审整条意见的全部关联段落」执行。仅修订关联段落，禁止重翻整章、修改标题或术语；不能将生成译文等同于问题已解决。冲突、无法定位、超预算或失败项保留待处理状态与原有效译文。写入前核对原文、译文、术语和语言，防止晚到响应覆盖已变化材料。
- **修订记录与段落定稿**：共享契约为 `contracts/refined-revision.ts` 与 `contracts/refined-finalization.ts`，持久化至 `refined_translation_revisions` 和 `refined_translation_paragraph_states`。`maxParagraphRevisions` 范围为 1–20，`maxReviewRounds` 至少为其加 2、最多 100；前后端复用 `revisionLimitsError`。完成修订和复审周期才计数，同周期不重复累计。达到上限仍有意见的段落由普通审核模型直接定稿，定稿或修订请求最多尝试 3 次。直接定稿不是独立复审通过，须保留前后文本、模型、原因与意见 ID。
- 定稿段落退出自动返工，失败定稿保留原译文等待人工处理。暂停并等待在途调用结束后，可通过段落 `/reopen` 接口重开；`fromScratch=true` 同时清空该段译文。普通手工编辑保留定稿标记，显式重新开启或确认需要复审的 Agent 编辑才重新纳入流程。
- **导出**：支持 EPUB、Markdown、TXT 三种格式，可选原文（`original`）、纯译文（`translated`）、双语对照（`bilingual`）三种模式，可选全部章节或仅已完成章节。
- **回收站**：删除的任务进入回收站，可恢复或永久清理（`purge`）；永久清理会移除原文快照、译文、术语、审核记录与操作日志。
- 精翻相关测试包括 `refined-translation.test.ts`、`refined-translation-index.test.ts`、`refined-revision.test.ts` 与 `contracts/refined-finalization.test.ts`，应使用 SQLite 内存数据库与模拟模型，**不得**依赖真实 LLM 调用。
- 新增精翻相关代码需同步更新 `novel-repository.ts` 中的精翻表结构与迁移逻辑。

### 4.10.2 书库术语候选与批量翻译：LibraryTermExtractionService & LibraryTermTranslationService

- 术语状态为 `pending`（待确认）/ `confirmed`（已确认）/ `rejected`（已排除），旧库存量术语迁移为已确认；仅已确认术语注入粗翻上下文并计入缺译统计。精翻任务创建时只复制已确认的书库术语，之后沿用精翻自己的候选确认流程。
- `LibraryTermExtractionService`（`src/server/core/library-term-extraction.ts`）先按 18,000 字符窗口（`glossary-extraction.ts` 的 `GLOSSARY_EXTRACTION_SOURCE_LIMIT`）扫描已下载章节，再按实际模型上下文预算细分。候选按源词去重、优先级夹取 0–10，并保留来源章节。模型解析顺序：单本 `termExtractionModel` → 全局翻译偏好 `termExtractionModel` → 模型网关默认对话模型；思考开关取单本 `termExtractionThinkingEnabled`（默认关闭）。
- 提取单批最多尝试 3 次、每次超时 120s；解析支持修复常见模型格式错误，失败批次记录到 `failedBatches` 后继续后续批次。`completedBatchIndexes` 与 `sourceFingerprint` 持久化恢复进度；仅未完成运行且源语言与窗口内容的指纹一致时复用成功批次。更换模型本身不失效，但上下文预算改变导致重新分批会改变指纹；旧记录无指纹时需重扫，已有术语仍保留。
- 术语提取复用 `LlmInteractionLogger` 和翻译日志开关，携带 `operation=term_extraction`、运行/批次/来源章节、尝试次数、请求响应与用量，凭据必须脱敏；不要为重试虚构独立路由，再次 `POST .../translate/term-extraction` 即执行恢复逻辑。
- `LibraryTermTranslationService`（`src/server/core/library-term-translation.ts`）为已确认但缺译文的术语批量翻译，每批 20 条，要求模型返回完整且不重复的 ID，缺失或多余即判失败。
- 两个服务均以 `AbortController` 取消、运行记录持久化到 SQLite，取消或失败保留已完成批次；服务重启时 `recoverInterruptedRuns` 把残留的 `running` 任务标记为 `failed`。
- 测试：`library-term-extraction.test.ts`、`library-term-translation.test.ts`、`routes/library-terms.test.ts`，应使用 SQLite 内存数据库，**不得**依赖真实 LLM 调用。

### 4.11 定时更新调度：SchedulingService

- `SchedulingService`（`src/server/core/scheduling.ts`）管理定时更新任务的全生命周期：启动/停止、策略 reload、轮询检查、增量下载触发。
- 通过 `setInterval` 每分钟 tick 一次，根据配置的调度策略（`SchedulingConfig.mode`）通过 `calculateNextTriggerTime()` 计算下次触发时间。
- 三种调度模式由 `SystemPreferencesService` 的 `SchedulingConfig` 定义：
  - **`interval`**：固定间隔轮询，按小时设定（最小 1h）。
  - **`cron`**：Cron 表达式模式，前端 `CronEditor` 组件支持可视化快速编排与 `cron-parser` 实时预览。
  - **`weekly`**：简易周期定时，按"每周几（0-6）+ 固定时刻"组合。
- 每轮检查串行遍历所有标记为已开启的书籍：
  - 跳过有活跃抓取任务的书籍，避免冲突。
  - 拉取远端目录与本地快照差分，发现新章节时自动调用 `SpiderRunner.crawlNovel()` 增量下载。
  - 单本检查失败不中断整体轮次，结果（`up_to_date` / `new_chapters` / `error`）持久化到 SQLite。
- 每轮检查写入 `scheduled_check_runs` 表，记录开始/完成时间、检查数量、新增章节数、跳过数、错误数，全链路日志通过 `SpiderLogDispatcher` 推送到控制台实时监控。
- 服务启动时调用 `start()` 恢复未完成的检查轮次并启动定时器；配置变更时调用 `reload()` 停止旧定时器并应用新策略。
- 前端通过两套 API 管理调度：
  - `GET/PUT /api/control/scheduling`：读取/更新全局调度策略，返回含 `lastCheckRun` 的快照。
  - `GET /api/control/scheduling/runs`：查询定时更新运行记录（支持 `?limit=&offset=` 分页）。
  - `GET/PUT /api/library/novels/:sourceId/:novelId/scheduling`：单书定时更新开关。
  - `GET/PUT /api/library/scheduling/novels`：批量管理参与定时更新的书籍列表。
- `SchedulingService` 支持自动翻译联动：增量下载完成后，若该书 `auto_translate = true`，自动调用 `TranslationService.startTranslation()` 触发翻译。前置校验翻译配置已就绪且无运行中的翻译任务，校验不通过时记录警告日志并跳过，不阻塞定时更新主流程。
- `SchedulingSummaryService`（`src/server/core/scheduling-summary.ts`）提供更新总结功能：增量下载完成后，若该书 `auto_summarize = true`，调用 LLM 对新抓取章节生成剧情摘要。模型来源优先取单本覆盖，其次取全局总结模型，最终回退到模型网关默认对话模型。总结结果持久化到 `scheduled_summaries` 表。
- `scheduled_novels` 表新增 `auto_translate`、`auto_summarize`、`summarize_model_json` 三列。
- 新增调度相关代码需同步更新 `novel-repository.ts` 中的 `scheduled_novels`、`scheduled_check_runs` 表结构与迁移逻辑。
- 调度相关测试在 `src/server/core/scheduling.test.ts`，应使用 SQLite 内存数据库。

### 4.12 OPDS 书源服务：OpdsCompilationService & OpdsFeedService

- `OpdsCompilationService`（`src/server/core/opds-compilation.ts`）管理 OPDS EPUB 制品的后台编译调度：
  - 通过 `setInterval` 每分钟 tick 一次，根据配置的 Cron 表达式计算下次触发时间。
  - 每轮扫描串行遍历所有标记为 `opds_visible` 的书籍，跳过已是最新（`contentUpdatedAt <= epubCompiledAt`）的书籍。
  - 有完整翻译的书籍自动生成原文、译文、双语对照三个版本的 EPUB；无翻译的仅生成原文版。
  - 制品输出至 `data/opds-artifacts/{sourceId}/{novelId}/` 目录。
  - 每轮扫描写入 `opds_compilation_runs` 表（`src/server/core/novel-repository.ts`），记录扫描数、编译数、跳过数、错误数。
  - 全链路日志通过 `SpiderLogDispatcher` 推送至监控面板。
- `OpdsFeedService`（`src/server/core/opds-feed.ts`）负责生成 OPDS 协议 Feed：
  - `buildAtomRootFeed()` / `buildAtomNovelFeed()`：OPDS 1.2（Atom XML），用于根目录和单书详情。
  - `buildOpds2RootFeed()` / `buildOpds2NovelPublication()`：OPDS 2.0（JSON-LD），兼容 Readium Web Publication Manifest。
  - 制品下载链接指向 `/opds/artifacts/{sourceId}/{novelId}/{fileName}`。
- OPDS 路由定义在 `src/server/routes/opds.ts`，挂载于 `/opds` 路径：
  - `GET /opds/v1` / `GET /opds/v1/:sourceId/:novelId`：OPDS 1.2 Feed。
  - `GET /opds/v2` / `GET /opds/v2/:sourceId/:novelId`：OPDS 2.0 Feed。
  - `GET /opds/artifacts/:sourceId/:novelId/:fileName`：EPUB 制品下载。
- OPDS 可见性管理通过 `src/server/routes/library.ts` 中的 API 实现：
  - `GET/PUT /api/library/novels/:sourceId/:novelId/opds`：单书 OPDS 可见性读取/更新。
  - `GET/PUT /api/library/opds/novels`：批量管理上架书单。
- OPDS 偏好管理集成在 `src/server/routes/control-center.ts` 中：
  - `GET/PUT /api/control/preferences/opds`：读取/更新 OPDS 全局配置（启用开关 + Cron 表达式）。
  - `GET /api/control/opds/runs`：查询编译运行记录。
- `ControlCenterService` 提供快捷方法：`listVisibleOpdsNovelsWithMetadata()`、`getOpdsNovelArtifactAvailability()`、`getOpdsArtifactFilePath()` 等。
- `SystemPreferencesService` 中的 `OpdsConfig` 定义在 `src/server/core/system-preferences.ts`，含 `enabled`、`scanCronExpression`、`updatedAt` 字段。
- OPDS 相关测试在 `src/server/core/opds-compilation.test.ts`、`src/server/core/opds-feed.test.ts`、`src/server/routes/opds.test.ts`，应使用 SQLite 内存数据库。

### 4.13 手动小说与书库管理增强：Manual Novel & Library Lifecycle

- **手动小说（Manual Novel）**：`source_id = 'manual'` + `novel_id = UUIDv4`，复用现有 novels/chapters 数据表；章节 `url` 与信息页 `info_page_url` 存空字符串 `''`。无 SpiderAdapter，天然不可达于采集工作台；定时更新书单加载时过滤 `source_id = 'manual'`。
  - API 集中在 `src/server/routes/library.ts` 的 `/api/library/novels/manual/:novelId` 前缀（元数据编辑、章节增删改、卷管理），核心逻辑在 `ControlCenterService`（`createManualLibraryNovel`、`saveManualLibraryChapterWithAssets`、`listManualLibraryVolumes` 等）。
  - 卷表为 `manual_volumes`（novel_id + volume_title + sort_index）；未分卷章节归入隐式根卷。
  - 正文编辑器为 `@uiw/react-md-editor`（`library-reader-view.tsx`），图片先本地预览（ObjectURL），保存时统一上传至 `data/manual-assets/{novelId}/`，正文以 `manual://{assetId}` 引用（assetId 必须匹配 36 位 UUID）。任一图片上传失败则整体不保存（保留草稿）。
  - 手动章节 JSON 请求体可能携带 Base64 图片，`express.json({ limit: '64mb' })` 已放大（`src/server/app.ts`），不得回退。
- **书库回收站**：软删除标记为 `novels.deleted_at`，删除时快照调度与 OPDS 状态（`deleted_scheduling_json`、`deleted_opds_visible` 列），还原时按快照恢复。自 `deleted_at` 起 15 天后可 `purge` 真删，清理章节、书签、进度、别名、图谱、翻译引用、OPDS 制品、offline-assets/manual-assets 对应目录与版本历史；精翻任务因自包含快照而保留。`GET /api/library/trash` 列出回收站。回收站独立于精翻回收站。
- **版本历史**：`novel_metadata_versions` 与 `chapter_versions` 表（快照式、不可变，v0 起，版本号 = 变更次数）；每次「保存成功且内容不同」产生新版本；还原操作本身产生新版本。迁移时对既有数据补插 v0 快照（`INSERT OR IGNORE`，仅 `source_id <> 'manual'` 的旧数据）。
- **元数据同步（仅抓取小说）**：`POST .../metadata-sync` 抓取远端对比（`MetadataSyncPreview`），`PUT` 提交逐字段选择结果；采纳字段写入版本历史并给对应翻译单元打「待重译」标记。
- **章节更新（仅抓取小说）**：`POST .../chapters/:chapterId/refetch` 单章重新抓取，远端为权威：变化则替换正文与标题、写新版本、标待重译；无变化不写库；失败保持现有内容。
- **待重译（Stale Translation）**：`TranslationService.buildTranslationUnits` 的 continue 逻辑改为比较 `sourceContentHash`——已完成但内容哈希变化的单元重新纳入翻译目标，未变化的跳过。
- **Markdown 全局升级**：
  - 全库章节正文统一按 Markdown 处理（抓取正文为纯文本，是合法 MD 子集）。
  - 阅读器渲染：`react-markdown` + `remark-gfm` + `rehype-sanitize`（防 XSS），不得移除 sanitize。
  - 导出：Markdown 原样透传；EPUB 用 `marked` 转 HTML（`renderEpubMarkdown`）；TXT 用 `markdownToPlainText` 剥标签。
  - 翻译切分：`splitChapterParagraphs`（`segment-node.ts`）先按 `splitMarkdownBlocks` 识别 GFM 表格块，整个表格作为单个段落单元（`isTable`），不拆行；普通段仍按 2000 字符阈值二次切分。
  - 图片提取：`MARKDOWN_IMAGE_PATTERN` 与 `normalizeMediaUrl`（`offline-library.ts`）识别 `manual://` 引用，渲染/导出/缓存管线复用现有逻辑。
  - RAG 检索与图谱抽取保持文本层处理（不解析 MD AST），仅图片提取感知 `manual://`。
- 相关测试：`src/server/routes/library.test.ts`、`src/server/core/export-engine.test.ts`、`src/server/core/translation.test.ts`、`src/web/services/library-view.test.ts`，应使用 SQLite 内存数据库。

### 4.14 浏览器采集桥接：BrowserCaptureService & BrowserTransportSpiderAdapter

- 组成：`BrowserCaptureService`（`src/server/core/browser-capture.ts`，配对、连接、串行请求队列、暂停与审计）＋ `BrowserTransportSpiderAdapter`（`src/server/core/browser-transport-spider.ts`，按阶段委托站点适配器）＋ `src/server/routes/browser-capture.ts`（`/api/browser`）＋ `src/server/browser-capture-websocket.ts`（`/api/browser/ws`）＋ 独立扩展工程 `browser-extension/`。
- 配对：`POST /api/control/browser/pairing-token` 生成一次性令牌（仅存哈希、有效期 5 分钟、交换成功即删除），扩展以 `POST /api/browser/pair` 换取长期配对密钥；服务端只保存密钥哈希（`browser_capture_pairings.key_hash`，`browser_capture_audits` 存审计）。撤销（`revokePairing`）标记 `revoked_at` 并关闭在用连接（关闭码 `4003`）。
- WebSocket：路径必须为 `/api/browser/ws`，子协议 `tns-browser-v1`，配对密钥作为第二个 `Sec-WebSocket-Protocol` 值传递，`maxPayload` 32 MiB；协议或密钥非法返回 401，消息解析失败以 `4002` 关闭。
- 安全边界（ADR-0002 / ADR-0004）：默认监听 `127.0.0.1`；`allowRemoteBrowserCapture` 为 false 时，`/api/browser` 与 `/api/control/browser` 前缀在非回环 Host 一律 403（防 DNS rebinding），`index.ts` 仅当 HOST 为 `0.0.0.0` / `::`（容器部署）时放开。配对密钥只授权桥接通道，**不得**用它访问管控 API。扩展只回传渲染后的 DOM；Cookie 与站点验证凭据不得离开浏览器；开发数据导出（下载页面 HTML、查看 Cookie）仅落在开发者本机，绝不进入服务端或配对通道。
- 任务模型：任务种类 `kind` 为 `direct` / `browser`，状态含 `paused` 与 `waiting_user`；浏览器任务强制单章并发并按队列尾部串行，复用 `SpiderRunner`、任务快照与 SSE 链路。控制入口 `POST /api/control/tasks/:taskId/browser-control`（`pause` / `continue` / `abort`）；需要人工处理（如人机验证）时进入 `waiting_user`，扩展断连把在用任务标记 `failed`（`transport_disconnected`），`capture_aborted` 映射为 `aborted`，另有 `transport_unavailable` / `capture_timeout` 等错误码。
- 经浏览器传输采集的书籍标记 `novels.capture_transport = 'browser'`，写标记时删除 `scheduled_novels` 行：这类书籍**不得**参与定时更新与远端图片缓存。
- 注册表：`SpiderRegistryEntry` 需同时声明 `transports`（含 `browser`）与 `createBrowserSpider` 才算支持浏览器传输，`GET /api/control/sources` 会暴露 `transports`；现有 Syosetu / Syosetu18 / Kakuyomu 三者均支持。解析始终留在站点适配器内，`BrowserTransportSpiderAdapter` 只做委托与解析失败等待重试，**不得**在适配器中绕过站点校验（ADR-0003）。
- 测试：`browser-capture.test.ts`、`browser-transport-spider.test.ts`、`browser-capture-websocket.test.ts`、`routes/control-center.test.ts`（配对一次性、作用域受限、可撤销、Host 校验）、`browser-extension/src/shared/bridge.test.ts`，均不得依赖真实浏览器或站点网络。

### 4.15 消息通知：NotificationService

- 通用事件/结果契约位于 `contracts/notification.ts`，渠道接口位于 `core/notification-channel.ts`，首版 `AstrBotNotificationChannel` 通过实例 OpenAPI 确定消息路径，POST 后不得切换路径重投。
- `notification_deliveries` 持久化事件去重键与脱敏后的发送记录；后台发送单次 15 秒、最多 3 次，仅明确可重试拒绝允许重试。发送超时及未知结果不自动重投；异常仅落本地日志。
- 采集告警在任务终态提交；定时更新检查错误按小说/轮次提交；新章下载结果在翻译/总结前提交，错误告警与更新提醒合并。不得从所有错误日志自动派生通知。
- `scheduled_novels.notify_on_update` 默认为 0，部分更新保留旧值，回收站快照恢复该值。只有全局通知开启、该书更新检查及更新通知均开启才发送更新提醒；独立错误告警不受单书通知开关影响。
- 设置位于 `notification-panel.tsx`；UMO 查询经后端，输入始终允许手写，连接变化同步失效候选并忽略迟到结果。所有自动测试使用模拟渠道/HTTP，不发送真实外部消息。
- API、兼容范围和实机验收边界见 `docs/notifications.md`。

## 5. API 路由速查 (API Routes)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康探针 |
| GET | `/api/control/sources` | 获取注册的爬虫来源列表 |
| GET | `/api/control/preview` | 预览小说元数据与目录（查询参数 `sourceId`、`novelId`、可选 `kind`，含增量状态） |
| GET | `/api/control/tasks` | 抓取任务快照列表（`?limit=`） |
| POST | `/api/control/tasks` | 创建并启动抓取任务（`kind` 为 `direct` 或 `browser`） |
| GET | `/api/control/tasks/:id` | 获取任务快照 |
| GET | `/api/control/tasks/:id/events` | SSE：实时任务日志流 |
| POST | `/api/control/tasks/:id/browser-control` | 浏览器采集任务控制（pause / continue / abort） |
| GET/PUT | `/api/control/network-proxy` | 读取/更新代理配置 |
| POST | `/api/control/network-proxy/validate` | 验证代理连通性 |
| GET/PUT | `/api/control/preferences/llm-providers` | 读取/更新 LLM 提供商配置 |
| POST | `/api/control/preferences/llm-providers/:providerId/models/:modelId/validate` | 验证单个 LLM 模型 |
| POST | `/api/control/preferences/llm-providers/discover-models` | 探测提供商可用模型列表 |
| GET/PUT | `/api/control/preferences/model-gateway` | 读取/更新模型网关配置 |
| GET/PUT | `/api/control/preferences/neo4j` | 读取/更新 Neo4j 连接配置 |
| POST | `/api/control/preferences/neo4j/validate` | 验证 Neo4j 连接 |
| GET/PUT | `/api/control/preferences/reader-typography` | 读取/更新全局阅读排版偏好 |
| GET/PUT | `/api/control/preferences/translation` | 读取/更新翻译偏好配置 |
| GET/PUT | `/api/control/scheduling` | 读取/更新定时更新调度策略 |
| GET | `/api/control/scheduling/runs` | 查询定时更新运行记录（支持 `?limit=&offset=`） |
| GET | `/api/library/novels` | 书库列表（支持 `?q=` 搜索） |
| GET | `/api/library/novels/:sourceId/:novelId` | 书库单本详情（含知识图谱状态） |
| GET | `/api/library/trash` | 回收站小说列表 |
| POST | `/api/library/manual-novels` | 创建手动小说 |
| PUT | `/api/library/novels/manual/:novelId/metadata` | 更新手动小说元数据 |
| POST | `/api/library/novels/manual/:novelId/chapters` | 新建手动章节（可携带 Base64 图片） |
| PUT | `/api/library/novels/manual/:novelId/chapters/:chapterId` | 保存手动章节（可携带 Base64 图片） |
| DELETE | `/api/library/novels/manual/:novelId/chapters/:chapterId` | 删除手动章节 |
| PUT | `/api/library/novels/manual/:novelId/chapters/order` | 重排手动章节顺序 |
| GET/POST | `/api/library/novels/manual/:novelId/volumes` | 手动卷列表 / 新建卷 |
| PUT | `/api/library/novels/manual/:novelId/volumes/:title` | 重命名手动卷 |
| DELETE | `/api/library/novels/manual/:novelId/volumes/:title` | 删除手动卷（连带删除其章节） |
| GET | `/api/library/manual-assets/:novelId/:assetId` | 获取手动小说素材文件 |
| POST/PUT | `/api/library/novels/:sourceId/:novelId/metadata-sync` | 预览 / 应用元数据同步（逐字段选择） |
| POST | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId/refetch` | 单章重新抓取（远端为权威） |
| GET | `/api/library/novels/:sourceId/:novelId/versions/metadata` | 元数据版本历史 |
| GET | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId/versions` | 章节版本历史 |
| POST | `/api/library/novels/:sourceId/:novelId/versions/metadata/:version/restore` | 还原元数据版本（产生新版本） |
| POST | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId/versions/:version/restore` | 还原章节版本（产生新版本） |
| POST | `/api/library/novels/:sourceId/:novelId/trash` | 移入书库回收站（软删除） |
| POST | `/api/library/novels/:sourceId/:novelId/restore` | 从回收站还原 |
| GET | `/api/library/novels/:sourceId/:novelId/purge-status` | 查询彻底删除状态（剩余天数） |
| DELETE | `/api/library/novels/:sourceId/:novelId/purge` | 彻底删除（清理全部关联数据） |
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
| GET | `/api/library/novels/:sourceId/:novelId/translate/units` | 获取元数据、卷标题、章节的翻译明细与状态 |
| GET/PUT | `/api/library/novels/:sourceId/:novelId/translate/profile` | 读取/更新翻译配置 |
| GET | `/api/library/novels/:sourceId/:novelId/translate/chapters/:chapterId` | 获取章节翻译详情 |
| GET | `/api/library/novels/:sourceId/:novelId/translate/terms` | 获取术语库列表 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/terms` | 创建术语条目 |
| PUT | `/api/library/novels/:sourceId/:novelId/translate/terms/:termId` | 更新术语条目 |
| DELETE | `/api/library/novels/:sourceId/:novelId/translate/terms/:termId` | 删除术语条目 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/terms/import-from-graph` | 从知识图谱实体导入术语 |
| GET/POST | `/api/library/novels/:sourceId/:novelId/translate/term-extraction` | 术语候选 AI 提取状态 / 启动提取 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/term-extraction/cancel` | 取消术语候选提取 |
| GET/POST | `/api/library/novels/:sourceId/:novelId/translate/term-translation` | 缺译术语批量翻译状态 / 启动翻译 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/term-translation/cancel` | 取消缺译术语批量翻译 |
| POST | `/api/library/novels/:sourceId/:novelId/translate/terms/bulk-status` | 批量更新术语状态（确认/排除） |
| GET/PUT | `/api/library/novels/:sourceId/:novelId/scheduling` | 读取/更新单书定时更新状态 |
| GET | `/api/library/scheduling/novels` | 获取所有书籍的定时更新书单 |
| PUT | `/api/library/scheduling/novels` | 批量更新定时更新书单 |
| GET/PUT | `/api/library/novels/:sourceId/:novelId/opds` | 读取/更新单书 OPDS 可见性 |
| GET/PUT | `/api/library/opds/novels` | 批量管理 OPDS 上架书单 |
| GET/PUT | `/api/control/preferences/opds` | 读取/更新 OPDS 全局配置（启用 + Cron 表达式） |
| GET | `/api/control/opds/runs` | 查询 OPDS 编译运行记录（支持 `?limit=&offset=`） |
| GET | `/api/control/browser/status` | 浏览器采集桥接连接状态 |
| POST | `/api/control/browser/pairing-token` | 生成一次性配对令牌（默认仅限本机访问） |
| GET | `/api/control/browser/pairings` | 已授权浏览器列表 |
| DELETE | `/api/control/browser/pairings/:pairingId` | 撤销配对（并断开在用连接） |
| GET | `/api/control/browser/audits` | 采集审计记录（`?limit=`，默认 100） |
| GET | `/api/browser/status` | 扩展侧连接状态（配对密钥 Bearer 鉴权） |
| POST | `/api/browser/pair` | 用一次性令牌换取配对密钥 |
| DELETE | `/api/browser/pairing` | 扩展主动解除配对 |
| WS | `/api/browser/ws` | 桥接 WebSocket 通道（子协议 `tns-browser-v1`） |
| GET | `/opds/v1` | OPDS 1.2 根目录 Feed（Atom XML） |
| GET | `/opds/v1.opds` | OPDS 1.2 根目录 Feed 的备用路径 |
| GET | `/opds/v1/:sourceId/:novelId` | OPDS 1.2 单书 Feed |
| GET | `/opds/v2` | OPDS 2.0 根目录 Feed（JSON-LD） |
| GET | `/opds/v2/:sourceId/:novelId` | OPDS 2.0 单书 Publication |
| GET | `/opds/artifacts/:sourceId/:novelId/:fileName` | 下载 EPUB 制品（original/translated/bilingual） |
| GET | `/api/refined-translations/tasks` | 精翻任务列表（支持 `?recycleBin=true`） |
| POST | `/api/refined-translations/tasks` | 创建精翻任务 |
| GET | `/api/refined-translations/tasks/:taskId` | 精翻任务详情 |
| PUT | `/api/refined-translations/tasks/:taskId` | 更新精翻任务配置 |
| GET | `/api/refined-translations/tasks/:taskId/stream` | SSE：精翻任务实时更新流 |
| GET | `/api/refined-translations/tasks/:taskId/chapters/:chapterId` | 精翻章节快照 |
| PUT | `/api/refined-translations/tasks/:taskId/chapters/:chapterId/segments/:paragraphIndex` | 写入段落译文 |
| POST | `/api/refined-translations/tasks/:taskId/chapters/:chapterId/segments/:paragraphIndex/reopen` | 重新开启段落自动修订（可选 `fromScratch=true` 清空译文） |
| PUT | `/api/refined-translations/tasks/:taskId/chapters/:chapterId/title` | 更新章节标题译文 |
| GET | `/api/refined-translations/tasks/:taskId/terms` | 精翻任务术语列表 |
| POST | `/api/refined-translations/tasks/:taskId/terms/extract` | AI 提取术语候选 |
| POST | `/api/refined-translations/tasks/:taskId/terms` | 创建术语条目 |
| PUT | `/api/refined-translations/tasks/:taskId/terms/:termId` | 更新术语条目 |
| DELETE | `/api/refined-translations/tasks/:taskId/terms/:termId` | 删除术语条目 |
| POST | `/api/refined-translations/tasks/:taskId/terms/bulk-status` | 批量更新术语状态 |
| POST | `/api/refined-translations/tasks/:taskId/terms/bulk-delete` | 批量删除术语 |
| POST | `/api/refined-translations/tasks/:taskId/sync-source` | 同步书库原文（可选 `reuseTaskId` 带入其他任务译文） |
| POST | `/api/refined-translations/tasks/:taskId/terms/:termId/agent-suggestion` | 术语 AI 修订建议 |
| POST | `/api/refined-translations/tasks/:taskId/chapters/:chapterId/segments/:paragraphIndex/agent-suggestion` | 段落 AI 修订建议 |
| POST | `/api/refined-translations/tasks/:taskId/chapters/:chapterId/agent-chat` | 章节 Agent 对话 |
| POST | `/api/refined-translations/tasks/:taskId/chapters/:chapterId/agent-edits/approve` | 确认章节 Agent 修改提案 |
| GET | `/api/refined-translations/tasks/:taskId/reviews` | 审核意见列表 |
| POST | `/api/refined-translations/tasks/:taskId/reviews` | 创建审核意见 |
| PUT | `/api/refined-translations/tasks/:taskId/reviews/:reviewId` | 处理审核意见（接受/拒绝/忽略） |
| POST | `/api/refined-translations/tasks/:taskId/advance` | 推进到下一步骤 |
| POST | `/api/refined-translations/tasks/:taskId/pause` | 暂停精翻任务 |
| POST | `/api/refined-translations/tasks/:taskId/resume` | 继续精翻任务 |
| POST | `/api/refined-translations/tasks/:taskId/retry-failed` | 重试失败段落 |
| DELETE | `/api/refined-translations/tasks/:taskId` | 删除任务（移入回收站） |
| POST | `/api/refined-translations/tasks/:taskId/restore` | 从回收站恢复任务 |
| GET | `/api/refined-translations/tasks/:taskId/purge-status` | 查询永久删除状态 |
| DELETE | `/api/refined-translations/tasks/:taskId/purge` | 永久删除任务 |
| GET | `/api/refined-translations/tasks/:taskId/export/:format` | 导出精翻结果（epub/markdown/txt，`?mode=` 控制原文/译文/双语） |
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
- 运行命令：`npm run test:server`（服务端）、`npm run test:web`（前端）、`npm run test:extension`（浏览器扩展，`browser-extension/src/**/*.test.ts`）、`npm run test:ci`（CI 脚本）。
- `npm test` 依次执行上述四组测试；单文件可运行 `npx tsx --test <服务端测试路径>`，前端单文件添加 `--tsconfig src/web/tsconfig.json`。脚本采用文件 glob；深层目录或新测试需核对实际输出，必要时显式传入测试路径，不能仅凭全量命令名称认定已覆盖。
- Spider 适配器测试通过注入本地 HTML fixture 进行，**不得**发起真实网络请求；浏览器采集桥接的测试同样不得启动真实浏览器或连接真实站点。
- **完成验收**：代码变更必须通过 `npm run typecheck` 和 `npm run build`，无类型错误和编译错误，并且相关测试通过。
- 扩展代码变更还需通过独立 `typecheck` 与 `build`（见 2.1）。不要用根目录类型检查替代扩展检查。

## 8. 文档更新规范 (Documentation)

- **禁止自动修改** `ROADMAP.md`。
- 未经用户明确要求，**禁止修改** `README.md` 和本文件（`AGENTS.md`）。
- 发布时的版本同步涉及：`changelog.md` 新增条目、根 `package.json`、`browser-extension/package.json`、`browser-extension/public/manifest.json` 的 `version` 字段，以及 `README.md` 的「当前版本」标注（见 `scripts/ci/prepare-release.mjs` 与 `.github/workflows/release.yml`）。
- 纯配置或文档变更至少需完成与改动直接相关的可执行验证（如 Docker build、healthcheck 等）。

## 9. 默认行为 (Default AI Behaviors)

- **新增爬虫**：在 `src/server/adapters/spider/` 下创建适配器文件，继承 `BaseHtmlSpiderAdapter`，并在 `ControlCenterService` 注册表中追加，同时补充测试。
- **前端组件**：默认使用 React Hooks + Mantine v7 组件库，通过 `src/web/services/api.ts` 调用后端接口。视觉风格遵循 `theme.ts` 中定义的暖色纸质暗调（`warmPaperDark`）。全局通知统一使用 `@mantine/notifications`（`notifications.show()`），不得自行实现通知中心组件。组件交互模式遵循：加载状态 → 草稿态编辑 → 验证反馈（✅/❌ 标识）→ 保存并通知。
- **前端路由**：七个主路由定义在 `src/web/services/app-routes.ts`（采集工作台 `/`、本地书库 `/library`、精翻工作区 `/refined-translation`、任务大盘 `/monitor`、定时更新 `/scheduling`、OPDS 书源 `/opds-dashboard`、全局设置 `/settings`）。书库模块由 `LibraryWorkspace` 壳层按子路由分发到 `LibraryListView` / `LibraryDetailView` / `LibraryReaderView`。
- **网络请求**：爬虫 HTTP 请求默认带完整 Headers，并经由 `createProxyAwareHtmlFetcher` 发出。
- **知识图谱与 AI 伴读**：相关功能为实验性，未经用户明确要求不得主动启用。新增图谱相关代码时需同步更新 `novel-repository.ts` 中的表结构与迁移逻辑。构建入口强制要求至少配置一个提取模型（无模型时直接拒绝并给出清晰提示）。LLM 失败不再回退本地规则，改为标记失败 + 重试。图谱构建测试应使用 SQLite 内存数据库，不得依赖真实 Neo4j 或 LLM 调用。
- **模型网关**：新增 AI 功能需通过 `resolveCapabilityRoute` / `resolveExtractionRoutes` 获取模型路由，不得硬编码模型选择。网关配置变更需同步更新 `system-preferences.ts` 中的 `LlmModelGatewayConfig` 类型与持久化逻辑。
- **系统偏好**：新增偏好字段需在 `SystemPreferencesService` 中定义接口与持久化逻辑，并在前端 `SystemPreferences` 组件中提供对应 UI。偏好迁移策略（新增字段默认值）需在 `system-preferences.ts` 的 `loadPersistedPreferences` 中显式处理。
- **书库搜索**：搜索语法变更需同步更新 `library-search.ts` 中的分词器与解析器，并补充测试覆盖。
- **翻译流水线**：新增翻译节点或修改流水线逻辑时，需同步更新 `translation-pipeline.ts` 中的 LangGraph 状态图定义（使用 `Annotation.Root()` API）以及 `translation-state.ts` 中的类型。翻译任务调度变更需同步更新 `translation-runner.ts`。术语库相关变更需同步更新 `translation-service.ts` 与 `novel-repository.ts` 中的表结构。从知识图谱实体导入术语（`importGraphEntitiesToTerms`）需要校验目标小说存在且术语表已就绪。翻译功能为 **已发布**，不属于实验性功能，但应在实现变更时提供测试覆盖。
- **定时更新调度**：新增调度相关代码需同步更新 `novel-repository.ts` 中的 `scheduled_novels`、`scheduled_check_runs` 表结构与迁移逻辑。调度测试使用 `scheduling.test.ts`，应使用 SQLite 内存数据库。前端 `CronEditor` 组件（`cron-editor.tsx`）使用 `cron-parser` 做表达式校验与实时预览。策略、书单表格与运行记录集中在独立 `/scheduling` 页面（`scheduling-dashboard.tsx`），不再使用全局设置内的书单 Modal。定时更新支持自动翻译联动（`auto_translate`）和自动总结（`auto_summarize`）。
- **OPDS 书源服务**：新增 OPDS 相关代码需同步更新 `novel-repository.ts` 中的 `opds_visible`、`content_updated_at`、`epub_compiled_at` 列以及 `opds_compilation_runs` 表结构与迁移逻辑。OPDS 测试使用 `opds-compilation.test.ts`、`opds-feed.test.ts`、`opds.test.ts`，应使用 SQLite 内存数据库。前端 OPDS 管理面板位于 `opds-dashboard.tsx`，视图模型位于 `opds-dashboard-model.ts`。OPDS 路由挂载在 `/opds` 路径下，注意与 `/api` 路由区分。
- **浏览器采集桥接**：新增站点若要支持浏览器传输，必须在 `ControlCenterService` 的注册表条目上同时声明 `transports`（含 `browser`）与 `createBrowserSpider`，并保持适配器只做解析（不得内含任何反爬绕过）；扩展只回传渲染后的 DOM，Cookie 与验证凭据不得离开浏览器；配对密钥只授权 `/api/browser` 通道，`/api/browser` 与 `/api/control/browser` 前缀必须保留回环校验（容器部署由 `allowRemoteBrowserCapture` 显式放开）。桥接相关测试使用模拟连接，不得启动真实浏览器。
- **翻译消息格式**：格式增删必须只改 `src/server/contracts/translation-message-format.ts` 这一处契约，前端选项与后端校验同步更新；新增专用格式时需同时覆盖首轮请求、重试、逐段回退、日志字段与存量配置迁移（未知值回退 `general`）。
- **书库术语流水线**：术语状态、提取窗口、批量翻译批次或运行记录的变更需同步 `library-term-extraction.ts`、`library-term-translation.ts`、`glossary-extraction.ts` 与 `novel-repository.ts` 的迁移逻辑，并补充对应测试。
- **精翻原文同步与译文复用**：两者都只在任务未运行时执行，必须按段落比对、保留未变段落译文、重置受影响章节的审核状态，且**不得**回写书库原始数据；相关表结构与迁移同步更新 `novel-repository.ts`。
- **精翻工作区**：精翻测试使用 `refined-translation.test.ts`，应使用 SQLite 内存数据库，不得依赖真实 LLM 调用。工具表面（`refined-translation-tools.ts`）必须通过 `scope` 绑定任务与章节作用域，不得让 Agent 自行传入 `taskId`/`chapterId`。工具代理接入点必须保留 `#generateText` 确定性回退路径。章节 Agent 编辑产出的修改必须经用户确认后才写入任务。精翻路由挂载在 `/api/refined-translations` 路径下。前端精翻工作区面板位于 `refined-translation-workspace.tsx`，任务详情与状态机流程图位于 `refined-translation-task-panel.tsx`（使用 `@xyflow/react` 渲染状态机）。
- **手动小说与书库生命周期**：新增手动小说/回收站/版本历史相关代码需同步更新 `novel-repository.ts` 中的表结构（`novel_metadata_versions`、`chapter_versions`、`manual_volumes`、`novels.deleted_at` 等列与迁移逻辑）。手动小说标识为 `source_id = 'manual'`，路由集中在 `/api/library/novels/manual/:novelId` 前缀；回收站独立于精翻回收站，purge 真删前必须二次确认。正文一律按 Markdown 处理：阅读器渲染必须保留 `rehype-sanitize` 防 XSS；翻译切分必须保持 GFM 表格为单个单元；EPUB 导出用 `marked` 转换。手动小说图片引用协议为 `manual://{assetId}`（36 位 UUID 校验），素材存储于 `data/manual-assets/{novelId}/`。
- **移动端布局**：采集页底部操作浮窗（`control-console.tsx`）的移动端版本必须单独渲染，使用紧凑布局（`p="xs"`、`compact-xs` 按钮、`wrap="nowrap"`），不得复用桌面端大卡片。移动端浮窗只需保留「解析目录」和「下发采集」两个按钮，「全局设置」按钮仅在桌面端出现。浮窗位置使用常量公式：`MOBILE_FOOTER_HEIGHT + MOBILE_AFFIX_GAP`，与 AppShell 的 `footer={{ height: isMobile ? 56 : 0 }}` 对齐。
- **键盘检测**：`control-console.tsx` 中的移动端键盘检测必须使用基准高度差值模型（记录 `visualViewport.height` 初始值，差值超过 140px 则判定键盘打开），并配合 `focusin`/`focusout` 事件兜底（输入框获焦点即判定键盘打开）。不得使用比例判断（如 `viewport.height < window.innerHeight * 0.78`），因为安卓浏览器中两个值可能同时变化导致检测失效。检测阈值应提取为模块级常量。
- *原 Python 参考项目地址：`C:\Users\silev\Documents\GitHub\PyNovelSpider`*

## 10. Git 提交规范 (Git Commit Convention)

Git 提交消息必须遵循以下统一格式，确保历史清晰、分类明确。

### 10.1 格式

```
<emoji> <type>(<scope>): <subject>

<body>

<footer>
```

- **emoji**：视觉分类标识，必须使用
- **type**：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `style` / `perf`
- **scope**：可选，如 `(opds)`、`(spider)`、`(api)`、`(web)`
- **subject**：中文标题，概括变更内容，首字无需空格
- **body**：英文或中英文混排，每行为一个 `- ` 开头的条目，描述具体变更
- **footer**：可选的 `Refs:` 或 `BREAKING CHANGE:`

### 10.2 Emoji 对照表

| Type | Emoji | 含义 |
|---|---|---|
| `feat` | ✨ | 新功能 |
| `fix` | 🐛 | Bug 修复 |
| `refactor` | ♻️ | 代码重构 |
| `docs` | 📚 | 文档变更 |
| `test` | 🧪 | 测试相关 |
| `chore` | 🔧 | 工程化/依赖/配置 |
| `style` | 🎨 | 代码格式/样式 |
| `perf` | ⚡ | 性能优化 |
| `wip` | 🚧 | 进行中（仅临时使用，合并前必须 squash） |

### 10.3 示例

```
✨ feat(opds): 实现 OPDS 基础层——可见性控制与 EPUB 制品生命周期

- DB: add opds_visible, content_updated_at, epub_compiled_at columns
- Repository: add OPDS CRUD methods
- OpdsCompilationService: new cron-based scheduler

Refs: ROADMAP OPDS 书源服务构建与分发
```

```
🐛 fix(api): 修复定时更新策略变更后调度器未正确重载的并发问题
```

```
📚 docs: 添加 OPDS 书源服务任务到路线图
```

### 10.4 约定

- 多条变更在同一提交中时，`subject` 概括主要变更，`body` 逐条列举
- 每行 body 以 `- ` 开头，长度不超过 72 字符（英文）或适当截断
- **禁止**仅重复文件列表而无语义描述的提交
- **禁止**在提交消息中包含内部指令或占位符（如 "TODO"、"TBD"）

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/` (no PR triage surface). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles use their default strings: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
