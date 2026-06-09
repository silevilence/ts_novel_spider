export type SpiderLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SpiderLogEventType =
  | 'task_started'
  | 'metadata_fetched'
  | 'catalog_fetched'
  | 'chapter_started'
  | 'chapter_fetched'
  | 'chapter_persisted'
  | 'chapter_failed'
  | 'task_completed'
  | 'task_failed'
  | 'scheduling_round_started'
  | 'scheduling_novel_checking'
  | 'scheduling_novel_checked'
  | 'scheduling_novel_skipped'
  | 'scheduling_novel_error'
  | 'scheduling_download_triggered'
  | 'scheduling_round_completed';

export interface SpiderLogContext {
  sourceId: string;
  novelId: string;
  runId: string;
}

export interface SpiderLogEvent<TPayload = Record<string, unknown>> {
  type: SpiderLogEventType;
  level: SpiderLogLevel;
  message: string;
  context: SpiderLogContext;
  payload?: TPayload;
  error?: Error;
  timestamp: string;
}

export interface SpiderLogAdapter {
  log(event: SpiderLogEvent): void | Promise<void>;
}

export class SpiderLogDispatcher {
  readonly #adapters: SpiderLogAdapter[] = [];

  constructor(adapters: SpiderLogAdapter[] = []) {
    for (const adapter of adapters) {
      this.addAdapter(adapter);
    }
  }

  addAdapter(adapter: SpiderLogAdapter): void {
    if (!this.#adapters.includes(adapter)) {
      this.#adapters.push(adapter);
    }
  }

  removeAdapter(adapter: SpiderLogAdapter): void {
    const index = this.#adapters.indexOf(adapter);

    if (index >= 0) {
      this.#adapters.splice(index, 1);
    }
  }

  async dispatch(event: SpiderLogEvent): Promise<void> {
    await Promise.all(
      this.#adapters.map(async (adapter) => {
        try {
          await adapter.log(event);
        } catch {
          // 日志适配器自身的异常不能反向打断爬虫主流程。
        }
      }),
    );
  }
}