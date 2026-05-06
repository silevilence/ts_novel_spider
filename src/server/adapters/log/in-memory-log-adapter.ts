import type { SpiderLogAdapter, SpiderLogEvent } from '../../core/logging';

export class InMemoryLogAdapter implements SpiderLogAdapter {
  readonly events: SpiderLogEvent[] = [];

  async log(event: SpiderLogEvent): Promise<void> {
    this.events.push(event);
  }
}