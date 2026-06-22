import type { HealthPayload } from '../../server/routes/health';
import type {
  ControlLlmProviderModelsPayload,
  ControlLlmProvidersPayload,
  ControlNeo4jPayload,
  ControlNetworkProxyPayload,
  ControlPreviewPayload,
  ControlReaderTypographyPayload,
  ControlSourcesPayload,
  ControlTaskPayload,
  ControlTasksPayload,
} from '../../server/routes/control-center';
import type {
  LibraryAliasPayload,
  LibraryAssistantPayload,
  LibraryBookmarkPayload,
  LibraryChapterDetailPayload,
  LibraryKnowledgeGraphBuildPayload,
  LibraryKnowledgeGraphPayload,
  LibraryKnowledgeGraphProfilePayload,
  LibraryMediaBatchPayload,
  LibraryMediaPayload,
  LibraryNovelDetailPayload,
  LibraryNovelSummaryPayload,
  LibraryReaderTypographyPayload,
  LibraryReadingProgressPayload,
  LibraryTranslationTermPayload,
  LibraryTranslationTermsPayload,
} from '../../server/routes/library';

export type LibraryExportFormat = 'markdown' | 'txt' | 'epub';
export type LibraryKnowledgeGraphBuildMode = 'full' | 'incremental' | 'rebuild';

export interface UpdateNetworkProxyInput {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: number | null;
  username: string;
  password: string;
  bypassHosts: string[];
}

export type ModelCapability = 'chat' | 'embedding' | 'rerank';
export type ModelCapabilityMode = 'manual' | 'auto';
export type LlmProviderType = 'openai-compatible' | 'anthropic' | 'google-generative-ai' | 'ollama';

export interface UpdateLlmModelInput {
  id: string;
  label: string;
  modelId: string;
  enabled: boolean;
  capabilityMode: ModelCapabilityMode;
  capabilities: ModelCapability[];
  defaultFor: ModelCapability[];
  contextWindowTokens?: number;
}

export interface UpdateLlmProviderInput {
  id: string;
  label: string;
  type: LlmProviderType;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  organization: string;
  models: UpdateLlmModelInput[];
}

export interface DiscoverLlmProviderModelsInput {
  label: string;
  type: LlmProviderType;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  organization: string;
}

export interface UpdateNeo4jInput {
  enabled: boolean;
  uri: string;
  username: string;
  password: string;
  database: string;
}

export interface UpdateKnowledgeGraphProfileInput {
  chatModel?: { providerId?: string; modelId?: string } | null;
  extractionModels?: Array<{ providerId?: string; modelId?: string; maxConcurrency?: number }> | null;
  embeddingModel?: { providerId?: string; modelId?: string } | null;
  rerankModel?: { providerId?: string; modelId?: string } | null;
  extractionConcurrency?: number;
  neo4j?: {
    enabled?: boolean;
    uri?: string;
    username?: string;
    password?: string;
    database?: string;
  } | null;
}

export async function fetchHealth(): Promise<HealthPayload> {
  const response = await fetch('/api/health');

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return (await response.json()) as HealthPayload;
}

export async function fetchControlSources(): Promise<ControlSourcesPayload> {
  return requestJson<ControlSourcesPayload>('/api/control/sources');
}

export async function fetchNetworkProxy(): Promise<ControlNetworkProxyPayload> {
  return requestJson<ControlNetworkProxyPayload>('/api/control/network-proxy');
}

export async function fetchLlmProvidersPreferences(): Promise<ControlLlmProvidersPayload> {
  return requestJson<ControlLlmProvidersPayload>('/api/control/preferences/llm-providers');
}

export async function updateLlmProvidersPreferences(
  providers: UpdateLlmProviderInput[],
): Promise<ControlLlmProvidersPayload> {
  const response = await fetch('/api/control/preferences/llm-providers', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ providers }),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'LLM preferences update failed');
  }

  return (await response.json()) as ControlLlmProvidersPayload;
}

export async function discoverLlmProviderModels(
  provider: DiscoverLlmProviderModelsInput,
): Promise<ControlLlmProviderModelsPayload> {
  const response = await fetch('/api/control/preferences/llm-providers/discover-models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider }),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'LLM model discovery failed');
  }

  return (await response.json()) as ControlLlmProviderModelsPayload;
}

export async function validateLlmProviderModel(
  providerId: string,
  modelId: string,
): Promise<ControlLlmProvidersPayload> {
  const response = await fetch(
    `/api/control/preferences/llm-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/validate`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    throw await buildRequestError(response, 'LLM model validation failed');
  }

  return (await response.json()) as ControlLlmProvidersPayload;
}

export async function fetchNeo4jPreferences(): Promise<ControlNeo4jPayload> {
  return requestJson<ControlNeo4jPayload>('/api/control/preferences/neo4j');
}

export async function updateNeo4jPreferences(
  input: UpdateNeo4jInput,
): Promise<ControlNeo4jPayload> {
  const response = await fetch('/api/control/preferences/neo4j', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Neo4j preferences update failed');
  }

  return (await response.json()) as ControlNeo4jPayload;
}

export async function validateNeo4jPreferences(): Promise<ControlNeo4jPayload> {
  const response = await fetch('/api/control/preferences/neo4j/validate', {
    method: 'POST',
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Neo4j validation failed');
  }

  return (await response.json()) as ControlNeo4jPayload;
}

export async function fetchReaderTypographyPreferences(): Promise<ControlReaderTypographyPayload> {
  return requestJson<ControlReaderTypographyPayload>('/api/control/preferences/reader-typography');
}

export interface UpdateReaderTypographyInput {
  fontSize?: number;
  fontSizePreset?: 'small' | 'medium' | 'large';
  lineHeight?: number;
  paragraphSpacing?: number;
  fontFamilyPreset?: 'sans' | 'serif' | 'monospace' | 'custom';
  fontFamilyCustom?: string;
}

export async function updateReaderTypographyPreferences(
  input: UpdateReaderTypographyInput,
): Promise<ControlReaderTypographyPayload> {
  const response = await fetch('/api/control/preferences/reader-typography', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Reader typography preferences update failed');
  }

  return (await response.json()) as ControlReaderTypographyPayload;
}

export async function fetchLibraryReaderTypography(
  sourceId: string,
  novelId: string,
): Promise<LibraryReaderTypographyPayload> {
  return requestJson<LibraryReaderTypographyPayload>(`/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/reader-typography`);
}

export async function updateLibraryReaderTypography(
  sourceId: string,
  novelId: string,
  input: UpdateReaderTypographyInput,
): Promise<LibraryReaderTypographyPayload> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/reader-typography`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw await buildRequestError(response, 'Library reader typography update failed');
  }

  return (await response.json()) as LibraryReaderTypographyPayload;
}

export async function deleteLibraryReaderTypography(
  sourceId: string,
  novelId: string,
): Promise<LibraryReaderTypographyPayload> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/reader-typography`,
    {
      method: 'DELETE',
    },
  );

  if (!response.ok) {
    throw await buildRequestError(response, 'Library reader typography reset failed');
  }

  return (await response.json()) as LibraryReaderTypographyPayload;
}

export async function updateNetworkProxy(
  input: UpdateNetworkProxyInput,
): Promise<ControlNetworkProxyPayload> {
  const response = await fetch('/api/control/network-proxy', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Proxy config update failed');
  }

  return (await response.json()) as ControlNetworkProxyPayload;
}

export async function validateNetworkProxy(targetUrl?: string): Promise<ControlNetworkProxyPayload> {
  const response = await fetch('/api/control/network-proxy/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(targetUrl ? { targetUrl } : {}),
    }),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Proxy validation failed');
  }

  return (await response.json()) as ControlNetworkProxyPayload;
}

export async function fetchNovelPreview(
  sourceId: string,
  novelId: string,
): Promise<ControlPreviewPayload> {
  const query = new URLSearchParams({ sourceId, novelId });
  return requestJson<ControlPreviewPayload>(`/api/control/preview?${query.toString()}`);
}

export async function createControlTask(input: {
  sourceId: string;
  novelId: string;
  chapterIds?: string[];
  forceRefetch?: boolean;
  chapterConcurrency?: number;
  chapterRetryCount?: number;
}): Promise<ControlTaskPayload> {
  const response = await fetch('/api/control/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Task creation failed');
  }

  return (await response.json()) as ControlTaskPayload;
}

export async function fetchTask(taskId: string): Promise<ControlTaskPayload> {
  return requestJson<ControlTaskPayload>(`/api/control/tasks/${taskId}`);
}

export async function fetchRecentTasks(limit = 8): Promise<ControlTasksPayload> {
  return requestJson<ControlTasksPayload>(`/api/control/tasks?limit=${limit}`);
}

export async function fetchLibraryNovels(query?: string): Promise<LibraryNovelSummaryPayload> {
  const search = query?.trim()
    ? `?q=${encodeURIComponent(query.trim())}`
    : '';

  return requestJson<LibraryNovelSummaryPayload>(`/api/library/novels${search}`);
}

export async function fetchLibraryNovel(
  sourceId: string,
  novelId: string,
): Promise<LibraryNovelDetailPayload> {
  return requestJson<LibraryNovelDetailPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}`,
  );
}

export async function fetchLibraryChapter(
  sourceId: string,
  novelId: string,
  chapterId: string,
): Promise<LibraryChapterDetailPayload> {
  return requestJson<LibraryChapterDetailPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`,
  );
}

export async function fetchLibraryKnowledgeGraph(
  sourceId: string,
  novelId: string,
): Promise<LibraryKnowledgeGraphPayload> {
  return requestJson<LibraryKnowledgeGraphPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph`,
  );
}

export async function updateLibraryKnowledgeGraphProfile(
  sourceId: string,
  novelId: string,
  input: UpdateKnowledgeGraphProfileInput,
): Promise<LibraryKnowledgeGraphProfilePayload> {
  return requestJson<LibraryKnowledgeGraphProfilePayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph/profile`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function buildLibraryKnowledgeGraph(
  sourceId: string,
  novelId: string,
  mode: LibraryKnowledgeGraphBuildMode = 'incremental',
): Promise<LibraryKnowledgeGraphBuildPayload> {
  return requestJson<LibraryKnowledgeGraphBuildPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph/build`,
    {
      method: 'POST',
      ...(mode === 'incremental'
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
          }),
    },
  );
}

export async function pauseLibraryKnowledgeGraph(
  sourceId: string,
  novelId: string,
): Promise<LibraryKnowledgeGraphBuildPayload> {
  return requestJson<LibraryKnowledgeGraphBuildPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph/pause`,
    {
      method: 'POST',
    },
  );
}

export async function resumeLibraryKnowledgeGraph(
  sourceId: string,
  novelId: string,
): Promise<LibraryKnowledgeGraphBuildPayload> {
  return requestJson<LibraryKnowledgeGraphBuildPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph/resume`,
    {
      method: 'POST',
    },
  );
}

export interface SyncNeo4jKnowledgeGraphResult {
  synced: boolean;
  message: string;
  entityCount: number;
  relationCount: number;
}

export async function syncLibraryKnowledgeGraphToNeo4j(
  sourceId: string,
  novelId: string,
): Promise<SyncNeo4jKnowledgeGraphResult> {
  return requestJson<SyncNeo4jKnowledgeGraphResult>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph/sync-neo4j`,
    {
      method: 'POST',
    },
  );
}

    export async function deleteLibraryKnowledgeGraph(
      sourceId: string,
      novelId: string,
    ): Promise<LibraryKnowledgeGraphPayload> {
      const response = await fetch(`/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/graph`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw await buildRequestError(response, 'Knowledge graph clear failed');
      }

      return (await response.json()) as LibraryKnowledgeGraphPayload;
    }

export async function askLibraryAssistant(
  sourceId: string,
  novelId: string,
  message: string,
  chapterId?: string,
): Promise<LibraryAssistantPayload> {
  return requestJson<LibraryAssistantPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/assistant/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        ...(chapterId ? { chapterId } : {}),
      }),
    },
  );
}

export async function cacheLibraryMedia(
  sourceId: string,
  novelId: string,
  chapterId: string,
  mediaId: string,
): Promise<LibraryMediaPayload> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/media/${encodeURIComponent(mediaId)}/cache`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    throw await buildRequestError(response, 'Media cache failed');
  }

  return (await response.json()) as LibraryMediaPayload;
}

export async function cacheLibraryNovelMedia(
  sourceId: string,
  novelId: string,
): Promise<LibraryMediaBatchPayload> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/media/cache`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    throw await buildRequestError(response, 'Media batch cache failed');
  }

  return (await response.json()) as LibraryMediaBatchPayload;
}

export async function createLibraryAlias(
  sourceId: string,
  novelId: string,
  alias: string,
): Promise<LibraryAliasPayload> {
  return requestJson<LibraryAliasPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/aliases`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias }),
    },
  );
}

export async function updateLibraryAlias(
  sourceId: string,
  novelId: string,
  aliasId: string,
  alias: string,
): Promise<LibraryAliasPayload> {
  return requestJson<LibraryAliasPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/aliases/${encodeURIComponent(aliasId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias }),
    },
  );
}

export async function deleteLibraryAlias(
  sourceId: string,
  novelId: string,
  aliasId: string,
): Promise<void> {
  await requestVoid(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/aliases/${encodeURIComponent(aliasId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function updateLibraryReadingProgress(
  sourceId: string,
  novelId: string,
  chapterId: string,
): Promise<LibraryReadingProgressPayload> {
  return requestJson<LibraryReadingProgressPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/progress`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId }),
    },
  );
}

export async function createLibraryBookmark(
  sourceId: string,
  novelId: string,
  chapterId: string,
  note: string,
): Promise<LibraryBookmarkPayload> {
  return requestJson<LibraryBookmarkPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/bookmarks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId, note }),
    },
  );
}

export async function updateLibraryBookmark(
  sourceId: string,
  novelId: string,
  bookmarkId: string,
  note: string,
): Promise<LibraryBookmarkPayload> {
  return requestJson<LibraryBookmarkPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
  );
}

export async function deleteLibraryBookmark(
  sourceId: string,
  novelId: string,
  bookmarkId: string,
): Promise<void> {
  await requestVoid(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    {
      method: 'DELETE',
    },
  );
}

// ── 翻译任务 ──

export interface TranslationBuildPayload {
  translation: {
    status: string;
    stage: string;
    progressPercent: number;
    message: string;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    translatedChapters: number;
    failedChapters: number;
    currentChapterParagraphs: number;
    currentChapterTranslatedParagraphs: number;
    totalTranslatedParagraphs: number;
    totalParagraphEstimate: number;
  };
}

export async function startLibraryTranslation(
  sourceId: string,
  novelId: string,
  modelOverride?: string,
  fromScratch?: boolean,
): Promise<TranslationBuildPayload> {
  const body: Record<string, unknown> = {};
  if (modelOverride) body.modelOverride = modelOverride;
  if (fromScratch) body.fromScratch = true;

  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw await buildRequestError(response, 'Translation start failed');
  }

  return (await response.json()) as TranslationBuildPayload;
}

export async function cancelLibraryTranslation(
  sourceId: string,
  novelId: string,
): Promise<TranslationBuildPayload> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/cancel`,
    { method: 'POST' },
  );
  if (!response.ok) throw await buildRequestError(response, 'Translation cancel failed');
  return (await response.json()) as TranslationBuildPayload;
}

export async function fetchLibraryTranslationBuild(
  sourceId: string,
  novelId: string,
): Promise<TranslationBuildPayload> {
  return requestJson<TranslationBuildPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/build`,
  );
}

export async function fetchLibraryTranslationChapter(
  sourceId: string,
  novelId: string,
  chapterId: string,
  sourceLang: string,
  targetLang: string,
): Promise<{
  chapterId: string;
  status: string;
  translatedTitle: string | null;
  overallQualityScore: number | null;
  paragraphs: Array<{
    paragraphIndex: number;
    sourceText: string;
    translatedText: string | null;
    confidence: number | null;
  }>;
} | null> {
  const url = `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/chapters/${encodeURIComponent(chapterId)}?sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`;
  try {
    return await requestJson(url) as {
      chapterId: string;
      status: string;
      translatedTitle: string | null;
      overallQualityScore: number | null;
      paragraphs: Array<{
        paragraphIndex: number;
        sourceText: string;
        translatedText: string | null;
        confidence: number | null;
      }>;
    };
  } catch {
    return null;
  }
}

export function buildLibraryExportDownloadUrl(
  sourceId: string,
  novelId: string,
  format: LibraryExportFormat,
  mode?: string,
  sourceLang?: string,
  targetLang?: string,
): string {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (sourceLang) params.set('sourceLang', sourceLang);
  if (targetLang) params.set('targetLang', targetLang);
  const qs = params.toString();
  return `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/exports/${encodeURIComponent(format)}/download${qs ? `?${qs}` : ''}`;
}

// ── 术语库 ──

export async function fetchLibraryTranslationTerms(
  sourceId: string,
  novelId: string,
): Promise<LibraryTranslationTermsPayload> {
  return requestJson<LibraryTranslationTermsPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/terms`,
  );
}

export interface CreateTranslationTermInput {
  sourceTerm: string;
  targetTerm?: string | null;
  entityType?: string | null;
  note?: string | null;
  priority?: number;
}

export async function createLibraryTranslationTerm(
  sourceId: string,
  novelId: string,
  input: CreateTranslationTermInput,
): Promise<LibraryTranslationTermPayload> {
  return requestJson<LibraryTranslationTermPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/terms`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export interface UpdateTranslationTermInput {
  targetTerm?: string | null;
  entityType?: string | null;
  note?: string | null;
  priority?: number;
}

export async function updateLibraryTranslationTerm(
  sourceId: string,
  novelId: string,
  termId: string,
  updates: UpdateTranslationTermInput,
): Promise<LibraryTranslationTermPayload> {
  return requestJson<LibraryTranslationTermPayload>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/terms/${encodeURIComponent(termId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    },
  );
}

export async function deleteLibraryTranslationTerm(
  sourceId: string,
  novelId: string,
  termId: string,
): Promise<void> {
  await requestVoid(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/terms/${encodeURIComponent(termId)}`,
    {
      method: 'DELETE',
    },
  );
}

export interface ImportGraphEntitiesToTermsResult {
  imported: number;
  updated: number;
  skipped: number;
}

export async function importGraphEntitiesToTerms(
  sourceId: string,
  novelId: string,
): Promise<ImportGraphEntitiesToTermsResult> {
  return requestJson<ImportGraphEntitiesToTermsResult>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/translate/terms/import-from-graph`,
    { method: 'POST' },
  );
}

// ── 翻译 ──

export type TranslationExportMode = 'original' | 'translated' | 'bilingual';

export interface TranslationPreferencesPayload {
  config: {
    sourceLang: string;
    targetLang: string;
    termExtractionModel: { providerId?: string; modelId?: string } | null;
    translationModels: Array<{ providerId?: string; modelId?: string }>;
    translationConcurrency: number;
    preferredTranslationModelKey: string | null;
    enableLlmInteractionLog: boolean;
    autoRejectUntranslatedTerms: boolean;
    defaultExportMode: TranslationExportMode;
  };
  updatedAt: string | null;
}

export async function fetchTranslationPreferences(): Promise<TranslationPreferencesPayload> {
  return requestJson<TranslationPreferencesPayload>('/api/control/preferences/translation');
}

export async function updateTranslationPreferences(
  input: Record<string, unknown>,
): Promise<TranslationPreferencesPayload> {
  const response = await fetch('/api/control/preferences/translation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Translation preferences update failed');
  }

  return (await response.json()) as TranslationPreferencesPayload;
}

// ── Model Gateway ──

export interface ModelGatewayPayload {
  chat?: { providerId: string; modelId: string };
  embedding?: { providerId: string; modelId: string };
  rerank?: { providerId: string; modelId: string };
}

export async function fetchModelGateway(): Promise<ModelGatewayPayload> {
  return requestJson<ModelGatewayPayload>('/api/control/preferences/model-gateway');
}

export async function updateModelGateway(
  input: ModelGatewayPayload,
): Promise<ModelGatewayPayload> {
  const response = await fetch('/api/control/preferences/model-gateway', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await buildRequestError(response, 'Model gateway update failed');
  }

  return (await response.json()) as ModelGatewayPayload;
}

// ── 定时更新调度 ──

export interface SchedulingConfig {
  enabled: boolean;
  mode: 'interval' | 'cron' | 'weekly';
  intervalHours: number;
  cronExpression: string;
  weeklyDays: number[];
  weeklyTime: string;
  updatedAt: string | null;
  lastCheckRun?: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: string;
    totalChecked: number;
    newChaptersFound: number;
    skipped: number;
    errored: number;
  } | null;
}

export interface SchedulingNovelEntry {
  sourceId: string;
  novelId: string;
  title: string;
  enabled: boolean;
}

export interface SchedulingNovelDetail {
  sourceId: string;
  novelId: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastCheckResult: 'new_chapters' | 'up_to_date' | 'error' | null;
  lastCheckMessage: string | null;
  updatedAt: string;
}

export interface SchedulingNovelsPayload {
  novels: SchedulingNovelEntry[];
}

export async function fetchSchedulingConfig(): Promise<SchedulingConfig> {
  const response = await fetch('/api/control/scheduling');
  if (!response.ok) {
    throw new Error(`获取调度配置失败 (${response.status})`);
  }
  return response.json();
}

export async function updateSchedulingConfig(input: Partial<SchedulingConfig>): Promise<SchedulingConfig> {
  const response = await fetch('/api/control/scheduling', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`更新调度配置失败 (${response.status})`);
  }
  return response.json();
}

export async function fetchNovelScheduling(sourceId: string, novelId: string): Promise<SchedulingNovelDetail> {
  const response = await fetch(`/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/scheduling`);
  if (!response.ok) {
    throw new Error(`获取书籍调度状态失败 (${response.status})`);
  }
  return response.json();
}

export async function updateNovelScheduling(sourceId: string, novelId: string, enabled: boolean): Promise<SchedulingNovelDetail> {
  const response = await fetch(`/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/scheduling`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`更新书籍调度状态失败 (${response.status})`);
  }
  return response.json();
}

export async function fetchSchedulingNovels(): Promise<SchedulingNovelsPayload> {
  const response = await fetch('/api/library/scheduling/novels');
  if (!response.ok) {
    throw new Error(`获取调度书单失败 (${response.status})`);
  }
  return response.json();
}

export async function updateSchedulingNovels(entries: Array<{ sourceId: string; novelId: string; enabled: boolean }>): Promise<void> {
  const response = await fetch('/api/library/scheduling/novels', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novels: entries }),
  });
  if (!response.ok) {
    throw new Error(`更新调度书单失败 (${response.status})`);
  }
}

// ── OPDS 书源服务 ──

export interface OpdsCompilationRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalScanned: number;
  compiled: number;
  skipped: number;
  errored: number;
}

export interface OpdsConfig {
  enabled: boolean;
  scanCronExpression: string;
  updatedAt: string | null;
  lastRun: OpdsCompilationRun | null;
}

export interface OpdsNovelEntry {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface OpdsNovelsPayload {
  novels: OpdsNovelEntry[];
}

export interface OpdsRunsPayload {
  runs: OpdsCompilationRun[];
}

export interface NovelOpdsStatus {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export async function fetchOpdsConfig(): Promise<OpdsConfig> {
  return requestJson<OpdsConfig>('/api/control/preferences/opds');
}

export async function updateOpdsConfig(
  input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>,
): Promise<OpdsConfig> {
  const response = await fetch('/api/control/preferences/opds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await buildRequestError(response, 'OPDS 配置更新失败');
  }
  return (await response.json()) as OpdsConfig;
}

export async function fetchOpdsNovels(): Promise<OpdsNovelsPayload> {
  return requestJson<OpdsNovelsPayload>('/api/library/opds/novels');
}

export async function updateOpdsNovels(
  entries: Array<{ sourceId: string; novelId: string; visible: boolean }>,
): Promise<{ ok: boolean }> {
  const response = await fetch('/api/library/opds/novels', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novels: entries }),
  });
  if (!response.ok) {
    throw await buildRequestError(response, 'OPDS 书单更新失败');
  }
  return (await response.json()) as { ok: boolean };
}

export async function fetchOpdsRuns(limit = 20, offset = 0): Promise<OpdsRunsPayload> {
  return requestJson<OpdsRunsPayload>(`/api/control/opds/runs?limit=${limit}&offset=${offset}`);
}

export async function fetchNovelOpdsStatus(
  sourceId: string,
  novelId: string,
): Promise<NovelOpdsStatus> {
  return requestJson<NovelOpdsStatus>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/opds`,
  );
}

export async function updateNovelOpdsVisible(
  sourceId: string,
  novelId: string,
  visible: boolean,
): Promise<NovelOpdsStatus> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/opds`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible }),
    },
  );
  if (!response.ok) {
    throw await buildRequestError(response, 'OPDS 可见性更新失败');
  }
  return (await response.json()) as NovelOpdsStatus;
}

async function requestJson<TPayload>(url: string, init?: RequestInit): Promise<TPayload> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw await buildRequestError(response, `Request failed with status ${response.status}`);
  }

  return (await response.json()) as TPayload;
}

async function requestVoid(url: string, init?: RequestInit): Promise<void> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw await buildRequestError(response, `Request failed with status ${response.status}`);
  }
}

async function buildRequestError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { message?: string };
    return new Error(payload.message ?? fallbackMessage);
  } catch {
    return new Error(fallbackMessage);
  }
}