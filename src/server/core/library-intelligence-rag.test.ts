import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemPreferencesService } from './system-preferences';
import { SqliteNovelRepository } from './novel-repository';
import { buildKnowledgeGraphArtifacts, collectAssistantSources, processChunkWithRoute } from './library-intelligence-rag';
import { modelInputFits, requestContextTokens } from './llm-context-budget';

test('graph extraction, embeddings and reranking obey their respective model budgets', async (t) => {
  const prefs = new SystemPreferencesService();
  prefs.updateLlmProviders([{ id: 'p', type: 'openai-compatible', apiKey: 'fake', baseUrl: 'http://fake.invalid/v1', models: [
    { id: 'chat', modelId: 'chat', capabilities: ['chat'], contextWindowTokens: 10000 },
    { id: 'embed', modelId: 'embed', capabilities: ['embedding'], contextWindowTokens: 700 },
    { id: 'rerank', modelId: 'rerank', capabilities: ['rerank'], contextWindowTokens: 900 },
  ] }]);
  const provider = prefs.getLlmState().providers[0]!;
  const route = (modelId: string) => ({ provider, model: provider.models.find((model) => model.modelId === modelId)!, source: 'global' as const, maxConcurrency: 1 });
  const chunks: string[] = [];
  let embeddingCalls = 0;
  let rerankCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      model: string; input: string[]; query: string; documents: string[];
      messages: Array<{ role: string; content: string }>; max_tokens: number;
      response_format?: { json_schema: { schema: Record<string, unknown> } };
    };
    if (String(url).includes('/embeddings')) {
      embeddingCalls++;
      assert.ok(modelInputFits(700, body.input));
      return Response.json({ data: body.input.map((text, index) => ({ index, embedding: [text.length, 1, 2] })), usage: { prompt_tokens: 1, total_tokens: 1 } });
    }
    if (String(url).includes('/rerank')) {
      rerankCalls++;
      assert.ok(modelInputFits(900, { query: body.query, documents: body.documents }));
      return Response.json({ data: body.documents.map((_, index) => ({ index, relevance_score: 0.9 })) });
    }
    const input = requestContextTokens({
      prompt: body.messages.map((message) => message.role === 'system' ? { role: 'system' as const, content: message.content }
        : { role: 'user' as const, content: [{ type: 'text' as const, text: message.content }] }),
      ...(body.response_format ? { responseFormat: { type: 'json' as const, schema: body.response_format.json_schema.schema } } : {}),
    });
    assert.ok(input + body.max_tokens <= 10000);
    chunks.push(body.messages.at(-1)!.content.split('正文：\n\n')[1]!);
    return Response.json({ id: 'test', object: 'chat.completion', created: 0, model: 'chat', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ summary: '猫の冒険', events: [], entities: [], relations: [], keywordHints: ['猫'] }) } }] });
  });
  const repository = new SqliteNovelRepository(':memory:');
  try {
    const source = '猫が旅に出る。'.repeat(1000);
    repository.saveMetadata('test', { novelId: 'n', title: '猫', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: '' });
    repository.saveChapterIndex('test', 'n', [{ id: 'c', index: 1, title: '猫の物語', url: '' }]);
    repository.saveChapterContent('test', 'n', { chapterId: 'c', index: 1, title: '猫の物語', url: '', content: source });
    const snapshot = repository.getSnapshot('test', 'n')!;
    const extraction = await processChunkWithRoute(snapshot, { id: 'chunk', chapterId: 'c', chapterIndex: 1, chapterTitle: '猫の物語', chunkIndex: 0, content: source }, route('chat'));
    assert.equal(extraction.warning, null);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(''), source);
    const artifacts = await buildKnowledgeGraphArtifacts({ snapshot, extractionModels: [route('chat')], embeddingModel: route('embed') });
    assert.ok(embeddingCalls > 1);
    assert.ok(artifacts.chunks.every((chunk) => chunk.embedding?.length === 3));
    const result = await collectAssistantSources({ snapshot, query: '猫の冒険', entities: artifacts.entities, relations: artifacts.relations, chunks: artifacts.chunks, summaries: artifacts.summaries, embeddingModel: route('embed'), rerankModel: route('rerank') });
    assert.ok(result.trace.usedEmbedding);
    assert.ok(result.trace.usedRerank);
    assert.ok(rerankCalls > 1);
  } finally { repository.close(); }
});
