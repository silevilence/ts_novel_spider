import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  createControlTask,
  fetchControlSources,
  fetchHealth,
  fetchNovelPreview,
  fetchRecentTasks,
  fetchTask,
} from './api';
import { SseTaskLogBridge } from './task-log-bridge';
import type { HealthPayload } from '../../server/routes/health';
import type {
  ApiTaskSnapshot,
  ControlPreviewPayload,
  ControlSourcesPayload,
} from '../../server/routes/control-center';

export type NoticeTone = 'success' | 'error' | 'info';

export interface NoticeInput {
  tone: NoticeTone;
  title: string;
  message: string;
}

interface TaskSubmissionTarget {
  sourceId: string;
  novelId: string;
}

interface TaskSubmissionOptions {
  chapterIds?: string[];
  forceRefetch: boolean;
  chapterConcurrency: number;
  chapterRetryCount: number;
}

export interface ControlCenterModel {
  health: HealthPayload | null;
  errorMessage: string | null;
  preview: ControlPreviewPayload | null;
  previewError: string | null;
  sources: ControlSourcesPayload['sources'];
  selectedSource: ControlSourcesPayload['sources'][number] | null;
  selectedSourceId: string;
  novelId: string;
  selectedChapterIds: string[];
  currentTask: ApiTaskSnapshot | null;
  recentTasks: ApiTaskSnapshot[];
  previewBusy: boolean;
  taskBusy: boolean;
  isBusy: boolean;
  streamState: 'idle' | 'connected' | 'reconnecting';
  forceRefetch: boolean;
  chapterConcurrency: number;
  chapterRetryCount: number;
  getSourceLabel: (sourceId: string) => string;
  setNovelId: (value: string) => void;
  setForceRefetch: (value: boolean) => void;
  setChapterConcurrency: (value: number) => void;
  setChapterRetryCount: (value: number) => void;
  handleSourceChange: (sourceId: string) => void;
  handlePreviewSubmit: () => Promise<void>;
  handleCreateTask: (chapterIds?: string[]) => Promise<void>;
  handlePickTask: (taskId: string) => Promise<void>;
  handleRetryFailed: () => Promise<void>;
  toggleChapterSelection: (chapterId: string) => void;
  selectAllChapters: () => void;
  selectPendingChapters: () => void;
  selectFailedChapters: () => void;
  clearSelectedChapters: () => void;
}

export function useControlCenterModel(onNotice: (notice: NoticeInput) => void): ControlCenterModel {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ControlPreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sources, setSources] = useState<ControlSourcesPayload['sources']>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [novelId, setNovelId] = useState('');
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [currentTask, setCurrentTask] = useState<ApiTaskSnapshot | null>(null);
  const [recentTasks, setRecentTasks] = useState<ApiTaskSnapshot[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'reconnecting'>('idle');
  const [forceRefetch, setForceRefetch] = useState(false);
  const [chapterConcurrency, setChapterConcurrencyState] = useState(4);
  const [chapterRetryCount, setChapterRetryCountState] = useState(1);
  const lastObservedTaskRef = useRef<{ id: string; status: ApiTaskSnapshot['status'] } | null>(null);
  const publishNotice = useEffectEvent(onNotice);

  const hydratePreview = useEffectEvent((payload: ControlPreviewPayload) => {
    startTransition(() => {
      setPreview(payload);
      setPreviewError(null);
      setSelectedChapterIds(defaultSelectedChapterIds(payload.chapters));
      if (payload.activeTask) {
        setCurrentTask(payload.activeTask);
      }
    });
  });

  const refreshRecentTasks = useEffectEvent(async () => {
    const payload = await fetchRecentTasks();

    startTransition(() => {
      setRecentTasks(payload.tasks);
    });
  });

  const refreshPreview = useEffectEvent(async (sourceId: string, targetNovelId: string) => {
    setPreviewBusy(true);
    setPreviewError(null);

    try {
      const payload = await fetchNovelPreview(sourceId, targetNovelId);
      hydratePreview(payload);
      publishNotice({
        tone: 'success',
        title: '目录解析完成',
        message: `${payload.metadata.title} 共 ${payload.metadata.chapterCount} 章，待采集 ${defaultSelectedChapterIds(payload.chapters).length} 章。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview request failed.';
      setPreviewError(message);
      publishNotice({ tone: 'error', title: '目录解析失败', message });
    } finally {
      setPreviewBusy(false);
    }
  });

  const hydrateTask = useEffectEvent((task: ApiTaskSnapshot) => {
    startTransition(() => {
      setCurrentTask(task);
    });

    if (task.status === 'completed' || task.status === 'failed') {
      void refreshRecentTasks();

      if (task.sourceId === selectedSourceId && task.novelId === novelId) {
        void refreshPreview(task.sourceId, task.novelId);
      }
    }
  });

  useEffect(() => {
    let active = true;

    void Promise.all([fetchHealth(), fetchControlSources(), fetchRecentTasks()])
      .then(([healthPayload, sourcesPayload, tasksPayload]) => {
        if (!active) {
          return;
        }

        setHealth(healthPayload);
        setSources(sourcesPayload.sources);
        setRecentTasks(tasksPayload.tasks);

        const defaultSource = sourcesPayload.sources[0];
        if (defaultSource) {
          setSelectedSourceId(defaultSource.sourceId);
          setNovelId(defaultSource.defaultNovelId);
        }

        const activeTask = tasksPayload.tasks.find(
          (task) => task.status === 'queued' || task.status === 'running',
        );

        if (activeTask) {
          setCurrentTask(activeTask);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          setErrorMessage(message);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentTask || (currentTask.status !== 'queued' && currentTask.status !== 'running')) {
      setStreamState('idle');
      return;
    }

    const bridge = new SseTaskLogBridge();
    setStreamState('connected');

    const unsubscribe = bridge.subscribe(currentTask.id, {
      onTaskUpdate: (task) => {
        hydrateTask(task);
        setStreamState('connected');
      },
      onError: () => {
        setStreamState('reconnecting');
      },
    });

    const pollId = window.setInterval(() => {
      void fetchTask(currentTask.id)
        .then((payload) => {
          hydrateTask(payload.task);
        })
        .catch(() => {
          setStreamState('reconnecting');
        });
    }, 2500);

    return () => {
      unsubscribe();
      window.clearInterval(pollId);
    };
  }, [currentTask?.id, currentTask?.status]);

  useEffect(() => {
    if (!currentTask) {
      lastObservedTaskRef.current = null;
      return;
    }

    const previous = lastObservedTaskRef.current;
    if (
      previous &&
      previous.id === currentTask.id &&
      previous.status !== currentTask.status &&
      (currentTask.status === 'completed' || currentTask.status === 'failed')
    ) {
      publishNotice({
        tone: currentTask.status === 'completed' ? 'success' : 'error',
        title: currentTask.status === 'completed' ? '采集任务已结束' : '采集任务失败',
        message: `${currentTask.novelId} 已结束，失败章节 ${currentTask.failures.length} 章。`,
      });
    }

    lastObservedTaskRef.current = { id: currentTask.id, status: currentTask.status };
  }, [currentTask, publishNotice]);

  const selectedSource = sources.find((source) => source.sourceId === selectedSourceId) ?? null;
  const isBusy = previewBusy || taskBusy;
  const sourceLabelMap = new Map(sources.map((source) => [source.sourceId, source.label]));

  async function handlePreviewSubmit() {
    const trimmedNovelId = novelId.trim();

    if (selectedSourceId.length === 0 || trimmedNovelId.length === 0) {
      return;
    }

    await refreshPreview(selectedSourceId, trimmedNovelId);
  }

  async function submitTask(target: TaskSubmissionTarget, chapterIds?: string[]) {
    setTaskBusy(true);

    try {
      const payload = await createControlTask(
        buildTaskSubmissionInput(target, {
          ...(chapterIds && chapterIds.length > 0 ? { chapterIds } : {}),
          forceRefetch,
          chapterConcurrency,
          chapterRetryCount,
        }),
      );

      hydrateTask(payload.task);
      await refreshRecentTasks();
      publishNotice({
        tone: 'success',
        title: '采集任务已启动',
        message: `${payload.task.novelId} 已进入 ${formatTaskStatus(payload.task.status)}，可前往任务大盘查看进度。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task creation failed.';
      setPreviewError(message);
      publishNotice({ tone: 'error', title: '任务下发失败', message });
    } finally {
      setTaskBusy(false);
    }
  }

  async function handleCreateTask(chapterIds?: string[]) {
    const trimmedNovelId = novelId.trim();
    if (selectedSourceId.length === 0 || trimmedNovelId.length === 0) {
      return;
    }

    await submitTask({
      sourceId: selectedSourceId,
      novelId: trimmedNovelId,
    }, chapterIds);
  }

  async function handlePickTask(taskId: string) {
    try {
      const payload = await fetchTask(taskId);
      hydrateTask(payload.task);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task query failed.';
      setPreviewError(message);
      publishNotice({ tone: 'error', title: '任务查询失败', message });
    }
  }

  async function handleRetryFailed() {
    const retryTarget = resolveRetryTaskTarget(currentTask);

    if (!retryTarget) {
      return;
    }

    await submitTask(retryTarget, retryTarget.chapterIds);
  }

  function handleSourceChange(nextSourceId: string) {
    const nextSource = sources.find((source) => source.sourceId === nextSourceId);
    setSelectedSourceId(nextSourceId);
    setNovelId(nextSource?.defaultNovelId ?? '');
    setPreview(null);
    setSelectedChapterIds([]);
  }

  function toggleChapterSelection(chapterId: string) {
    setSelectedChapterIds((current) =>
      current.includes(chapterId)
        ? current.filter((item) => item !== chapterId)
        : [...current, chapterId],
    );
  }

  function selectAllChapters() {
    setSelectedChapterIds((preview?.chapters ?? []).map((chapter) => chapter.id));
  }

  function selectPendingChapters() {
    setSelectedChapterIds(defaultSelectedChapterIds(preview?.chapters ?? []));
  }

  function selectFailedChapters() {
    setSelectedChapterIds(
      (preview?.chapters ?? [])
        .filter((chapter) => chapter.status === 'failed')
        .map((chapter) => chapter.id),
    );
  }

  function clearSelectedChapters() {
    setSelectedChapterIds([]);
  }

  function getSourceLabel(sourceId: string): string {
    return sourceLabelMap.get(sourceId) ?? sourceId;
  }

  function setChapterConcurrency(value: number) {
    setChapterConcurrencyState(Math.min(12, Math.max(1, value || 1)));
  }

  function setChapterRetryCount(value: number) {
    setChapterRetryCountState(Math.min(5, Math.max(0, value || 0)));
  }

  return {
    health,
    errorMessage,
    preview,
    previewError,
    sources,
    selectedSource,
    selectedSourceId,
    novelId,
    selectedChapterIds,
    currentTask,
    recentTasks,
    previewBusy,
    taskBusy,
    isBusy,
    streamState,
    forceRefetch,
    chapterConcurrency,
    chapterRetryCount,
    getSourceLabel,
    setNovelId,
    setForceRefetch,
    setChapterConcurrency,
    setChapterRetryCount,
    handleSourceChange,
    handlePreviewSubmit,
    handleCreateTask,
    handlePickTask,
    handleRetryFailed,
    toggleChapterSelection,
    selectAllChapters,
    selectPendingChapters,
    selectFailedChapters,
    clearSelectedChapters,
  };
}

function defaultSelectedChapterIds(chapters: Array<{ id: string; status: string }>): string[] {
  return chapters
    .filter((chapter) => chapter.status !== 'downloaded')
    .map((chapter) => chapter.id);
}

export function buildTaskSubmissionInput(
  target: TaskSubmissionTarget,
  options: TaskSubmissionOptions,
): Parameters<typeof createControlTask>[0] {
  return {
    sourceId: target.sourceId,
    novelId: target.novelId,
    ...(options.chapterIds && options.chapterIds.length > 0 ? { chapterIds: options.chapterIds } : {}),
    forceRefetch: options.forceRefetch,
    chapterConcurrency: options.chapterConcurrency,
    chapterRetryCount: options.chapterRetryCount,
  };
}

export function resolveRetryTaskTarget(
  currentTask: ApiTaskSnapshot | null,
): (TaskSubmissionTarget & { chapterIds: string[] }) | null {
  if (!currentTask) {
    return null;
  }

  const chapterIds = currentTask.failures.map((failure) => failure.chapterId);
  if (chapterIds.length === 0) {
    return null;
  }

  return {
    sourceId: currentTask.sourceId,
    novelId: currentTask.novelId,
    chapterIds,
  };
}

function formatTaskStatus(status: ApiTaskSnapshot['status']): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '执行中';
    case 'completed':
      return '已采集';
    case 'failed':
      return '已失败';
    default:
      return status;
  }
}