import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { InMemoryCredentialStore, InMemoryModelsStore, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createAgentSession, ModelRuntime, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

const directory = mkdtempSync(join(tmpdir(), 'novel-pi-smoke-'));
let session;
let server;
const originalCwd = process.cwd();
try {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ provider: 'novel-validation', tokensPerSecond: Infinity });
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage('SDK_OK')]);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager, noExtensions: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool-search'], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Validation only.' });
  await resourceLoader.reload();
  ({ session } = await createAgentSession({ cwd: directory, agentDir: directory, modelRuntime: runtime, model: faux.getModel(), thinkingLevel: 'off', tools: [], resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(directory) }));
  await session.prompt('Return SDK_OK');
  assert.equal(faux.state.callCount, 1);
  assert.match(JSON.stringify(session.messages), /SDK_OK/);
  assert.equal(session.agent.state.tools.length, 0);
  let serverHealth = 'not requested';
  const entryIndex = process.argv.indexOf('--server-entry');
  if (entryIndex !== -1) {
    assert.ok(process.argv[entryIndex + 1]);
    const entry = resolve(process.argv[entryIndex + 1]);
    const require = createRequire(import.meta.url);
    const { startServer } = require(entry);
    process.chdir(directory);
    server = startServer({ HOST: '127.0.0.1', PORT: '0' });
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    serverHealth = '200';
  }
  console.log(JSON.stringify({ status: 'passed', node: process.version, platform: process.platform, sdk: '1.4.0', modelCalls: faux.state.callCount, tools: 0, network: 'no real LLM', serverHealth }));
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  session?.dispose();
  process.chdir(originalCwd);
  const resolved = join(tmpdir(), 'novel-pi-smoke-');
  if (!directory.startsWith(resolved)) throw new Error('Unexpected temporary directory');
  rmSync(directory, { recursive: true, force: true });
}
