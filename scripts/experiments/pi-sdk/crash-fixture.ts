import { writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createHarness } from './harness.js';

const [directory, mode] = process.argv.slice(2);
if (!directory || !resolve(directory).startsWith(resolve(tmpdir()) + sep) || !['before-write', 'after-write', 'compaction'].includes(mode ?? '')) throw new Error('Invalid crash fixture arguments');
const tool = defineTool({ name: 'save_translation', label: 'Save', description: 'Crash boundary probe', parameters: Type.Object({}), execute: async () => {
  if (mode === 'after-write') writeFileSync(join(directory, 'business-write.json'), JSON.stringify({ operationId: 'operation-1', text: '译文', writes: 1 }));
  process.exit(23);
} });
const harness = await createHarness({ directory, tools: [tool] });
writeFileSync(join(directory, 'session-path.txt'), harness.manager.getSessionFile()!);
if (mode === 'compaction') {
  harness.faux.setResponses([fauxAssistantMessage('Old material '.repeat(200)), fauxAssistantMessage('Recent answer'), () => process.exit(24)]);
  await harness.session.prompt('INITIAL_GOAL ' + 'source '.repeat(200));
  await harness.session.prompt('chapter-2 pending');
  await harness.session.compact();
} else {
  harness.faux.setResponses([fauxAssistantMessage(fauxToolCall('save_translation', {}, { id: 'operation-1' }), { stopReason: 'toolUse' })]);
  await harness.session.prompt('Translate chapter');
}
throw new Error('Crash fixture unexpectedly completed');
