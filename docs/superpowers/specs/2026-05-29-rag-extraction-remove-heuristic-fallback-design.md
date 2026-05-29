# RAG 结构提取：移除启发式回退并支持失败重试

**日期**：2026-05-29  
**状态**：已确认

---

## 1. 动机

当前 RAG 知识图谱构建的 chunk 级结构提取（`processChunkWithRoute`）在 LLM 调用失败后，会自动回退到本地启发式规则（`extractChunkHeuristically`），基于分词和简单分类生成实体/关系。该回退引入的噪声实体和虚假关系降低了最终图谱的准确性。

本次变更移除 per-chunk 的启发式回退，改为将失败 chunk 显式标记，并支持后续针对失败片段的重试。

---

## 2. 设计概览

### 2.1 Checkpoint 数据模型

`knowledge_graph_build_checkpoints` 表新增 `status` 字段：

```sql
ALTER TABLE knowledge_graph_build_checkpoints
ADD COLUMN status TEXT NOT NULL DEFAULT 'success';
```

| 值 | 含义 |
|---|---|
| `success` | LLM 提取成功，`extraction_json` 为有效结果 |
| `failed` | 所有配置模型均失败，`extraction_json` 为空对象 `{}`，`warning_message` 记录错误 |

存量迁移：已有行默认填 `'success'`（包含历史启发式回退产生的数据）。

### 2.2 核心提取逻辑

**`processChunkWithRoute`（`library-intelligence-rag.ts`）**：

- `route` 为 `null` 时（无配置模型）→ 不再回退启发式，直接 throw
- LLM 调用失败（catch）→ 返回 `FAILED_EXTRACTION`（空实体/关系，`usedLlm: false`）及 warning
- 不再调用 `extractChunkHeuristically`

**主循环 `runKnowledgeGraphBuild`**：

- 收到 `FAILED_EXTRACTION` → 记录 `llmFailureCount`，checkpoint 写 `status='failed'`，该 chunk 不参与实体/关系归并
- 所有 chunk 均失败且配置了模型 → 保持现有错误抛出行为，错误消息追加"可用重试端点再次尝试"

**入口校验**：

- `extractionModels` 为空 → 直接拒绝构建，抛出 `"未配置图谱提取模型，无法构建知识图谱。请先在小说图谱配置中添加至少一个提取模型。"`

**保留但不活跃的代码**：

- `extractChunkHeuristically` 函数保留（测试引用、独立工具价值），但不再被 LLM 失败路径调用
- `buildFallbackGraph` 保留不动（实体归零兜底，仅用元数据构建书名/作者锚点，非启发式猜测）

### 2.3 重试 API

**新增端点**：`POST /api/library/novels/:sourceId/:novelId/graph/retry-failed`

**可选请求体**：

```json
{
  "modelOverrides": [
    { "providerId": "openai", "modelId": "gpt-4o" }
  ]
}
```

- 不传 → 使用小说当前配置的提取模型池
- 传入 → 仅本次重试临时覆盖（不持久化）

**行为**：

1. 查询 `status='failed'` 的 checkpoint
2. 无失败片段 → 返回 `{ retriedCount: 0, message: "没有需要重试的失败片段。" }`
3. 有失败片段 → 逐个走 `processChunkWithRoute` 重新提取
4. 成功 → checkpoint 更新为 `status='success'` + 有效 `extraction_json`
5. 仍失败 → 保持 `status='failed'`，更新 `warning_message`
6. 全部处理完后，重新运行实体归并（`finalizeEntities`/`finalizeRelations`），刷新图谱数据
7. 返回 `{ retriedCount, successCount, stillFailedCount }`

### 2.4 路由注册

在 `src/server/routes/library.ts` 中追加处理函数，复用 `LibraryIntelligenceService` 的现有方法。

### 2.5 错误处理与边界

| 场景 | 行为 |
|---|---|
| 无配置模型 | 拒绝构建/重试，给出明确提示 |
| 全部 chunk 失败 | 抛出异常，消息提示可重试 |
| 部分成功部分失败 | 图谱正常构建，失败片段不参与归并 |
| 重试时模型仍不可用 | 返回 `stillFailedCount`，前端提示用户 |
| 存量数据 | migration 填 `success`，历史启发式产物视为有效 |

---

## 3. 涉及文件

| 文件 | 变更 |
|---|---|
| `src/server/core/novel-repository.ts` | 追加 checkpoint 表 migration |
| `src/server/core/library-intelligence-rag.ts` | `processChunkWithRoute` 去回退、`runKnowledgeGraphBuild` 处理失败状态、入口校验 |
| `src/server/routes/library.ts` | 新增 `POST .../graph/retry-failed` 路由 |
| `src/server/core/library-intelligence.ts` | 新增 `retryFailedChunks` 方法 |
| `src/server/routes/library.test.ts` | 新增重试端点测试 |
| `src/server/core/translation.test.ts` 等现有测试 | 调整依赖启发式回退的测试断言 |

---

## 4. 测试要点

- 无模型配置时 `POST .../graph/build` 返回明确错误
- 配置模型但模拟全部失败 → 错误抛出，checkpoint 状态为 failed
- 部分成功部分失败 → 图谱仅包含成功 chunk 的实体/关系
- 重试端点：成功片段被更新、仍失败片段保持 failed
- 重试端点：`modelOverrides` 参数生效
- 存量 migration：已有 checkpoint 默认 status='success'
