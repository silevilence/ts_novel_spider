import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { defineTool, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createHarness, temporaryWorkspace } from './harness.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SqliteNovelRepository } = require('../../../src/server/core/novel-repository.ts') as typeof import('../../../src/server/core/novel-repository.ts');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('explicit skill loading excludes host/project resources and supports invocation', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  const skillDirectory = join(workspace.directory, 'selected-skills');
  mkdirSync(join(skillDirectory, 'review'), { recursive: true });
  writeFileSync(join(skillDirectory, 'review', 'SKILL.md'), '---\nname: review\ndescription: Review translated paragraphs.\n---\nSKILL_VERSION=1\nNever mark a changed translation reviewed without new evidence.');
  writeFileSync(join(workspace.directory, 'AGENTS.md'), 'HOST_INSTRUCTION_MUST_NOT_LOAD');
  mkdirSync(join(workspace.directory, '.pi', 'skills', 'unselected'), { recursive: true });
  writeFileSync(join(workspace.directory, '.pi', 'skills', 'unselected', 'SKILL.md'), '---\nname: unselected\ndescription: Must not load.\n---\nUNSELECTED_SKILL');
  const harness = await createHarness({ directory: workspace.directory, skillDirectory });
  try {
    assert.deepEqual(harness.resourceLoader.getSkills().skills.map((skill) => skill.name), ['review']);
    assert.deepEqual(harness.resourceLoader.getAgentsFiles().agentsFiles, []);
    harness.faux.setResponses([(context) => {
      const material = JSON.stringify(context);
      assert.match(material, /Never mark a changed translation/);
      assert.doesNotMatch(material, /HOST_INSTRUCTION_MUST_NOT_LOAD|UNSELECTED_SKILL/);
      return fauxAssistantMessage('Read selected skill.');
    }]);
    await harness.session.prompt('/skill:review Check the chapter.');
    assert.equal(harness.faux.state.callCount, 1);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('bounded replacement read tool enables autonomous skill discovery and reference loading', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  const skillDirectory = join(workspace.directory, 'snapshot-v1', 'review');
  mkdirSync(skillDirectory, { recursive: true });
  const skillPath = join(skillDirectory, 'SKILL.md');
  const referencePath = join(skillDirectory, 'checklist.md');
  writeFileSync(skillPath, '---\nname: review\ndescription: NOVEL_REVIEW_SKILL\n---\nSKILL_VERSION=1\nRead checklist.md before reviewing.');
  writeFileSync(referencePath, 'CHECKLIST_V1: check omissions and terminology.');
  const allowed = new Set([realpathSync(skillPath), realpathSync(referencePath)]);
  const reader = defineTool({ name: 'read', label: 'Read selected skill', description: 'Only reads explicitly allowed skill resources', parameters: Type.Object({ path: Type.String() }, { additionalProperties: false }), execute: async (_id, input) => {
    const actual = realpathSync(input.path);
    if (!allowed.has(actual)) throw new Error('Resource outside selected skill snapshot');
    return { content: [{ type: 'text', text: readFileSync(actual, 'utf8') }], details: {} };
  } });
  const harness = await createHarness({ directory: workspace.directory, skillDirectory, tools: [reader] });
  try {
    harness.faux.setResponses([
      (context) => { assert.match(JSON.stringify(context), /NOVEL_REVIEW_SKILL/); return fauxAssistantMessage(fauxToolCall('read', { path: skillPath }), { stopReason: 'toolUse' }); },
      (context) => { assert.match(JSON.stringify(context), /SKILL_VERSION=1/); return fauxAssistantMessage(fauxToolCall('read', { path: referencePath }), { stopReason: 'toolUse' }); },
      (context) => { assert.match(JSON.stringify(context), /CHECKLIST_V1/); return fauxAssistantMessage(fauxToolCall('read', { path: import.meta.filename }), { stopReason: 'toolUse' }); },
      (context) => { assert.match(JSON.stringify(context), /Resource outside selected skill snapshot/); return fauxAssistantMessage('Selected skill loaded; unrelated resource rejected.'); },
    ]);
    await harness.session.prompt('Review the novel with the available skill');
    assert.equal(harness.faux.state.callCount, 4);
    assert.deepEqual(harness.session.getActiveToolNames(), ['read']);
    assert.ok(harness.session.messages.some((message) => message.role === 'toolResult' && message.isError));
  } finally { harness.session.dispose(); workspace.close(); }
});

test('steering arrives after the in-flight tool and before the next model call', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  const started = deferred<void>();
  const release = deferred<void>();
  const tool = defineTool({ name: 'in_flight', label: 'Wait', description: 'Controlled in-flight operation', parameters: Type.Object({}), execute: async () => {
    started.resolve();
    await release.promise;
    return { content: [{ type: 'text', text: 'TOOL_FINISHED' }], details: {} };
  } });
  const harness = await createHarness({ directory: workspace.directory, tools: [tool] });
  try {
    harness.faux.setResponses([fauxAssistantMessage(fauxToolCall('in_flight', {}), { stopReason: 'toolUse' }), (context) => {
      assert.match(JSON.stringify(context), /NEW_PRIORITY/);
      assert.match(JSON.stringify(context), /TOOL_FINISHED/);
      return fauxAssistantMessage('New priority accepted.');
    }]);
    const running = harness.session.prompt('Start work');
    await started.promise;
    await harness.session.steer('NEW_PRIORITY: check terminology first.');
    release.resolve();
    await running;
    assert.equal(harness.faux.state.callCount, 2);
  } finally { release.resolve(); await harness.session.abort(); harness.session.dispose(); workspace.close(); }
});

test('abort reaches an in-flight tool and prevents late writes', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  const started = deferred<void>();
  let writes = 0;
  const tool = defineTool({ name: 'cancel_me', label: 'Cancel', description: 'Wait for cancellation', parameters: Type.Object({}), execute: async (_id, _input, signal) => {
    assert.ok(signal);
    started.resolve();
    await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    signal.throwIfAborted();
    writes++;
    return { content: [{ type: 'text', text: 'written' }], details: {} };
  } });
  const harness = await createHarness({ directory: workspace.directory, tools: [tool] });
  try {
    harness.faux.setResponses([fauxAssistantMessage(fauxToolCall('cancel_me', {}), { stopReason: 'toolUse' })]);
    const running = harness.session.prompt('Run until cancelled');
    await started.promise;
    await harness.session.abort();
    await running;
    assert.equal(writes, 0);
    assert.equal(harness.faux.state.callCount, 1);
    assert.equal(harness.session.isStreaming, false);
  } finally { await harness.session.abort(); harness.session.dispose(); workspace.close(); }
});

test('extension hook can block completion without review evidence', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  let completions = 0;
  const tool = defineTool({ name: 'finish_task', label: 'Finish', description: 'Request task completion', parameters: Type.Object({}), execute: async () => { completions++; return { content: [{ type: 'text', text: 'finished' }], details: {} }; } });
  const harness = await createHarness({ directory: workspace.directory, tools: [tool], extensions: [(pi) => {
    pi.on('tool_call', (event) => { if (event.toolName === 'finish_task') return { block: true, reason: 'Current translation has no review evidence' }; });
  }] });
  try {
    harness.faux.setResponses([fauxAssistantMessage(fauxToolCall('finish_task', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('Review required.')]);
    await harness.session.prompt('Finish task');
    assert.equal(completions, 0);
    assert.match(JSON.stringify(harness.session.messages), /no review evidence/);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('session file restores transcript and task checkpoint, while another task stays empty', { timeout: 15000 }, async () => {
  const workspace = temporaryWorkspace();
  const first = await createHarness({ directory: workspace.directory });
  let second: Awaited<ReturnType<typeof createHarness>> | undefined;
  let other: Awaited<ReturnType<typeof createHarness>> | undefined;
  try {
    first.faux.setResponses([fauxAssistantMessage('Chapter one translated; chapter two pending.')]);
    await first.session.prompt('TASK_A_GOAL');
    first.manager.appendCustomEntry('novel-checkpoint', { taskId: 'A', skillVersion: 1, pending: ['chapter-2'] });
    const file = first.manager.getSessionFile();
    assert.ok(file);
    first.session.dispose();
    second = await createHarness({ directory: workspace.directory, manager: SessionManager.open(file) });
    assert.match(JSON.stringify(second.session.messages), /TASK_A_GOAL/);
    const checkpoint = second.manager.getEntries().find((entry) => entry.type === 'custom' && entry.customType === 'novel-checkpoint');
    assert.ok(checkpoint?.type === 'custom');
    assert.deepEqual(checkpoint.data, { taskId: 'A', skillVersion: 1, pending: ['chapter-2'] });
    second.faux.setResponses([(context) => { assert.match(JSON.stringify(context), /chapter two pending/); return fauxAssistantMessage('Continuing.'); }]);
    await second.session.prompt('Continue remaining work');
    other = await createHarness({ directory: workspace.directory, manager: SessionManager.inMemory(workspace.directory) });
    assert.doesNotMatch(JSON.stringify(other.session.messages), /TASK_A_GOAL/);
  } finally { first.session.dispose(); second?.session.dispose(); other?.session.dispose(); workspace.close(); }
});

test('native compaction retains a summary and system constraints across session reopen', { timeout: 15000 }, async () => {
  const workspace = temporaryWorkspace();
  const harness = await createHarness({ directory: workspace.directory });
  let reopened: Awaited<ReturnType<typeof createHarness>> | undefined;
  try {
    harness.faux.setResponses([fauxAssistantMessage('old material '.repeat(200)), fauxAssistantMessage('chapter-2 pending'), fauxAssistantMessage('Goal: translate novel. Pending: chapter-2. Skill version: 1. Review remains required.')]);
    await harness.session.prompt('INITIAL_GOAL: Translate novel. ' + 'source '.repeat(200));
    await harness.session.prompt('Continue chapter two');
    const result = await harness.session.compact('Preserve goal and pending work.');
    assert.match(result.summary, /chapter-2/);
    assert.ok(harness.manager.getEntries().some((entry) => entry.type === 'compaction'));
    const file = harness.manager.getSessionFile();
    assert.ok(file);
    harness.session.dispose();
    reopened = await createHarness({ directory: workspace.directory, manager: SessionManager.open(file) });
    reopened.faux.setResponses([(context) => {
      assert.match(JSON.stringify(context), /chapter-2/);
      assert.match(JSON.stringify(context), /Goal: translate novel/);
      assert.match(JSON.stringify(context), /SKILL_VERSION=1/);
      assert.match(JSON.stringify(context), /Never claim completion/);
      return fauxAssistantMessage('Restored from summary.');
    }]);
    await reopened.session.prompt('Resume');
    assert.equal(reopened.faux.state.callCount, 1);
  } finally { harness.session.dispose(); reopened?.session.dispose(); workspace.close(); }
});

test('cancelled compaction preserves the pre-compaction transcript', { timeout: 15000 }, async () => {
  const workspace = temporaryWorkspace();
  const started = deferred<void>();
  const release = deferred<void>();
  const harness = await createHarness({ directory: workspace.directory });
  try {
    harness.faux.setResponses([fauxAssistantMessage('Long old answer '.repeat(200)), fauxAssistantMessage('Recent answer'), async () => { started.resolve(); await release.promise; return fauxAssistantMessage('LATE_SUMMARY'); }]);
    await harness.session.prompt('ORIGINAL_GOAL ' + 'source '.repeat(200));
    await harness.session.prompt('Remaining work');
    const before = harness.manager.getEntries().length;
    const compacting = harness.session.compact().then(() => false, () => true);
    await started.promise;
    harness.session.abortCompaction();
    release.resolve();
    assert.equal(await compacting, true);
    assert.equal(harness.manager.getEntries().length, before);
    assert.doesNotMatch(JSON.stringify(harness.manager.getEntries()), /LATE_SUMMARY/);
  } finally { release.resolve(); harness.session.dispose(); workspace.close(); }
});

test('compaction requests share the budget guard and do not persist failed summaries', { timeout: 10000 }, async () => {
  const workspace = temporaryWorkspace();
  const manager = SessionManager.inMemory(workspace.directory);
  manager.appendMessage({ role: 'user', content: 'Initial goal ' + 'source '.repeat(500), timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage('old answer '.repeat(500)));
  manager.appendMessage({ role: 'user', content: 'Continue chapter two', timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage('Recent answer'));
  const harness = await createHarness({ directory: workspace.directory, manager, budget: 1000 });
  try {
    await assert.rejects(harness.session.compact(), /上下文上限/);
    assert.equal(harness.faux.state.callCount, 0);
    assert.equal(harness.manager.getEntries().some((entry) => entry.type === 'compaction'), false);
  } finally { harness.session.dispose(); workspace.close(); }
});

test('session recovery alone cannot make an external business write atomic', async () => {
  const workspace = temporaryWorkspace();
  try {
    const manager = SessionManager.create(workspace.directory, join(workspace.directory, 'sessions'));
    manager.appendMessage({ role: 'user', content: 'Translate chapter', timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage(fauxToolCall('save_translation', { text: '译文' }, { id: 'operation-1' }), { stopReason: 'toolUse' }));
    const businessFile = join(workspace.directory, 'business-write.json');
    writeFileSync(businessFile, JSON.stringify({ operationId: 'operation-1', text: '译文', writes: 1 }));
    // Simulated crash boundary: the external write exists but no tool-result entry was appended.
    const file = manager.getSessionFile();
    assert.ok(file);
    const reopened = SessionManager.open(file);
    assert.equal(JSON.parse(readFileSync(businessFile, 'utf8')).writes, 1);
    assert.equal(reopened.buildSessionContext().messages.some((message) => message.role === 'toolResult'), false);
    assert.match(JSON.stringify(reopened.getEntries()), /operation-1/);
  } finally { workspace.close(); }
});

for (const mode of ['before-write', 'after-write', 'compaction', 'before-sqlite', 'after-sqlite']) {
  test(`real process exit at ${mode} preserves recoverable evidence`, { timeout: 30000 }, async () => {
    const workspace = temporaryWorkspace();
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./crash-fixture.ts', import.meta.url)), workspace.directory, mode], { cwd: fileURLToPath(new URL('.', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let diagnostics = '';
        child.stderr.on('data', (data: Buffer) => { diagnostics += data.toString(); });
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Crash fixture timed out')); }, 25000);
        child.on('error', (error) => { clearTimeout(timeout); reject(error); });
        child.on('exit', (exitCode) => { clearTimeout(timeout); if (exitCode !== 23 && exitCode !== 24) reject(new Error(`Unexpected exit ${exitCode}: ${diagnostics}`)); else resolve(exitCode); });
      });
      const sessionPath = readFileSync(join(workspace.directory, 'session-path.txt'), 'utf8');
      const manager = SessionManager.open(sessionPath);
      if (mode === 'compaction') {
        assert.equal(code, 24);
        assert.match(JSON.stringify(manager.getEntries()), /INITIAL_GOAL/);
        assert.equal(manager.getEntries().some((entry) => entry.type === 'compaction'), false);
      } else {
        assert.equal(code, 23);
        assert.match(JSON.stringify(manager.getEntries()), /operation-1/);
        assert.equal(manager.buildSessionContext().messages.some((message) => message.role === 'toolResult'), false);
        assert.equal(existsSync(join(workspace.directory, 'business-write.json')), mode === 'after-write');
        if (mode.endsWith('sqlite')) {
          const database = new SqliteNovelRepository(join(workspace.directory, 'business.sqlite'));
          try {
            const segment = database.listRefinedTranslationSegments('task', 'chapter')[0]!;
            const state = database.getRefinedAgentState('task')!;
            assert.equal(segment.translatedText, mode === 'after-sqlite' ? '译文' : null);
            assert.equal(state.receipts[0]!.status, mode === 'after-sqlite' ? 'completed' : 'running');
            assert.equal(state.usage.calls, 1);
            assert.equal(database.listRefinedTranslationSegments('task', 'chapter').length, 1);
          } finally { database.close(); }
        }
      }
    } finally { workspace.close(); }
  });
}
