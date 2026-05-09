# TS Novel Spider - Copilot 辅助开发指南

## 1. 项目概述 (Project Overview)

- **核心定位**：基于 TypeScript 的自动化小说爬虫与多格式导出工具。
- **主要功能**：通过 Web 管控界面调度爬虫，抓取小说内容并持久化至本地 SQLite，支持离线阅读与多格式导出（Markdown、EPUB、TXT）。
- **架构模式**：前后端分离但合并部署的 B/S 架构。
  - **前端 (src/web)**：纯视图层，负责参数配置、目录浏览、实时监控与任务调度。
  - **后端 (src/server)**：核心执行层，负责爬虫调度、网页解析、SQLite 持久化、文件导出与 SSE 事件推送。后端任务完全独立于前端会话，前端关闭不影响任务执行。

## 2. 技术栈 (Tech Stack)

| 层 | 技术 |
|---|---|
| 后端 | Node.js ≥ 20, Express 5, `better-sqlite3`, `cheerio` |
| 前端 | React 19, Vite 6, TypeScript strict 模式 |
| 导出 | `jszip`（EPUB 打包） |
| 工程化 | `tsx` (watch + test runner), `concurrently`, Docker multi-stage build |

**禁止降级**：不得将 Express 5 降回 v4；不得关闭 TypeScript strict 模式。

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
│   │   │       └── mock-html-spider-adapter.ts    # 测试用 Mock
│   │   ├── core/
│   │   │   ├── spider.ts          # SpiderAdapter 接口 + BaseHtmlSpiderAdapter 抽象类
│   │   │   ├── spider-runner.ts   # 批量抓取调度器（含并发、重试、异常隔离）
│   │   │   ├── control-center.ts  # ControlCenterService（任务生命周期、Spider 注册表）
│   │   │   ├── novel-repository.ts # SQLite ORM（SqliteNovelRepository）
│   │   │   ├── offline-library.ts # 离线书库服务（章节详情、媒体资产）
│   │   │   ├── export-engine.ts   # 本地导出引擎（Markdown / EPUB / TXT）
│   │   │   ├── network-proxy.ts   # 网络代理服务（持久化至 .data/network-proxy.json）
│   │   │   └── logging.ts         # SpiderLogDispatcher + SpiderLogAdapter 接口
│   │   ├── routes/
│   │   │   ├── control-center.ts  # /api/control 路由
│   │   │   ├── library.ts         # /api/library 路由
│   │   │   └── health.ts          # /api/health 路由
│   │   ├── app.ts                 # createServerApp()，挂载路由与静态资源
│   │   └── index.ts               # HTTP 监听入口
│   └── web/
│       ├── components/            # UI 组件
│       ├── services/              # API 封装（api.ts）+ 视图模型
│       ├── App.tsx                # 路由配置入口
│       └── vite.config.ts
├── scripts/ci/                    # CI 发布准备脚本
├── data/
│   ├── exports/                   # 导出文件输出目录
│   └── offline-assets/            # 离线图片缓存
├── .data/                         # 运行时数据（SQLite、代理配置）— 不提交 Git
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
| GET | `/api/library/novels` | 书库列表 |
| GET | `/api/library/novels/:sourceId/:novelId` | 书库单本详情 |
| GET | `/api/library/novels/:sourceId/:novelId/chapters/:chapterId` | 章节内容 |
| GET | `/api/library/novels/:sourceId/:novelId/exports/:format/download` | 下载导出文件（markdown/txt/epub） |

## 6. 编码规范 (Coding Standards)

1. **类型安全**：禁止使用 `any`。API 响应、数据库模型、爬虫中间态数据必须定义 `interface` 或 `type`。
2. **异步处理**：统一使用 `async/await`。
3. **注释**：核心接口方法、复杂 CSS 选择器必须添加 JSDoc 注释。
4. **命名**：文件/目录用 `kebab-case`；类用 `PascalCase`；变量/函数用 `camelCase`。
5. **请求头**：爬虫发起的所有 HTTP 请求必须带 `User-Agent`、`Accept-Language`、`Accept` 等基础请求头。
6. **私有字段**：类的内部状态优先使用 `#privateField` 语法（ES2022 私有字段），而非 `private` 关键字。

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
- **前端组件**：默认使用 React Hooks，通过 `src/web/services/api.ts` 调用后端接口，与现有暗黑模式视觉风格保持一致。
- **网络请求**：爬虫 HTTP 请求默认带完整 Headers，并经由 `createProxyAwareHtmlFetcher` 发出。
- *原 Python 参考项目地址：`C:\Users\silev\Documents\GitHub\PyNovelSpider`*
