import { wrapLanguageModel } from 'ai';
import type { SystemPreferencesService } from './system-preferences';

type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]['model'];
export type ContextCallOptions = Parameters<LanguageModelV3['doGenerate']>[0];

// Provider tokenizers are not interchangeable. UTF-8 bytes are a conservative
// text-token estimate; reserve additional room for chat templates and framing.
const PROTOCOL_RESERVE = 256;

export class ContextBudgetExceededError extends Error {
  constructor(readonly limit: number, readonly required: number) {
    super(`模型上下文上限 ${limit} Token 不足：输入、协议与输出预算约需 ${required} Token。请增大上限或缩小不可拆分的材料。`);
    this.name = 'ContextBudgetExceededError';
  }
}

/** Conservative, Unicode-aware estimate shared by every model caller. */
export function estimateContextTokens(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Non-generative models have no output-token reserve, but their full inputs still need a bound. */
export function assertModelInputBudget(limit: number, input: unknown): void {
  const required = PROTOCOL_RESERVE + estimateContextTokens(JSON.stringify(input));
  if (limit > 0 && required > limit) throw new ContextBudgetExceededError(limit, required);
}

export function modelInputFits(limit: number, input: unknown): boolean {
  try { assertModelInputBudget(limit, input); return true; }
  catch (error) { if (error instanceof ContextBudgetExceededError) return false; throw error; }
}

/** Resolve the actual model, including per-task overrides. Zero keeps legacy unlimited behavior. */
export function modelContextLimit(preferences: SystemPreferencesService, route: { providerId: string; modelId: string }): number {
  return preferences.getLlmState().providers.find((provider) => provider.id === route.providerId)
    ?.models.find((model) => model.modelId === route.modelId)?.contextWindowTokens ?? 0;
}

/** Output is reserved before fitting input, never silently reduced to make an oversized input fit. */
export function contextOutputReserve(limit: number, requested?: number): number {
  return requested ?? (limit > 0 ? Math.max(1, Math.min(4096, Math.floor(limit / 4))) : 4096);
}

/** Includes all serialized messages, tool schemas/results and structured-output schemas. */
export function requestContextTokens(params: { prompt: ContextCallOptions['prompt']; tools?: ContextCallOptions['tools']; responseFormat?: ContextCallOptions['responseFormat'] }): number {
  const { prompt, tools, responseFormat } = params;
  return PROTOCOL_RESERVE + estimateContextTokens(JSON.stringify({ prompt, tools, responseFormat }));
}

/** Removes complete old turns only; the current user turn and its tool chain stay intact. */
export function fitContextRequest(params: ContextCallOptions, limit: number): ContextCallOptions {
  if (!(limit > 0)) return params;
  const maxOutputTokens = contextOutputReserve(limit, params.maxOutputTokens);
  const prompt = [...params.prompt];
  const required = () => requestContextTokens({ prompt, tools: params.tools, responseFormat: params.responseFormat }) + maxOutputTokens;
  while (required() > limit) {
    const users = prompt.flatMap((message, index) => message.role === 'user' ? [index] : []);
    if (users.length < 2) throw new ContextBudgetExceededError(limit, required());
    // Keep system instructions even if interleaved with the old conversation.
    prompt.splice(users[0]!, users[1]! - users[0]!, ...prompt.slice(users[0], users[1]).filter((message) => message.role === 'system'));
  }
  // Anthropic's SDK adds thinking.budgetTokens to maxOutputTokens on the wire.
  // Treat our output reserve as the total, including that hidden addition.
  const thinking = params.providerOptions?.anthropic?.thinking;
  const thinkingBudget = thinking && typeof thinking === 'object' && !Array.isArray(thinking) && thinking.type === 'enabled'
    ? typeof thinking.budgetTokens === 'number' ? thinking.budgetTokens : 1024 : 0;
  if (thinkingBudget >= maxOutputTokens) throw new ContextBudgetExceededError(limit, required() + thinkingBudget);
  return { ...params, prompt, maxOutputTokens: maxOutputTokens - thinkingBudget };
}

/** Last guard before each SDK request, including every tool-agent step and retry. */
export function withContextBudget(model: LanguageModelV3, limit = 0): LanguageModelV3 {
  if (!(limit > 0)) return model;
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => fitContextRequest(params, limit),
  } });
}

/** Same accounting as the SDK guard, for planning safe semantic batches. */
export function textRequestFits(limit: number, system: string, prompt: string, outputTokens?: number): boolean {
  if (!(limit > 0)) return true;
  try {
    fitContextRequest({
      prompt: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user', content: [{ type: 'text', text: prompt }] },
      ],
      maxOutputTokens: contextOutputReserve(limit, outputTokens),
    }, limit);
    return true;
  } catch (error) {
    if (error instanceof ContextBudgetExceededError) return false;
    throw error;
  }
}

export function textContextTokens(system: string, prompt: string): number {
  return requestContextTokens({ prompt: [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ] });
}

/** Lossless splitting at natural boundaries, with code-point fallback for a long paragraph. */
export function splitTextForContext(text: string, fits: (part: string) => boolean): string[] {
  if (fits(text)) return [text];
  if (!text) throw new Error('上下文预算不足以容纳系统提示词及输出预留；请增大模型上下文上限。');
  const points = Array.from(text);
  const parts: string[] = [];
  let offset = 0;
  while (offset < points.length) {
    let low = 0;
    let high = points.length - offset;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(points.slice(offset, offset + middle).join(''))) low = middle;
      else high = middle - 1;
    }
    if (!low) throw new Error('上下文预算不足以容纳系统提示词、必要术语、一个字符及输出预留；请增大模型上下文上限。');
    let length = low;
    // Prefer a sentence/paragraph boundary without producing tiny fragments.
    if (offset + low < points.length) {
      for (let i = low - 1; i >= Math.floor(low / 2); i--) {
        if (/[\n。！？.!?]/u.test(points[offset + i]!)) { length = i + 1; break; }
      }
    }
    parts.push(points.slice(offset, offset + length).join(''));
    offset += length;
  }
  return parts;
}

/** Batch indivisible records without dropping IDs or chopping structured JSON. */
export function batchForContext<T>(items: T[], fits: (batch: T[]) => boolean, maxItems = Infinity): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  for (const item of items) {
    if (batch.length && (batch.length >= maxItems || !fits([...batch, item]))) {
      batches.push(batch);
      batch = [];
    }
    if (!fits([item])) throw new Error('单条材料超过模型上下文预算，无法安全拆分；请增大模型上下文上限。');
    batch.push(item);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
