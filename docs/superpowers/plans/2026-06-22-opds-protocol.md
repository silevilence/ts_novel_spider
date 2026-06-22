# OPDS 协议层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 OPDS v1（Atom XML）与 v2（JSON-LD）feed 生成器与端点，向 OPDS 兼容阅读器暴露书库目录与多版本 EPUB 制品下载链接。

**Architecture:** 新建纯函数式 `OpdsFeedService`（无副作用，输入数据输出 XML/JSON 字符串）+ `opdsRouter`（HTTP 路由）。复用基础层的 `opds_visible` 字段与 `data/opds-artifacts` 制品目录。扩展 `ControlCenterService` 提供带元数据的可见书籍列表与制品文件信息查询。

**Tech Stack:** Node.js ≥ 20, Express 5, TypeScript strict

**Spec:** `docs/superpowers/specs/2026-06-22-opds-protocol-design.md`

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `src/server/core/opds-feed.ts` | `OpdsFeedService` 纯函数 feed 生成器（Atom 1.2 + JSON-LD 2.0） | Create |
| `src/server/core/opds-feed.test.ts` | feed 生成器单元测试 | Create |
| `src/server/routes/opds.ts` | `opdsRouter` HTTP 路由 | Create |
| `src/server/routes/opds.test.ts` | OPDS 路由集成测试 | Create |
| `src/server/core/novel-repository.ts` | 新增 `listVisibleOpdsNovelsWithMetadata()` | Modify |
| `src/server/core/control-center.ts` | 透传方法 + `getOpdsArtifactInfo()` + `#opdsArtifactsRoot` 字段 | Modify |
| `src/server/app.ts` | 挂载 `opdsRouter` 到 `/opds` | Modify |

---

### Task 1: Repository — listVisibleOpdsNovelsWithMetadata

**Files:**
- Modify: `src/server/core/novel-repository.ts`（在 `listVisibleOpdsNovels()` 方法之后追加）

- [ ] **Step 1: 在 `listVisibleOpdsNovels()` 方法之后追加新方法**

```ts
  /** 查询所有 opds_visible=1 的小说（含完整元数据，供 feed 构造） */
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
  }> {
    const rows = this.#database
      .prepare(
        `SELECT n.source_id, n.novel_id, n.title, n.author, n.description,
                n.tags_json, n.content_updated_at, n.epub_compiled_at,
                EXISTS (
                  SELECT 1 FROM chapter_translations ct
                  WHERE ct.source_id = n.source_id
                    AND ct.novel_id = n.novel_id
                    AND ct.status = 'completed'
                ) AS has_translation
         FROM novels n
         WHERE n.opds_visible = 1
         ORDER BY n.title COLLATE NOCASE ASC`,
      )
      .all() as Array<{
        source_id: string; novel_id: string; title: string; author: string;
        description: string; tags_json: string;
        content_updated_at: string | null; epub_compiled_at: string | null;
        has_translation: number;
      }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      novelId: row.novel_id,
      title: row.title,
      author: row.author,
      description: row.description,
      tags: JSON.parse(row.tags_json) as string[],
      contentUpdatedAt: row.content_updated_at,
      epubCompiledAt: row.epub_compiled_at,
      hasTranslation: row.has_translation === 1,
    }));
  }
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 跳过 commit（项目规则禁止自动提交）**

---

### Task 2: OpdsFeedService — feed 生成器

**Files:**
- Create: `src/server/core/opds-feed.ts`
- Create: `src/server/core/opds-feed.test.ts`

- [ ] **Step 1: 编写失败测试 — feed 生成器单元测试**

创建 `src/server/core/opds-feed.test.ts`：

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OpdsFeedService,
  type OpdsNovelFeedEntry,
  type OpdsArtifactAvailability,
} from './opds-feed';

function makeNovel(overrides: Partial<OpdsNovelFeedEntry> = {}): OpdsNovelFeedEntry {
  return {
    sourceId: 'syosetu',
    novelId: 'n1',
    title: '测试小说',
    author: '测试作者',
    description: '简介内容',
    tags: ['标签1', '标签2'],
    contentUpdatedAt: '2026-06-22T00:00:00.000Z',
    epubCompiledAt: '2026-06-22T01:00:00.000Z',
    hasTranslation: true,
    ...overrides,
  };
}

function makeAvailability(overrides: Partial<OpdsArtifactAvailability> = {}): OpdsArtifactAvailability {
  return {
    original: true,
    translated: true,
    bilingual: true,
    ...overrides,
  };
}

describe('OpdsFeedService - OPDS 1.2 (Atom XML)', () => {
  const service = new OpdsFeedService();

  it('root feed contains XML declaration and Atom namespace', () => {
    const xml = service.buildAtomRootFeed([]);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('xmlns="http://www.w3.org/2005/Atom"'));
  });

  it('root feed contains all visible novels as entries', () => {
    const xml = service.buildAtomRootFeed([
      makeNovel({ novelId: 'n1', title: '小说一' }),
      makeNovel({ novelId: 'n2', title: '小说二' }),
    ]);
    assert.ok(xml.includes('<title>小说一</title>'));
    assert.ok(xml.includes('<title>小说二</title>'));
    assert.ok(xml.includes('urn:opds:novel:syosetu:n1'));
    assert.ok(xml.includes('urn:opds:novel:syosetu:n2'));
  });

  it('root feed with empty list still returns valid document', () => {
    const xml = service.buildAtomRootFeed([]);
    assert.ok(xml.includes('<feed'));
    assert.ok(xml.includes('</feed>'));
    assert.ok(!xml.includes('<entry>'));
  });

  it('root feed updated takes max content_updated_at', () => {
    const xml = service.buildAtomRootFeed([
      makeNovel({ contentUpdatedAt: '2026-06-20T00:00:00.000Z' }),
      makeNovel({ contentUpdatedAt: '2026-06-22T00:00:00.000Z' }),
    ]);
    assert.ok(xml.includes('<updated>2026-06-22T00:00:00.000Z</updated>'));
  });

  it('root feed entry links to single-novel feed', () => {
    const xml = service.buildAtomRootFeed([makeNovel({ sourceId: 'syosetu', novelId: 'n1' })]);
    assert.ok(xml.includes('href="/opds/v1/syosetu/n1"'));
    assert.ok(xml.includes('type="application/atom+xml;profile=opds-catalog;kind=acquisition"'));
  });

  it('single-novel feed contains acquisition links for available versions', () => {
    const xml = service.buildAtomNovelFeed(
      makeNovel({ title: '测试小说' }),
      makeAvailability({ original: true, translated: true, bilingual: false }),
    );
    assert.ok(xml.includes('href="/opds/artifacts/syosetu/n1/original.epub"'));
    assert.ok(xml.includes('href="/opds/artifacts/syosetu/n1/translated.epub"'));
    assert.ok(!xml.includes('href="/opds/artifacts/syosetu/n1/bilingual.epub"'));
  });

  it('single-novel feed has up link to root', () => {
    const xml = service.buildAtomNovelFeed(makeNovel(), makeAvailability());
    assert.ok(xml.includes('rel="up"'));
    assert.ok(xml.includes('href="/opds/v1"'));
  });

  it('XML special characters are escaped', () => {
    const xml = service.buildAtomRootFeed([
      makeNovel({ title: 'A<B>&"C"', description: 'D&E<F>' }),
    ]);
    assert.ok(xml.includes('A&lt;B&gt;&amp;&quot;C&quot;'));
    assert.ok(xml.includes('D&amp;E&lt;F&gt;'));
    assert.ok(!xml.includes('A<B>&"C"'));
  });

  it('single-novel feed updated uses epub_compiled_at', () => {
    const xml = service.buildAtomNovelFeed(
      makeNovel({ epubCompiledAt: '2026-06-22T01:00:00.000Z', contentUpdatedAt: '2026-06-22T00:00:00.000Z' }),
      makeAvailability(),
    );
    assert.ok(xml.includes('<updated>2026-06-22T01:00:00.000Z</updated>'));
  });
});

describe('OpdsFeedService - OPDS 2.0 (JSON-LD)', () => {
  const service = new OpdsFeedService();

  it('root feed contains @context, metadata, links, publications', () => {
    const json = service.buildOpds2RootFeed([]);
    const parsed = JSON.parse(json);
    assert.equal(parsed['@context'], 'https://readium.org/webpub-manifest/context.jsonld');
    assert.ok(parsed.metadata);
    assert.ok(parsed.links);
    assert.ok(Array.isArray(parsed.publications));
  });

  it('root feed publications contain novel metadata', () => {
    const json = service.buildOpds2RootFeed([makeNovel({ title: '小说X', author: '作者Y' })]);
    const parsed = JSON.parse(json);
    assert.equal(parsed.publications.length, 1);
    assert.equal(parsed.publications[0].metadata.title, '小说X');
    assert.equal(parsed.publications[0].metadata.author, '作者Y');
    assert.equal(parsed.publications[0].metadata.identifier, 'urn:opds:novel:syosetu:n1');
  });

  it('root feed publication links to single-novel publication', () => {
    const json = service.buildOpds2RootFeed([makeNovel({ sourceId: 'syosetu', novelId: 'n1' })]);
    const parsed = JSON.parse(json);
    assert.ok(parsed.publications[0].links.some((l: { href: string }) => l.href === '/opds/v2/syosetu/n1'));
  });

  it('root feed omits tags when empty', () => {
    const json = service.buildOpds2RootFeed([makeNovel({ tags: [] })]);
    const parsed = JSON.parse(json);
    assert.equal(parsed.publications[0].metadata.tags, undefined);
  });

  it('single-novel publication contains acquisition links for available versions', () => {
    const json = service.buildOpds2NovelPublication(
      makeNovel({ title: '小说X' }),
      makeAvailability({ original: true, translated: false, bilingual: true }),
    );
    const parsed = JSON.parse(json);
    const acquisitionLinks = parsed.links.filter((l: { rel: string }) => l.rel === 'http://opds-spec.org/acquisition');
    assert.ok(acquisitionLinks.some((l: { href: string }) => l.href === '/opds/artifacts/syosetu/n1/original.epub'));
    assert.ok(acquisitionLinks.some((l: { href: string }) => l.href === '/opds/artifacts/syosetu/n1/bilingual.epub'));
    assert.ok(!acquisitionLinks.some((l: { href: string }) => l.href === '/opds/artifacts/syosetu/n1/translated.epub'));
  });

  it('single-novel publication has self link', () => {
    const json = service.buildOpds2NovelPublication(makeNovel(), makeAvailability());
    const parsed = JSON.parse(json);
    assert.ok(parsed.links.some((l: { rel: string; href: string }) => l.rel === 'self' && l.href === '/opds/v2/syosetu/n1'));
  });

  it('JSON is parseable', () => {
    const json1 = service.buildOpds2RootFeed([makeNovel()]);
    const json2 = service.buildOpds2NovelPublication(makeNovel(), makeAvailability());
    assert.doesNotThrow(() => JSON.parse(json1));
    assert.doesNotThrow(() => JSON.parse(json2));
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test src/server/core/opds-feed.test.ts`
Expected: FAIL — 模块 `./opds-feed` 不存在

- [ ] **Step 3: 实现 `OpdsFeedService`**

创建 `src/server/core/opds-feed.ts`：

```ts
export interface OpdsNovelFeedEntry {
  sourceId: string;
  novelId: string;
  title: string;
  author: string;
  description: string;
  tags: string[];
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface OpdsArtifactAvailability {
  original: boolean;
  translated: boolean;
  bilingual: boolean;
}

const OPDS_VERSION_LABELS: Record<keyof OpdsArtifactAvailability, string> = {
  original: '原文',
  translated: '译文',
  bilingual: '双语对照',
};

const ATOM_ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const EPUB_MEDIA_TYPE = 'application/epub+zip';
const OPDS2_MEDIA_TYPE = 'application/opds+json';

export class OpdsFeedService {
  /** OPDS 1.2 根目录 feed（Atom XML） */
  buildAtomRootFeed(novels: OpdsNovelFeedEntry[]): string {
    const updated = this.computeFeedUpdated(novels);
    const entries = novels.map((novel) => this.buildAtomRootEntry(novel)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:opds:root</id>
  <title>TS Novel Spider 书库</title>
  <updated>${this.escapeXml(updated)}</updated>
  <link rel="self" href="/opds/v1" type="${ATOM_ACQUISITION_TYPE}"/>
  <link rel="start" href="/opds/v1" type="${ATOM_ACQUISITION_TYPE}"/>
${entries}
</feed>`;
  }

  /** OPDS 1.2 单书 feed（Atom XML） */
  buildAtomNovelFeed(novel: OpdsNovelFeedEntry, availability: OpdsArtifactAvailability): string {
    const updated = novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString();
    const versions = this.collectAvailableVersions(availability);
    const entries = versions.map((version) => this.buildAtomVersionEntry(novel, version)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}</id>
  <title>${this.escapeXml(novel.title)}</title>
  <updated>${this.escapeXml(updated)}</updated>
  <link rel="self" href="/opds/v1/${this.escapeXml(novel.sourceId)}/${this.escapeXml(novel.novelId)}" type="${ATOM_ACQUISITION_TYPE}"/>
  <link rel="up" href="/opds/v1" type="${ATOM_ACQUISITION_TYPE}"/>
${entries}
</feed>`;
  }

  /** OPDS 2.0 根目录 feed（JSON-LD） */
  buildOpds2RootFeed(novels: OpdsNovelFeedEntry[]): string {
    const updated = this.computeFeedUpdated(novels);
    const publications = novels.map((novel) => this.buildOpds2PublicationSummary(novel));

    return JSON.stringify({
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata: {
        title: 'TS Novel Spider 书库',
        updated,
      },
      links: [
        { rel: 'self', href: '/opds/v2', type: OPDS2_MEDIA_TYPE },
        { rel: 'start', href: '/opds/v2', type: OPDS2_MEDIA_TYPE },
      ],
      publications,
    }, null, 2);
  }

  /** OPDS 2.0 单书 publication（JSON-LD） */
  buildOpds2NovelPublication(novel: OpdsNovelFeedEntry, availability: OpdsArtifactAvailability): string {
    const versions = this.collectAvailableVersions(availability);
    const acquisitionLinks = versions.map((version) => ({
      rel: 'http://opds-spec.org/acquisition',
      href: `/opds/artifacts/${novel.sourceId}/${novel.novelId}/${version}.epub`,
      type: EPUB_MEDIA_TYPE,
      title: OPDS_VERSION_LABELS[version],
    }));

    const metadata: Record<string, unknown> = {
      title: novel.title,
      author: novel.author,
      description: novel.description,
      identifier: `urn:opds:novel:${novel.sourceId}:${novel.novelId}`,
      modified: novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString(),
    };

    if (novel.tags.length > 0) {
      metadata.tags = novel.tags;
    }

    return JSON.stringify({
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata,
      links: [
        { rel: 'self', href: `/opds/v2/${novel.sourceId}/${novel.novelId}`, type: OPDS2_MEDIA_TYPE },
        ...acquisitionLinks,
      ],
      images: [],
    }, null, 2);
  }

  private buildAtomRootEntry(novel: OpdsNovelFeedEntry): string {
    const updated = novel.contentUpdatedAt ?? new Date().toISOString();
    return `  <entry>
    <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}</id>
    <title>${this.escapeXml(novel.title)}</title>
    <author><name>${this.escapeXml(novel.author)}</name></author>
    <summary>${this.escapeXml(novel.description)}</summary>
    <updated>${this.escapeXml(updated)}</updated>
    <link rel="http://opds-spec.org/acquisition" href="/opds/v1/${this.escapeXml(novel.sourceId)}/${this.escapeXml(novel.novelId)}" type="${ATOM_ACQUISITION_TYPE}"/>
  </entry>`;
  }

  private buildAtomVersionEntry(novel: OpdsNovelFeedEntry, version: keyof OpdsArtifactAvailability): string {
    const versionLabel = OPDS_VERSION_LABELS[version];
    const updated = novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString();
    return `  <entry>
    <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}:${version}</id>
    <title>${this.escapeXml(novel.title)}（${this.escapeXml(versionLabel)}）</title>
    <updated>${this.escapeXml(updated)}</updated>
    <link rel="http://opds-spec.org/acquisition" href="/opds/artifacts/${this.escapeXml(novel.sourceId)}/${this.escapeXml(novel.novelId)}/${version}.epub" type="${EPUB_MEDIA_TYPE}"/>
  </entry>`;
  }

  private buildOpds2PublicationSummary(novel: OpdsNovelFeedEntry): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      title: novel.title,
      author: novel.author,
      description: novel.description,
      identifier: `urn:opds:novel:${novel.sourceId}:${novel.novelId}`,
      modified: novel.contentUpdatedAt ?? new Date().toISOString(),
    };

    if (novel.tags.length > 0) {
      metadata.tags = novel.tags;
    }

    return {
      metadata,
      links: [
        {
          rel: 'http://opds-spec.org/acquisition',
          href: `/opds/v2/${novel.sourceId}/${novel.novelId}`,
          type: OPDS2_MEDIA_TYPE,
        },
      ],
    };
  }

  private collectAvailableVersions(availability: OpdsArtifactAvailability): Array<keyof OpdsArtifactAvailability> {
    const versions: Array<keyof OpdsArtifactAvailability> = [];
    if (availability.original) versions.push('original');
    if (availability.translated) versions.push('translated');
    if (availability.bilingual) versions.push('bilingual');
    return versions;
  }

  private computeFeedUpdated(novels: OpdsNovelFeedEntry[]): string {
    const timestamps = novels
      .map((n) => n.contentUpdatedAt)
      .filter((t): t is string => t !== null)
      .sort()
      .reverse();
    return timestamps[0] ?? new Date().toISOString();
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test src/server/core/opds-feed.test.ts`
Expected: PASS

- [ ] **Step 5: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: 跳过 commit（项目规则禁止自动提交）**

---

### Task 3: ControlCenterService — 制品信息查询与透传

**Files:**
- Modify: `src/server/core/control-center.ts`

- [ ] **Step 1: 在 import 区追加 `OpdsNovelFeedEntry` 类型导入**

在现有 `novel-repository` 类型导入中追加 `StoredOpdsNovelRow`（如未导入）并新增 `OpdsNovelFeedEntry` 相关类型。由于 `OpdsNovelFeedEntry` 定义在 `opds-feed.ts`，需追加导入：

```ts
import type { OpdsNovelFeedEntry } from './opds-feed';
```

- [ ] **Step 2: 在类字段区追加 `#opdsArtifactsRoot`**

在 `readonly #opdsCompilation: OpdsCompilationService;` 之后追加：

```ts
  readonly #opdsArtifactsRoot: string;
```

- [ ] **Step 3: 在构造函数中初始化 `#opdsArtifactsRoot`**

在 `this.#opdsCompilation = new OpdsCompilationService({...});` 之前追加：

```ts
    this.#opdsArtifactsRoot = options.opdsArtifactsPath ?? path.resolve(process.cwd(), 'data', 'opds-artifacts');
```

- [ ] **Step 4: 在 OPDS 透传方法块之后追加新方法**

在 `getLatestCompletedOpdsCompilationRun()` 方法之后追加：

```ts
  /** 列出所有 OPDS 可见书籍（含完整元数据，供 feed 构造） */
  listVisibleOpdsNovelsWithMetadata(): OpdsNovelFeedEntry[] {
    return this.#repository.listVisibleOpdsNovelsWithMetadata();
  }

  /** 查询某书某版本制品文件信息 */
  getOpdsArtifactInfo(sourceId: string, novelId: string, fileName: string): { exists: boolean; filePath: string; size: number } {
    const allowedFileNames = ['original.epub', 'translated.epub', 'bilingual.epub'];
    if (!allowedFileNames.includes(fileName)) {
      return { exists: false, filePath: '', size: 0 };
    }
    const filePath = path.join(this.#opdsArtifactsRoot, sourceId, novelId, fileName);
    if (!fs.existsSync(filePath)) {
      return { exists: false, filePath, size: 0 };
    }
    const stat = fs.statSync(filePath);
    return { exists: true, filePath, size: stat.size };
  }

  /** 查询单本书的所有版本制品可用性 */
  getOpdsNovelArtifactAvailability(sourceId: string, novelId: string): { original: boolean; translated: boolean; bilingual: boolean } {
    return {
      original: this.getOpdsArtifactInfo(sourceId, novelId, 'original.epub').exists,
      translated: this.getOpdsArtifactInfo(sourceId, novelId, 'translated.epub').exists,
      bilingual: this.getOpdsArtifactInfo(sourceId, novelId, 'bilingual.epub').exists,
    };
  }

  /** 获取制品文件绝对路径（供路由 sendFile 使用） */
  getOpdsArtifactFilePath(sourceId: string, novelId: string, fileName: string): string | null {
    const info = this.getOpdsArtifactInfo(sourceId, novelId, fileName);
    return info.exists ? info.filePath : null;
  }
```

- [ ] **Step 5: 确认 `fs` 和 `path` 已导入**

检查 `control-center.ts` 顶部是否已 `import fs from 'node:fs'` 和 `import path from 'node:path'`。若未导入则追加。

- [ ] **Step 6: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: 跳过 commit（项目规则禁止自动提交）**

---

### Task 4: opdsRouter — HTTP 路由

**Files:**
- Create: `src/server/routes/opds.ts`

- [ ] **Step 1: 实现 `opdsRouter`**

创建 `src/server/routes/opds.ts`：

```ts
import { Router } from 'express';

import type { ControlCenterService } from '../core/control-center';
import { OpdsFeedService } from '../core/opds-feed';

export interface OpdsRouterOptions {
  service: ControlCenterService;
}

const ATOM_ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const OPDS2_MEDIA_TYPE = 'application/opds+json';
const EPUB_MEDIA_TYPE = 'application/epub+zip';
const ALLOWED_ARTIFACT_FILE_NAMES = new Set(['original.epub', 'translated.epub', 'bilingual.epub']);

export function createOpdsRouter({ service }: OpdsRouterOptions): Router {
  const router = Router();
  const feedService = new OpdsFeedService();

  // ── OPDS 1.2 (Atom XML) ──

  router.get('/v1', (_request, response) => {
    try {
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const xml = feedService.buildAtomRootFeed(novels);
      response.setHeader('Content-Type', ATOM_ACQUISITION_TYPE);
      response.send(xml);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  router.get('/v1/:sourceId/:novelId', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const novel = novels.find((n) => n.sourceId === sourceId && n.novelId === novelId);

      if (!novel) {
        response.status(404).json({
          message: `OPDS novel ${sourceId}/${novelId} was not found or not visible.`,
        });
        return;
      }

      const availability = service.getOpdsNovelArtifactAvailability(sourceId, novelId);
      const xml = feedService.buildAtomNovelFeed(novel, availability);
      response.setHeader('Content-Type', ATOM_ACQUISITION_TYPE);
      response.send(xml);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  // ── OPDS 2.0 (JSON-LD) ──

  router.get('/v2', (_request, response) => {
    try {
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const json = feedService.buildOpds2RootFeed(novels);
      response.setHeader('Content-Type', OPDS2_MEDIA_TYPE);
      response.send(json);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  router.get('/v2/:sourceId/:novelId', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const novel = novels.find((n) => n.sourceId === sourceId && n.novelId === novelId);

      if (!novel) {
        response.status(404).json({
          message: `OPDS novel ${sourceId}/${novelId} was not found or not visible.`,
        });
        return;
      }

      const availability = service.getOpdsNovelArtifactAvailability(sourceId, novelId);
      const json = feedService.buildOpds2NovelPublication(novel, availability);
      response.setHeader('Content-Type', OPDS2_MEDIA_TYPE);
      response.send(json);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  // ── 制品下载 ──

  router.get('/artifacts/:sourceId/:novelId/:fileName', (request, response) => {
    try {
      const { sourceId, novelId, fileName } = request.params;

      if (!ALLOWED_ARTIFACT_FILE_NAMES.has(fileName)) {
        response.status(404).json({
          message: `Artifact ${fileName} is not a valid OPDS artifact file name.`,
        });
        return;
      }

      const filePath = service.getOpdsArtifactFilePath(sourceId, novelId, fileName);
      if (!filePath) {
        response.status(404).json({
          message: `Artifact ${sourceId}/${novelId}/${fileName} was not found.`,
        });
        return;
      }

      response.setHeader('Content-Type', EPUB_MEDIA_TYPE);
      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.sendFile(filePath);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'Artifact download failed.',
      });
    }
  });

  return router;
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 跳过 commit（项目规则禁止自动提交）**

---

### Task 5: app.ts — 挂载 opdsRouter

**Files:**
- Modify: `src/server/app.ts`

- [ ] **Step 1: 在 import 区追加 `createOpdsRouter` 导入**

在 `import { createLibraryRouter } from './routes/library';` 之后追加：

```ts
import { createOpdsRouter } from './routes/opds';
```

- [ ] **Step 2: 在路由挂载区追加 `/opds` 路由**

在 `app.use('/api/library', createLibraryRouter({ service: controlCenter }));` 之后追加：

```ts
  app.use('/opds', createOpdsRouter({ service: controlCenter }));
```

- [ ] **Step 3: 更新 SPA 回退中间件，排除 `/opds` 路径**

在 SPA 回退中间件的 `if (request.path.startsWith('/api'))` 判断中追加 `/opds` 排除：

```ts
    if (request.path.startsWith('/api') || request.path.startsWith('/opds')) {
      next();
      return;
    }
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 跳过 commit（项目规则禁止自动提交）**

---

### Task 6: 路由集成测试

**Files:**
- Create: `src/server/routes/opds.test.ts`

- [ ] **Step 1: 编写路由集成测试**

创建 `src/server/routes/opds.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeServer,
  createLibraryServer,
  waitForServerListening,
} from './library-test-helpers';

test('OPDS v1 root feed returns Atom XML with correct content type', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/opds/v1`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('application/atom+xml'));
    const xml = await response.text();
    assert.ok(xml.includes('<?xml version="1.0"'));
    assert.ok(xml.includes('xmlns="http://www.w3.org/2005/Atom"'));
    assert.ok(xml.includes('离线书库样例'));
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS v1 root feed excludes invisible novels', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v1`);
    const xml = await response.text();
    assert.ok(!xml.includes('离线书库样例'));
    assert.ok(xml.includes('<feed'));
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS v1 single-novel feed returns 404 for missing novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v1/syosetu/missing`);
    assert.equal(response.status, 404);
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS v2 root feed returns JSON-LD with correct content type', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/opds/v2`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('application/opds+json'));
    const json = await response.json();
    assert.equal(json['@context'], 'https://readium.org/webpub-manifest/context.jsonld');
    assert.ok(Array.isArray(json.publications));
    assert.ok(json.publications.some((p: { metadata: { title: string } }) => p.metadata.title === '离线书库样例'));
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS v2 single-novel publication returns 404 for missing novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v2/syosetu/missing`);
    assert.equal(response.status, 404);
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS artifact download returns 404 for nonexistent file', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/artifacts/syosetu/n1000lib/original.epub`);
    assert.equal(response.status, 404);
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS artifact download rejects invalid file name', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/artifacts/syosetu/n1000lib/../../etc/passwd`);
    assert.equal(response.status, 404);
  } finally {
    closeServer(server);
    cleanup();
  }
});

test('OPDS artifact download returns file stream when file exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-artifact-test-'));
  const artifactsRoot = path.join(tempDir, 'artifacts');
  const novelDir = path.join(artifactsRoot, 'syosetu', 'n1000lib');
  fs.mkdirSync(novelDir, { recursive: true });
  const fakeEpubContent = Buffer.from('fake epub content for testing');
  fs.writeFileSync(path.join(novelDir, 'original.epub'), fakeEpubContent);

  const { app, cleanup, repository } = createLibraryServer({
    beforeControlCenter: () => {},
  });
  // Note: createLibraryServer doesn't expose opdsArtifactsPath option directly;
  // the test relies on the default data/opds-artifacts path being overridden
  // by creating the artifact in the default location. For isolation, we skip
  // this test if the default path isn't writable. Instead, test via a custom
  // server setup below.

  // Clean up unused server
  cleanup();
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Build a custom server with opdsArtifactsPath
  const { createServerApp } = await import('../app');
  const { ControlCenterService } = await import('../core/control-center');
  const { SqliteNovelRepository } = await import('../core/novel-repository');
  const { SystemPreferencesService } = await import('../core/system-preferences');

  const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-artifact-test2-'));
  const artifactsRoot2 = path.join(tempDir2, 'artifacts');
  const novelDir2 = path.join(artifactsRoot2, 'syosetu', 'n1000lib');
  fs.mkdirSync(novelDir2, { recursive: true });
  fs.writeFileSync(path.join(novelDir2, 'original.epub'), fakeEpubContent);

  const repository2 = new SqliteNovelRepository(path.join(tempDir2, 'novels.db'));
  repository2.saveMetadata('syosetu', {
    novelId: 'n1000lib',
    title: '测试小说',
    author: '作者',
    description: '简介',
    tags: [],
    chapterCount: 1,
    infoPageUrl: 'https://example.com',
  });
  repository2.saveChapterIndex('syosetu', 'n1000lib', [{
    id: 'c1', index: 1, title: '第一章', volumeTitle: null, url: 'https://example.com/c1',
  }]);
  repository2.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'c1', index: 1, title: '第一章', volumeTitle: null,
    url: 'https://example.com/c1', content: '内容',
  });
  repository2.updateOpdsVisible('syosetu', 'n1000lib', true);

  const controlCenter = new ControlCenterService({
    repository: repository2,
    spiders: [],
    systemPreferences: new SystemPreferencesService(),
    offlineAssetStoragePath: path.join(tempDir2, 'assets'),
    exportStoragePath: path.join(tempDir2, 'exports'),
    opdsArtifactsPath: artifactsRoot2,
  });
  const app2 = createServerApp({ controlCenter });
  const server2 = app2.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server2);
    const response = await fetch(`${baseUrl}/opds/artifacts/syosetu/n1000lib/original.epub`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('application/epub+zip'));
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(buffer, fakeEpubContent);
  } finally {
    closeServer(server2);
    controlCenter.close();
    repository2.close();
    fs.rmSync(tempDir2, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行测试验证通过**

Run: `npx tsx --test src/server/routes/opds.test.ts`
Expected: PASS

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: 跳过 commit（项目规则禁止自动提交）**

---

### Task 7: 最终验证 — typecheck + build + 全量测试

- [ ] **Step 1: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: 运行 build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 运行全量服务端测试**

Run: `npm run test:server`
Expected: PASS

- [ ] **Step 4: 运行全量前端测试**

Run: `npm run test:web`
Expected: PASS

- [ ] **Step 5: 运行 CI 脚本测试**

Run: `npm run test:ci`
Expected: PASS

---

## Self-Review

**Spec coverage:**
- §2.1 `OpdsFeedService` → Task 2 ✓
- §2.1 `opdsRouter` → Task 4 ✓
- §2.2 `listVisibleOpdsNovelsWithMetadata` → Task 1 ✓
- §2.2 `ControlCenterService` 透传 + `getOpdsArtifactInfo` → Task 3 ✓
- §2.2 `app.ts` 挂载 → Task 5 ✓
- §3 端点结构 → Task 4 ✓
- §4 Feed 数据模型 → Task 2 ✓
- §5 ControlCenter 扩展 → Task 1 + 3 ✓
- §6 转义与边界 → Task 2 ✓
- §7 制品下载端点 → Task 4 ✓
- §8 测试策略 → Task 2 + 6 ✓

**Placeholder scan:** 无 TBD/TODO；所有步骤含完整代码。

**Type consistency:** `OpdsNovelFeedEntry`、`OpdsArtifactAvailability`、`OpdsFeedService`、`createOpdsRouter`、`getOpdsArtifactInfo`、`getOpdsNovelArtifactAvailability`、`getOpdsArtifactFilePath`、`listVisibleOpdsNovelsWithMetadata` 命名前后一致。
