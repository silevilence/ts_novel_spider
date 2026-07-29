import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ai-sdk-ollama';

import type { TranslationPipelineState, ParagraphDraft, TranslationTermEntry } from '../../translation-state';
import type { TranslationHistoryManager } from './history-manager';
import type { LlmInteractionLogger } from './llm-logger';
import type { SystemPreferencesService, LlmProviderConfig } from '../../system-preferences';
import { resolveTranslationModel } from '../../translation-pipeline';

/** 批量段落翻译的分隔符：LLM 必须保持此分隔符以支持本地拆分 */
const BATCH_SEPARATOR = '\n\n---\n\n';

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

/** Lightweight task-scoped generation entry point used by the refined workspace. */
export async function generateRefinedTranslationText(
  preferences: SystemPreferencesService,
  route: { providerId: string; modelId: string },
  system: string,
  prompt: string,
): Promise<string> {
  const provider = getProvider(preferences, route.providerId);
  if (!provider) {
    throw new Error(`精翻模型提供商 ${route.providerId} 不可用。`);
  }

  const result = await generateText({
    model: createLanguageModel(provider, route.modelId),
    system,
    prompt,
    temperature: 0.2,
  });
  return result.text.trim();
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
  preferences: SystemPreferencesService,
  historyManager: TranslationHistoryManager,
  paragraphsPerBatch: number,
  llmLogger?: LlmInteractionLogger,
  onBatchProgress?: (batchParagraphs: number, totalCompleted: number) => void,
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
  console.log(`[translation] translateNode: provider=${provider.type} model=${modelRoute.modelId} paragraphsPerBatch=${paragraphsPerBatch} ${historyManager.summary()}`);

  const glossary = buildGlossaryContext(state.glossary);
  const systemPrompt = buildTranslationSystemPrompt(state.sourceLang, state.targetLang, glossary);
  const totalSegments = state.segments.length;
  console.log(`[translation] 开始翻译共 ${totalSegments} 个段落，每批 ${paragraphsPerBatch} 段`);

  const drafts: ParagraphDraft[] = [];
  const modelIdStr = `${modelRoute.providerId}:${modelRoute.modelId}`;

  // 按 paragraphsPerBatch 分组段落
  const batches = chunkArray(state.segments, paragraphsPerBatch);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!;

    if (state.pauseRequested || abortSignal?.aborted) {
      console.log(`[translation] 翻译中断: 批 ${batchIdx + 1}/${batches.length}`);
      return { draftParagraphs: drafts, pauseRequested: true };
    }

    const batchStartIdx = batchIdx * paragraphsPerBatch + 1;
    const batchEndIdx = batchStartIdx + batch.length - 1;
    console.log(`[translation] 批 ${batchIdx + 1}/${batches.length} (段 ${batchStartIdx}-${batchEndIdx}, ${batch.length} 段)...`);

    try {
      const batchDrafts = await translateBatch(
        batch,
        model,
        systemPrompt,
        state.glossary,
        modelIdStr,
        historyManager,
        llmLogger,
      );
      drafts.push(...batchDrafts);

      // 仅当本批所有段落都有有效译文时才追加到对话历史
      // 历史以 EXACT 原始格式存储，保证 KV Cache 前缀匹配
      const allValid = batchDrafts.every(
        (d) => d.translatedText && d.translatedText.length > 0,
      );
      if (allValid) {
        const batchPrompt = buildBatchPrompt(batch);
        const batchResponse = batchDrafts.map((d) => d.translatedText).join('\n---\n');
        historyManager.addEntry(batchPrompt, batchResponse);
      }

      // 通知外部批次完成（用于实时进度条）
      onBatchProgress?.(batch.length, drafts.length);

      console.log(`[translation] 批 ${batchIdx + 1}/${batches.length} 完成 (${batchDrafts.length} 段译文${allValid ? ', 已入历史' : ''})`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[translation] 批 ${batchIdx + 1}/${batches.length} 整体失败:`, errMsg);

      // 批量失败时回退到逐段单独翻译（即时执行，保证顺序）
      console.log(`[translation] 回退逐段翻译 ${batch.length} 段...`);
      for (let si = 0; si < batch.length; si++) {
        const segment = batch[si]!;

        // 回退路径也检查暂停
        if (state.pauseRequested || abortSignal?.aborted) {
          console.log(`[translation] 回退中翻译中断: 段索引 ${segment.paragraphIndex}`);
          return { draftParagraphs: drafts, pauseRequested: true };
        }

        console.log(`[translation]   回退段 ${si + 1}/${batch.length} (段索引 ${segment.paragraphIndex}, ${segment.sourceText.length} 字)...`);
        try {
          const singleDraft = await translateSingleSegment(
            segment,
            model,
            systemPrompt,
            state.glossary,
            modelIdStr,
            llmLogger,
          );
          drafts.push(singleDraft);
          // 逐段成功时也追加到历史，保持上下文连贯
          if (singleDraft.translatedText && singleDraft.translatedText.length > 0) {
            historyManager.addEntry(segment.sourceText, singleDraft.translatedText);
          }
          // 通知进度（回退段也算完成）
          onBatchProgress?.(1, drafts.length);
        } catch (singleError) {
          const singleMsg = singleError instanceof Error ? singleError.message : String(singleError);
          console.error(`[translation] 段 ${segment.paragraphIndex} 回退也失败:`, singleMsg);
          drafts.push({
            paragraphIndex: segment.paragraphIndex,
            sourceText: segment.sourceText,
            translatedText: '',
            confidence: 0,
            appliedTermIds: [],
            modelId: modelIdStr,
          });
        }
      }
    }
  }

  console.log(`[translation] 翻译全部完成: ${drafts.length} 段译文, ${historyManager.summary()}`);
  return {
    draftParagraphs: drafts,
    translatorModelId: modelIdStr,
  };
}

/**
 * 翻译一批段落（一次 LLM 调用）。
 * 失败时先重试 3 次（温度递进），仍失败再回退逐段翻译。
 * 遇到上下文溢出错误时自动裁剪历史后重试。
 */
async function translateBatch(
  batch: Array<{ paragraphIndex: number; sourceText: string; id: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  systemPrompt: string,
  glossary: TranslationTermEntry[],
  modelIdStr: string,
  historyManager: TranslationHistoryManager,
  llmLogger?: LlmInteractionLogger,
): Promise<ParagraphDraft[]> {
  let lastError: Error | null = null;
  const maxRetries = 3;
  // 温度递进：0.3 → 0.45 → 0.6 → 0.75（每次提高不稳定性以尝试不同输出）
  const retryTemperatures = [0.3, 0.45, 0.6, 0.75];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const temperature = retryTemperatures[attempt] ?? 0.3;
    try {
      const batchPrompt = buildBatchPrompt(batch);
      const historyMessages = historyManager.buildHistoryMessages();

      console.log(`[translation] 调用 LLM (尝试 ${attempt + 1}/${maxRetries + 1}, ${batch.length} 段, ${historyMessages.length} 条历史, temp=${temperature})`);

      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...historyMessages,
        { role: 'user', content: batchPrompt },
      ];

      const callStart = Date.now();
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        temperature,
        maxOutputTokens: Math.max(batch.reduce((sum, s) => sum + s.sourceText.length, 0) * 3, 512),
        abortSignal: AbortSignal.timeout(120000),
      });
      const callDuration = Date.now() - callStart;

      // 打印 DeepSeek 缓存命中信息
      // @ai-sdk/deepseek 会放在 providerMetadata.deepseek 中；
      // 用 createOpenAI 时字段在原始响应的 response.body.usage 中
      try {
        const raw = result as unknown as Record<string, unknown>;
        const providerMeta = raw.providerMetadata as Record<string, Record<string, number>> | undefined;
        let hit: number | undefined;
        let miss: number | undefined;

        // 路径 1: providerMetadata.deepseek / providerMetadata.<name>
        if (providerMeta) {
          for (const key of Object.keys(providerMeta)) {
            const val = providerMeta[key];
            if (val && typeof val.promptCacheHitTokens === 'number') {
              hit = val.promptCacheHitTokens;
              miss = val.promptCacheMissTokens as number | undefined;
              break;
            }
          }
        }

        // 路径 2: response.body.usage.prompt_cache_hit_tokens（原始 HTTP 响应）
        if (typeof hit !== 'number') {
          const resp = raw.response as Record<string, unknown> | undefined;
          const body = resp?.body as Record<string, unknown> | undefined;
          const usage = body?.usage as Record<string, number> | undefined;
          if (usage) {
            hit = usage.prompt_cache_hit_tokens;
            miss = usage.prompt_cache_miss_tokens;
          }
        }

        if (typeof hit === 'number' || typeof miss === 'number') {
          const total = (hit ?? 0) + (miss ?? 0);
          const rate = total > 0 ? Math.round(((hit ?? 0) / total) * 100) : 0;
          console.log(`[translation] DS Cache: hit=${hit ?? '?'} miss=${miss ?? '?'} total=${total} rate=${rate}%`);
        }
      } catch { /* ignore */ }

      const responseText = result.text.trim();

      llmLogger?.logCall({
        provider: modelIdStr.split(':')[0] ?? 'unknown',
        model: modelIdStr.split(':')[1] ?? modelIdStr,
        systemPrompt,
        userPrompt: batchPrompt,
        response: responseText,
        durationMs: callDuration,
      });

      return splitBatchResponse(responseText, batch, glossary, modelIdStr);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errMsg = lastError.message;

      // 检测是否是上下文超标错误
      if (isContextOverflowError(errMsg) && historyManager.size > 0) {
        const discardCount = Math.max(2, Math.ceil(historyManager.size / 2));
        console.warn(`[translation] 上下文超标，舍弃 ${discardCount} 条旧历史后重试 (${historyManager.size} → ${Math.max(0, historyManager.size - discardCount)})`);
        historyManager.discardOldest(discardCount);
        continue;
      }

      // 达到最大重试次数，抛出以触发回退
      if (attempt >= maxRetries) {
        console.warn(`[translation] 批次翻译 ${maxRetries + 1} 次尝试均失败，回退逐段翻译: ${errMsg}`);
        throw lastError;
      }
      console.warn(`[translation] 翻译失败，第 ${attempt + 1} 次重试 (temp=${temperature}→${retryTemperatures[attempt + 1]}): ${errMsg}`);
    }
  }

  throw lastError ?? new Error('翻译批次失败，已达最大重试次数');
}

/**
 * 逐段单独翻译（回退策略）。
 */
async function translateSingleSegment(
  segment: { paragraphIndex: number; sourceText: string; id: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  systemPrompt: string,
  glossary: TranslationTermEntry[],
  modelIdStr: string,
  llmLogger?: LlmInteractionLogger,
): Promise<ParagraphDraft> {
  const callStart = Date.now();
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [
      { role: 'user', content: segment.sourceText },
    ],
    temperature: 0.3,
    maxOutputTokens: Math.max(segment.sourceText.length * 3, 256),
    abortSignal: AbortSignal.timeout(60000),
  });
  const callDuration = Date.now() - callStart;

  let translatedText = result.text.trim();
  translatedText = stripTranslationNumberPrefix(segment.sourceText, translatedText);

  llmLogger?.logCall({
    provider: modelIdStr.split(':')[0] ?? 'unknown',
    model: modelIdStr.split(':')[1] ?? modelIdStr,
    systemPrompt,
    userPrompt: segment.sourceText,
    response: translatedText,
    durationMs: callDuration,
  });

  const appliedTermIds = findAppliedTerms(translatedText, glossary);

  return {
    paragraphIndex: segment.paragraphIndex,
    sourceText: segment.sourceText,
    translatedText,
    confidence: translatedText.length > 0 ? 0.85 : 0,
    appliedTermIds,
    modelId: modelIdStr,
  };
}

/**
 * 将 LLM 响应按分隔符拆分为各段落译文。
 * 尝试多种分隔符变体，支持带/不带编号前缀的响应。
 * 段落数不匹配时抛出错误以触发回退。
 */
function splitBatchResponse(
  responseText: string,
  batch: Array<{ paragraphIndex: number; sourceText: string }>,
  glossary: TranslationTermEntry[],
  modelIdStr: string,
): ParagraphDraft[] {
  let parts: string[] = [];
  let usedSeparator = '';

  // 依次尝试各种分隔符
  for (const sep of FALLBACK_SEPARATORS) {
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
    return stripTranslationNumberPrefix(sourceText, p);
  }).filter((p) => p.length > 0);

  if (cleaned.length !== batch.length) {
    throw new Error(
      `译文段落数不匹配：期望 ${batch.length} 段，LLM 返回 ${cleaned.length} 段 ` +
      `(分隔符 "${usedSeparator || '无'}" 拆出 ${parts.length} 部分)。将回退逐段翻译。`,
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
