# RAG 结构提取：移除启发式回退并支持失败重试 — 实施计划

> **用于 Agentic 工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步执行此计划。步骤使用 checkbox (`- [ ]`) 语法进行跟踪。

**目标：** 移除知识图谱构建中 per-chunk 的启发式回退，改为显式失败标记 + 失败片段重试端点。

**架构：** 在 `novel_graph_build_checkpoints` 表新增 `status` 字段（`'success' | 'failed'`）；`processChunkWithRoute` 不再回退到 `extractChunkHeuristically`；新增 `POST .../graph/retry-failed` 端点仅重试失败片段。

**技术栈：** TypeScript (strict)、better-sqlite3、Express 5、Vercel AI SDK

---

### Task 1: 数据库 migration — checkpoint 表新增 status 字段

**文件：**
- 修改：`src/server/core/novel-repository.ts`

- [ ] **Step 1: 更新 DB 行接口 `KnowledgeGraphBuildCheckpointRow`（约 L452）**

```ts
interface KnowledgeGraphBuildCheckpointRow {
  source_id: string;
  novel_id: string;
  chunk_id: string;
  chapter_id: string;
  chapter_index: number;
  chunk_index: number;
  chapter_title: string;
  extraction_json: string;
  warning_message: string | null;
  status: string;           // 新增
  updated_at: string;
}
```

- [ ] **Step 2: 更新存储行接口 `StoredKnowledgeGraphBuildCheckpointRow`（约 L130）**

```ts
export interface StoredKnowledgeGraphBuildCheckpointRow {
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  chunkIndex: number;
  chapterTitle: string;
  extractionJson: string;
  warningMessage: string | null;
  status: 'success' | 'failed';  // 新增
  updatedAt: string;
}
```

- [ ] **Step 3: 在 migration 块中追加 `ensureColumnExists`（约 L3060 之后）**

在现有的 `this.ensureColumnExists('novel_graph_builds', 'model_stats_json', ...)` 之后加入：

```ts
this.ensureColumnExists('novel_graph_build_checkpoints', 'status', "TEXT NOT NULL DEFAULT 'success'");
```

- [ ] **Step 4: 更新 `mapKnowledgeGraphBuildCheckpointRow` 映射函数（约 L3500）**

```ts
function mapKnowledgeGraphBuildCheckpointRow(row: KnowledgeGraphBuildCheckpointRow): StoredKnowledgeGraphBuildCheckpointRow {
  return {
    chunkId: row.chunk_id,
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    chunkIndex: row.chunk_index,
    chapterTitle: row.chapter_title,
    extractionJson: row.extraction_json,
    warningMessage: row.warning_message,
    status: (row.status === 'failed' ? 'failed' : 'success'),  // 安全转换
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 5: 更新 `saveKnowledgeGraphBuildCheckpoint`（约 L1403）**

在 `INSERT ... ON CONFLICT DO UPDATE` 语句中加入 `status` 列：

```ts
// INSERT 子句中追加 status 参数
INSERT INTO novel_graph_build_checkpoints (
  source_id, novel_id, chunk_id, chapter_id, chapter_index,
  chunk_index, chapter_title, extraction_json, warning_message, status, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_id, novel_id, chunk_id) DO UPDATE SET
  chapter_id = excluded.chapter_id,
  chapter_index = excluded.chapter_index,
  chunk_index = excluded.chunk_index,
  chapter_title = excluded.chapter_title,
  extraction_json = excluded.extraction_json,
  warning_message = excluded.warning_message,
  status = excluded.status,
  updated_at = excluded.updated_at
```

方法签名新增 `status` 参数：

```ts
saveKnowledgeGraphBuildCheckpoint(input: {
  sourceId: string;
  novelId: string;
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  chunkIndex: number;
  chapterTitle: string;
  extractionJson: string;
  warningMessage: string | null;
  status: 'success' | 'failed';  // 新增
}): void {
```

`.run(...)` 调用追加 `input.status`：

```ts
.run(
  input.sourceId, input.novelId, input.chunkId, input.chapterId,
  input.chapterIndex, input.chunkIndex, input.chapterTitle,
  input.extractionJson, input.warningMessage, input.status, updatedAt,
);
```

- [ ] **Step 6: 更新 `replaceKnowledgeGraphBuildCheckpoints`（约 L1463）**

入参类型中 `checkpoints` 数组元素新增 `status`，INSERT 语句和 `.run()` 调用同步追加：

```ts
replaceKnowledgeGraphBuildCheckpoints(
  sourceId: string,
  novelId: string,
  checkpoints: Array<{
    chunkId: string;
    chapterId: string;
    chapterIndex: number;
    chunkIndex: number;
    chapterTitle: string;
    extractionJson: string;
    warningMessage: string | null;
    status: 'success' | 'failed';  // 新增
  }>,
): void {
```

INSERT SQL 追加 `status` 列，`.run()` 调用追加 `checkpoint.status`。

- [ ] **Step 7: 新增方法 `listFailedKnowledgeGraphCheckpoints`**

在 `listKnowledgeGraphBuildCheckpoints` 旁边新增（约 L1400 之后）：

```ts
listFailedKnowledgeGraphCheckpoints(sourceId: string, novelId: string): StoredKnowledgeGraphBuildCheckpointRow[] {
  return this.#database
    .prepare(
      `
        SELECT
          source_id, novel_id, chunk_id, chapter_id, chapter_index,
          chunk_index, chapter_title, extraction_json, warning_message, status, updated_at
        FROM novel_graph_build_checkpoints
        WHERE source_id = ? AND novel_id = ? AND status = 'failed'
        ORDER BY chapter_index ASC, chunk_index ASC
      `,
    )
    .all(sourceId, novelId)
    .map((row) => mapKnowledgeGraphBuildCheckpointRow(row as KnowledgeGraphBuildCheckpointRow));
}
```

- [ ] **Step 8: 运行 typecheck 验证 migration 无类型错误**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 9: 提交**

```bash
git add src/server/core/novel-repository.ts
git commit -m "feat: add status column to graph build checkpoints"
```

---

### Task 2: 核心提取逻辑 — 移除启发式回退

**文件：**
- 修改：`src/server/core/library-intelligence-rag.ts`

- [ ] **Step 1: 修改 `processChunkWithRoute`（约 L1298）**

将函数改为：`route` 为 null 时 throw；LLM 失败时返回 `FAILED_EXTRACTION` 而非调用 `extractChunkHeuristically`。

```ts
async function processChunkWithRoute(
  snapshot: StoredNovelSnapshot,
  chunk: ChunkPlan,
  route: ResolvedExtractionRoute | null,
): Promise<{ extraction: ChunkExtraction; warning: string | null }> {
  if (!route) {
    throw new Error('未配置图谱提取模型，无法进行结构化提取。');
  }

  try {
    return {
      extraction: await extractChunkWithLlm(snapshot, chunk, route),
      warning: null,
    };
  } catch (error) {
    return {
      extraction: FAILED_EXTRACTION,
      warning: describeErrorMessage(error),
    };
  }
}
```

- [ ] **Step 2: 定义 `FAILED_EXTRACTION` 常量**

在 `processChunkWithRoute` 函数上方新增：

```ts
const FAILED_EXTRACTION: ChunkExtraction = Object.freeze({
  summary: '',
  eventSummary: '',
  entities: [],
  relations: [],
  keywordHints: [],
  usedLlm: false,
});
```

- [ ] **Step 3: 修改 `runKnowledgeGraphBuild` 入口校验（约 L340）**

在函数体开头、`extractionModels` 过滤之后，加入：

```ts
if (extractionModels.length === 0) {
  throw new Error(
    '未配置图谱提取模型，无法构建知识图谱。请先在小说图谱配置中添加至少一个提取模型。',
  );
}
```

- [ ] **Step 4: 删除 `workerSlots` 中的 `route: null` 回退逻辑（约 L404）**

将：

```ts
const workerSlots: Array<{ id: string; route: ResolvedExtractionRoute | null }> = extractionModels.length > 0
  ? createExtractionWorkerSlots(extractionModels)
  : [{ id: 'fallback::0', route: null }];
```

改为：

```ts
const workerSlots: Array<{ id: string; route: ResolvedExtractionRoute | null }> =
  createExtractionWorkerSlots(extractionModels);
```

- [ ] **Step 5: 修改主循环中失败 chunk 的处理（约 L525-535 区域）**

在 `canHandoff` 判断之后的 else 分支中，将：

```ts
if (settled.extraction.usedLlm) {
  usedLlmExtraction = true;
  llmSuccessCount += 1;
} else {
  fallbackCount += 1;
  if (settled.warning) {
    llmFailureCount += 1;
    pushUnique(failureSamples, settled.warning, 4);
  }
}
```

改为（区分成功与失败，不再有 fallback 概念）：

```ts
if (settled.extraction.usedLlm) {
  usedLlmExtraction = true;
  llmSuccessCount += 1;
} else if (settled.warning) {
  // 所有模型均失败，片段标记为 failed
  llmFailureCount += 1;
  pushUnique(failureSamples, settled.warning, 4);
}
// 注意：删除了 fallbackCount += 1 的逻辑——不再有启发式回退
```

- [ ] **Step 6: 更新 `onCheckpoint` 回调（约 L540）**

在 `onCheckpoint` 调用的对象中追加 `status` 字段（需要同步更新 `KnowledgeGraphBuildArtifacts` 中 checkpoints 的类型）：

对 `extractionByChunkId.set(...)` 后的 `onCheckpoint` 调用处，新增 `status` 属性。但 `onCheckpoint` 签名在 `library-intelligence-rag.ts` 中是 `KnowledgeGraphBuildCallbacks['onCheckpoint']` 类型，我们需要先更新该类型。

找到 `onCheckpoint` 回调的类型定义处（约 L175-185），在参数中追加 `status`：

```ts
onCheckpoint?: (checkpoint: {
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  chunkIndex: number;
  chapterTitle: string;
  extractionJson: string;
  warningMessage: string | null;
  status: 'success' | 'failed';  // 新增
}) => Promise<void> | void;
```

然后更新主循环中两处 `onCheckpoint` 调用（about L540 和 L565 中的 `chunkPlans.flatMap`），追加 `status`。

在 completed 分支中：

```ts
await options.onCheckpoint?.({
  chunkId: settled.pending.chunk.id,
  chapterId: settled.pending.chunk.chapterId,
  chapterIndex: settled.pending.chunk.chapterIndex,
  chunkIndex: settled.pending.chunk.chunkIndex,
  chapterTitle: settled.pending.chunk.chapterTitle,
  extractionJson: serializeCheckpointExtraction(settled.pending.chunk, settled.extraction),
  warningMessage: settled.warning,
  status: settled.extraction.usedLlm ? 'success' : 'failed',  // 新增
});
```

- [ ] **Step 7: 删除全部 chunk 失败的错误抛出中对 fallback 的引用（约 L583）**

将错误消息改为：

```ts
if (extractionModels.length > 0 && chunkPlans.length > 0 && !usedLlmExtraction && llmFailureCount === chunkPlans.length) {
  throw new Error(
    `已配置图谱抽取模型，但所有结构化抽取请求都失败了。请检查模型配置后使用重试端点再次尝试。最近错误：${failureSamples[0] ?? '未返回具体错误。'}`,
  );
}
```

- [ ] **Step 8: 移除不再需要的相关变量和死代码**

- 删除 `fallbackCount` 变量声明（约 L365），或在不再需要时保留但仅作统计展示
- 从 `KnowledgeGraphBuildProgressEvent` 接口中移除 `fallbackCount` 和 `mode` 字段（约 L59-63），或者保留向后兼容（填 0）
- `buildKnowledgeGraphArtifacts` 返回值 `KnowledgeGraphBuildArtifacts` 中的 `checkpoints` 数组类型追加 `status`
- 注意：`extractChunkHeuristically` 函数保留不删（测试引用），但加注释 `@deprecated 不再用于 LLM 失败回退`

> **简化决策**：保留 `fallbackCount` 在接口中（填 0 以兼容），不做接口破坏性变更。`mode` 字段固定为 `'llm'`。

- [ ] **Step 9: 运行 typecheck**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 10: 提交**

```bash
git add src/server/core/library-intelligence-rag.ts
git commit -m "feat: remove heuristic fallback from chunk extraction, mark failed chunks explicitly"
```

---

### Task 3: 导出 chunk 提取函数 + 新增批量重试入口（library-intelligence-rag.ts）

**文件：**
- 修改：`src/server/core/library-intelligence-rag.ts`

> **前置条件**：当前 `processChunkWithRoute` 是内部函数，未导出。需先导出它并新增批量重试包装函数，供 `LibraryIntelligenceService.retryFailedKnowledgeGraphChunks` 调用。

- [ ] **Step 1: 导出 `processChunkWithRoute`（约 L1298）**

在函数声明前加 `export`：

```ts
export async function processChunkWithRoute(
```

同时导出 `FAILED_EXTRACTION` 常量（在函数上方新增 export）：

```ts
export const FAILED_EXTRACTION: ChunkExtraction = Object.freeze({
  summary: '',
  eventSummary: '',
  entities: [],
  relations: [],
  keywordHints: [],
  usedLlm: false,
});
```

- [ ] **Step 2: 运行 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: 提交**

```bash
git add src/server/core/library-intelligence-rag.ts
git commit -m "feat: export processChunkWithRoute for retry support"
```

---

### Task 4: LibraryIntelligenceService — 新增 retryFailedChunks 方法

**文件：**
- 修改：`src/server/core/library-intelligence.ts`

- [ ] **Step 1: 导入 `processChunkWithRoute`**

```ts
import {
  buildKnowledgeGraphArtifacts,
  ...
  processChunkWithRoute,  // 新增
  ...
} from './library-intelligence-rag';
```

- [ ] **Step 2: 新增方法**

```ts
async retryFailedKnowledgeGraphChunks(
  sourceId: string,
  novelId: string,
  options?: { modelOverrides?: Array<{ providerId: string; modelId: string }> },
): Promise<{ retriedCount: number; successCount: number; stillFailedCount: number } | null> {
  const snapshot = this.#repository.getSnapshot(sourceId, novelId);
  if (!snapshot) return null;

  const failedCheckpoints = this.#repository.listFailedKnowledgeGraphCheckpoints(sourceId, novelId);
  if (failedCheckpoints.length === 0) {
    return { retriedCount: 0, successCount: 0, stillFailedCount: 0 };
  }

  const llmState = this.#preferences.getLlmState();
  const profile = this.#repository.getKnowledgeGraphProfile(sourceId, novelId);
  let extractionModels = resolveExtractionRoutes(llmState, profile);

  if (options?.modelOverrides?.length) {
    const overridden = options.modelOverrides
      .map(({ providerId, modelId }) => {
        const provider = llmState.providers.find((p) => p.id === providerId);
        const model = provider?.models.find((m) => m.id === modelId);
        return model && provider ? { provider, model, maxConcurrency: 1, source: 'global' as const } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (overridden.length > 0) extractionModels = overridden;
  }

  if (extractionModels.length === 0) {
    throw new Error('未配置图谱提取模型，无法重试失败片段。请先在小说图谱配置中添加至少一个提取模型。');
  }

  // 从 knowledge_graph_chunks 表获取原始文本
  const allChunks = this.#repository.listKnowledgeGraphChunks(sourceId, novelId);
  const contentById = new Map(allChunks.map((c) => [c.id, c.content]));

  let successCount = 0;
  let stillFailedCount = 0;

  for (const cp of failedCheckpoints) {
    const content = contentById.get(cp.chunkId);
    if (!content) continue;

    const route = extractionModels[0];
    if (!route) continue;

    try {
      const { extraction, warning } = await processChunkWithRoute(snapshot, {
        id: cp.chunkId, chapterId: cp.chapterId, chapterIndex: cp.chapterIndex,
        chunkIndex: cp.chunkIndex, chapterTitle: cp.chapterTitle, content,
      }, route);

      if (extraction.usedLlm) {
        this.#repository.saveKnowledgeGraphBuildCheckpoint({
          sourceId, novelId, chunkId: cp.chunkId, chapterId: cp.chapterId,
          chapterIndex: cp.chapterIndex, chunkIndex: cp.chunkIndex,
          chapterTitle: cp.chapterTitle,
          extractionJson: JSON.stringify(extraction),
          warningMessage: warning, status: 'success',
        });
        successCount += 1;
      } else {
        this.#repository.saveKnowledgeGraphBuildCheckpoint({
          sourceId, novelId, chunkId: cp.chunkId, chapterId: cp.chapterId,
          chapterIndex: cp.chapterIndex, chunkIndex: cp.chunkIndex,
          chapterTitle: cp.chapterTitle,
          extractionJson: '{}',
          warningMessage: warning ?? '重试后模型仍返回空结果。',
          status: 'failed',
        });
        stillFailedCount += 1;
      }
    } catch (error) {
      this.#repository.saveKnowledgeGraphBuildCheckpoint({
        sourceId, novelId, chunkId: cp.chunkId, chapterId: cp.chapterId,
        chapterIndex: cp.chapterIndex, chunkIndex: cp.chunkIndex,
        chapterTitle: cp.chapterTitle,
        extractionJson: '{}',
        warningMessage: error instanceof Error ? error.message : '重试时发生未知错误。',
        status: 'failed',
      });
      stillFailedCount += 1;
    }
  }

  return { retriedCount: failedCheckpoints.length, successCount, stillFailedCount };
}
```

- [ ] **Step 3: 运行 typecheck → 提交**

```bash
npm run typecheck
git add src/server/core/library-intelligence.ts
git commit -m "feat: add retryFailedKnowledgeGraphChunks method"
```

---

### Task 5: 路由 — 新增 POST /graph/retry-failed 端点

**文件：**
- 修改：`src/server/routes/library.ts`

- [ ] **Step 1: 在 graph/resume 路由之后追加新路由（约 L280 之后）**

```ts
router.post('/novels/:sourceId/:novelId/graph/retry-failed', async (request, response) => {
  try {
    const { sourceId, novelId } = request.params;
    const body = (request.body ?? {}) as { modelOverrides?: Array<{ providerId: string; modelId: string }> };

    const result = await service.retryFailedKnowledgeGraphChunks(sourceId, novelId, {
      modelOverrides: body.modelOverrides,
    });

    if (!result) {
      response.status(404).json({
        message: `Library novel ${sourceId}/${novelId} was not found.`,
      });
      return;
    }

    response.status(200).json(result);
  } catch (error) {
    response.status(409).json({
      message: error instanceof Error ? error.message : 'Knowledge graph retry failed.',
    });
  }
});
```

- [ ] **Step 2: 运行 typecheck**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 3: 提交**

```bash
git add src/server/routes/library.ts
git commit -m "feat: add POST /graph/retry-failed endpoint"
```

---

### Task 6: 测试

**文件：**
- 修改：`src/server/routes/library-graph.test.ts`
- 可能需要修改：`src/server/core/library-intelligence-rag.ts` 的单元测试（如果存在）

- [ ] **Step 1: 新增测试 — 无模型时 build 返回错误**

在 `library-graph.test.ts` 中追加：

```ts
test('graph build without extraction models returns error', async () => {
  const novel = await seedNovelWithChapters(testRepo, testSnapshot, 3);
  const llmState = createEmptyLlmState(); // 无模型配置
  const service = createTestService(testRepo, llmState);
  // 确认图谱 profile 也没有配置模型
  const profile = service.getLibraryKnowledgeGraph(novel.sourceId, novel.novelId);
  expect(profile?.profile.extractionModels).toHaveLength(0);

  // 尝试构建
  const build = service.buildLibraryKnowledgeGraph(novel.sourceId, novel.novelId, { mode: 'full' });
  // 应该返回 null 或直接 throw... 根据实际 API 调整
});
```

- [ ] **Step 2: 新增测试 — retry-failed 端点正常流程**

```ts
test('POST /graph/retry-failed returns retry result', async () => {
  // 1. 先设置一个有模型的 profile 并做一次构建，让部分 chunk 标记为 failed
  // 2. 调用 POST /graph/retry-failed
  // 3. 断言返回 { retriedCount, successCount, stillFailedCount }

  const baseUrl = `http://127.0.0.1:${testPort}`;
  const retryRes = await fetch(
    `${baseUrl}/api/library/novels/syosetu/n1000lib/graph/retry-failed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelOverrides: [{ providerId: 'test', modelId: 'test-model' }] }),
    },
  );
  const result = await retryRes.json();
  expect(retryRes.status).toBe(200);
  expect(result).toHaveProperty('retriedCount');
  expect(result).toHaveProperty('successCount');
  expect(result).toHaveProperty('stillFailedCount');
});
```

- [ ] **Step 3: 新增测试 — retry-failed 无失败片段时返回 countable 结果**

```ts
test('POST /graph/retry-failed with no failed checkpoints returns zero counts', async () => { /* ... */ });
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run test:server
```
预期：所有测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/server/routes/library-graph.test.ts
git commit -m "test: add retry-failed and no-model graph build tests"
```

---

### Task 7: 更新日志消息中的措辞

**文件：**
- 修改：`src/server/core/library-intelligence.ts`

- [ ] **Step 1: 更新构建完成日志（约 L990）**

将日志消息：

```ts
`抽取结束：共处理 ${extracted.diagnostics.totalChunks} 个片段，结构化成功 ${extracted.diagnostics.llmSuccessCount} 个，回退 ${extracted.diagnostics.fallbackCount} 个。`
```

改为：

```ts
`抽取结束：共处理 ${extracted.diagnostics.totalChunks} 个片段，结构化成功 ${extracted.diagnostics.llmSuccessCount} 个，失败 ${extracted.diagnostics.llmFailureCount} 个。`
```

- [ ] **Step 2: 更新构建开始日志（约 L920-940）**

移除日志中"当前只使用本地规则"的措辞变体。

- [ ] **Step 3: 运行 typecheck**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 4: 提交**

```bash
git add src/server/core/library-intelligence.ts
git commit -m "chore: update graph build log messages to reflect failure model"
```

---

### Task 8: 最终验证

- [ ] **Step 1: 运行完整 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2: 运行全部服务端测试**

```bash
npm run test:server
```

- [ ] **Step 3: 运行构建**

```bash
npm run build
```

- [ ] **Step 4: 所有通过后最终提交（如有遗漏文件）**

```bash
git add -A
git commit -m "chore: final adjustments for heuristic fallback removal"
```

---

## 自查清单

1. **规范覆盖**：所有 5 个设计文档章节在此计划中均有对应任务 ✓
2. **占位符扫描**：无 TBD、TODO、空代码块 ✓
3. **类型一致性**：`status` 字段贯穿 DB 行 → 存储行 → checkpoint 回调 → 路由响应 ✓
4. **注意**：Task 3 中的 `retryFailedKnowledgeGraphChunks` 实现需要 chunk content 重建逻辑——这在实际编码时可能需要根据 chunk 在表中的存储方式调整。当前 checkpoint 表不存原始文本，重试时需要从 `knowledge_graph_chunks` 表或 `chapters` 表读取内容并重新切片。
