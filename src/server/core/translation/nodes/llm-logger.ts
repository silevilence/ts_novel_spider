import fs from 'node:fs';
import path from 'node:path';

export interface LlmLogContext {
  sourceId?: string;
  novelId?: string;
  chapterId?: string;
  unitKind?: string;
}

/** 按日期保存请求、原始响应及错误，保留七天；同步追加以确保调用返回时已落盘。 */
export class LlmInteractionLogger {
  readonly #logDir: string;
  readonly #enabled: boolean;
  readonly #context: LlmLogContext;
  #todayDate = '';

  constructor(logDir?: string, enabled = true, context: LlmLogContext = {}) {
    this.#logDir = logDir ?? path.resolve(process.cwd(), '.data', 'llm-logs');
    this.#enabled = enabled;
    this.#context = context;
  }

  get enabled(): boolean { return this.#enabled; }

  /** 为并行任务创建独立上下文，避免章节标识互相覆盖。 */
  withContext(context: LlmLogContext): LlmInteractionLogger {
    return new LlmInteractionLogger(this.#logDir, this.#enabled, { ...this.#context, ...context });
  }

  /** 不包含 API Key；messages 保留本次实际发送的完整角色和历史消息。 */
  logCall(params: {
    provider: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    response: string;
    durationMs: number;
    error?: string;
    event?: 'request' | 'response';
    callId?: string;
    attempt?: number;
    paragraphIndices?: number[];
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    temperature?: number;
    maxOutputTokens?: number;
  }): void {
    if (!this.#enabled) return;
    try {
      fs.mkdirSync(this.#logDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const entry = [
        `=== ${new Date().toISOString()} ===`,
        `Event: ${params.event ?? 'response'} Call: ${params.callId ?? ''}`,
        `Context: ${JSON.stringify(this.#context)}`,
        `Provider: ${params.provider}`,
        `Model: ${params.model}`,
        `Attempt: ${params.attempt ?? 1} Paragraphs: ${JSON.stringify(params.paragraphIndices ?? [])}`,
        `Temperature: ${params.temperature ?? ''} MaxOutputTokens: ${params.maxOutputTokens ?? ''}`,
        `Duration: ${params.durationMs}ms`,
        params.error ? `ERROR: ${params.error}` : '',
        '--- SYSTEM ---', params.systemPrompt,
        '--- USER ---', params.userPrompt,
        '--- MESSAGES ---', JSON.stringify(params.messages ?? []),
        '--- RESPONSE ---', params.response, '',
      ].join('\n') + '\n';
      fs.appendFileSync(path.join(this.#logDir, `${today}.log`), entry, 'utf8');
      if (this.#todayDate !== today) {
        this.#todayDate = today;
        for (const name of fs.readdirSync(this.#logDir)) {
          if (/^\d{4}-\d{2}-\d{2}\.log$/.test(name)
            && Date.now() - new Date(name.slice(0, 10)).getTime() > 7 * 86400000) {
            fs.unlinkSync(path.join(this.#logDir, name));
          }
        }
      }
    } catch (error) {
      // 不中断翻译，但不能静默吞掉无法写入日志的原因。
      console.warn('[translation] LLM 交互日志写入失败:', error instanceof Error ? error.message : String(error));
    }
  }

  /** 同步写入无需刷新流，保留调用方的关闭接口。 */
  close(): void {}
}
