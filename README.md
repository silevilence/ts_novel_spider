# TS Novel Spider

一款基于 TypeScript 的自动化小说抓取与离线阅读工具，提供 Web 管控界面，支持后台守护运行与多格式导出。当前版本 **v0.13.3**。

## 功能特性

- **多站点抓取**：内置 [小説家になろう](https://ncode.syosetu.com)（Syosetu）、[ノクターンノベルズ](https://novel18.syosetu.com)（Syosetu18）与 [カクヨム](https://kakuyomu.jp)（Kakuyomu）适配器
- **浏览器采集桥接**：除服务端直连外，可把采集方式切换为「浏览器传输」，由你配对授权过的真实浏览器在标签页中加载页面并回传渲染后的 DOM，用于服务端直连受限的站点（人机验证、权限授权、触发频率限制等）。浏览器任务串行执行，可在任务大盘暂停、继续或中止，需要人工处理时任务会进入等待状态
- **浏览器扩展**：随附 Chromium Manifest V3 扩展（Edge / Chrome），提供配对、连接与任务状态展示、逐章采集走查，以及仅供开发使用的页面 HTML / Cookie 本地导出；扩展只回传渲染后的 DOM，Cookie 与站点验证凭据不会离开浏览器
- **增量同步**：自动对比本地缓存与远端目录，高亮标识新增章节
- **批量下载**：支持并发抓取，单章失败不阻塞整体任务，失败章节可单点重试
- **离线阅读**：内置沉浸式阅读器，支持字体、字号、行高、段间距个性化排版，图片资源可本地化缓存；正文按 Markdown 渲染（表格、删除线、任务列表等）
- **手动维护小说**：书库内可直接创建不依赖任何站点的小说，元数据、卷/章结构与正文全部由用户维护；正文支持 Markdown 编辑与本地图片插入，章节与卷可自由新建、重命名、删除、排序与跨卷移动
- **多格式导出**：支持导出为 Markdown、EPUB、TXT 三种格式，已翻译内容可按原文、纯译文或双语对照模式导出
- **章节翻译**：接入大语言模型对已下载章节进行逐段翻译与 AI 审校，翻译结果自动保存，支持进度追踪与从零重译。翻译范围覆盖书名、简介、卷标题及章节标题，阅读器可完整查看各层级译文。翻译中断、失败或应用重启后可从已完成的段落继续，无需整章重来
- **翻译消息格式**：翻译模型可分别选用「通用 / HY-MT2 / Bilibili Index-Translate」三种消息格式，适配对提示词组织有特殊要求的翻译模型
- **翻译术语库**：每本小说拥有独立的术语库，支持自定义术语条目（源词、译文、实体类型、注释），可从知识图谱实体一键导入，翻译流水线自动参照术语库确保译文一致性。术语按「待确认 / 已确认 / 已排除」管理，支持 AI 从已下载章节提取候选、批量确认与批量 AI 翻译缺译术语
- **双语阅读**：阅读器支持原文 / 纯译文 / 段落级双语对照三种视图实时切换，方便对照学习
- **模型网关**：可为对话、向量嵌入、重排序等不同 AI 能力分别指定默认模型，按任务自动路由
- **网络代理**：支持配置 HTTP/SOCKS 代理，代理配置持久化跨重启保留
- **后台守护**：前端界面关闭后，后端抓取任务持续运行，不受影响
- **实时监控**：通过 SSE 推送任务进度，前端实时展示日志与进度条
- **智能检索**：支持按书名、作者、标签、摘要等多维度模糊搜索，可按相关性排序
- **阅读进度与书签**：自动记忆每本书的阅读位置，支持手动添加章内书签
- **书籍别名**：可为本地书籍设置自定义别名，搜索时自动关联
- **AI 伴读与知识图谱（实验性）**：接入大语言模型自动构建人物关系与情节图谱，支持 AI 问答辅助理解文本内容。检索链路采用 GraphRAG 两阶段召回：先按图谱摘要（子图、章节簇、社区）定位，再下钻证据片段，并展示实体对齐与多跳路径
- **自动化定时更新**：支持固定间隔、Cron 表达式、每周定时三种调度策略，自动检查已标记书籍的远端更新并增量下载到本地。每本书可独立开关，可在设置中批量管理参与定时更新的书单
- **自动翻译联动**：开启后，每次定时更新发现新章节并下载完成，自动触发翻译，仅翻译新增章节，已有译文自动跳过
- **更新总结**：支持为每本书开启自动总结，新章节抓取完成后调用 AI 生成剧情摘要，可全局选择总结模型也可单本覆盖
- **定时更新管理面板**：独立页面集中管理调度策略、书单和运行记录，支持查看每次检查的耗时、扫描书籍数和发现更新数
- **OPDS 书源服务**：支持 OPDS 1.2（Atom XML）与 OPDS 2.0（JSON-LD）协议，将本地书库作品分发给阅读器应用。自动为每本上架书籍编译 EPUB 制品，有翻译的作品额外生成译文版和双语对照版
- **精翻工作区**：独立于书库粗翻的精翻流水线，按「术语确认 → 术语翻译 → 正文初翻 → 遗漏检查 → 审核校对 → 审核修订」六阶段推进。每本小说可创建精翻任务，自动快照原文与术语候选，支持段落级编辑、章节 Agent 对话、多轮审核与多格式导出（原文/译文/双语对照）。任务可将书库中的最新原文增量同步进来（未变段落保留译文、受影响章节重新审核），也可带入其他同源同语言精翻任务的已有译文复用
- **书库回收站**：删除的小说移入回收站，可随时还原；移入后自动退出定时更新与 OPDS 分发，15 天后可彻底删除（清理全部关联数据）
- **元数据同步（抓取小说）**：一键重新抓取信息页元数据，弹窗逐字段对比差异，标题/作者/简介/标签可分别选择保留旧版或采用新版，标签还支持合并模式
- **章节内容更新（抓取小说）**：对单个章节重新抓取，远端为权威：内容变化则替换正文并记录新版本，无变化明确提示，抓取失败保留现有内容
- **版本历史**：小说的元数据与章节正文均保留快照式版本历史（从 v0 开始），支持查看与一键还原到任意历史版本

## 快速上手

### 前置要求

- Node.js >= 20
- npm
- Microsoft Edge 或 Google Chrome 116+（仅浏览器采集桥接需要）

### 本地开发

```bash
# 安装依赖
npm install

# 同时启动前端（Vite dev server）和后端（tsx watch）
npm run dev
```

启动后：
- 前端开发服务器：`http://localhost:5173`
- 后端 API：`http://localhost:3000`

### 构建与生产运行

```bash
# 构建前后端
npm run build

# 启动生产服务（默认端口 3000）
npm start
```

访问 `http://localhost:3000` 即可使用完整应用。

### 运行测试

```bash
npm test               # 全量测试（服务端 + 前端 + 浏览器扩展 + CI 脚本）
npm run test:server    # 仅服务端测试
npm run test:web       # 仅前端测试
npm run test:extension # 仅浏览器扩展测试
npm run typecheck      # TypeScript 类型检查
```

### 浏览器扩展（可选，用于浏览器采集桥接）

浏览器采集桥接依赖随附的 Chromium 扩展（Microsoft Edge / Google Chrome 116+）：

```bash
cd browser-extension
npm install
npm run build   # 构建产物位于 browser-extension/dist/
```

在 `edge://extensions` 或 `chrome://extensions` 开启开发者模式，以「加载解压缩的扩展」选择 `browser-extension/dist/` 目录即可。

## Docker 部署

### 生产环境（推荐）

使用预构建的 GitHub Packages 镜像一键拉起：

```bash
docker compose up -d
```

默认端口映射 `3000:3000`，可通过环境变量覆盖：

```bash
TS_NOVEL_SPIDER_PORT=8080 docker compose up -d
```

数据持久化目录：
| 宿主机路径 | 容器内路径 | 用途 |
|---|---|---|
| `./.data` | `/app/.data` | SQLite 数据库、代理配置等运行时数据 |
| `./data` | `/app/data` | 导出文件（epub/txt/md）、离线图片缓存 |

### 本地开发容器

使用 `Dockerfile.dev` 构建，注入国内加速源：

```bash
docker compose -f docker-compose.dev.yml up
```

## 使用说明

1. 打开 Web 界面，在**采集工作台**选择目标站点（Syosetu / Syosetu18 / Kakuyomu）
2. 输入小说 ID（Syosetu 如 `n3130lr`，Kakuyomu 如 `822139839856110454`），点击**解析目录**加载元数据与目录
3. 在章节目录中勾选需要下载的章节，点击**下发采集**
4. 前往**任务大盘**查看实时进度与日志
5. 下载完成后，前往**本地书库**页面离线阅读、导出文件或发起 AI 翻译；书库中也可点击「新建手动小说」创建不依赖站点的小说
6. 前往**精翻工作区**页面可创建独立精翻任务，进行术语管理、段落级编辑与多轮审核校对
7. 前往**定时更新**页面可配置自动追更策略，支持自动翻译联动和 AI 更新总结
8. 在**全局设置**页面可配置网络代理、大模型服务、图数据库连接、阅读排版偏好、浏览器采集桥接以及翻译默认选项

删除的小说会进入书库回收站，可在书库页面的回收站入口查看、还原或彻底删除。

如需采集服务端直连受限的站点，把**采集工作台**的「采集传输」切换为「浏览器扩展」（仅对支持桥接的来源可选），先在**全局设置 → 浏览器采集桥接**生成一次性配对令牌，再到扩展设置页填入令牌完成配对。之后的采集任务会由浏览器在真实标签页中依次打开信息页与目录页：需要你手动完成授权或验证时任务进入等待状态，可在**任务大盘**暂停、继续或中止；扩展弹窗也提供「保存本页」「打开目录」「暂停/继续/中止任务」等操作，便于逐章走查。

如需启用 AI 伴读与知识图谱功能（实验性），需先在设置中完成大模型与 Neo4j 的连接配置。

如要使用 OPDS 书源服务，前往 **OPDS 书源** 页面开启服务并管理上架书单，支持 OPDS 1.2 与 OPDS 2.0 的阅读器可通过 `/opds/v1` 或 `/opds/v2` 地址浏览和下载。

## 目录结构

```
.
├── src/
│   ├── server/                  # 后端与爬虫核心逻辑
│   │   ├── adapters/
│   │   │   ├── log/             # 日志适配器
│   │   │   └── spider/          # 站点爬虫适配器（Syosetu / Syosetu18 / Kakuyomu）
│   │   ├── contracts/           # 前后端共享契约（翻译消息格式）
│   │   ├── core/
│   │   │   ├── translation/     # 翻译流水线子节点（分段/翻译/组装/审校/定稿）
│   │   │   ├── browser-capture.ts          # 浏览器采集桥接（配对、串行调度、审计）
│   │   │   ├── browser-transport-spider.ts # 浏览器传输适配器包装
│   │   │   ├── translation-checkpoint.ts   # 翻译段落检查点（中断恢复）
│   │   │   ├── refined-translation.ts        # 精翻工作区服务（任务/术语/审核生命周期）
│   │   │   ├── refined-translation-tools.ts   # 精翻 Agent 工具表面（AI SDK ToolSet）
│   │   │   ├── library-intelligence-rag.ts    # GraphRAG 检索（摘要召回 + 证据下钻）
│   │   │   ├── library-term-extraction.ts     # 书库术语候选 AI 提取
│   │   │   ├── library-term-translation.ts    # 缺译术语批量 AI 翻译
│   │   │   ├── opds-compilation.ts  # OPDS 制品编译调度器
│   │   │   ├── opds-feed.ts         # OPDS Feed 生成（Atom XML + JSON-LD）
│   │   │   ├── scheduling-summary.ts  # 更新总结服务（AI 摘要生成）
│   │   │   ├── scheduling.ts    # 定时更新调度引擎
│   │   │   └── ...              # 数据库、导出引擎、网络代理、系统偏好、知识图谱
│   │   ├── routes/
│   │   │   ├── browser-capture.ts  # 浏览器采集桥接配对 API（/api/browser）
│   │   │   ├── refined-translation.ts  # 精翻工作区 API
│   │   │   ├── opds.ts          # OPDS 协议路由（v1/v2 Feed + 制品下载）
│   │   │   └── ...              # health、control-center、library 等路由
│   │   └── index.ts             # 服务入口
│   └── web/                     # 前端 React 工程（Mantine v7 + Vite 构建）
│       ├── components/
│       │   ├── refined-translation-workspace.tsx  # 精翻工作区面板
│       │   ├── refined-translation-task-panel.tsx  # 精翻任务详情与状态机流程图
│       │   ├── scheduling-dashboard.tsx  # 定时更新管理面板
│       │   ├── opds-dashboard.tsx  # OPDS 书源管理面板
│       │   └── ...              # 控制台、书库、监控、设置、Cron 编辑器等
│       ├── services/            # API 封装与视图模型
│       └── App.tsx              # 前端入口与路由配置（含 OPDS 路由）
├── data/
│   ├── exports/                 # 导出的小说文件
│   ├── manual-assets/           # 手动小说上传的图片素材
│   ├── offline-assets/          # 本地化图片缓存
│   └── opds-artifacts/          # OPDS EPUB 制品
├── .data/                       # 运行时数据（SQLite、代理配置、系统偏好）— 不提交 Git
├── docs/                        # UX 设计规范与开发备忘
├── browser-extension/           # Chromium 浏览器扩展工程（浏览器采集桥接）
│   ├── public/manifest.json     # Manifest V3 清单
│   └── src/                     # 后台 service worker、弹窗、设置页与桥接协议
├── scripts/ci/                  # CI 发布准备脚本
├── scripts/dev/                 # 开发启动诊断脚本
├── Dockerfile                   # 生产镜像构建脚本（multi-stage）
├── Dockerfile.dev               # 开发镜像构建脚本（国内加速源）
├── docker-compose.yml           # 生产环境编排配置
└── docker-compose.dev.yml       # 开发环境编排配置
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js ≥ 20, Express 5, better-sqlite3, Cheerio, cron-parser |
| 前端 | React 19, Mantine v7, Vite 6, TypeScript strict 模式 |
| Markdown | react-markdown + remark-gfm（渲染）、@uiw/react-md-editor（编辑）、marked（EPUB 转换） |
| AI / 图谱 / 翻译 | Vercel AI SDK, LangGraph, Neo4j, 支持 OpenAI / Anthropic / Google / Ollama |
| 导出 / 压缩 | JSZip（EPUB 打包） |
| 工程化 | tsx, concurrently, Docker multi-stage build |
| 浏览器扩展 | Chromium Manifest V3（Edge / Chrome 116+）、Vite 6、TypeScript |
