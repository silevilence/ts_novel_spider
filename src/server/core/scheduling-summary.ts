import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createOllama } from 'ai-sdk-ollama';

import { SqliteNovelRepository, type StoredScheduledNovelRow } from './novel-repository';
import {
  SystemPreferencesService,
  type LlmModelConfig,
  type LlmModelGatewayRoute,
  type LlmPreferencesState,
  type LlmProviderConfig,
} from './system-preferences';
import type { StoredChapterRecord } from './spider';

export interface AutoSummaryReadiness {
  ready: boolean;
  reason?: string;
}

export interface SchedulingSummaryResult {
  providerId: string;
  modelId: string;
  summary: string;
}

interface ResolvedSummaryModel {
  provider: LlmProviderConfig;
  model: LlmModelConfig;
}

export class SchedulingSummaryService {
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;

  constructor(repository: SqliteNovelRepository, preferences: SystemPreferencesService) {
    this.#repository = repository;
    this.#preferences = preferences;
  }

  getAutoSummaryReadiness(novel: Pick<StoredScheduledNovelRow, 'summarizeModel'>): AutoSummaryReadiness {
    const resolved = this.#resolveSummaryModel(novel);
    if (!resolved) {
      return {
        ready: false,
        reason: '没有可用的更新总结模型。请先在定时更新页选择默认总结模型，或配置模型网关默认对话模型。',
      };
    }

    return { ready: true };
  }

  async summarizeNewChapters(input: {
    sourceId: string;
    novelId: string;
    novel: Pick<StoredScheduledNovelRow, 'summarizeModel'>;
    chapters: StoredChapterRecord[];
  }): Promise<SchedulingSummaryResult> {
    const resolved = this.#resolveSummaryModel(input.novel);
    if (!resolved) {
      throw new Error('没有可用的更新总结模型。');
    }

    const snapshot = this.#repository.getSnapshot(input.sourceId, input.novelId);
    const prompt = buildSchedulingSummaryPrompt(snapshot?.metadata.title ?? input.novelId, input.chapters);
    const summary = (await generateChatText(resolved.provider, resolved.model, prompt)).trim();

    if (!summary) {
      throw new Error('更新总结为空。');
    }

    return {
      providerId: resolved.provider.id,
      modelId: resolved.model.modelId,
      summary,
    };
  }

  #resolveSummaryModel(novel: Pick<StoredScheduledNovelRow, 'summarizeModel'>): ResolvedSummaryModel | null {
    const llmState = this.#preferences.getLlmState();
    const scheduling = this.#preferences.getScheduling();
    const gateway = this.#preferences.getModelGateway();

    return (
      resolveChatRoute(llmState, novel.summarizeModel)
      ?? resolveChatRoute(llmState, scheduling.summaryModel)
      ?? resolveChatRoute(llmState, gateway.chat)
    );
  }
}

function resolveChatRoute(
  state: LlmPreferencesState,
  route: LlmModelGatewayRoute | null | undefined,
): ResolvedSummaryModel | null {
  if (!route) {
    return null;
  }

  const provider = state.providers.find(
    (entry) => entry.id === route.providerId && entry.enabled && entry.isConfigured,
  );
  if (!provider) {
    return null;
  }

  const model = provider.models.find(
    (entry) => entry.modelId === route.modelId
      && entry.enabled
      && entry.isConfigured
      && entry.resolvedCapabilities.includes('chat'),
  );
  if (!model) {
    return null;
  }

  return { provider, model };
}

function buildSchedulingSummaryPrompt(novelTitle: string, chapters: StoredChapterRecord[]): string {
  const chapterBlocks = chapters.map((chapter, index) => {
    const content = typeof chapter.content === 'string'
      ? chapter.content.replace(/\s+/g, ' ').trim().slice(0, 1800)
      : '';

    return [
      `章节 ${index + 1}: ${chapter.title}`,
      `章节ID: ${chapter.id}`,
      `正文摘录: ${content}`,
    ].join('\n');
  }).join('\n\n---\n\n');

  return [
    '你是小说追更助手，需要为刚刚新增的章节生成简洁、准确的中文更新总结。',
    '输出要求：',
    '1. 第一行以“更新章节：”开头，列出新增章节标题。',
    '2. 后续用 3 到 6 条短句概括关键剧情推进、人物变化、冲突与线索。',
    '3. 不要编造原文没有的信息，不要输出提示语或免责声明。',
    '4. 总长度控制在 180 到 320 字之间。',
    '',
    `作品：${novelTitle}`,
    `新增章节数：${chapters.length}`,
    '',
    chapterBlocks,
  ].join('\n');
}

async function generateChatText(provider: LlmProviderConfig, model: LlmModelConfig, prompt: string): Promise<string> {
  switch (provider.type) {
    case 'openai-compatible': {
      const factory = createOpenAI({
        apiKey: provider.apiKey,
        baseURL: buildProviderApiBaseUrl(provider),
        ...(provider.organization ? { organization: provider.organization } : {}),
      });
      const result = await generateText({ model: factory.chat(model.modelId), prompt, maxOutputTokens: 480 });
      return result.text;
    }
    case 'anthropic': {
      const factory = createAnthropic({ apiKey: provider.apiKey, baseURL: normalizeBaseUrl(provider.baseUrl) });
      const result = await generateText({ model: factory(model.modelId), prompt, maxOutputTokens: 480 });
      return result.text;
    }
    case 'google-generative-ai': {
      const factory = createGoogleGenerativeAI({ apiKey: provider.apiKey, baseURL: normalizeBaseUrl(provider.baseUrl) });
      const result = await generateText({ model: factory(model.modelId), prompt, maxOutputTokens: 480 });
      return result.text;
    }
    case 'ollama': {
      const factory = createOllama({
        baseURL: normalizeBaseUrl(provider.baseUrl),
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      });
      const result = await generateText({ model: factory.chat(model.modelId), prompt, maxOutputTokens: 480 });
      return result.text;
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = new URL(baseUrl).toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function buildProviderApiBaseUrl(provider: Pick<LlmProviderConfig, 'type' | 'baseUrl'>): string {
  const normalizedBaseUrl = normalizeBaseUrl(provider.baseUrl);
  if (provider.type !== 'openai-compatible') {
    return normalizedBaseUrl;
  }

  const url = new URL(normalizedBaseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (normalizedPath.length === 0) {
    url.pathname = '/v1';
    return url.toString().replace(/\/$/, '');
  }

  if (normalizedPath === '/v1') {
    return url.toString().replace(/\/$/, '');
  }

  return normalizedBaseUrl;
}