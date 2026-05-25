import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ai-sdk-ollama';

import type { TranslationPipelineState, ParagraphDraft, TranslationTermEntry } from '../../translation-state';
import type { SystemPreferencesService, LlmProviderConfig } from '../../system-preferences';
import { resolveTranslationModel } from '../../translation-pipeline';

/**
 * 翻译节点：调用 LLM 逐段翻译章节内容。
 *
 * 策略：
 * - 从系统偏好中解析翻译模型。
 * - 每段独立调用 LLM，附带术语表作为翻译约束。
 * - 支持暂停检测（state.pauseRequested）。
 * - 单段失败记录错误并标记 confidence=0，不阻塞整体。
 */
export async function translateNode(
  state: TranslationPipelineState,
  preferences: SystemPreferencesService,
  modelOverride?: string,
  abortSignal?: AbortSignal,
): Promise<Partial<TranslationPipelineState>> {
  const modelRoute = resolveTranslationModel(preferences, modelOverride);
  if (!modelRoute) {
    return { errorMessage: '未找到可用的翻译模型——请在设置中配置并启用一个 chat 模型。' };
  }

  const provider = getProvider(preferences, modelRoute.providerId);
  if (!provider) {
    return { errorMessage: `翻译模型提供商 ${modelRoute.providerId} 未找到。` };
  }

  const model = createLanguageModel(provider, modelRoute.modelId);
  console.log(`[translation] translateNode: provider=${provider.type} model=${modelRoute.modelId} hasApiKey=${!!(provider.apiKey && provider.apiKey.length > 8)} baseUrl=${provider.baseUrl || '(default)'}`);
  const glossary = buildGlossaryContext(state.glossary);
  const drafts: ParagraphDraft[] = [];
  const totalSegments = state.segments.length;
  console.log(`[translation] 开始翻译共 ${totalSegments} 个段落`);

  for (let i = 0; i < state.segments.length; i++) {
    const segment = state.segments[i]!;

    if (state.pauseRequested || abortSignal?.aborted) {
      console.log(`[translation] 翻译中断: 段 ${i + 1}/${totalSegments}`);
      return { draftParagraphs: drafts, pauseRequested: true };
    }

    console.log(`[translation] 段 ${i + 1}/${totalSegments} (${segment.sourceText.length} 字)...`);

    try {
      const prompt = buildTranslationPrompt(
        segment.sourceText,
        state.sourceLang,
        state.targetLang,
        glossary,
      );

      const result = await generateText({
        model,
        system: buildTranslationSystemPrompt(state.sourceLang, state.targetLang, glossary),
        prompt,
        temperature: 0.3,
        maxOutputTokens: Math.max(segment.sourceText.length * 3, 256),
        abortSignal: AbortSignal.timeout(60000),
      });

      const translatedText = result.text.trim();
      const appliedTermIds = findAppliedTerms(translatedText, state.glossary);

      console.log(`[translation] 段 ${i + 1}/${totalSegments} 完成 (${translatedText.length} 字译文)`);

      drafts.push({
        paragraphIndex: segment.paragraphIndex,
        sourceText: segment.sourceText,
        translatedText,
        confidence: translatedText.length > 0 ? 0.85 : 0,
        appliedTermIds,
        modelId: `${modelRoute.providerId}:${modelRoute.modelId}`,
      });
    } catch (error) {
      console.error(`[translation] translateNode 段 ${segment.paragraphIndex} 失败:`, error instanceof Error ? error.message : String(error));
      drafts.push({
        paragraphIndex: segment.paragraphIndex,
        sourceText: segment.sourceText,
        translatedText: null as unknown as string,
        confidence: 0,
        appliedTermIds: [],
        modelId: `${modelRoute.providerId}:${modelRoute.modelId}`,
      });
    }
  }

  return {
    draftParagraphs: drafts,
    translatorModelId: `${modelRoute.providerId}:${modelRoute.modelId}`,
  };
}

/** 构建翻译系统提示词（Agent 角色设定 + 术语约束） */
function buildTranslationSystemPrompt(
  sourceLang: string,
  targetLang: string,
  glossary: string,
): string {
  return [
    `你是一位专业的${langLabel(sourceLang)}→${langLabel(targetLang)}文学翻译专家。`,
    '',
    '核心规则：',
    `1. 只输出${langLabel(targetLang)}译文，不要附带任何解释、注释或原文`,
    '2. 保持原文段落结构、语气和文学风格',
    '3. 严格遵循术语表中的翻译，术语表优先级高于你的常识',
    '4. 人物名、地名、专有名词按术语表翻译，术语表未覆盖的合理音译',
    '5. 译文需自然流畅，符合目标语言阅读习惯',
    glossary ? `\n术语表（强制遵循）：\n${glossary}` : '',
  ].join('\n');
}

/** 构建翻译提示词 */
function buildTranslationPrompt(
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  glossary: string,
): string {
  return sourceText;
}

/** 从术语表中查找哪些术语出现在译文中 */
function findAppliedTerms(translatedText: string, glossary: TranslationTermEntry[]): string[] {
  return glossary
    .filter((term) => term.targetTerm && translatedText.includes(term.targetTerm!))
    .map((term) => term.id);
}

/** 构建术语表上下文文本 */
function buildGlossaryContext(glossary: TranslationTermEntry[]): string {
  const populated = glossary.filter((t) => t.targetTerm);
  if (populated.length === 0) {
    return '';
  }

  return populated
    .map((t) => `- ${t.sourceTerm} → ${t.targetTerm}`)
    .join('\n');
}

function langLabel(code: string): string {
  const map: Record<string, string> = {
    ja: '日文',
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    en: '英文',
    ko: '韩文',
  };
  return map[code] ?? code;
}

/** 确保 OpenAI 兼容接口的 base URL 包含 /v1 路径 */
function normalizeOpenAIBaseUrl(url: string): string {
  if (!url) {
    return 'https://api.openai.com/v1';
  }
  const trimmed = url.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return trimmed;
  }
  const normalized = `${trimmed}/v1`;
  console.log(`[translation] URL 规范化: ${url} → ${normalized}`);
  return normalized;
}

/** 从系统偏好中获取提供商配置 */
function getProvider(
  preferences: SystemPreferencesService,
  providerId: string,
): LlmProviderConfig | null {
  const state = preferences.getLlmState();
  return state.providers.find((p) => p.id === providerId) ?? null;
}

/** 创建 AI SDK 语言模型 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createLanguageModel(provider: LlmProviderConfig, overrideModelId?: string): any {
  const enabledModels = provider.models.filter((m) => m.enabled && m.modelId);
  const modelId = overrideModelId || enabledModels[0]?.modelId || 'gpt-4o';

  switch (provider.type) {
    case 'openai-compatible': {
      const url = provider.baseUrl ? provider.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
      const hasPath = new URL(url).pathname.replace(/\/+$/, '').length > 0;
      const baseURL = hasPath ? url : `${url}/v1`;
      const factory = createOpenAI({
        apiKey: provider.apiKey,
        baseURL,
        ...(provider.organization ? { organization: provider.organization } : {}),
      });
      return factory.chat(modelId);
    }

    case 'anthropic':
      return createAnthropic({
        apiKey: provider.apiKey || 'sk-ant-placeholder',
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })(modelId);

    case 'google-generative-ai':
      return createGoogleGenerativeAI({
        apiKey: provider.apiKey || 'placeholder',
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })(modelId);

    case 'ollama':
      return createOllama({
        baseURL: provider.baseUrl || 'http://localhost:11434/api',
      })(modelId);

    default:
      return createOpenAI({
        apiKey: provider.apiKey || 'sk-placeholder',
        baseURL: 'https://api.openai.com/v1',
      }).chat(modelId);
  }
}
