/** Isolated browser acceptance harness: no user database, credentials or remote models. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createServerApp } from '../../src/server/app';
import { ControlCenterService } from '../../src/server/core/control-center';
import { SqliteNovelRepository } from '../../src/server/core/novel-repository';
import { SystemPreferencesService } from '../../src/server/core/system-preferences';
import { NetworkProxyService } from '../../src/server/core/network-proxy';
import { agentConfigSchema } from '../../src/server/contracts/refined-agent';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'refined-agent-preview-'));
const repository = new SqliteNovelRepository(':memory:');
const preferences = new SystemPreferencesService();
const port = Number(process.env.AGENT_PREVIEW_PORT ?? 43123);
preferences.updateLlmProviders([{ id: 'preview', label: '本地协议模拟', type: 'openai-compatible', apiKey: 'preview-fixture-only', baseUrl: `http://127.0.0.1:${port}/v1`, models: [{ id: 'controller', modelId: 'controller', capabilities: ['chat'] }, { id: 'translator', modelId: 'translator', capabilities: ['chat'] }] }]);
preferences.updateModelGateway({ chat: { providerId: 'preview', modelId: 'translator' } });
const networkProxy = new NetworkProxyService();
const service = new ControlCenterService({ repository, systemPreferences: preferences, networkProxy, spiders: [], exportStoragePath: path.join(directory, 'exports'), offlineAssetStoragePath: path.join(directory, 'assets'), opdsArtifactsPath: path.join(directory, 'opds') });
const novel = repository.createManualNovel('花与旅人 · 验收样本');
for (const [index, title] of ['春日的车站', '远方的来信'].entries()) repository.saveManualChapter(novel.metadata.novelId, { title, content: `桜の下で、旅人は手紙を読んだ。${index + 1}\n\n風が静かに通り過ぎた。${index + 1}` });
const task = service.createRefinedTranslationTask('manual', novel.metadata.novelId, { name: '花与旅人 · Agent 验收', sourceLang: 'ja', targetLang: 'zh-CN', executionMode: 'agent', agentConfig: agentConfigSchema.parse({ initialCommand: '逐章翻译这部小说，保持温柔克制的叙事语气。审核后导出 Markdown。', controller: { providerId: 'preview', modelId: 'controller' } }), modelConfig: { translationModels: [{ providerId: 'preview', modelId: 'translator' }], reviewModel: { providerId: 'preview', modelId: 'translator' } } });
const app = express(); app.use(express.json());
app.post('/v1/chat/completions', async (request, response) => {
  const body = request.body as { model: string; messages: Array<{ role: string; content: string }>; tools?: unknown[] };
  await new Promise((resolve) => setTimeout(resolve, 350));
  const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
  const prompt = body.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
  let text = '';
  let calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | undefined;
  if (body.model === 'controller') {
    const input = JSON.parse(prompt) as { taskId: string }; const state = repository.getRefinedAgentState(input.taskId)!;
    const chapters = repository.listRefinedTranslationChapters(input.taskId);
    const operations = [{ operation: 'translate_metadata', chapterId: null }, ...chapters.flatMap((chapter) => [{ operation: 'translate_chapter', chapterId: chapter.chapterId }, { operation: 'check_chapter', chapterId: chapter.chapterId }, { operation: 'review_chapter', chapterId: chapter.chapterId }]), { operation: 'export', chapterId: null }];
    const next = operations.find((operation, index) => !state.receipts.some((receipt) => receipt.id === `preview-${index}` && receipt.status === 'completed'));
    const action = !state.plan ? { name: 'save_plan', input: { text: '1. 翻译作品信息。\n2. 逐章翻译、检查遗漏并审核。\n3. 检查完成条件，导出 Markdown。' } } : next ? { name: 'execute', input: { ...next, operationId: `preview-${operations.indexOf(next)}`, format: 'markdown' } } : { name: 'request_completion', input: {} };
    calls = [{ id: crypto.randomUUID(), type: 'function', function: { name: action.name, arguments: JSON.stringify(action.input) } }];
  } else if (system.includes('审核文学翻译')) text = '{"score":95,"issues":[],"scores":{"fluency":95,"consistency":95,"termAccuracy":95,"format":95}}';
  else if (system.includes('判断原文')) text = 'NO';
  else if (prompt.includes('桜の下')) text = '樱花树下，旅人展开信，默默读了起来。';
  else if (prompt.includes('風が')) text = '风静静地从身边经过。';
  else text = prompt;
  response.json({ id: crypto.randomUUID(), object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: calls ? null : text, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } });
});
app.use(createServerApp({ controlCenter: service }));
const server = app.listen(port, '127.0.0.1', () => process.stdout.write(`Preview: http://127.0.0.1:${port}/refined-translation\nTask: ${task.id}\nTemporary assets: ${directory}\n`));
process.on('SIGINT', () => { server.close(); service.close(); repository.close(); networkProxy.close(); process.exit(0); });
