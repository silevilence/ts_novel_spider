# TS Novel Spider

一款基于 TypeScript 的自动化小说抓取与离线阅读工具，提供 Web 管控界面，支持后台守护运行与多格式导出。当前版本 **v0.9.0**。

## 功能特性

- **多站点抓取**：内置 [小説家になろう](https://ncode.syosetu.com)（Syosetu）、[ノクターンノベルズ](https://novel18.syosetu.com)（Syosetu18）与 [カクヨム](https://kakuyomu.jp)（Kakuyomu）适配器
- **增量同步**：自动对比本地缓存与远端目录，高亮标识新增章节
- **批量下载**：支持并发抓取，单章失败不阻塞整体任务，失败章节可单点重试
- **离线阅读**：内置沉浸式阅读器，支持字体、字号、行高、段间距个性化排版，图片资源可本地化缓存
- **多格式导出**：支持导出为 Markdown、EPUB、TXT 三种格式，已翻译内容可按原文、纯译文或双语对照模式导出
- **章节翻译**：接入大语言模型对已下载章节进行逐段翻译与 AI 审校，翻译结果自动保存，支持进度追踪与从零重译。翻译范围覆盖书名、简介、卷标题及章节标题，阅读器可完整查看各层级译文
- **翻译术语库**：每本小说拥有独立的术语库，支持自定义术语条目（源词、译文、实体类型、注释），可从知识图谱实体一键导入，翻译流水线自动参照术语库确保译文一致性
- **双语阅读**：阅读器支持原文 / 纯译文 / 段落级双语对照三种视图实时切换，方便对照学习
- **模型网关**：可为对话、向量嵌入、重排序等不同 AI 能力分别指定默认模型，按任务自动路由
- **网络代理**：支持配置 HTTP/SOCKS 代理，代理配置持久化跨重启保留
- **后台守护**：前端界面关闭后，后端抓取任务持续运行，不受影响
- **实时监控**：通过 SSE 推送任务进度，前端实时展示日志与进度条
- **智能检索**：支持按书名、作者、标签、摘要等多维度模糊搜索，可按相关性排序
- **阅读进度与书签**：自动记忆每本书的阅读位置，支持手动添加章内书签
- **书籍别名**：可为本地书籍设置自定义别名，搜索时自动关联
- **AI 伴读与知识图谱（实验性）**：接入大语言模型自动构建人物关系与情节图谱，支持 AI 问答辅助理解文本内容
- **自动化定时更新**：支持固定间隔、Cron 表达式、每周定时三种调度策略，自动检查已标记书籍的远端更新并增量下载到本地。每本书可独立开关，可在设置中批量管理参与定时更新的书单
- **自动翻译联动**：开启后，每次定时更新发现新章节并下载完成，自动触发翻译，仅翻译新增章节，已有译文自动跳过
- **更新总结**：支持为每本书开启自动总结，新章节抓取完成后调用 AI 生成剧情摘要，可全局选择总结模型也可单本覆盖
- **定时更新管理面板**：独立页面集中管理调度策略、书单和运行记录，支持查看每次检查的耗时、扫描书籍数和发现更新数
- **OPDS 书源服务**：支持 OPDS 1.2（Atom XML）与 OPDS 2.0（JSON-LD）协议，将本地书库作品分发给阅读器应用。自动为每本上架书籍编译 EPUB 制品，有翻译的作品额外生成译文版和双语对照版

## 快速上手

### 前置要求

- Node.js >= 20
- npm

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
npm test           # 全量测试（服务端 + 前端 + CI 脚本）
npm run test:server  # 仅服务端测试
npm run test:web     # 仅前端测试
npm run typecheck    # TypeScript 类型检查
```

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

1. 打开 Web 界面，在**开始抓取**页面选择目标站点（Syosetu / Syosetu18 / Kakuyomu）
2. 输入小说 ID（Syosetu 如 `n3130lr`，Kakuyomu 如 `822139839856110454`），点击**预览**加载元数据与目录
3. 在章节目录中勾选需要下载的章节，点击**开始抓取**
4. 切换至**任务进度**页面查看实时进度与日志
5. 下载完成后，前往**本地书库**页面离线阅读、导出文件或发起 AI 翻译
6. 前往**定时更新**页面可配置自动追更策略，支持自动翻译联动和 AI 更新总结
7. 在**全局设置**页面可配置网络代理、大模型服务、图数据库连接、阅读排版偏好以及翻译默认选项

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
│   │   ├── core/
│   │   │   ├── translation/     # 翻译流水线子节点（分段/翻译/组装/审校/定稿）
│   │   │   ├── opds-compilation.ts  # OPDS 制品编译调度器
│       │   ├── opds-feed.ts         # OPDS Feed 生成（Atom XML + JSON-LD）
│       │   ├── scheduling-summary.ts  # 更新总结服务（AI 摘要生成）
│       │   ├── scheduling.ts    # 定时更新调度引擎
│   │   │   └── ...              # 数据库、导出引擎、网络代理、系统偏好、知识图谱
│   │   ├── routes/
│   │   │   ├── opds.ts          # OPDS 协议路由（v1/v2 Feed + 制品下载）
│   │   │   └── ...              # health、control-center、library 等路由
│   │   └── index.ts             # 服务入口
│   └── web/                     # 前端 React 工程（Mantine v7 + Vite 构建）
│       ├── components/
│       │   ├── scheduling-dashboard.tsx  # 定时更新管理面板
│       │   ├── opds-dashboard.tsx  # OPDS 书源管理面板
│       │   └── ...              # 控制台、书库、监控、设置、Cron 编辑器等
│       ├── services/            # API 封装与视图模型
│       └── App.tsx              # 前端入口与路由配置（含 OPDS 路由）
├── data/
│   ├── exports/                 # 导出的小说文件
│   ├── offline-assets/          # 本地化图片缓存
│   └── opds-artifacts/          # OPDS EPUB 制品
├── .data/                       # 运行时数据（SQLite、代理配置、系统偏好）— 不提交 Git
├── docs/                        # UX 设计规范与开发备忘
├── scripts/ci/                  # CI 发布准备脚本
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
| AI / 图谱 / 翻译 | Vercel AI SDK, LangGraph, Neo4j, 支持 OpenAI / Anthropic / Google / Ollama |
| 导出 / 压缩 | JSZip（EPUB 打包） |
| 工程化 | tsx, concurrently, Docker multi-stage build |
