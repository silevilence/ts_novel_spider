# TS Novel Spider

一款基于 TypeScript 的自动化小说抓取与离线阅读工具，提供 Web 管控界面，支持后台守护运行与多格式导出。

## 功能特性

- **多站点抓取**：内置 [小説家になろう](https://ncode.syosetu.com)（Syosetu）与 [ノクターンノベルズ](https://novel18.syosetu.com)（Syosetu18）适配器
- **增量同步**：自动对比本地缓存与远端目录，高亮标识新增章节
- **批量下载**：支持并发抓取，单章失败不阻塞整体任务，失败章节可单点重试
- **离线阅读**：内置沉浸式阅读器，支持字体、字号、行高、段间距个性化排版，图片资源可本地化缓存
- **多格式导出**：支持导出为 Markdown、EPUB、TXT 三种格式，已翻译内容可按原文、纯译文或双语对照模式导出
- **章节翻译**：接入大语言模型对已下载章节进行逐段翻译与 AI 审校，翻译结果自动保存，支持进度追踪与从零重译
- **网络代理**：支持配置 HTTP/SOCKS 代理，代理配置持久化跨重启保留
- **后台守护**：前端界面关闭后，后端抓取任务持续运行，不受影响
- **实时监控**：通过 SSE 推送任务进度，前端实时展示日志与进度条
- **智能检索**：支持按书名、作者、标签、摘要等多维度模糊搜索，可按相关性排序
- **阅读进度与书签**：自动记忆每本书的阅读位置，支持手动添加章内书签
- **书籍别名**：可为本地书籍设置自定义别名，搜索时自动关联
- **AI 伴读与知识图谱（实验性）**：接入大语言模型自动构建人物关系与情节图谱，支持 AI 问答辅助理解文本内容

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

1. 打开 Web 界面，在**开始抓取**页面选择目标站点（Syosetu / Syosetu18）
2. 输入小说 ID（如 `n3130lr`），点击**预览**加载元数据与目录
3. 在章节目录中勾选需要下载的章节，点击**开始抓取**
4. 切换至**任务进度**页面查看实时进度与日志
5. 下载完成后，前往**本地书库**页面离线阅读、导出文件或发起 AI 翻译
6. 在**下载设置**页面可配置网络代理、大模型服务、图数据库连接、阅读排版偏好以及翻译默认选项

如需启用 AI 伴读与知识图谱功能（实验性），需先在设置中完成大模型与 Neo4j 的连接配置。

## 目录结构

```
.
├── src/
│   ├── server/                  # 后端与爬虫核心逻辑
│   │   ├── adapters/
│   │   │   ├── log/             # 日志适配器
│   │   │   └── spider/          # 站点爬虫适配器（Syosetu / Syosetu18）
│   │   ├── core/                # 调度器、数据库、导出引擎、网络代理、系统偏好、知识图谱
│   │   ├── routes/              # Express API 路由
│   │   └── index.ts             # 服务入口
│   └── web/                     # 前端 React 工程（Vite 构建）
│       ├── components/          # UI 组件（控制台、书库、监控、设置）
│       ├── services/            # API 封装与视图模型
│       └── App.tsx              # 前端入口与路由配置
├── data/
│   ├── exports/                 # 导出的小说文件
│   └── offline-assets/          # 本地化图片缓存
├── .data/                       # 运行时数据（SQLite、代理配置、系统偏好）— 不提交 Git
├── docs/                        # UX 设计规范与开发备忘
├── Dockerfile                   # 生产镜像构建脚本（multi-stage）
├── Dockerfile.dev               # 开发镜像构建脚本（国内加速源）
├── docker-compose.yml           # 生产环境编排配置
└── docker-compose.dev.yml       # 开发环境编排配置
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js ≥ 20, Express 5, better-sqlite3, Cheerio |
| 前端 | React 19, Vite 6, TypeScript |
| AI / 图谱 | Vercel AI SDK, Neo4j, 支持 OpenAI / Anthropic / Google / Ollama |
| 导出 | JSZip（EPUB 打包）|
| 工程化 | tsx, concurrently, Docker |
