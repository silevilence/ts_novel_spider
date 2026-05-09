# TS Novel Spider - Copilot 辅助开发指南

## 1. 项目概述 (Project Overview)
- **项目名称**：TS Novel Spider
- **核心定位**：基于 TypeScript 的自动化小说爬虫与导出工具。
- **主要功能**：抓取指定来源的小说内容并持久化至本地，支持将抓取的数据导出为多种标准格式（Markdown、JSON、TXT 等）。
- **架构模式**：前后端分离（B/S 架构）但合并部署。
  - **前端 (Web)**：仅作为纯视图层与管控中心，负责参数配置、进度展示与任务调度。
  - **后端 (Server)**：作为核心执行层，负责真正的爬虫调度、网页解析、数据持久化与文件导出等高密集任务。且必须支持后台守护态运行（前端界面关闭不影响后端任务执行）。

## 2. 技术栈约束 (Tech Stack)
- **通用**：全栈 TypeScript (开启 strict 模式)。
- **后端 (src/server)**：Node.js, Express, SQLite (建议使用 `better-sqlite3` 或 `sqlite3`), 高性能 HTML 解析库 (建议使用 `cheerio`)。
- **前端 (src/web)**：React, Vite。
- **工程化**：本地脚本开发使用 `concurrently` 管理全栈开发环境的并行启动；容器化开发与部署遵循仓库中的 Docker / Compose 配置。

## 3. 目录结构规范 (Directory Structure)
在生成或修改文件时，请严格遵守以下目录划分：
```text
.
├── src/
│   ├── server/           # 后端与核心爬虫逻辑
│   │   ├── adapters/     # 策略模式适配器（Spider, Log）
│   │   ├── core/         # 核心调度器、数据库 ORM/交互、文件导出服务
│   │   ├── routes/       # Express 接口路由
│   │   └── index.ts      # Express 入口，挂载 API 与静态资源
│   └── web/              # 前端 React 工程 (由 Vite 构建)
│       ├── components/   # UI 组件
│       ├── services/     # API 请求封装
│       └── App.tsx       # 前端入口
├── Dockerfile            # 生产环境镜像构建脚本
├── Dockerfile.dev        # 开发环境镜像构建脚本
├── docker-compose.yml    # 生产环境容器编排配置
├── docker-compose.dev.yml # 开发环境容器编排配置
├── package.json          # 根配置，包含 concurrently 启动脚本
└── tsconfig.json         # 全局 TS 配置
```

## 4. 核心架构与设计模式要求 (Core Architecture & Patterns)

### 4.1 策略模式 (Strategy Pattern) 绝对优先
- **爬虫适配器 (Spider Adapter)**：必须定义统一的接口/抽象类（包含：生成URL、解析基本信息、解析章节列表、单章抓取、批量抓取等方法）。具体的站点（如 Syosetu, Syosetu18）必须实现该接口。
- **日志适配器 (Log Adapter)**：解耦爬虫逻辑与日志输出，提供统一的事件上报接口，便于后续桥接控制台输出、数据库落盘或通过 SSE (Server-Sent Events) 推送给前端。
- *注：当要求参考原 Python 项目 (`PyNovelSpider`) 时，需将 Python 的面向对象逻辑转换为符合 TypeScript 特性的策略模式实现。*
- *原 Python 项目地址：`C:\Users\silev\Documents\GitHub\PyNovelSpider`*

### 4.2 后台运行与异常隔离原则 (Resilience & Background Execution)
- **状态分离**：前端关闭或断开连接时，后端的抓取任务（Promise 链或任务队列）必须能够继续独立执行。
- **异常隔离**：在进行批量章节抓取时，**必须**捕获单章抓取的异常 (`try/catch`)。单个章节的请求超时或解析失败，绝对不能阻塞或中断其他章节的抓取流程。
- **重试机制**：为网络请求和解析失败保留重试逻辑的插槽。

### 4.3 增量更新与状态校验 (Incremental Updates)
- 在获取小说基本信息及目录时，需优先查询本地 SQLite 数据快照。
- 前端与后端交互时，应能比对出“已下载章节”与“新增章节”，并在 API 响应中予以标识。

## 5. 编码规范 (Coding Standards)
1. **类型安全**：禁止使用 `any`，必须为 API 响应、数据库模型、爬虫中间态数据定义清晰的 `interface` 或 `type`。
2. **异步处理**：统一使用 `async/await`，避免回调地狱。
3. **注释规范**：对于核心的适配器接口、复杂 DOM 解析逻辑（如 CSS 选择器定位），必须添加 JSDoc 注释。
4. **命名规范**：文件和目录使用 `kebab-case` 或 `snake_case`；类名使用 `PascalCase`；变量和函数使用 `camelCase`。
5. **测试覆盖**：所有可测试的功能实现与问题修复必须补充或更新自动化测试；基础设施配置类变更（如 Docker / Compose）至少需要完成对应的构建、启动或配置解析验证。
6. **手动更新文档**：禁止自动修改 `ROADMAP.md`，并且在用户没有明确要求时，禁止修改 `README.md`和`copilot-instructions.md`。
7. **任务与问题修改完成验收**：代码类变更必须在相关测试通过后才能算完成，并且必须通过 `typecheck` 和 `build` 验证没有编译错误；纯配置或文档变更至少需要完成与改动直接相关的可执行验证。

## 6. 上下文记忆与默认行为 (Default AI Behaviors)
- 如果我要求“新增一个爬虫”，请自动继承已有的爬虫核心接口，并在指定的目录下创建适配器文件。
- 如果我要求“编写前端组件”，请默认其为无状态组件或使用 React Hooks 进行状态管理，并默认请求 `src/server` 提供的 API。
- 在涉及网络请求抓取（爬虫部分）时，请默认带上基础的 Headers（User-Agent 等）以防基础反爬。