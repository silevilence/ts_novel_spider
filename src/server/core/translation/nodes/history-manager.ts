/**
 * 翻译对话历史管理器。
 *
 * 维护 FIFO 队列存储已翻译的 (原文, 译文) 对，为 LLM 提供上下文参考。
 * 当上下文超标时可滚动舍弃旧历史记录。
 */
export interface HistoryEntry {
  sourceText: string;
  translatedText: string;
}

export class TranslationHistoryManager {
  readonly #entries: HistoryEntry[] = [];
  /** 最大保留条目数（约等于 2-3 章 × 每章约 10 批） */
  readonly #maxEntries: number;

  constructor(maxEntries = 30) {
    this.#maxEntries = maxEntries;
  }

  /** 追加一条翻译历史，自动裁剪超出上限的旧记录 */
  addEntry(sourceText: string, translatedText: string): void {
    this.#entries.push({ sourceText, translatedText });
    while (this.#entries.length > this.#maxEntries) {
      this.#entries.shift();
    }
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
   * 丢弃最旧的 count 条历史记录。
   * 上下文超标时调用，逐步释放 token 空间。
   */
  discardOldest(count: number): void {
    const toRemove = Math.min(count, this.#entries.length);
    for (let i = 0; i < toRemove; i++) {
      this.#entries.shift();
    }
  }

  /** 清空所有历史 */
  clear(): void {
    this.#entries.length = 0;
  }

  /** 获取当前历史的摘要（供日志） */
  summary(): string {
    return `history: ${this.#entries.length} entries (max ${this.#maxEntries})`;
  }
}
