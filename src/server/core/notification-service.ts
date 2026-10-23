import crypto from 'node:crypto';
import type { NotificationEvent, NotificationRecord, NotificationResult } from '../contracts/notification';
import type { StoredNotificationConfig, SystemPreferencesService } from './system-preferences';
import type { NotificationChannel } from './notification-channel';
import { redactSecrets } from './translation/nodes/redact-secrets';

export interface NotificationStore {
  insertNotification(record: NotificationRecord): boolean;
  saveNotification(record: NotificationRecord): void;
  recoverNotifications(): void;
  listNotifications(limit?: number): NotificationRecord[];
  getNotification(id: string): NotificationRecord | null;
}

/** 后台串行发送，失败只落本地记录；绝不通过通知服务报告通知自身的失败。 */
export class NotificationService {
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #abort: AbortController | null = null;
  constructor(
    private readonly store: NotificationStore,
    private readonly preferences: SystemPreferencesService,
    private readonly channels: ReadonlyMap<string, NotificationChannel>,
    private readonly options: { timeoutMs?: number; retryDelayMs?: number; localLog?: (message: string) => void } = {},
  ) {
    try { store.recoverNotifications(); } catch { this.#log('通知恢复失败；业务服务继续启动'); }
  }

  /** 同步持久化去重后异步发送；返回 false 表示重复或无法入队，不抛出业务异常。 */
  submit(event: NotificationEvent, test = false, override?: StoredNotificationConfig): boolean {
    if (this.#closed) return false;
    try {
      const config = override ?? this.preferences.resolveNotification();
      const allowed = test || config.enabled && ((event.error && config.errorEnabled) || Boolean(event.update?.enabled));
      const now = new Date().toISOString();
      const entry: NotificationRecord = {
        id: event.id, event: this.#sanitize(event, config), channel: config.channel,
        target: this.#sanitize(config.target, config), status: allowed ? 'queued' : 'skipped', attempts: 0,
        createdAt: now, updatedAt: now, result: null,
      };
      if (!this.store.insertNotification(entry)) return false;
      if (allowed) this.#tail = this.#tail.then(async () => {
        if (!this.#closed) await this.#send(entry, config, test);
      }).catch(() => this.#log('通知记录写入失败；未触发新的告警'));
      return true;
    } catch { this.#log('通知入队失败；业务任务继续运行'); return false; }
  }

  async test(config: StoredNotificationConfig): Promise<NotificationRecord> {
    const id = `test:${crypto.randomUUID()}`;
    if (!this.submit({ id, kind: 'test', sourceId: '-', novelId: '-', runId: id, title: '测试通知',
      summary: 'TS Novel Spider 通知渠道测试', occurredAt: new Date().toISOString(), error: false }, true, config)) throw new Error('测试通知无法入队');
    await this.drain();
    const result = this.store.getNotification(id);
    if (!result) throw new Error('未找到测试通知发送记录');
    return result;
  }

  async drain(): Promise<void> { await this.#tail; }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort?.abort();
    try { this.store.recoverNotifications(); } catch { this.#log('通知关闭状态写入失败'); }
  }

  #log(message: string): void {
    try { (this.options.localLog ?? console.warn)(`[notification] ${message}`); } catch { /* 日志失败也不能干扰业务。 */ }
  }

  #sanitize<T>(value: T, config: StoredNotificationConfig): T {
    const keys = [config.apiKey, ...this.preferences.getLlmState().providers.map((provider) => provider.apiKey), this.preferences.getNeo4jState().config.password];
    const json = JSON.stringify(value, (_key, item: unknown) => typeof item === 'string'
      ? redactSecrets(item, keys)
        .replace(/\b(?:abk_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
      : item);
    return JSON.parse(json) as T;
  }

  async #send(entry: NotificationRecord, config: StoredNotificationConfig, test: boolean): Promise<void> {
    const channel = this.channels.get(config.channel);
    const message = [entry.event.title, `业务：${entry.event.kind}`, `小说：${entry.event.sourceId}/${entry.event.novelId}`,
      `任务/轮次：${entry.event.runId}`, entry.event.summary,
      ...(entry.event.update ? [`发现 ${entry.event.update.discovered} 章，成功下载 ${entry.event.update.downloaded} 章，失败 ${entry.event.update.failed} 章`] : []),
      `时间：${entry.event.occurredAt}`].join('\n');
    for (let attempt = 1; attempt <= 3 && !this.#closed; attempt++) {
      if (!test) {
        const current = this.preferences.resolveNotification();
        const allowed = current.enabled && ((entry.event.error && current.errorEnabled) || entry.event.update?.enabled);
        if (!allowed || current.channel !== config.channel || current.baseUrl !== config.baseUrl || current.apiKey !== config.apiKey || current.target.umo !== config.target.umo) {
          entry.status = 'skipped'; entry.updatedAt = new Date().toISOString();
          entry.result = { status: 'failed', category: 'configuration', retryable: false, message: '发送前通知被关闭或渠道/目标已变化，已跳过待发送通知' };
          this.store.saveNotification(entry);
          return;
        }
      }
      entry.status = 'sending'; entry.attempts = attempt; entry.updatedAt = new Date().toISOString();
      this.store.saveNotification(entry);
      const controller = new AbortController();
      this.#abort = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: NotificationResult;
      try {
        result = await Promise.race([
          channel ? channel.send(config, message, controller.signal) : Promise.resolve<NotificationResult>({ status: 'failed', category: 'configuration', retryable: false, message: '通知渠道不可用' }),
          new Promise<NotificationResult>((resolve) => {
            timer = setTimeout(() => { resolve({ status: 'unknown', category: 'timeout', retryable: false, message: '发送超时，投递结果不确定；未重发' }); controller.abort(); }, this.options.timeoutMs ?? 15_000);
          }),
        ]);
      } catch {
        result = { status: 'unknown', category: 'unavailable', retryable: false, message: '渠道异常，投递结果不确定；未重发' };
      } finally { clearTimeout(timer); this.#abort = null; }
      if (this.#closed) return;
      entry.result = this.#sanitize(result, config); entry.status = result.status; entry.updatedAt = new Date().toISOString();
      this.store.saveNotification(entry);
      if (result.status !== 'failed' || result.category !== 'unavailable' || !result.retryable || attempt === 3) {
        if (result.status !== 'accepted') this.#log(`${entry.id}: ${entry.result.message}`);
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, (this.options.retryDelayMs ?? 1000) * attempt));
    }
  }
}
