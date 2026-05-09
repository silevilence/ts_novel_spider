import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';

import type { AppLocation } from './app-routes';
import {
  buildLibraryNovelPath,
  buildLibraryReaderPath,
} from './app-routes';
import {
  cacheLibraryMedia,
  createControlTask,
  fetchLibraryChapter,
  fetchLibraryNovel,
  fetchLibraryNovels,
  fetchNovelPreview,
  fetchTask,
} from './api';
import { SseTaskLogBridge } from './task-log-bridge';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import type {
  LibraryChapterDetailPayload,
  LibraryNovelDetailPayload,
  LibraryNovelSummaryPayload,
} from '../../server/routes/library';
import type { NoticeInput } from './control-center-model';

export interface LibraryModel {
  location: AppLocation;
  novels: LibraryNovelSummaryPayload['novels'];
  detail: LibraryNovelDetailPayload | null;
  chapter: LibraryChapterDetailPayload | null;
  loading: boolean;
  errorMessage: string | null;
  syncBusy: boolean;
  mediaBusyId: string | null;
  currentTask: ApiTaskSnapshot | null;
  taskStreamState: 'idle' | 'connected' | 'reconnecting';
  openNovel: (sourceId: string, novelId: string) => void;
  openChapter: (sourceId: string, novelId: string, chapterId: string) => void;
  refresh: () => Promise<void>;
  runIncrementalSync: () => Promise<void>;
  syncMissingChapters: () => Promise<void>;
  cacheMediaAsset: (mediaId: string) => Promise<void>;
}

interface UseLibraryModelOptions {
  location: AppLocation;
  onNavigate: (path: string) => void;
  onNotice: (notice: NoticeInput) => void;
}

type LibraryTaskSnapshot = NonNullable<LibraryNovelDetailPayload['activeTask']>;

export function useLibraryModel({ location, onNavigate, onNotice }: UseLibraryModelOptions): LibraryModel {
  const [novels, setNovels] = useState<LibraryNovelSummaryPayload['novels']>([]);
  const [detail, setDetail] = useState<LibraryNovelDetailPayload | null>(null);
  const [chapter, setChapter] = useState<LibraryChapterDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<ApiTaskSnapshot | null>(null);
  const [taskStreamState, setTaskStreamState] = useState<'idle' | 'connected' | 'reconnecting'>('idle');
  const latestLocationRef = useRef(location);
  const currentTaskRef = useRef<ApiTaskSnapshot | null>(null);
  const lastObservedTaskRef = useRef<{ id: string; status: ApiTaskSnapshot['status'] } | null>(null);
  const publishNotice = useEffectEvent(onNotice);

  latestLocationRef.current = location;
  currentTaskRef.current = currentTask;

  const loadLocation = useEffectEvent(async (targetLocation: AppLocation): Promise<void> => {
    if (targetLocation.route.id !== 'library') {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      if (targetLocation.view === 'page') {
        const payload = await fetchLibraryNovels();

        startTransition(() => {
          setNovels(payload.novels);
          setDetail(null);
          setChapter(null);
          setCurrentTask(null);
        });
        return;
      }

      const sourceId = targetLocation.sourceId;
      const novelId = targetLocation.novelId;

      if (!sourceId || !novelId) {
        throw new Error('书库路由缺少作品标识。');
      }

      if (targetLocation.view === 'reader' && targetLocation.chapterId) {
        const [novelPayload, chapterPayload] = await Promise.all([
          fetchLibraryNovel(sourceId, novelId),
          fetchLibraryChapter(sourceId, novelId, targetLocation.chapterId),
        ]);

        const retainedTask = currentTaskRef.current;
        const nextTask = normalizeLibraryTask(novelPayload.activeTask)
          ?? (
            retainedTask
            && retainedTask.sourceId === sourceId
            && retainedTask.novelId === novelId
            ? retainedTask
            : null
          );

        startTransition(() => {
          setDetail(novelPayload);
          setChapter(chapterPayload);
          setCurrentTask(nextTask);
        });
        return;
      }

      const payload = await fetchLibraryNovel(sourceId, novelId);
      const retainedTask = currentTaskRef.current;
      const nextTask = normalizeLibraryTask(payload.activeTask)
        ?? (
          retainedTask
          && retainedTask.sourceId === sourceId
          && retainedTask.novelId === novelId
          ? retainedTask
          : null
        );

      startTransition(() => {
        setDetail(payload);
        setChapter(null);
        setCurrentTask(nextTask);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Library request failed.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadLocation(location);
  }, [
    location.route.id,
    location.view,
    location.sourceId,
    location.novelId,
    location.chapterId,
  ]);

  useEffect(() => {
    if (!location.sourceId || !location.novelId) {
      setCurrentTask(null);
      lastObservedTaskRef.current = null;
      return;
    }

    setCurrentTask((existing) => (
      existing
      && existing.sourceId === location.sourceId
      && existing.novelId === location.novelId
        ? existing
        : null
    ));
    lastObservedTaskRef.current = null;
  }, [location.sourceId, location.novelId]);

  useEffect(() => {
    if (!currentTask || (currentTask.status !== 'queued' && currentTask.status !== 'running')) {
      setTaskStreamState('idle');
      return;
    }

    const bridge = new SseTaskLogBridge();
    setTaskStreamState('connected');

    const unsubscribe = bridge.subscribe(currentTask.id, {
      onTaskUpdate: (task) => {
        startTransition(() => {
          setCurrentTask(task);
        });
        setTaskStreamState('connected');
      },
      onError: () => {
        setTaskStreamState('reconnecting');
      },
    });

    const pollId = window.setInterval(() => {
      void fetchTask(currentTask.id)
        .then((payload) => {
          startTransition(() => {
            setCurrentTask(payload.task);
          });
          setTaskStreamState('connected');
        })
        .catch(() => {
          setTaskStreamState('reconnecting');
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
      previous
      && previous.id === currentTask.id
      && previous.status !== currentTask.status
      && (currentTask.status === 'completed' || currentTask.status === 'failed')
    ) {
      publishNotice({
        tone: currentTask.status === 'completed' ? 'success' : 'error',
        title: currentTask.status === 'completed' ? '同步任务已完成' : '同步任务已结束',
        message: `${currentTask.novelId} 已处理完成，失败章节 ${currentTask.failures.length} 章。`,
      });
      void loadLocation(latestLocationRef.current);
    }

    lastObservedTaskRef.current = { id: currentTask.id, status: currentTask.status };
  }, [currentTask]);

  function openNovel(sourceId: string, novelId: string) {
    onNavigate(buildLibraryNovelPath(sourceId, novelId));
  }

  function openChapter(sourceId: string, novelId: string, chapterId: string) {
    onNavigate(buildLibraryReaderPath(sourceId, novelId, chapterId));
  }

  async function refresh() {
    await loadLocation(latestLocationRef.current);
  }

  async function runIncrementalSync() {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setSyncBusy(true);

    try {
      const payload = await createControlTask({
        sourceId: location.sourceId,
        novelId: location.novelId,
      });

      startTransition(() => {
        setCurrentTask(payload.task);
      });

      publishNotice({
        tone: 'success',
        title: '增量同步已启动',
        message: `${payload.task.novelId} 已进入 ${payload.task.status === 'queued' ? '排队中' : '执行中'}。`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Incremental sync failed.';
      publishNotice({ tone: 'error', title: '增量同步失败', message });
    } finally {
      setSyncBusy(false);
    }
  }

  async function syncMissingChapters() {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setSyncBusy(true);

    try {
      const preview = await fetchNovelPreview(location.sourceId, location.novelId);
      const pendingIds = preview.chapters
        .filter((entry) => entry.status !== 'downloaded')
        .map((entry) => entry.id);

      if (pendingIds.length === 0) {
        publishNotice({
          tone: 'info',
          title: '没有缺失章节',
          message: '当前本地书库已经包含全部已知章节。',
        });
        return;
      }

      const payload = await createControlTask({
        sourceId: location.sourceId,
        novelId: location.novelId,
        chapterIds: pendingIds,
      });

      startTransition(() => {
        setCurrentTask(payload.task);
      });

      publishNotice({
        tone: 'success',
        title: '补录任务已启动',
        message: `${payload.task.novelId} 将补抓 ${pendingIds.length} 个缺失章节。`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing chapter sync failed.';
      publishNotice({ tone: 'error', title: '补录任务失败', message });
    } finally {
      setSyncBusy(false);
    }
  }

  async function cacheMediaAsset(mediaId: string) {
    if (!location.sourceId || !location.novelId || !location.chapterId) {
      return;
    }

    setMediaBusyId(mediaId);

    try {
      const payload = await cacheLibraryMedia(
        location.sourceId,
        location.novelId,
        location.chapterId,
        mediaId,
      );

      publishNotice({
        tone: 'success',
        title: '媒体已缓存',
        message: payload.media.fileName ?? '已生成本地离线副本。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media cache failed.';
      publishNotice({ tone: 'error', title: '媒体缓存失败', message });
    } finally {
      setMediaBusyId(null);
    }
  }

  return {
    location,
    novels,
    detail,
    chapter,
    loading,
    errorMessage,
    syncBusy,
    mediaBusyId,
    currentTask,
    taskStreamState,
    openNovel,
    openChapter,
    refresh,
    runIncrementalSync,
    syncMissingChapters,
    cacheMediaAsset,
  };
}

function normalizeLibraryTask(task: LibraryTaskSnapshot | null): ApiTaskSnapshot | null {
  if (!task) {
    return null;
  }

  return {
    ...task,
    events: task.events.map((event) => ({
      type: event.type,
      level: event.level,
      message: event.message,
      context: event.context,
      ...(event.payload !== undefined ? { payload: event.payload } : {}),
      errorMessage: event.error?.message ?? null,
      timestamp: event.timestamp,
    })),
  };
}