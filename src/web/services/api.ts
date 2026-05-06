import type { HealthPayload } from '../../server/routes/health';
import type {
  ControlPreviewPayload,
  ControlSourcesPayload,
  ControlTaskPayload,
  ControlTasksPayload,
} from '../../server/routes/control-center';

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