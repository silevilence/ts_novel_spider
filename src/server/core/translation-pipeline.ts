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

/** 流水线注入了运行时的依赖 */
export interface TranslationPipelineRuntime {
  preferences: SystemPreferencesService;
  repository: SqliteNovelRepository;
  historyManager: TranslationHistoryManager;
  paragraphsPerBatch: number;
  llmLogger?: LlmInteractionLogger;
  modelOverride?: string;
  abortSignal?: AbortSignal;
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
  const graph = new StateGraph(TranslationState)

    .addNode('segment', async (state: TranslationPipelineState) => {
      return segmentNode(state);
    })
    .addNode('translate', async (state: TranslationPipelineState) => {
      return translateNode(state, runtime.preferences, runtime.historyManager, runtime.paragraphsPerBatch, runtime.llmLogger, runtime.onBatchProgress, runtime.modelOverride, runtime.abortSignal);
    })
    .addNode('assemble', async (state: TranslationPipelineState) => {
      return assembleNode(state);
    })
    .addNode('finalize', async (state: TranslationPipelineState) => {
      return finalizeNode(state, runtime.repository);
    })

    // 边界路由：segment -> translate -> assemble -> finalize
    .addEdge(START, 'segment')
    .addEdge('segment', 'translate')
    .addEdge('translate', 'assemble')
    .addEdge('assemble', 'finalize')
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
  // 1. 用户手动指定（来自翻译启动面板的模型选择器）
  if (modelOverride) {
    const [overrideProviderId, overrideModelId] = modelOverride.split(':');
    if (overrideProviderId && overrideModelId) {
      console.log(`[translation] 使用用户指定模型: ${overrideProviderId}/${overrideModelId}`);
      return { providerId: overrideProviderId!, modelId: overrideModelId! };
    }
  }

  const llmState = preferences.getLlmState();

  // 2. 全局翻译偏好中指定的默认模型
  const translationPrefs = preferences.getTranslationState().config;
  if (translationPrefs.preferredTranslationModelKey) {
    const [prefProviderId, prefModelId] = translationPrefs.preferredTranslationModelKey.split(':');
    if (prefProviderId && prefModelId) {
      const prefProvider = llmState.providers.find((p) => p.id === prefProviderId && p.enabled && p.isConfigured);
      if (prefProvider) {
        const prefModel = prefProvider.models.find((m) => m.id === prefModelId && m.enabled && m.isConfigured);
        if (prefModel && prefModel.resolvedCapabilities.includes('chat')) {
          console.log(`[translation] 使用全局默认翻译模型: ${prefProviderId}/${prefModelId}`);
          return { providerId: prefProviderId!, modelId: prefModelId! };
        }
        console.log(`[translation] 全局默认翻译模型 ${prefProviderId}/${prefModelId} 不可用（未启用/未配置/非 chat），回退自动选择`);
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
        return { providerId: provider.id, modelId: model.id };
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
