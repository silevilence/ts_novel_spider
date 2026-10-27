import { writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createHarness } from './harness.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SqliteNovelRepository } = require('../../../src/server/core/novel-repository.ts') as typeof import('../../../src/server/core/novel-repository.ts');
const { newAgentState, agentConfigSchema } = require('../../../src/server/contracts/refined-agent.ts') as typeof import('../../../src/server/contracts/refined-agent.ts');

const [directory, mode] = process.argv.slice(2);
if (!directory || !resolve(directory).startsWith(resolve(tmpdir()) + sep) || !['before-write', 'after-write', 'compaction', 'before-sqlite', 'after-sqlite'].includes(mode ?? '')) throw new Error('Invalid crash fixture arguments');
const database = mode?.endsWith('sqlite') ? new SqliteNovelRepository(join(directory, 'business.sqlite')) : null;
if (database) {
  database.createRefinedTranslationTask({ id: 'task', sourceId: 'test', novelId: 'novel', name: 'Crash probe', novelTitle: 'Book', author: '', sourceLang: 'ja', targetLang: 'zh-CN', modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 }, chapters: [{ id: 'chapter', index: 1, title: 'Title', volumeTitle: null, content: '原文', paragraphs: ['原文'] }], terms: [] });
  const state = newAgentState(agentConfigSchema.parse({ initialCommand: 'Translate', controller: { providerId: 'test', modelId: 'model' } }), 'session');
  state.status = 'running'; state.usage.calls = 1;
  state.receipts.push({ id: 'operation-1', operation: '{"operation":"translate_chapter"}', chapterId: 'chapter', status: 'running', at: new Date().toISOString(), message: '', before: '', after: '' });
  database.saveRefinedAgentState('task', state);
}
const tool = defineTool({ name: 'save_translation', label: 'Save', description: 'Crash boundary probe', parameters: Type.Object({}), execute: async () => {
  if (mode === 'after-write') writeFileSync(join(directory, 'business-write.json'), JSON.stringify({ operationId: 'operation-1', text: '译文', writes: 1 }));
  if (database && mode === 'after-sqlite') {
    const fingerprint = database.refinedAgentFingerprint('task'); const draft = database.createRefinedAgentDraft('task');
    draft.updateRefinedTranslationSegment('task', 'chapter', 0, '译文', 'translated');
    database.refinedAgentTransaction(() => {
      database.applyRefinedAgentDraft('task', fingerprint, draft);
      const state = database.getRefinedAgentState('task')!; state.receipts[0]!.status = 'completed'; state.receipts[0]!.message = 'Saved once'; database.saveRefinedAgentState('task', state);
    });
    draft.close();
  }
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
