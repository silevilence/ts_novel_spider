import { redactSecrets } from './redact-secrets';
import { randomUUID } from 'node:crypto';
import { generateText, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ai-sdk-ollama';

import type { TranslationPipelineState, ParagraphDraft, TranslationTermEntry, TranslationBackgroundParagraph, TranslationFailureDetail } from '../../translation-state';
import type { TranslationHistoryManager } from './history-manager';
import type { LlmInteractionLogger } from './llm-logger';
import type { SystemPreferencesService, LlmProviderConfig } from '../../system-preferences';
import type { TranslationMessageFormat } from '../../../contracts/translation-message-format';
import { resolveTranslationModel } from '../../translation-pipeline';
import { buildIndexTranslatePrompt, detectIndexTranslatePromptEcho } from './index-translate-messages';
import { classifyTranslationFailure, canFallbackToSingle, TranslationFailure } from './translation-failure';
import { buildHyMt2Prompt, detectHyMt2PromptEcho, normalizeHyMt2Response } from './hy-mt2-messages';
import { batchTranslationSegments, hasTranslationGlossaryEcho, hasTranslationBackgroundEcho, selectTranslationTerms, mergeTranslationDrafts } from './translation-prompt-materials';

/** 专用翻译格式的材料边界；背景由当前单元的相邻原文和有效草稿构建。 */
interface TranslationPromptContext {
  format: Exclude<TranslationMessageFormat, 'general'>;
  sourceLang: string;
  targetLang: string;
  previousParagraphs: TranslationBackgroundParagraph[];
}

/** 备选分隔符列表（按优先级尝试拆分） */
const FALLBACK_SEPARATORS = ['\n\n---\n\n', '\n---\n', '\n\n---', '---\n\n', '---'];

/** 翻译编号前缀的正则模式——匹配 LLM 在批量/单条响应中可能附带的序号 */
export const TRANSLATION_PREFIX_PATTERN = /^\s*(?:\d+[\.\、\)]\s*|段落\d+[：:]\s*|【\d+】\s*)/;

/**
 * 原文感知的翻译编号前缀清洗。
 *
 * 仅在译文带编号前缀、原文不带同类前缀时去除前缀。
 * 若原文本身以编号前缀开头，则视为正文的一部分，保留译文前缀。
 */
export function stripTranslationNumberPrefix(sourceText: string, translatedText: string): string {
  const trimmed = translatedText.trim();
  const prefixMatch = trimmed.match(TRANSLATION_PREFIX_PATTERN);
  if (!prefixMatch) {
    return trimmed;
  }
  // 检查原文是否也以同类前缀开头——若有则说明是正文一部分，保留
  const sourceTrimmed = sourceText.trim();
  if (sourceTrimmed.match(TRANSLATION_PREFIX_PATTERN)) {
    return trimmed;
  }
  // 去掉译文前缀
  return trimmed.replace(TRANSLATION_PREFIX_PATTERN, '').trim();
}

export interface RefinedTextGenerationResponse {
  text: string;
  finishReason: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

/** Lightweight task-scoped generation entry point; optionally exposes raw output and usage for diagnostics. */
export async function generateRefinedTranslationText(
  preferences: SystemPreferencesService,
  route: { providerId: string; modelId: string; thinkingEnabled?: boolean },
  system: string,
  prompt: string,
  abortSignal?: AbortSignal,
  onResponse?: (response: RefinedTextGenerationResponse) => void,
): Promise<string> {
  const provider = getProvider(preferences, route.providerId);
  if (!provider) {
    throw new Error(`精翻模型提供商 ${route.providerId} 不可用。`);
  }

  const result = await generateText({
    model: createLanguageModel(provider, route.modelId, { thinkingEnabled: route.thinkingEnabled }),
    system,
    prompt,
    ...(abortSignal ? { abortSignal } : {}),
    ...(!route.thinkingEnabled ? { temperature: 0.2 } : {}),
    ...(route.thinkingEnabled !== undefined ? { providerOptions: refinedThinkingProviderOptions(provider, route.thinkingEnabled) as never } : {}),
  });
  onResponse?.({ text: result.text, finishReason: result.rawFinishReason, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
  return result.text.trim();
}

/** Runs a bounded, real tool-calling loop for task-scoped refined agents. */
export async function runRefinedTranslationToolAgent(
  preferences: SystemPreferencesService,
  route: { providerId: string; modelId: string; thinkingEnabled?: boolean },
  system: string,
  prompt: string,
  tools: ToolSet,
  firstToolName: string = 'read_current_translation',
  abortSignal?: AbortSignal,
): Promise<{ text: string; toolCallCount: number; toolCalls: Array<{ toolName: string; input: unknown }> }> {
  const provider = getProvider(preferences, route.providerId);
  if (!provider) throw new Error(`精翻模型提供商 ${route.providerId} 不可用。`);
  const result = await generateText({
    model: createLanguageModel(provider, route.modelId, { thinkingEnabled: route.thinkingEnabled }),
    system,
    prompt,
    tools,
    ...(abortSignal ? { abortSignal } : {}),
    stopWhen: stepCountIs(8),
    // Do not force toolChoice here. Some reasoning/Thinking-mode providers reject
    // forced tool selection altogether ("Thinking mode does not support this
    // tool_choice"), which used to make every refined-agent invocation fall back.
    // The system prompts still require the scoped read tool before the agent acts.
    prepareStep: async ({ stepNumber }) => stepNumber === 0
      ? { system: `${system}\n开始前请先调用 ${firstToolName} 读取任务物料；不要跳过此步骤。` }
      : {},
    ...(!route.thinkingEnabled ? { temperature: 0.2 } : {}),
    ...(route.thinkingEnabled !== undefined ? { providerOptions: refinedThinkingProviderOptions(provider, route.thinkingEnabled) as never } : {}),
  });
  return { text: result.text.trim(), toolCallCount: result.toolCalls.length, toolCalls: result.toolCalls.map((call) => ({ toolName: call.toolName, input: call.input })) };
}

/** 翻译节点所需的模型、上下文与请求控制选项。 */
export interface TranslateNodeOptions {
  preferences: SystemPreferencesService;
  historyManager: TranslationHistoryManager;
  paragraphsPerBatch: number;
  llmLogger?: LlmInteractionLogger;
  onBatchProgress?: (batchParagraphs: number, totalCompleted: number) => void;
  modelOverride?: string;
  abortSignal?: AbortSignal;
}

/**
 * 翻译节点：批量段落翻译 + 对话历史上下文。
 *
 * 策略：
 * - 按 paragraphsPerBatch 将段落分组，每组一次 LLM 调用。
 * - 严格按段落顺序发送，保留对话历史作为上下文参考。
 * - LLM 响应按分隔符拆分为各段落译文，段落数不匹配时回退逐段翻译。
 * - 上下文超标时自动舍弃旧历史后重试（最多 3 次）。
 * - 支持暂停检测（state.pauseRequested）。
 */
export async function translateNode(
  state: TranslationPipelineState,
  options: TranslateNodeOptions,
): Promise<Partial<TranslationPipelineState>> {
  const { preferences, historyManager, paragraphsPerBatch, onBatchProgress, modelOverride, abortSignal } = options;
  let { llmLogger } = options;
  const modelRoute = resolveTranslationModel(preferences, modelOverride);
  if (!modelRoute) {
    return { errorMessage: '未找到可用的翻译模型——请在设置中配置并启用一个 chat 模型。' };
  }

  const provider = getProvider(preferences, modelRoute.providerId);
  if (!provider) {
    return { errorMessage: `翻译模型提供商 ${modelRoute.providerId} 未找到。` };
  }

  const format = provider.models.find((m) => m.modelId === modelRoute.modelId)?.translationMessageFormat ?? 'general';
  const dedicated = format !== 'general';
  const model = createLanguageModel(provider, modelRoute.modelId, format === 'bilibili-index-translate' ? { thinkingEnabled: false, chatTemplateThinking: false } : {});
  const promptContext: TranslationPromptContext | undefined = dedicated
    ? { format, sourceLang: state.sourceLang, targetLang: state.targetLang, previousParagraphs: [] } : undefined;
  llmLogger = llmLogger?.withSecrets([provider.apiKey]).withContext({ sourceId: state.sourceId, novelId: state.novelId, chapterId: state.chapterId, unitKind: state.unitKind });
  const systemPrompt = buildTranslationSystemPrompt(state.sourceLang, state.targetLang, '');
  const totalSegments = state.segments.length;
  console.log(`[translation] 开始翻译共 ${totalSegments} 个段落，每批 ${paragraphsPerBatch} 段`);

  const drafts = state.draftParagraphs.filter((draft) => draft.translatedText.trim()
    && state.segments.some((segment) => segment.paragraphIndex === draft.paragraphIndex && segment.sourceText === draft.sourceText));
  const modelIdStr = `${modelRoute.providerId}:${modelRoute.modelId}`;

  const pendingSegments = state.segments.filter((segment) => !drafts.some((draft) => draft.paragraphIndex === segment.paragraphIndex));
  const batches = dedicated ? batchTranslationSegments(pendingSegments, paragraphsPerBatch) : chunkArray(pendingSegments, Math.max(1, paragraphsPerBatch));
  const completedDrafts = () => dedicated ? mergeTranslationDrafts(state.segments, drafts) : drafts;
  const validDrafts = () => completedDrafts().filter((draft) => draft.translatedText.trim());
  const translationFailures: TranslationFailureDetail[] = [];
  const recordSuccess = (result: ParagraphDraft[], batch: typeof state.segments, options: { fromFallback?: boolean } = {}) => {
    const before = validDrafts().length;
    drafts.push(...result);
    if (!promptContext) historyManager.addEntry(options.fromFallback ? batch[0]!.sourceText : buildBatchPrompt(batch), result.map((draft) => draft.translatedText).join('\n---\n'));
    const completed = validDrafts().length;
    onBatchProgress?.(completed - before, completed);
  };
  const recordFailure = (batch: typeof state.segments, error: unknown) => {
    const failure = classifyTranslationFailure(error, { cancelled: abortSignal?.aborted === true });
    const message = `[${failure.category}] 段落 ${batch.map((s) => s.paragraphIndex).join(', ')}：${failure.message}`;
    translationFailures.push({ category: failure.category, paragraphIndices: batch.map((s) => s.paragraphIndex), message: failure.message });
    console.error(`[translation] 最终失败 ${message}`);
    // 留下空草稿仅供状态诊断；错误路由阻止任何失败单元落库。
    drafts.push(...batch.map((segment) => ({ ...segment, translatedText: '', confidence: 0, appliedTermIds: [], modelId: modelIdStr })));
  };

  const batchOptions: TranslationBatchOptions = {
    model, systemPrompt, glossary: state.glossary, modelIdStr, historyManager,
    llmLogger, context: promptContext, abortSignal, secrets: [provider.apiKey],
  };
  const updateBackground = (paragraphIndex: number) => {
    if (!promptContext) return;
    const valid = validDrafts();
    promptContext.previousParagraphs = state.segments.filter((segment) => segment.paragraphIndex < paragraphIndex).slice(-2)
      .map((segment) => ({ sourceText: segment.sourceText, translatedText: valid.find((draft) => draft.paragraphIndex === segment.paragraphIndex)?.translatedText ?? '' }));
  };
  for (const batch of batches) {
    if (state.pauseRequested || abortSignal?.aborted) return { draftParagraphs: completedDrafts(), pauseRequested: true };
    updateBackground(batch[0]!.paragraphIndex);
    try {
      recordSuccess(await translateBatch(batch, batchOptions), batch);
    } catch (error) {
      if (abortSignal?.aborted) return { draftParagraphs: completedDrafts(), pauseRequested: true };
      const failure = classifyTranslationFailure(error);
      // 只有拆分粒度能够修复的失败进入回退；网络/空输出耗尽后直接失败。
      if (batch.length === 1 || !canFallbackToSingle(failure.category)) {
        recordFailure(batch, failure);
        continue;
      }
      for (const segment of batch) {
        if (state.pauseRequested || abortSignal?.aborted) return { draftParagraphs: completedDrafts(), pauseRequested: true };
        try {
          // fallback 日志由下方请求层在真正发起单段请求前写入。
          updateBackground(segment.paragraphIndex);
          recordSuccess(await translateBatch([segment], batchOptions, failure), [segment], { fromFallback: true });
        } catch (singleError) {
          if (abortSignal?.aborted) return { draftParagraphs: completedDrafts(), pauseRequested: true };
          recordFailure([segment], singleError);
        }
      }
    }
  }
  return {
    draftParagraphs: completedDrafts(), translatorModelId: modelIdStr,
    errorMessage: translationFailures.length ? translationFailures.map((failure) => `[${failure.category}] 段落 ${failure.paragraphIndices.join(', ')}：${failure.message}`).join('; ') : null,
  };
}

/** 一轮翻译请求所共享的依赖与输出安全策略。 */
interface TranslationBatchOptions {
  model: LanguageModel;
  systemPrompt: string;
  glossary: TranslationTermEntry[];
  modelIdStr: string;
  historyManager: TranslationHistoryManager;
  llmLogger: LlmInteractionLogger | undefined;
  context: TranslationPromptContext | undefined;
  abortSignal: AbortSignal | undefined;
  secrets: readonly string[];
}

/** 每次请求最多四次尝试；格式不匹配立即交由调用方决定是否拆分。 */
async function translateBatch(
  batch: Array<{ paragraphIndex: number; sourceText: string; id: string }>,
  options: TranslationBatchOptions,
  fallbackFrom?: TranslationFailure,
): Promise<ParagraphDraft[]> {
  const { model, systemPrompt, glossary, modelIdStr, historyManager, llmLogger, context, abortSignal, secrets } = options;
  let includeBackground = true;
  let includeGlossary = true;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    abortSignal?.throwIfAborted();
    const terms = includeGlossary ? glossary : [];
    const background = includeBackground ? context?.previousParagraphs ?? [] : [];
    const prompt = context?.format === 'bilibili-index-translate'
      ? buildIndexTranslatePrompt(batch, { sourceLang: context.sourceLang, targetLang: context.targetLang, glossary: terms, previousParagraphs: background })
      : context ? buildHyMt2Prompt(batch, context.targetLang, terms, background)
      : fallbackFrom ? batch[0]!.sourceText : buildBatchPrompt(batch);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...(!context && !fallbackFrom ? historyManager.buildHistoryMessages() : []), { role: 'user', content: prompt },
    ];
    const requestSystemPrompt = context ? '' : appendTranslationGlossary(systemPrompt, selectTranslationTerms(batch, glossary));
    const phase = batch.length > 1 ? (attempt === 1 ? 'batch' : 'batch_retry') : (attempt === 1 ? 'single' : 'single_retry');
    const logParams = {
      provider: modelIdStr.slice(0, modelIdStr.indexOf(':')), model: modelIdStr.slice(modelIdStr.indexOf(':') + 1),
      systemPrompt: requestSystemPrompt, userPrompt: prompt, messages, callId: randomUUID(),
      attempt, maxAttempts, paragraphIndices: batch.map((s) => s.paragraphIndex),
      // 书库翻译的请求策略：仅 Index 固定为 0，通用与 HY-MT2 沿用 0.3。
      temperature: context?.format === 'bilibili-index-translate' ? 0 : 0.3,
      maxOutputTokens: Math.max(batch.reduce((sum, s) => sum + s.sourceText.length, 0) * 3, 512),
    };
    if (fallbackFrom && attempt === 1) {
      console.log(`[translation] 回退逐段翻译：段落 ${batch[0]!.paragraphIndex}`);
      llmLogger?.logCall({ ...logParams, event: 'fallback', phase: 'fallback', errorCategory: fallbackFrom.category, response: '', durationMs: 0 });
    }
    console.log(`[translation] ${phase} 段落 ${logParams.paragraphIndices.join(',')} 尝试 ${attempt}/${maxAttempts}`);
    const startedAt = Date.now();
    let responseText = '';
    let failure: TranslationFailure | undefined;
    let terminal = false;
    let finishReason: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    llmLogger?.logCall({ ...logParams, event: 'request', phase, response: '', durationMs: 0 });
    try {
      const timeout = AbortSignal.timeout(120000);
      const result = await generateText({
        model, ...(context ? {} : { system: requestSystemPrompt }), messages,
        temperature: logParams.temperature, maxOutputTokens: logParams.maxOutputTokens, maxRetries: 0,
        abortSignal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout,
      });
      responseText = result.text;
      finishReason = result.rawFinishReason;
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      logDeepSeekCache(result.providerMetadata, result.response.body);
      const source = batch.map((s) => s.sourceText).join('\n');
      // 日志保留原始响应；仅解析副本清理模型附带的源文区块包装。
      const translationText = context?.format === 'hy-mt2' ? normalizeHyMt2Response(responseText, source) : responseText.trim();
      if (!translationText) throw new TranslationFailure('empty_response', '模型返回空响应（含纯空白或仅区块标题）。');
      if (context) {
        const echo = context.format === 'hy-mt2' ? detectHyMt2PromptEcho(translationText, source) : detectIndexTranslatePromptEcho(translationText, source);
        echo.glossary ||= hasTranslationGlossaryEcho(translationText, source, glossary);
        echo.background ||= hasTranslationBackgroundEcho(translationText, batch, context.previousParagraphs);
        const removed: string[] = [];
        if (echo.glossary) { includeGlossary = false; removed.push('术语'); }
        if (echo.background) { includeBackground = false; removed.push('背景'); }
        if (echo.glossary || echo.background || echo.template) {
          throw new TranslationFailure('prompt_echo', removed.length
            ? `响应回显${removed.join('及')}；本批后续重试禁用${removed.join('及')}参考。`
            : '响应回显提示词区块；保留术语和背景材料进行有限重试。');
        }
      }
      const resultDrafts = splitBatchResponse(translationText, batch, glossary, modelIdStr, context?.format);
      if (context && resultDrafts.some((draft) => hasTranslationBackgroundEcho(draft.translatedText, [draft], context.previousParagraphs))) {
        includeBackground = false;
        throw new TranslationFailure('prompt_echo', '段落回显背景；本批后续重试禁用背景参考。');
      }
      return resultDrafts;
    } catch (error) {
      failure = classifyTranslationFailure(error, { cancelled: abortSignal?.aborted === true });
      failure = new TranslationFailure(failure.category, redactSecrets(failure.message, secrets));
      terminal = attempt === maxAttempts || failure.category === 'format_mismatch' || abortSignal?.aborted === true;
      if (terminal) throw failure;
      if (!context && isContextOverflowError(failure.message) && historyManager.size > 0) {
        historyManager.discardOldest(Math.max(2, Math.ceil(historyManager.size / 2)));
      }
      console.warn(`[translation] ${phase} 失败 [${failure.category}]，准备第 ${attempt + 1}/${maxAttempts} 次尝试：${failure.message}`);
    } finally {
      const responseLog = {
        ...logParams, phase, event: 'response', response: responseText,
        durationMs: Date.now() - startedAt, finishReason, inputTokens, outputTokens,
        ...(failure ? { error: failure.message, errorCategory: failure.category } : {}),
      } satisfies Parameters<LlmInteractionLogger['logCall']>[0];
      llmLogger?.logCall(responseLog);
      if (failure && terminal && !(batch.length > 1 && canFallbackToSingle(failure.category) && !abortSignal?.aborted)) {
        llmLogger?.logCall({ ...responseLog, event: 'failure', phase: 'final_failure' });
      }
    }
  }
  throw new Error('翻译尝试次数耗尽');
}

/** 保留既有缓存命中诊断；只有提供商确实返回用量时才打印。 */
function logDeepSeekCache(metadata: unknown, body: unknown): void {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const usage = record(record(body).usage);
  const native = Object.values(record(metadata)).map(record).find((value) => typeof value.promptCacheHitTokens === 'number');
  const hit = native?.promptCacheHitTokens ?? usage.prompt_cache_hit_tokens;
  const miss = native?.promptCacheMissTokens ?? usage.prompt_cache_miss_tokens;
  if (typeof hit === 'number' || typeof miss === 'number') {
    const total = typeof hit === 'number' && typeof miss === 'number' ? hit + miss : undefined;
    const rate = total !== undefined && total > 0 && typeof hit === 'number' ? Math.round(hit / total * 100) : undefined;
    console.log(`[translation] DS Cache: hit=${hit ?? 'unavailable'} miss=${miss ?? 'unavailable'} total=${total ?? 'unavailable'} rate=${rate !== undefined ? `${rate}%` : 'unavailable'}`);
  }
}

/**
 * 将 LLM 响应按分隔符拆分为各段落译文。
 * 尝试多种分隔符变体，支持带/不带编号前缀的响应。
 * 段落数不匹配时抛出错误以触发回退。
 * @param format Index 模板明确要求保留编号；HY-MT2 也接受可逐段对齐的纯文本响应。
 */
function splitBatchResponse(
  responseText: string,
  batch: Array<{ paragraphIndex: number; sourceText: string }>,
  glossary: TranslationTermEntry[],
  modelIdStr: string,
  format: TranslationMessageFormat = 'general',
): ParagraphDraft[] {
  let parts: string[] = [];
  let usedSeparator = '';
  const numbers = [...responseText.matchAll(/【(\d+)】/g)];
  if (batch.length === 1 && numbers.length > 1 && !/【\d+】/.test(batch[0]!.sourceText)) {
    throw new TranslationFailure('format_mismatch', '单段响应包含多个段落编号。');
  }
  if (batch.length > 1 && (format === 'bilibili-index-translate' || numbers.length)) {
    if (numbers.length !== batch.length || numbers.some((match, i) => Number(match[1]) !== i + 1)
      || responseText.slice(0, numbers[0]?.index ?? 0).trim()) {
      throw new TranslationFailure('format_mismatch', '非空译文的段落编号缺失、重复或顺序错误。');
    }
    parts = numbers.map((match, i) => responseText.slice(match.index! + match[0].length, numbers[i + 1]?.index).replace(/\s*---\s*$/, '').trim());
    usedSeparator = 'numbered';
  }

  // HY-MT2 官方模板未要求编号。仅在原段均为单行且译文段数一致时接受空行分段；
  // 表格、多行段落或任何残缺编号仍走严格校验/回退，避免猜测段落归属。
  if (!parts.length && format === 'hy-mt2' && batch.length > 1 && batch.every((segment) => !/[\r\n]/.test(segment.sourceText))) {
    const paragraphs = responseText.split(/\r?\n\s*\r?\n/);
    if (paragraphs.length === batch.length) { parts = paragraphs; usedSeparator = 'blank-line'; }
  }

  // 依次尝试各种分隔符
  for (const sep of parts.length ? [] : FALLBACK_SEPARATORS) {
    const candidate = responseText.split(sep);
    if (candidate.length === batch.length) {
      parts = candidate;
      usedSeparator = sep;
      break;
    }
  }

  // 如果所有分隔符都不匹配段落数，尝试基于编号拆分
  if (parts.length !== batch.length) {
    const numberedSplit = splitByNumberedPrefix(responseText);
    if (numberedSplit.length === batch.length) {
      parts = numberedSplit;
      usedSeparator = 'numbered';
    }
  }

  // 清理各部分：去除编号前缀（原文感知）和首尾空白
  const cleaned = parts.map((p, i) => {
    const sourceText = batch[i]?.sourceText ?? '';
    return usedSeparator === 'numbered' ? p.trim() : stripTranslationNumberPrefix(sourceText, p);
  }).filter((p) => p.length > 0);

  if (cleaned.length !== batch.length) {
    throw new TranslationFailure('format_mismatch',
      `非空译文段落数不匹配：期望 ${batch.length} 段，LLM 返回 ${cleaned.length} 段 ` +
      `(分隔符 "${usedSeparator || '无'}" 拆出 ${parts.length} 部分)。`,
    );
  }

  const drafts: ParagraphDraft[] = [];
  for (let i = 0; i < batch.length; i++) {
    const segment = batch[i]!;
    const translatedText = cleaned[i]!;
    const appliedTermIds = findAppliedTerms(translatedText, glossary);

    drafts.push({
      paragraphIndex: segment.paragraphIndex,
      sourceText: segment.sourceText,
      translatedText,
      confidence: translatedText.length > 0 ? 0.85 : 0,
      appliedTermIds,
      modelId: modelIdStr,
    });
  }

  return drafts;
}

/** 按编号前缀（如 "1." "2、" "3）"）拆分文本 */
function splitByNumberedPrefix(text: string): string[] {
  // 按 "数字+标点+空白" 的模式拆分，保留段落内容
  const parts = text.split(/\n(?=\d+[\.\、\)]\s*)/);
  if (parts.length >= 2) return parts;
  // 尝试 "【数字】" 模式
  return text.split(/(?=【\d+】)/);
}

/** 构建批次翻译 prompt：仅包含段落内容，格式极简以最大化 KV Cache 命中 */
function buildBatchPrompt(
  batch: Array<{ sourceText: string }>,
): string {
  const numberedParts: string[] = [];
  for (let i = 0; i < batch.length; i++) {
    numberedParts.push(`【${i + 1}】${batch[i]!.sourceText}`);
  }
  return numberedParts.join('\n\n---\n\n');
}

/** 构建翻译系统提示词（全部固定指令 + 术语表，供 KV Cache 100% 复用） */
function buildTranslationSystemPrompt(
  sourceLang: string,
  targetLang: string,
  glossary: string,
): string {
  const srcLabel = langLabel(sourceLang);
  const tgtLabel = langLabel(targetLang);
  const parts = [
    `你是一位资深${srcLabel}→${tgtLabel}文学翻译专家，精通两种语言的文学表达与文化背景。`,
    '',
    '【核心翻译规则】',
    `1. 只输出${tgtLabel}译文，严禁附带任何解释、注释、分析或原文`,
    '2. 严格保持原文的段落结构、叙述语气和文学风格',
    '3. 人物名、地名、专有名词按术语表翻译，术语表未覆盖的合理音译',
    `4. 译文需自然流畅，符合${tgtLabel}母语者的阅读习惯`,
    '5. 对话和内心独白需保留口语感和角色性格',
    '6. 修辞手法（比喻、排比等）应在目标语言中还原等效效果',
    '',
    '【段落输出格式】',
    '每段译文用单独一行 "---" 分隔，段落内不要出现此分隔符',
    '每段译文前保留【N】编号以帮助对齐',
    '严格按照原文段落顺序输出，不要合并或拆分段落',
  ];
  if (glossary) {
    parts.push('', '【术语表（强制遵循）】', glossary);
  }
  return parts.join('\n');
}

/** 每次请求只添加当前原文命中的术语；通用模型保留原有提示词结构。 */
function appendTranslationGlossary(systemPrompt: string, glossary: TranslationTermEntry[]): string {
  const context = buildGlossaryContext(glossary);
  return context ? `${systemPrompt}\n\n【术语表（强制遵循）】\n${context}` : systemPrompt;
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

/** 检测错误是否为上下文溢出 */
function isContextOverflowError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  const overflowPatterns = [
    'context_length_exceeded',
    'context window',
    'maximum context length',
    'reduce the length',
    'too many tokens',
    'token limit',
    'max_tokens',
    'input length',
    'context length',
    '请求内容超长',
    '超出上下文',
    '超出最大长度',
    'no_kv_slot',
  ];
  return overflowPatterns.some((pattern) => lower.includes(pattern));
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

/** 数组按大小分块 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** 从系统偏好中获取提供商配置 */
function getProvider(
  preferences: SystemPreferencesService,
  providerId: string,
): LlmProviderConfig | null {
  const state = preferences.getLlmState();
  return state.providers.find((p) => p.id === providerId) ?? null;
}

/** 创建 AI SDK 语言模型。
 * @param options thinkingEnabled 使用提供商原生开关；chatTemplateThinking 控制 OpenAI 兼容服务的模板参数。
 */
function createLanguageModel(provider: LlmProviderConfig, overrideModelId?: string, options: { thinkingEnabled?: boolean | undefined; chatTemplateThinking?: boolean } = {}): LanguageModel {
  const { thinkingEnabled, chatTemplateThinking } = options;
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
        // Index 官方 OpenAI 兼容客户端的非思考参数，仅用于此格式。
        ...(chatTemplateThinking !== undefined ? { fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          if (typeof init?.body !== 'string') return fetch(input, init);
          const body = JSON.parse(init.body) as Record<string, unknown>;
          return fetch(input, { ...init, body: JSON.stringify({ ...body, chat_template_kwargs: { enable_thinking: chatTemplateThinking } }) });
        } } : {}),
        ...(provider.organization ? { organization: provider.organization } : {}),
      });
       return factory.chat(modelId);
    }

    case 'anthropic':
      return createAnthropic({
        apiKey: provider.apiKey || 'sk-ant-placeholder',
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
        // The SDK omits thinking.type=disabled; preserve an explicit off request.
        ...(thinkingEnabled === false ? { fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          if (typeof init?.body !== 'string') return fetch(input, init);
          const body = JSON.parse(init.body) as Record<string, unknown>;
          return fetch(input, { ...init, body: JSON.stringify({ ...body, thinking: { type: 'disabled' } }) });
        } } : {}),
      })(modelId);

    case 'google-generative-ai':
      return createGoogleGenerativeAI({
        apiKey: provider.apiKey || 'placeholder',
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })(modelId);

    case 'ollama':
      return createOllama({
        baseURL: provider.baseUrl || 'http://localhost:11434/api',
      })(modelId, thinkingEnabled !== undefined ? { think: thinkingEnabled } : {});

    default:
      return createOpenAI({
        apiKey: provider.apiKey || 'sk-placeholder',
        baseURL: 'https://api.openai.com/v1',
      }).chat(modelId);
  }
}

/** Explicit native thinking controls; omitted switches retain provider defaults. */
function refinedThinkingProviderOptions(provider: LlmProviderConfig, enabled: boolean): Record<string, Record<string, unknown>> {
  switch (provider.type) {
    case 'openai-compatible': return { openai: { reasoningEffort: enabled ? 'medium' : 'none' } };
    case 'anthropic': return { anthropic: { thinking: enabled ? { type: 'enabled', budgetTokens: 2048 } : { type: 'disabled' } } };
    case 'google-generative-ai': return { google: { thinkingConfig: { thinkingBudget: enabled ? 2048 : 0, includeThoughts: false } } };
    // ai-sdk-ollama reads `think` from model settings, not providerOptions.
    case 'ollama': return {};
  }
}
