import { redactSecrets } from './redact-secrets';
import fs from 'node:fs';
import path from 'node:path';

export interface LlmLogContext {
  /** 当前执行轮次标识，与构建 modelStatsJson.runId 对应。 */
  runId?: string;
  sourceId?: string;
  novelId?: string;
  chapterId?: string;
  unitKind?: string;
  operation?: string;
  /** 批次编号从 1 开始；跨章节窗口保留全部来源章节。 */
  batchIndex?: number;
  totalBatches?: number;
  chapterIds?: string[];
  thinkingEnabled?: boolean;
}

/** 日志实例配置；路径、开关、上下文和脱敏凭据使用具名字段。 */
export interface LlmInteractionLoggerOptions {
  logDir?: string;
  enabled?: boolean;
  context?: LlmLogContext;
  secrets?: string[];
}

/** 按日期保存请求、原始响应及错误，保留七天；同步追加以确保调用返回时已落盘。 */
export class LlmInteractionLogger {
  readonly #logDir: string;
  readonly #enabled: boolean;
  readonly #context: LlmLogContext;
  readonly #secrets: string[];
  #todayDate = '';

  constructor(options: LlmInteractionLoggerOptions = {}) {
    this.#logDir = options.logDir ?? path.resolve(process.cwd(), '.data', 'llm-logs');
    this.#enabled = options.enabled ?? true;
    this.#context = options.context ?? {};
    this.#secrets = (options.secrets ?? []).filter(Boolean);
  }

  get enabled(): boolean { return this.#enabled; }

  /** 为并行任务创建独立上下文，避免章节标识互相覆盖。 */
  withContext(context: LlmLogContext): LlmInteractionLogger {
    return new LlmInteractionLogger({ logDir: this.#logDir, enabled: this.#enabled, context: { ...this.#context, ...context }, secrets: this.#secrets });
  }

  /** 同时清理错误、响应和提示词中可能回显的凭据。 */
  withSecrets(secrets: string[]): LlmInteractionLogger {
    return new LlmInteractionLogger({ logDir: this.#logDir, enabled: this.#enabled, context: this.#context, secrets: [...this.#secrets, ...secrets] });
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
    event?: 'request' | 'response' | 'fallback' | 'failure';
    phase?: 'batch' | 'batch_retry' | 'single' | 'single_retry' | 'fallback' | 'final_failure';
    errorCategory?: string;
    maxAttempts?: number;
    finishReason?: string | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
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
      let entry = [
        `=== ${new Date().toISOString()} ===`,
        `Event: ${params.event ?? 'response'} Call: ${params.callId ?? ''}`,
        `Context: ${JSON.stringify(this.#context)}`,
        `Provider: ${params.provider}`,
        `Model: ${params.model}`,
        `Phase: ${params.phase ?? 'unavailable'}`,
        `Attempt: ${params.attempt ?? 1}/${params.maxAttempts ?? 'unavailable'} Paragraphs: ${JSON.stringify(params.paragraphIndices ?? [])}`,
        `ErrorCategory: ${params.errorCategory ?? 'none'}`,
        `ResponseCharacters: ${params.event === 'request' ? 'unavailable' : params.response.length}`,
        `FinishReason: ${params.finishReason ?? 'unavailable'} InputTokens: ${params.inputTokens ?? 'unavailable'} OutputTokens: ${params.outputTokens ?? 'unavailable'}`,
        `Temperature: ${params.temperature ?? ''} MaxOutputTokens: ${params.maxOutputTokens ?? ''}`,
        `Duration: ${params.durationMs}ms`,
        params.error ? `ERROR: ${params.error}` : '',
        '--- SYSTEM ---', params.systemPrompt,
        '--- USER ---', params.userPrompt,
        '--- MESSAGES ---', JSON.stringify(params.messages ?? []),
        '--- RESPONSE ---', params.response, '',
      ].join('\n') + '\n';
      entry = redactSecrets(entry, this.#secrets);
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
