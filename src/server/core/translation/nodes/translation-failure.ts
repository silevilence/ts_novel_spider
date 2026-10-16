import type { TranslationErrorCategory } from '../../translation-state';

/** 只有段落对齐或参考材料回显错误可尝试通过拆分请求恢复。 */
export function canFallbackToSingle(category: TranslationErrorCategory): boolean {
  return category === 'format_mismatch' || category === 'prompt_echo';
}

/** 失败分类独立于重试/回退动作；错误文案本身不宣告流程切换。 */
export class TranslationFailure extends Error {
  constructor(readonly category: TranslationErrorCategory, message: string) {
    super(message);
    this.name = 'TranslationFailure';
  }
}

/** SDK 包装异常可能把 timeout 放在 cause 中，按整条原因链识别。 */
export function classifyTranslationFailure(error: unknown, options: { cancelled?: boolean } = {}): TranslationFailure {
  if (error instanceof TranslationFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  let cause: unknown = error;
  const seen = new Set<unknown>();
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    if (/timeout|timed out|超时/i.test(`${cause.name} ${cause.message}`)) return new TranslationFailure('timeout', `请求超时：${message}`);
    cause = cause.cause;
  }
  return new TranslationFailure(options.cancelled ? 'cancelled' : 'api_error', message);
}
