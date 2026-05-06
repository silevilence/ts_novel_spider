import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryLogAdapter } from '../adapters/log/in-memory-log-adapter';
import { SpiderLogDispatcher, type SpiderLogAdapter, type SpiderLogEvent } from './logging';

const baseEvent: SpiderLogEvent = {
  type: 'task_started',
  level: 'info',
  message: 'task started',
  context: {
    sourceId: 'mock-source',
    novelId: 'novel-1',
    runId: 'run-1',
  },
  timestamp: new Date('2026-05-06T00:00:00.000Z').toISOString(),
};

test('SpiderLogDispatcher dispatches events to registered adapters', async () => {
  const adapter = new InMemoryLogAdapter();
  const dispatcher = new SpiderLogDispatcher([adapter]);

  await dispatcher.dispatch(baseEvent);

  assert.equal(adapter.events.length, 1);
  assert.deepEqual(adapter.events[0], baseEvent);
});

test('SpiderLogDispatcher isolates adapter failures', async () => {
  const adapter = new InMemoryLogAdapter();
  const failingAdapter: SpiderLogAdapter = {
    async log(): Promise<void> {
      throw new Error('adapter failure');
    },
  };
  const dispatcher = new SpiderLogDispatcher([failingAdapter, adapter]);

  await assert.doesNotReject(async () => dispatcher.dispatch(baseEvent));
  assert.equal(adapter.events.length, 1);
});

test('SpiderLogDispatcher avoids duplicate adapter registration', async () => {
  const adapter = new InMemoryLogAdapter();
  const dispatcher = new SpiderLogDispatcher([adapter]);
  dispatcher.addAdapter(adapter);

  await dispatcher.dispatch(baseEvent);

  assert.equal(adapter.events.length, 1);
});