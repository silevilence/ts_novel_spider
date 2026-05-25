import fs from 'node:fs';
import path from 'node:path';

/**
 * LLM 交互日志记录器。
 *
 * 将每次 LLM 调用的 system prompt、user prompt 和 response 写入
 * `.data/llm-logs/` 目录下按日期滚动的日志文件。
 * 文件保留最近 7 天，超期的自动删除。
 */
export class LlmInteractionLogger {
  readonly #logDir: string;
  readonly #enabled: boolean;
  #todayDate: string = '';
  #stream: fs.WriteStream | null = null;

  constructor(logDir?: string, enabled = false) {
    this.#logDir = logDir ?? path.resolve(process.cwd(), '.data', 'llm-logs');
    this.#enabled = enabled;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** 记录一次 LLM 交互 */
  logCall(params: {
    provider: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    response: string;
    durationMs: number;
    error?: string;
  }): void {
    if (!this.#enabled) return;

    try {
      this.#ensureStream();
      const entry = [
        `=== ${new Date().toISOString()} ===`,
        `Provider: ${params.provider}`,
        `Model: ${params.model}`,
        `Duration: ${params.durationMs}ms`,
        params.error ? `ERROR: ${params.error}` : '',
        `--- SYSTEM ---`,
        params.systemPrompt,
        `--- USER ---`,
        params.userPrompt,
        `--- RESPONSE ---`,
        params.response,
        '',
      ].filter((l) => l !== '').join('\n') + '\n';

      this.#stream?.write(entry);
    } catch {
      // 日志写入失败不应影响翻译流程
    }
  }

  #ensureStream(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.#todayDate === today && this.#stream) return;

    this.#stream?.end();
    this.#stream = null;

    try {
      fs.mkdirSync(this.#logDir, { recursive: true });
      const filePath = path.join(this.#logDir, `${today}.log`);
      this.#stream = fs.createWriteStream(filePath, { flags: 'a' });
      this.#todayDate = today;

      // 清理超过 7 天的旧日志
      this.#cleanOldLogs();
    } catch {
      // 无法创建日志文件时静默失败
    }
  }

  #cleanOldLogs(): void {
    try {
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.#logDir);
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        const datePart = file.replace('.log', '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue;
        const fileTime = new Date(datePart).getTime();
        if (now - fileTime > maxAge) {
          fs.unlinkSync(path.join(this.#logDir, file));
        }
      }
    } catch {
      // 清理失败不影响
    }
  }

  /** 关闭日志流（应用退出时调用） */
  close(): void {
    this.#stream?.end();
    this.#stream = null;
  }
}
