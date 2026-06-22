# OPDS 协议层 —— 设计规格

> 日期：2026-06-22 | 状态：待实施
> 父特性：OPDS 书源服务构建与分发（ROADMAP 🚧 开发中）
> 子项目编号：② 协议层（OPDS v1/v2 端点 + 多版本交付）
> 依赖：子项目 ① 基础层（已实现）

## 1. 概述

在基础层（可见性控制 + EPUB 制品生命周期）之上，实现 OPDS 协议端点，向 OPDS 兼容阅读器暴露书库目录与制品下载链接。手写 Atom 1.2（OPDS v1）与 JSON-LD 2.0（OPDS v2）两种格式的 feed 生成器，支持 original/translated/bilingual 三种制品的多版本分发。

### 1.1 关键决策

| 决策点 | 选择 |
|---|---|
| Feed 层级 | 两层：根目录 feed（列出所有可见书）+ 单书 feed（多版本 acquisition link） |
| 制品下载 | 新增 `/opds/artifacts/:sourceId/:novelId/:fileName` 端点流式返回 |
| v1 多版本 | 单书 feed 中每版本一个 Entry（符合 OPDS 1.2 acquisition feed 惯例） |
| v2 多版本 | 单书 publication 的 `links` 数组含多个 acquisition link（符合 OPDS 2.0 Publication 模型） |
| href 格式 | 相对路径（如 `/opds/v1/syosetu/n1`），由阅读器解析 |
| Feed 生成器 | 纯函数模块，无副作用，输入数据 + base URL，输出 XML/JSON 字符串 |

## 2. 架构

### 2.1 新增模块

**`OpdsFeedService`**（`src/server/core/opds-feed.ts`）

纯函数式 feed 生成器，负责构造 Atom 1.2 与 JSON-LD 2.0 两种格式的 feed 文档。无副作用，不访问文件系统或数据库。

**`opdsRouter`**（`src/server/routes/opds.ts`）

OPDS HTTP 路由，挂载 `/opds/v1`、`/opds/v2`、`/opds/artifacts` 端点。

### 2.2 扩展现有模块

| 模块 | 变更 |
|---|---|
| `SqliteNovelRepository` | 新增 `listVisibleOpdsNovelsWithMetadata()`（返回完整元数据供 feed 构造） |
| `ControlCenterService` | 透传 `listVisibleOpdsNovelsWithMetadata()` + `getOpdsArtifactInfo()`（内部实现，需 artifactsRoot） |
| `app.ts` | 挂载 `opdsRouter` 到 `/opds` 路径 |

### 2.3 依赖关系

```
OpdsFeedService（纯函数） ← opdsRouter ← app.ts
                                ↑
              ControlCenterService（提供书籍数据 + 制品信息）
```

## 3. 端点结构

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/opds/v1` | OPDS 1.2 根目录 feed（Atom XML），列出所有 `opds_visible` 的书 |
| GET | `/opds/v1/:sourceId/:novelId` | OPDS 1.2 单书 feed（Atom XML），每版本一个 Entry |
| GET | `/opds/v2` | OPDS 2.0 根目录 feed（JSON-LD），列出所有 `opds_visible` 的书 |
| GET | `/opds/v2/:sourceId/:novelId` | OPDS 2.0 单书 publication（JSON-LD），links 数组含多版本下载 |
| GET | `/opds/artifacts/:sourceId/:novelId/:fileName` | EPUB 制品文件下载（流式返回，404 若文件不存在） |

## 4. Feed 数据模型

### 4.1 OPDS 1.2（Atom XML）

**根目录 feed**（`/opds/v1`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:opds:root</id>
  <title>TS Novel Spider 书库</title>
  <updated>2026-06-22T00:00:00Z</updated>
  <link rel="self" href="/opds/v1" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="/opds/v1" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <entry>
    <id>urn:opds:novel:syosetu:n1</id>
    <title>小说标题</title>
    <author><name>作者</name></author>
    <summary>简介...</summary>
    <updated>2026-06-22T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" href="/opds/v1/syosetu/n1" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
  ...
</feed>
```

**单书 feed**（`/opds/v1/:sourceId/:novelId`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:opds:novel:syosetu:n1</id>
  <title>小说标题</title>
  <updated>2026-06-22T00:00:00Z</updated>
  <link rel="self" href="/opds/v1/syosetu/n1" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="up" href="/opds/v1" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <entry>
    <id>urn:opds:novel:syosetu:n1:original</id>
    <title>小说标题（原文）</title>
    <updated>2026-06-22T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" href="/opds/artifacts/syosetu/n1/original.epub" type="application/epub+zip"/>
  </entry>
  <entry>
    <id>urn:opds:novel:syosetu:n1:translated</id>
    <title>小说标题（译文）</title>
    <link rel="http://opds-spec.org/acquisition" href="/opds/artifacts/syosetu/n1/translated.epub" type="application/epub+zip"/>
  </entry>
  <entry>
    <id>urn:opds:novel:syosetu:n1:bilingual</id>
    <title>小说标题（双语对照）</title>
    <link rel="http://opds-spec.org/acquisition" href="/opds/artifacts/syosetu/n1/bilingual.epub" type="application/epub+zip"/>
  </entry>
</feed>
```

> 单书 feed 中每个版本是独立 Entry（符合 OPDS 1.2 acquisition feed 惯例，每个 Entry 一个 acquisition link）。根目录 feed 中每本书的 Entry 用 acquisition link 指向单书 feed（kind=acquisition），让阅读器导航进入。

### 4.2 OPDS 2.0（JSON-LD）

**根目录 feed**（`/opds/v2`）：

```json
{
  "@context": "https://readium.org/webpub-manifest/context.jsonld",
  "metadata": {
    "title": "TS Novel Spider 书库",
    "updated": "2026-06-22T00:00:00Z"
  },
  "links": [
    { "rel": "self", "href": "/opds/v2", "type": "application/opds+json" },
    { "rel": "start", "href": "/opds/v2", "type": "application/opds+json" }
  ],
  "publications": [
    {
      "metadata": {
        "title": "小说标题",
        "author": "作者",
        "description": "简介...",
        "identifier": "urn:opds:novel:syosetu:n1",
        "modified": "2026-06-22T00:00:00Z",
        "language": "ja",
        "tag": ["标签1", "标签2"]
      },
      "links": [
        { "rel": "http://opds-spec.org/acquisition", "href": "/opds/v2/syosetu/n1", "type": "application/opds+json" }
      ]
    }
  ]
}
```

**单书 publication**（`/opds/v2/:sourceId/:novelId`）：

```json
{
  "@context": "https://readium.org/webpub-manifest/context.jsonld",
  "metadata": {
    "title": "小说标题",
    "author": "作者",
    "description": "简介...",
    "identifier": "urn:opds:novel:syosetu:n1",
    "modified": "2026-06-22T00:00:00Z",
    "language": "ja"
  },
  "links": [
    { "rel": "self", "href": "/opds/v2/syosetu/n1", "type": "application/opds+json" },
    { "rel": "http://opds-spec.org/acquisition", "href": "/opds/artifacts/syosetu/n1/original.epub", "type": "application/epub+zip", "title": "原文" }
  ],
  "images": []
}
```

> 单书 publication 的 `links` 数组含多个 acquisition link（original/translated/bilingual），每个带 `title` 区分版本。符合 OPDS 2.0 单 Publication 多 link 模式。

## 5. ControlCenterService 扩展

### 5.1 新增 Repository 方法

```ts
listVisibleOpdsNovelsWithMetadata(): Array<{
  sourceId: string;
  novelId: string;
  title: string;
  author: string;
  description: string;
  tags: string[];
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}>
```

SQL 复用 `listOpdsNovels` 的 `has_translation` 子查询，但只返回 `opds_visible=1` 的行，并补充 `author`、`description`、`tags_json` 字段。

### 5.2 制品文件信息查询

```ts
interface OpdsArtifactInfo {
  exists: boolean;
  filePath: string;
  size: number;
}

getOpdsArtifactInfo(sourceId: string, novelId: string, fileName: string): OpdsArtifactInfo
```

- `fileName` 白名单：`original.epub`、`translated.epub`、`bilingual.epub`
- 路径：`<artifactsRoot>/<sourceId>/<novelId>/<fileName>`
- `exists` 通过 `fs.existsSync` 判断
- `size` 通过 `fs.statSync` 获取（不存在时为 0）

### 5.3 ControlCenterService 透传

```ts
listVisibleOpdsNovelsWithMetadata(): Array<{...}>  // 透传 repository
getOpdsArtifactInfo(sourceId, novelId, fileName): OpdsArtifactInfo  // 内部实现，需 artifactsRoot
```

`ControlCenterService` 构造函数中保存 `opdsArtifactsPath`（Task 7 已添加该 option），供制品查询使用：

```ts
this.#opdsArtifactsRoot = options.opdsArtifactsPath ?? path.resolve(process.cwd(), 'data', 'opds-artifacts');
```

与 `OpdsCompilationService` 的默认值一致，确保两者指向同一目录。

## 6. XML/JSON 转义与边界处理

### 6.1 XML 转义（OPDS 1.2）

`OpdsFeedService` 内部实现 `escapeXml()` 函数：

```ts
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

- 所有从数据库取出的文本字段（title、author、description、tag）必须经过 `escapeXml` 后才能写入 XML
- `id`、`href` 等 URL 字段也需转义（防御性处理）

### 6.2 JSON 构造（OPDS 2.0）

JSON-LD 直接用 `JSON.stringify()` 构造，无需手动转义。但需注意：
- `description` 可能含换行符，`JSON.stringify` 会正确处理为 `\n`
- `tag` 数组可能为空，空数组时 OPDS 2.0 metadata 中省略 `tag` 字段（避免输出 `"tag": []`）

### 6.3 空数据处理

- **无可见书籍**：根 feed 仍返回有效文档，`<entry>` 列表为空（v1）/ `publications` 为空数组（v2）。不返回 404。
- **单书无制品**：`epub_compiled_at` 为 null 或制品文件不存在时，单书 feed 中该版本的 Entry/link 不输出。若所有版本都不存在，单书 feed 返回有效但无 acquisition link 的文档。
- **单书不存在或不可见**：`/opds/v1/:sourceId/:novelId` 与 `/opds/v2/:sourceId/:novelId` 返回 404。

### 6.4 时间戳处理

- feed 顶层的 `<updated>` / `metadata.updated`：取所有可见书籍中最大的 `content_updated_at`，若无则用当前时间
- 单书 feed 的 `<updated>` / `metadata.modified`：取该书的 `epub_compiled_at`（制品生成时间），若为 null 则用 `content_updated_at`

### 6.5 URL 构造

- feed 中的 `href` 使用相对路径（如 `/opds/v1/syosetu/n1`），由阅读器根据服务端 base URL 解析
- 不依赖 `Host` 头构造绝对 URL，避免反向代理场景下 URL 错误
- `id` 使用 `urn:opds:novel:<sourceId>:<novelId>` 格式，确保全局唯一

## 7. 制品下载端点

`GET /opds/artifacts/:sourceId/:novelId/:fileName`

- `fileName` 必须是 `original.epub`、`translated.epub`、`bilingual.epub` 之一（白名单校验，防止路径穿越）
- 文件不存在返回 404
- `Content-Type: application/epub+zip`
- `Content-Disposition: attachment; filename="..."`
- 使用 `response.sendFile()` 流式返回

## 8. 测试策略

### 8.1 测试文件

- `src/server/core/opds-feed.test.ts` — feed 生成器单元测试（纯函数，无 HTTP）
- `src/server/routes/opds.test.ts` — OPDS 路由集成测试

### 8.2 测试约束

- **SQLite 内存数据库**，与基础层测试一致
- **不得**依赖真实网络
- feed 生成器测试：直接调用 `OpdsFeedService` 方法，断言输出 XML/JSON 字符串内容
- 路由测试：使用现有 `createTestServer()` / `createLibraryServer()` 模式，`fetch()` 真实 HTTP 服务器
- 制品文件测试：用临时目录 + 写入假 EPUB 文件（任意二进制内容，无需真实 EPUB 结构）

### 8.3 核心测试用例

**Feed 生成器（`opds-feed.test.ts`）**

OPDS 1.2（Atom XML）：
- 根 feed 包含正确的 XML 声明与 namespace
- 根 feed 包含所有可见书籍的 Entry
- 根 feed 空书籍列表时仍返回有效文档
- 单书 feed 包含存在的版本 acquisition link
- 单书 feed 不输出制品不存在的版本
- XML 特殊字符（`<`、`&`、`"`）被正确转义
- feed 的 `<updated>` 取最大 content_updated_at

OPDS 2.0（JSON-LD）：
- 根 feed 包含 `@context`、`metadata`、`links`、`publications`
- 单书 publication 的 `links` 数组含存在的版本下载链接
- 不输出制品不存在的版本 link
- 空 `tag` 数组时省略 `tag` 字段
- JSON 结构可被 `JSON.parse` 解析

**路由（`opds.test.ts`）**
- `GET /opds/v1` 返回 `Content-Type: application/atom+xml;profile=opds-catalog;kind=acquisition`
- `GET /opds/v1` 返回 200 + 有效 XML
- `GET /opds/v1/:sourceId/:novelId` 返回单书 feed
- `GET /opds/v1/:sourceId/:novelId` 不存在的书返回 404
- `GET /opds/v2` 返回 `Content-Type: application/opds+json`
- `GET /opds/v2` 返回 200 + 可解析 JSON
- `GET /opds/v2/:sourceId/:novelId` 返回单书 publication
- `GET /opds/artifacts/:sourceId/:novelId/original.epub` 返回文件流
- `GET /opds/artifacts/.../nonexistent.epub` 返回 404
- `GET /opds/artifacts/.../../../etc/passwd` 路径穿越被白名单拒绝（400 或 404）

### 8.4 验收标准

- `npm run typecheck` 无错误
- `npm run build` 无错误
- `npm run test:server` 全部通过
- 新增测试覆盖所有核心用例

## 9. 范围边界

**本子项目包含**：
- `OpdsFeedService` feed 生成器（Atom 1.2 + JSON-LD 2.0）
- `opdsRouter` 路由（`/opds/v1`、`/opds/v2`、`/opds/artifacts`）
- Repository 扩展（`listVisibleOpdsNovelsWithMetadata`）
- ControlCenterService 扩展（制品信息查询）
- `app.ts` 挂载路由
- 后端测试

**本子项目不包含**（留给子项目 ③）：
- 前端 OPDS 配置面板
- 前端可见性批量管理 Modal
- 可观测性监控看板
