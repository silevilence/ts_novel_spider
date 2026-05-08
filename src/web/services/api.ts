import type { HealthPayload } from '../../server/routes/health';
import type {
  ControlNetworkProxyPayload,
  ControlPreviewPayload,
  ControlSourcesPayload,
  ControlTaskPayload,
  ControlTasksPayload,
} from '../../server/routes/control-center';
import type {
  LibraryChapterDetailPayload,
  LibraryMediaPayload,
  LibraryNovelDetailPayload,
  LibraryNovelSummaryPayload,
} from '../../server/routes/library';

export type LibraryExportFormat = 'markdown' | 'txt' | 'epub';

export interface UpdateNetworkProxyInput {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: number | null;
  username: string;
  password: string;
  bypassHosts: string[];
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

export async function fetchLibraryNovels(): Promise<LibraryNovelSummaryPayload> {
  return requestJson<LibraryNovelSummaryPayload>('/api/library/novels');
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

export function buildLibraryExportDownloadUrl(
  sourceId: string,
  novelId: string,
  format: LibraryExportFormat,
): string {
  return `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/exports/${encodeURIComponent(format)}/download`;
}

async function requestJson<TPayload>(url: string): Promise<TPayload> {
  const response = await fetch(url);

  if (!response.ok) {
    throw await buildRequestError(response, `Request failed with status ${response.status}`);
  }

  return (await response.json()) as TPayload;
}

async function buildRequestError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { message?: string };
    return new Error(payload.message ?? fallbackMessage);
  } catch {
    return new Error(fallbackMessage);
  }
}