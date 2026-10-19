import assert from 'node:assert/strict';
import test from 'node:test';
import { SchedulingSummaryService } from './scheduling-summary';
import { SystemPreferencesService } from './system-preferences';
import { SqliteNovelRepository } from './novel-repository';
import { textRequestFits } from './llm-context-budget';

test('scheduled summaries split by model budget while covering every new chapter', async (t) => {
  const prefs = new SystemPreferencesService();
  prefs.updateLlmProviders([{ id: 'p', baseUrl: 'http://fake.invalid/v1', apiKey: 'fake', models: [{ id: 'm', modelId: 'm', capabilities: ['chat'], contextWindowTokens: 4000 }] }]);
  prefs.updateModelGateway({ chat: { providerId: 'p', modelId: 'm' } });
  const submitted: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { messages: Array<{ content: string }>; max_tokens: number };
    const prompt = request.messages.at(-1)!.content;
    assert.ok(textRequestFits(4000, '', prompt, request.max_tokens));
    submitted.push(prompt);
    return Response.json({ id: 'test', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `总结${submitted.length}` } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    repository.saveMetadata('test', { novelId: 'n', title: '书', author: '', description: '', tags: [], chapterCount: 12, infoPageUrl: '' });
    const chapters = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, index: i + 1, title: `章节${i}`, url: '' }));
    repository.saveChapterIndex('test', 'n', chapters);
    chapters.forEach((chapter) => repository.saveChapterContent('test', 'n', { ...chapter, chapterId: chapter.id, content: '小说正文。'.repeat(150) }));
    const service = new SchedulingSummaryService(repository, prefs);
    const result = await service.summarizeNewChapters({ sourceId: 'test', novelId: 'n', novel: { summarizeModel: null }, chapters: repository.getSnapshot('test', 'n')!.chapters });
    assert.ok(submitted.length > 1);
    for (const chapter of chapters) assert.ok(submitted.some((prompt) => prompt.includes(`章节ID: ${chapter.id}\n`)));
    assert.ok(result.summary.endsWith(`总结${submitted.length}`));
  } finally { repository.close(); }
});
