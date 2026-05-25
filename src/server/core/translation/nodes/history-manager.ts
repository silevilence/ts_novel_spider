/**
 * 翻译对话历史管理器。
 *
 * 维护 FIFO 队列存储已翻译的 (原文, 译文) 对，为 LLM 提供上下文参考。
 * 支持按条目数或 Token 数截断，使用批量裁剪策略保留近期稳定前缀以维持 KV Cache 命中。
 */
export interface HistoryEntry {
  sourceText: string;
  translatedText: string;
}

export class TranslationHistoryManager {
  readonly #entries: HistoryEntry[] = [];
  /** 最大保留条目数（备用，当未设置 contextWindowTokens 时使用） */
  readonly #maxEntries: number;
  /** 上下文窗口 Token 上限（0 = 不限制，使用 maxEntries 控制） */
  readonly #maxContextTokens: number;
  /** 累计已从历史中移除的条目数（仅统计） */
  #evictedCount = 0;

  constructor(maxEntries = 200, maxContextTokens = 0) {
    this.#maxEntries = maxEntries;
    this.#maxContextTokens = maxContextTokens;
  }

  /** 追加一条翻译历史，超出上限时批量裁剪旧记录以保持前缀稳定 */
  addEntry(sourceText: string, translatedText: string): void {
    this.#entries.push({ sourceText, translatedText });
    this.#trimIfNeeded();
  }

  /** 返回当前历史条目数 */
  get size(): number {
    return this.#entries.length;
  }

  /**
   * 构建 LLM 对话历史消息数组。
   * 奇数索引为 user（原文），偶数索引为 assistant（译文）。
   */
  buildHistoryMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const entry of this.#entries) {
      messages.push({ role: 'user', content: entry.sourceText });
      messages.push({ role: 'assistant', content: entry.translatedText });
    }
    return messages;
  }

  /**
   * 丢弃最旧的 count 条历史记录（上下文超标时由外部调用）。
   * 使用批量移除而非逐条，避免每次请求都改变前缀。
   */
  discardOldest(count: number): void {
    const toRemove = Math.min(count, this.#entries.length);
    if (toRemove > 0) {
      this.#entries.splice(0, toRemove);
      this.#evictedCount += toRemove;
    }
  }

  /** 清空所有历史 */
  clear(): void {
    this.#entries.length = 0;
    this.#evictedCount = 0;
  }

  /** 获取当前历史的摘要（供日志） */
  summary(): string {
    const estTokens = this.#estimateTotalTokens();
    const limit = this.#maxContextTokens > 0
      ? `tokens≈${estTokens}/${this.#maxContextTokens}`
      : `entries=${this.#entries.length}/${this.#maxEntries}`;
    const evicted = this.#evictedCount > 0 ? ` evicted=${this.#evictedCount}` : '';
    return `history: ${this.#entries.length} entries (${limit})${evicted}`;
  }

  // ── 私有方法 ──

  /** 超出上限时批量裁剪旧记录——移除旧的一半，保留近期稳定前缀 */
  #trimIfNeeded(): void {
    const overByEntries = this.#maxEntries > 0 && this.#entries.length > this.#maxEntries;
    const overByTokens = this.#maxContextTokens > 0 && this.#estimateTotalTokens() > this.#maxContextTokens;

    if (!overByEntries && !overByTokens) return;

    // 批量移除：丢弃较旧的一半，保留近期条目以维持 KV Cache 前缀稳定
    const removeCount = Math.max(1, Math.ceil(this.#entries.length / 2));
    this.#entries.splice(0, removeCount);
    this.#evictedCount += removeCount;

    // 递归检查（Token 超标时可能需更激进裁剪）
    if (this.#maxContextTokens > 0 && this.#estimateTotalTokens() > this.#maxContextTokens) {
      const secondRemove = Math.max(1, Math.ceil(this.#entries.length / 2));
      this.#entries.splice(0, secondRemove);
      this.#evictedCount += secondRemove;
    }
  }

  /** 估算当前历史的总 Token 数（中/日文约 2 字=1 token，英文约 4 字=1 token） */
  #estimateTotalTokens(): number {
    let totalChars = 0;
    for (const entry of this.#entries) {
      totalChars += entry.sourceText.length + entry.translatedText.length;
    }
    return Math.ceil(totalChars / 3.5);
  }
}

/** 估算一段文本的 Token 数 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
