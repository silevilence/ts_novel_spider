# Kakuyomu 爬虫适配器 — 逆向分析与开发技术方案

> 调研日期：2026-06-08  
> 目标站点：`kakuyomu.jp`（KADOKAWA 旗下 Web 小说平台）  
> 典型作品路径：
> - `/works/822139839856110454` — 連載中 49 話（鎖編みのミスティカ）
> - `/works/822139838857602966` — 完結済 81 話（裏切り者の魔法少女）

---

## 1. 站点架构概览

| 维度 | 详情 |
|---|---|
| 前端框架 | Next.js（SSR） + Apollo Client（GraphQL） + Redux |
| 渲染方式 | 服务端渲染（SSR），内容直接嵌入 HTML；章节正文页为传统 SSR（非 Next.js SPA） |
| URL 规范 | 作品页 `/works/{workId}`；章节页 `/works/{workId}/episodes/{episodeId}` |
| ID 格式 | 纯数字，19 位（作品 ID）/ 19 位（章节 ID）|
| 反爬等级 | 中等（详见第 5 节）|
| 内容保护 | 无加密、无付费墙遮罩（公开章节）；正文直接以 `<p>` 标签输出 |

### 1.1 两种页面的技术差异

| 页面类型 | 技术栈 | 数据来源 |
|---|---|---|
| 作品详情页 `/works/{id}` | Next.js SSR | `__NEXT_DATA__` 内嵌 Apollo State |
| 章节阅读页 `/works/{id}/episodes/{id}` | 传统 SSR（非 Next.js） | HTML 直出，无 `__NEXT_DATA__` |

---

## 2. 页面结构深度剖析

### 2.1 作品详情页（Works Page）

#### 元数据提取

作品数据位于 `__NEXT_DATA__` → `props.pageProps.__APOLLO_STATE__` → `Work:{workId}` 对象中：

```typescript
interface KakuyomuWorkData {
  __typename: 'Work';
  id: string;                           // 作品 ID
  title: string;                        // 标题
  introduction: string;                 // 简介（含换行符 \n）
  tagLabels: string[];                  // 标签数组
  serialStatus: 'RUNNING' | 'COMPLETED'; // 连载状态
  publicEpisodeCount: number;           // 公开章节数
  totalCharacterCount: number;          // 总字符数
  isCruel: boolean;                     // 残酷描写
  isViolent: boolean;                   // 暴力描写
  isSexual: boolean;                    // 性描写
  author: { __ref: string };           // 作者引用 → UserAccount:{id}
  tableOfContentsV2: Array<{ __ref: string }>; // 目录引用 → TableOfContentsChapter:{id}
  firstPublicEpisodeUnion: { __ref: string };  // 首章引用
  totalReviewPoint: number;             // 评分
  totalFollowers: number;               // 关注数
  publishedAt: string;                  // 首次发布时间（ISO 8601）
  lastEpisodePublishedAt: string;       // 最近更新时间
}
```

作者数据位于 `UserAccount:{id}`：

```typescript
interface KakuyomuUserAccount {
  __typename: 'UserAccount';
  id: string;
  name: string;           // 用户名
  activityName: string;   // 显示名（如 @topazrf）
  screenName: string;     // 屏幕名
}
```

#### 目录结构（Table of Contents）

目录通过 `TableOfContentsChapter` → `Chapter` 二级结构组织：

```typescript
// TableOfContentsChapter:{id}
interface TableOfContentsChapter {
  __typename: 'TableOfContentsChapter';
  id: string;
  episodeUnions: Array<{ __ref: string }>; // Episode 引用列表
  chapter: { __ref: string };              // Chapter 引用（卷标题）
}

// Chapter:{id}
interface Chapter {
  __typename: 'Chapter';
  id: string;
  level: number;    // 层级（1 = 一级卷标题）
  title: string;    // 卷标题（如 "前編", "後編"）
}

// Episode:{id}
interface Episode {
  __typename: 'Episode';
  id: string;
  title: string;       // 章节标题（如 "第1話　路地裏で目覚めて(1)"）
  publishedAt: string; // 发布时间（ISO 8601）
}
```

**目录组织模式**：
- 部分作品有卷分组（如"前編" / "後編"），通过 `Chapter` 对象表示
- 部分作品无卷分组，所有章节平铺在单个 `TableOfContentsChapter` 中
- 卷标题在 HTML 中以 `<h3>` 标签渲染

#### HTML 选择器映射

| 数据项 | 选择器 / 提取方式 |
|---|---|
| 标题 | `h1` 内文本 |
| 作者 | `a[href^="/users/"]` 的 `textContent` |
| 标签 | `a[href^="/tags/"]` 的 `textContent` |
| 简介 | `__NEXT_DATA__` → `Work.introduction` |
| 连载状态 | `__NEXT_DATA__` → `Work.serialStatus` |
| 章节数 | `__NEXT_DATA__` → `Work.publicEpisodeCount` |
| 字符数 | `__NEXT_DATA__` → `Work.totalCharacterCount` |
| 内容警告 | `Work.isCruel`, `Work.isViolent`, `Work.isSexual` |
| 章节链接 | `a[href*="/episodes/"]`（过滤掉"1話目から読む"按钮）|
| 卷标题 | `h3` 内文本（排除"レビュー"、"関連"等非卷标题）|

### 2.2 章节阅读页（Episode Page）

#### 页面结构

```
banner
  ├── 作品标题链接（h1 > a[href="/works/{workId}"]）
  ├── 章节标题（h2）
  ├── 关闭按钮（a[href="/works/{workId}"]）
  └── 工具栏（ビューワー設定、目次）
main
  └── 章节内容容器
      ├── 元信息区（作品标题、作者名、章节标题）
      └── 正文区（div.widget-episodeBody.js-episode-body）
          ├── <p id="p1">正文段落</p>
          ├── <p id="p2" class="blank"><br></p>  ← 空行分隔
          ├── <p id="p3">正文段落</p>
          └── ...
底部
  ├── 应援区
  ├── 注册引导
  └── 下一章链接（a[href*="/episodes/"]，含"次のエピソード"标识）
```

#### 正文提取选择器

| 数据项 | 选择器 |
|---|---|
| 章节标题 | `h2` 或 `.widget-episodeTitle` |
| 正文容器 | `.widget-episodeBody.js-episode-body` |
| 正文段落 | 容器内 `p:not(.blank)` |
| 空行 | `p.blank`（`<br>` 占位，需跳过）|
| 下一章链接 | `a[href*="/episodes/"]` 含"次のエピソード"文本 |

#### 章节 ID 提取

从页面内嵌脚本的 `dataLayer` 中可提取：

```javascript
dataLayer = [{
  episodeId: "822139838858343224",
  workId: "822139838857602966",
  workAuthorName: "pen3742",
  // ...
}];
```

---

## 3. 两个典型案例深度对比

| 维度 | 案例 A：`822139839856110454` | 案例 B：`822139838857602966` |
|---|---|---|
| 标题 | 鎖編みのミスティカ | 裏切り者の魔法少女に転生した… |
| 状态 | 連載中 | 完結済 |
| 章节数 | 49 話 | 81 話 |
| 字符数 | 121,207 | 250,713 |
| 卷分组 | 有（前編 44 話 + 後編 5 話）| 有（1〜30 / 31〜60 / 61〜81）|
| 标签 | TS, 魔法少女, ガールズラブ 等 8 个 | 残酷描写, 暴力描写, 性描写 |
| 内容警告 | 残酷・暴力 | 残酷・暴力・性 |
| 章节 ID 格式 | 19 位纯数字 | 19 位纯数字 |

**关键发现**：
1. 两部作品均使用卷分组（Chapter），但卷数量不同（2 vs 3）
2. 章节 ID 均为 19 位纯数字，无字母前缀
3. 章节标题格式统一为"第N話　标题"（全角空格分隔）
4. 目录页无分页机制——所有章节在单页内完整展示

---

## 4. 数据抓取策略

### 4.1 元数据抓取流程

```
GET /works/{workId}
  ↓
解析 HTML → 提取 <script id="__NEXT_DATA__"> JSON
  ↓
JSON.parse → props.pageProps.__APOLLO_STATE__
  ↓
提取 Work:{workId} 对象 → title, introduction, tagLabels, serialStatus, ...
  ↓
提取 UserAccount:{authorId} → name
  ↓
组装 NovelMetadata
```

**备选方案**（不依赖 `__NEXT_DATA__`，用于 HTML 解析降级）：
- 标题：`h1` 文本（提取第一个 `<h1>` 的 `textContent`）
- 作者：`a[href^="/users/"]` 文本（取作品卡片区域内的第一个用户链接）
- 标签：`a[href^="/tags/"]` 文本数组
- 简介：从 `<meta name="description">` 提取（`og:description` 优于标准 `description`）
- 章节数：正则匹配正文中 `全(\d+)話`（需去除逗号等干扰字符）
- 字符数：正则匹配 `([\d,]+)文字`，去除千分位逗号后 `parseInt`
- 连载状态：正则匹配 `連載中|完結済`

### 4.2 目录抓取流程

```
GET /works/{workId}
  ↓
解析 __NEXT_DATA__ → Apollo State
  ↓
遍历 tableOfContentsV2 → TableOfContentsChapter
  ↓
对每个 Chapter：
  - 提取 Chapter:{id} → title（卷标题）
  - 遍历 episodeUnions → Episode:{id}
  - 提取 title, publishedAt
  ↓
组装 ChapterIndexEntry[]
```

**备选方案**（HTML 解析）：
- 遍历 `a[href*="/episodes/"]` 提取章节链接
- 从 `h3` 提取卷标题
- 根据章节在 DOM 中的位置判断所属卷

### 4.3 正文抓取流程

```
GET /works/{workId}/episodes/{episodeId}
  ↓
解析 HTML
  ↓
定位 .widget-episodeBody.js-episode-body
  ↓
遍历子 <p> 元素：
  - 跳过 p.blank（空行占位）
  - 提取 p.textContent 作为正文段落
  ↓
拼接段落 → 组装 ChapterContent
```

---

## 5. 反爬特征与应对策略

### 5.1 已观测到的防护措施

| 防护类型 | 表现 | 应对策略 |
|---|---|---|
| 连接阻断 | `fetch()` 直接返回 `ERR_CONNECTION_CLOSED` | 必须使用代理或浏览器环境 |
| User-Agent 检测 | 未确认，但标准 UA 可正常访问 | 携带标准浏览器 UA |
| 频率限制 | 未观测到明确限流 | 建议单章间隔 ≥ 1 秒 |
| Cookie / 登录 | 公开内容无需登录 | 无需 Cookie |
| CAPTCHA | 未观测到 | — |
| 内容加密 | 正文明文输出 | — |

### 5.2 推荐请求配置

```typescript
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};
```

**关键约束**：必须通过代理发出请求（`createProxyAwareHtmlFetcher`），直连会被拒绝。

---

## 6. 与现有框架的适配方案

### 6.1 接口实现映射

| SpiderAdapter 接口 | Kakuyomu 实现策略 |
|---|---|
| `sourceId` | `'kakuyomu'` |
| `buildInfoPageUrl(novelId)` | `https://kakuyomu.jp/works/${novelId}` |
| `fetchMetadata(context)` | 解析 `__NEXT_DATA__` 提取 Work 对象；备选 HTML 解析 |
| `fetchChapterIndex(context, metadata)` | 解析 Apollo State 的 TableOfContentsChapter 结构；备选 HTML 解析 |
| `fetchChapter(context, chapter)` | HTML 解析 `.widget-episodeBody` 内 `<p>` 标签 |
| `fetchChapters(context, chapters, options)` | 继承 `BaseHtmlSpiderAdapter` 默认实现（并发 + 重试）|

### 6.2 继承策略

```
BaseHtmlSpiderAdapter（abstract）
  └── KakuyomuSpiderAdapter（concrete）
```

- 继承 `BaseHtmlSpiderAdapter`，获得 `parseHtml()`、`fetchChapters()`（含并发与重试）等基础能力
- 注入 `SpiderHtmlFetcher` 实现请求与解析解耦
- 不需要 Cookie（与 Syosetu18 不同）
- `novelId` 为标准数字串（19 位），`normalizeNovelId()` 仅执行 `.trim()`，无需大小写转换

### 6.3 目录无分页优势

Kakuyomu 的目录在单页内完整展示，**无需实现分页遍历逻辑**（Syosetu 需要翻页）。这大幅简化了 `fetchChapterIndex` 的实现。

---

## 7. 开发计划

### 7.1 文件清单

| 文件 | 职责 |
|---|---|
| `src/server/adapters/spider/kakuyomu-spider-adapter.ts` | 核心适配器实现 |
| `src/server/adapters/spider/kakuyomu-spider-adapter.test.ts` | 单元测试（注入 HTML fixture）|
| `src/server/core/control-center.ts` | 注册新爬虫到 `createDefaultSpiderRegistry` |

### 7.2 实现步骤

#### Step 1：创建适配器骨架

- 新建 `kakuyomu-spider-adapter.ts`
- 继承 `BaseHtmlSpiderAdapter`
- 定义 `sourceId = 'kakuyomu'`
- 实现 `buildInfoPageUrl()` 和基础 URL 构建方法
- 注入 `SpiderHtmlFetcher`

#### Step 2：实现 `fetchMetadata()`

- 优先路径：解析 `__NEXT_DATA__` → Apollo State → `Work:{id}`
- 提取 `title`, `introduction`, `tagLabels`, `serialStatus`, `publicEpisodeCount`
- 从 `UserAccount:{id}` 提取作者名
- 备选路径：HTML 选择器解析（`h1`, `a[href^="/users/"]`, `a[href^="/tags/"]` 等）

#### Step 3：实现 `fetchChapterIndex()`

- 优先路径：解析 Apollo State 的 `tableOfContentsV2` 结构
  - 遍历 `TableOfContentsChapter` → `Chapter`（卷标题）→ `Episode`（章节）
  - 组装 `ChapterIndexEntry[]`，含 `volumeTitle`
- 备选路径：HTML 解析
  - 遍历 `a[href*="/episodes/"]` 提取章节链接
  - 从 `h3` 提取卷标题
  - 根据 DOM 位置判断章节所属卷

#### Step 4：实现 `fetchChapter()`

- 请求章节页面 HTML
- 定位 `.widget-episodeBody.js-episode-body` 容器
- 遍历子 `<p>` 元素，跳过 `p.blank`
- 提取 `textContent` 作为正文段落
- 从 `<h2>` 或 `.widget-episodeTitle` 提取章节标题
- 组装 `ChapterContent`

#### Step 5：注册到 Spider Registry

- 在 `control-center.ts` 的 `createDefaultSpiderRegistry()` 中追加条目：

```typescript
{
  descriptor: {
    sourceId: 'kakuyomu',
    label: 'カクヨム',
    description: 'KADOKAWA 旗下的 Web 小说平台。请输入作品 ID（19 位数字），例如 822139839856110454。',
    defaultNovelId: '822139839856110454',
  },
  spider: new KakuyomuSpiderAdapter({ fetchHtml }),
}
```

#### Step 6：编写测试

- 准备 HTML fixture（从真实页面保存的元数据页、目录页、章节页 HTML 文件，存放于 `src/server/adapters/spider/__fixtures__/kakuyomu/`）
- 注入 `createFixtureFetch` 模式的 `fetchHtml` 函数（与 `syosetu-spider-adapter.test.ts` 保持一致的测试风格）
- 测试覆盖：
  - 元数据解析（标题、作者、标签、简介、章节数）
  - 目录解析（章节列表、卷分组、章节 ID 和 URL）
  - 正文解析（段落提取、空行过滤、内容完整性）
  - 边界情况（无卷分组的作品、完结/连载状态、内容警告）

#### Step 7：端到端验证

- 使用代理环境执行真实抓取测试
- 验证两个典型案例作品的完整性
- 确认增量更新（`persistStatus`）正确

### 7.3 技术风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `__NEXT_DATA__` 结构变更 | 元数据/目录解析失败 | 实现 HTML 备选路径，双轨解析 |
| 连接被拒绝 | 无法抓取 | 强制走代理；重试机制 |
| 章节页面结构变更 | 正文解析失败 | 选择器写为可配置常量，便于快速调整 |
| 大型作品目录过长 | 单页 HTML 体积过大 | Kakuyomu 目录无分页，实测 81 话页面加载正常 |

---

## 8. 与 Syosetu 适配器的差异总结

| 维度 | Syosetu / Syosetu18 | Kakuyomu |
|---|---|---|
| ID 格式 | 字母数字混合（如 `n9669bk`）| 纯数字 19 位 |
| Cookie | Syosetu18 需要 `over18=yes` | 无需 |
| 目录分页 | 需要翻页遍历 | 单页完整展示 |
| 正文结构 | `<p id="L1">` 系列 | `<p id="p1">` 系列 |
| 卷标识 | `<div class="chapter_title">` | `<h3>` + Apollo `Chapter` 对象 |
| 数据获取 | 纯 HTML 解析 | `__NEXT_DATA__` + HTML 双轨 |
| 请求方式 | 直连（Syosetu）/ Cookie（Syosetu18）| 必须走代理 |
