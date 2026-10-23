import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

import type { TranslationPipelineState, TranslationSegment, ParagraphDraft, TranslationTermEntry } from './translation-state';
import type { TranslationHistoryManager } from './translation/nodes/history-manager';
import type { LlmInteractionLogger } from './translation/nodes/llm-logger';
import type { SystemPreferencesService } from './system-preferences';
import type { SqliteNovelRepository } from './novel-repository';

import { segmentNode } from './translation/nodes/segment-node';
import { translateNode } from './translation/nodes/translate-node';
import { assembleNode } from './translation/nodes/assemble-node';
import { finalizeNode } from './translation/nodes/finalize-node';
import { restoreTranslationDrafts, saveTranslationDrafts } from './translation-checkpoint';

/** 流水线注入了运行时的依赖 */
export interface TranslationPipelineRuntime {
  preferences: SystemPreferencesService;
  repository: SqliteNovelRepository;
  historyManager: TranslationHistoryManager;
  paragraphsPerBatch: number;
  llmLogger?: LlmInteractionLogger;
  modelOverride?: string;
  abortSignal?: AbortSignal;
  /** 显式继续任务时恢复有效草稿；从零重译不得复用检查点。 */
  resumeIncomplete?: boolean;
  assertCurrent?: (state: TranslationPipelineState) => void;
  onCheckpointInvalidated?: (chapterId: string) => void;
  /** 每批翻译完成后的回调（段落数，累计总段数） */
  onBatchProgress?: (batchParagraphs: number, totalCompleted: number) => void;
}

/**
 * 使用 Annotation API 定义 LangGraph 状态——每项声明 reducer 与默认值。
 * 这比原始 channels 对象更简洁且类型安全。
 */
const TranslationState = Annotation.Root({
  sourceId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  novelId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  chapterId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  chapterIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  unitKind: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => 'chapter',
  }),
  chapterTitle: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  sourceContent: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  sourceLang: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  targetLang: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  glossary: Annotation<TranslationTermEntry[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  segments: Annotation<TranslationSegment[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  draftParagraphs: Annotation<ParagraphDraft[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  translatedTitle: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  finalParagraphs: Annotation<ParagraphDraft[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  translatorModelId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  tokenUsageJson: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  sourceContentHash: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  glossaryVersion: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  profileVersion: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  retryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  maxRetries: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 3,
  }),
  pauseRequested: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  errorMessage: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

/**
 * 构建单章翻译的 LangGraph 状态图。
 *
 * 节点顺序：
 *   START -> segment -> translate -> assemble -> finalize -> END
 *
 * 注意：审校（review）节点暂未启用，预留给将来的多 Agent 翻译架构。
 */
export function createTranslationPipelineGraph(runtime: TranslationPipelineRuntime) {
  const checkpointModelKey = () => {
    const route = resolveTranslationModel(runtime.preferences, runtime.modelOverride);
    const provider = runtime.preferences.getLlmState().providers.find((item) => item.id === route?.providerId);
    const model = provider?.models.find((item) => item.modelId === route?.modelId);
    return JSON.stringify({ route, providerType: provider?.type, baseUrl: provider?.baseUrl, format: model?.translationMessageFormat ?? 'general' });
  };
  const graph = new StateGraph(TranslationState)

    .addNode('segment', async (state: TranslationPipelineState) => {
      return segmentNode(state);
    })
    .addNode('translate', async (state: TranslationPipelineState) => {
      // 消息格式由实际模型路由决定；请求碎片在节点内合并，不改变图状态的段落边界。
      const modelKey = checkpointModelKey();
      const input = runtime.resumeIncomplete
        ? { ...state, draftParagraphs: restoreTranslationDrafts(runtime.repository, state, modelKey) } : state;
      const saved = runtime.repository.getTranslationBuildCheckpoint(state.sourceId, state.novelId, state.chapterId);
      if (runtime.resumeIncomplete && saved && saved.stage !== 'completed' && !input.draftParagraphs.length) runtime.onCheckpointInvalidated?.(state.chapterId);
      const result = await translateNode(input, runtime);
      if (!runtime.abortSignal?.aborted) runtime.assertCurrent?.(state);
      if (result.draftParagraphs) saveTranslationDrafts(runtime.repository, { ...input, ...result }, modelKey);
      return result;
    })
    .addNode('assemble', async (state: TranslationPipelineState) => {
      return assembleNode(state);
    })
    .addNode('finalize', async (state: TranslationPipelineState) => {
      runtime.assertCurrent?.(state);
      const result = await finalizeNode(state, runtime.repository);
      if (!result.errorMessage && !state.pauseRequested) saveTranslationDrafts(runtime.repository, state, checkpointModelKey(), { completed: true });
      return result;
    })

    // 边界路由：segment -> translate -> assemble -> finalize
    .addEdge(START, 'segment')
    .addConditionalEdges('segment', (state) => state.errorMessage ? END : 'translate', ['translate', END])
    .addConditionalEdges('translate', (state) => state.errorMessage || state.pauseRequested ? END : 'assemble', ['assemble', END])
    .addConditionalEdges('assemble', (state) => state.errorMessage || state.pauseRequested ? END : 'finalize', ['finalize', END])
    .addEdge('finalize', END);

  return graph.compile();
}

/**
 * 从全局 LLM 偏好中解析翻译模型。
 * 优先级：用户手动指定 > 全局默认翻译模型 > 第一个启用的 chat 模型。
 * 如果没有找到，返回 null。
 */
export function resolveTranslationModel(
  preferences: SystemPreferencesService,
  modelOverride?: string,
): { providerId: string; modelId: string } | null {
  const llmState = preferences.getLlmState();
  const findRoute = (key: string) => {
    const separator = key.indexOf(':');
    if (separator < 1) return null;
    const provider = llmState.providers.find((p) => p.id === key.slice(0, separator) && p.enabled && p.isConfigured);
    const modelKey = key.slice(separator + 1);
    const model = provider?.models.find((m) => (m.id === modelKey || m.modelId === modelKey)
      && m.enabled && m.isConfigured && m.resolvedCapabilities.includes('chat'));
    return provider && model ? { providerId: provider.id, modelId: model.modelId } : null;
  };

  // 显式覆盖不可用时直接失败，避免静默使用另一个模型及其消息格式。
  if (modelOverride) return findRoute(modelOverride);

  const preferredKey = preferences.getTranslationState().config.preferredTranslationModelKey;
  if (preferredKey) {
    const preferred = findRoute(preferredKey);
    if (preferred) return preferred;
  }

  // 2a. 模型网关中指定的默认 chat 模型
  const gateway = preferences.getModelGateway();
  if (gateway.chat) {
    const gwProvider = llmState.providers.find((p) => p.id === gateway.chat!.providerId && p.enabled && p.isConfigured);
    if (gwProvider) {
      const gwModel = gwProvider.models.find((m) => m.modelId === gateway.chat!.modelId && m.enabled && m.isConfigured && m.resolvedCapabilities.includes('chat'));
      if (gwModel) {
        console.log(`[translation] 使用模型网关默认翻译模型: ${gwProvider.id}/${gwModel.modelId}`);
        return { providerId: gwProvider.id, modelId: gwModel.modelId };
      }
    }
  }

  // 3. 自动选择：第一个启用且已配置的 chat 模型
  for (const provider of llmState.providers) {
    if (!provider.enabled || !provider.isConfigured) {
      continue;
    }

    for (const model of provider.models) {
      if (!model.enabled || !model.isConfigured) {
        continue;
      }

      if (model.resolvedCapabilities.includes('chat')) {
        console.log(`[translation] 自动选中翻译模型: ${provider.id}/${model.modelId} (capabilities: ${model.resolvedCapabilities.join(',')})`);
        return { providerId: provider.id, modelId: model.modelId };
      }
      console.log(`[translation] 跳过模型 ${provider.id}/${model.modelId}: enabled=${model.enabled} configured=${model.isConfigured} capabilities=${model.resolvedCapabilities.join(',')}`);
    }
  }

  console.log(`[translation] 未找到可用翻译模型。共检查 ${llmState.providers.length} 个提供商。`);
  for (const p of llmState.providers) {
    console.log(`[translation]   provider ${p.id}: enabled=${p.enabled} configured=${p.isConfigured} models=${p.models.length}`);
    for (const m of p.models) {
      console.log(`[translation]     model ${m.id}/${m.modelId}: enabled=${m.enabled} configured=${m.isConfigured} caps=${m.resolvedCapabilities.join(',')}`);
    }
  }

  return null;
}
