import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

import type { TranslationPipelineState, TranslationSegment, ParagraphDraft, TranslationReviewResult, TranslationTermEntry } from './translation-state';
import type { SystemPreferencesService } from './system-preferences';
import type { SqliteNovelRepository } from './novel-repository';

import { segmentNode } from './translation/nodes/segment-node';
import { translateNode } from './translation/nodes/translate-node';
import { reviewNode } from './translation/nodes/review-node';
import { assembleNode } from './translation/nodes/assemble-node';
import { finalizeNode } from './translation/nodes/finalize-node';

/** 流水线注入了运行时的依赖 */
export interface TranslationPipelineRuntime {
  preferences: SystemPreferencesService;
  repository: SqliteNovelRepository;
  qualityThreshold: number;
  modelOverride?: string;
  abortSignal?: AbortSignal;
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
  reviewResult: Annotation<TranslationReviewResult | null>({
    reducer: (_prev, next) => next,
    default: () => null,
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
  reviewerModelId: Annotation<string | null>({
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
 *   START -> segment -> translate -> review
 *     review 条件路由：
 *       - 若需要重译（reviewResult.requiresRework）→ 回到 translate
 *       - 否则 → assemble → finalize → END
 */
export function createTranslationPipelineGraph(runtime: TranslationPipelineRuntime) {
  const graph = new StateGraph(TranslationState)

    .addNode('segment', async (state: TranslationPipelineState) => {
      return segmentNode(state);
    })
    .addNode('translate', async (state: TranslationPipelineState) => {
      return translateNode(state, runtime.preferences, runtime.modelOverride, runtime.abortSignal);
    })
    .addNode('review', async (state: TranslationPipelineState) => {
      return reviewNode(state, runtime.preferences, runtime.qualityThreshold);
    })
    .addNode('assemble', async (state: TranslationPipelineState) => {
      return assembleNode(state);
    })
    .addNode('finalize', async (state: TranslationPipelineState) => {
      return finalizeNode(state, runtime.repository);
    })

    // 边界路由
    .addEdge(START, 'segment')
    .addEdge('segment', 'translate')
    .addEdge('translate', 'review')
    .addConditionalEdges(
      'review',
      (state: TranslationPipelineState): string => {
        if (state.pauseRequested) {
          return 'finalize';
        }
        if (state.errorMessage) {
          return 'finalize';
        }
        if (state.reviewResult?.requiresRework && state.retryCount < state.maxRetries) {
          return 'translate';
        }
        return 'assemble';
      },
    )
    .addEdge('assemble', 'finalize')
    .addEdge('finalize', END);

  return graph.compile();
}

/**
 * 从全局 LLM 偏好中解析翻译模型。
 * 遍历 provider 找到第一个启用且已配置的 chat 模型，返回 `{ providerId, modelId }`。
 * 如果没有找到，返回 null。
 */
export function resolveTranslationModel(
  preferences: SystemPreferencesService,
  modelOverride?: string,
): { providerId: string; modelId: string } | null {
  // 如果指定了模型覆写，优先使用
  if (modelOverride) {
    const [overrideProviderId, overrideModelId] = modelOverride.split(':');
    if (overrideProviderId && overrideModelId) {
      console.log(`[translation] 使用用户指定模型: ${overrideProviderId}/${overrideModelId}`);
      return { providerId: overrideProviderId!, modelId: overrideModelId! };
    }
  }
  const llmState = preferences.getLlmState();
  for (const provider of llmState.providers) {
    if (!provider.enabled || !provider.isConfigured) {
      continue;
    }

    for (const model of provider.models) {
      if (!model.enabled || !model.isConfigured) {
        continue;
      }

      if (model.resolvedCapabilities.includes('chat')) {
        console.log(`[translation] 选中翻译模型: ${provider.id}/${model.modelId} (capabilities: ${model.resolvedCapabilities.join(',')})`);
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

/**
 * 从全局 LLM 偏好中解析审校模型。
 * 优先返回一个不同于 translateModel 的 chat 模型。
 * 如果无法区分翻译/审校模型，返回翻译模型本身。
 */
export function resolveReviewModel(
  preferences: SystemPreferencesService,
  translateModel: { providerId: string; modelId: string } | null,
): { providerId: string; modelId: string } | null {
  const llmState = preferences.getLlmState();

  const candidates: Array<{ providerId: string; modelId: string }> = [];
  for (const provider of llmState.providers) {
    if (!provider.enabled || !provider.isConfigured) {
      continue;
    }

    for (const model of provider.models) {
      if (!model.enabled || !model.isConfigured) {
        continue;
      }

      if (model.resolvedCapabilities.includes('chat')) {
        candidates.push({ providerId: provider.id, modelId: model.id });
      }
    }
  }

  // 优先选择非翻译模型
  if (candidates.length >= 2 && translateModel) {
    const different = candidates.find(
      (c) => c.providerId !== translateModel.providerId || c.modelId !== translateModel.modelId,
    );
    if (different) {
      return different;
    }
  }

  return candidates[0] ?? null;
}
