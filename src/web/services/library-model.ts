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
  mediaBatchBusy: boolean;
  mediaBatchProgress: {
    total: number;
    completed: number;
    cached: number;
    skipped: number;
    currentChapterTitle: string | null;
  } | null;
  currentTask: ApiTaskSnapshot | null;
  taskStreamState: 'idle' | 'connected' | 'reconnecting';
  openNovel: (sourceId: string, novelId: string) => void;
  openChapter: (sourceId: string, novelId: string, chapterId: string) => void;
  refresh: () => Promise<void>;
  runIncrementalSync: () => Promise<void>;
  syncMissingChapters: () => Promise<void>;
  redownloadAllDownloadedChapters: () => Promise<void>;
  redownloadSelectedChapters: (chapterIds: string[]) => Promise<void>;
  cacheMediaAsset: (mediaId: string) => Promise<void>;
  cacheAllMediaAssets: () => Promise<void>;
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
  const [mediaBatchBusy, setMediaBatchBusy] = useState(false);
  const [mediaBatchProgress, setMediaBatchProgress] = useState<LibraryModel['mediaBatchProgress']>(null);
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
      setMediaBatchProgress(null);
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
    setMediaBatchProgress(null);
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

  async function submitRedownloadTask(chapterIds: string[], taskLabel: string) {
    if (!location.sourceId || !location.novelId || !detail?.novel) {
      return;
    }

    if (chapterIds.length === 0) {
      publishNotice({
        tone: 'info',
        title: '没有可重下章节',
        message: '当前没有符合条件的章节可重新下载。',
      });
      return;
    }

    setSyncBusy(true);

    try {
      const payload = await createControlTask({
        sourceId: location.sourceId,
        novelId: location.novelId,
        chapterIds,
        forceRefetch: true,
      });

      startTransition(() => {
        setCurrentTask(payload.task);
      });

      publishNotice({
        tone: 'success',
        title: '重新下载任务已启动',
        message: `${payload.task.novelId} 将重新抓取 ${chapterIds.length} 个${taskLabel}。`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chapter redownload failed.';
      publishNotice({ tone: 'error', title: '重新下载任务失败', message });
    } finally {
      setSyncBusy(false);
    }
  }

  async function redownloadAllDownloadedChapters() {
    if (!detail?.novel) {
      return;
    }

    const downloadedChapterIds = detail.novel.chapters
      .filter((chapter) => chapter.status === 'downloaded')
      .map((chapter) => chapter.id);

    await submitRedownloadTask(downloadedChapterIds, '已下载章节');
  }

  async function redownloadSelectedChapters(chapterIds: string[]) {
    await submitRedownloadTask([...new Set(chapterIds)], '选中章节');
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

  async function cacheAllMediaAssets() {
    const currentDetail = detail?.novel;

    if (!location.sourceId || !location.novelId || !currentDetail) {
      return;
    }

    const pendingChapters = currentDetail.chapters.filter((chapter) => chapter.hasContent && chapter.media.pending > 0);

    if (currentDetail.media.pending === 0 || pendingChapters.length === 0) {
      publishNotice({
        tone: 'info',
        title: '图片缓存已是最新',
        message: '当前没有需要补缓存的图片。',
      });
      return;
    }

    setMediaBatchBusy(true);
    const totalCount = currentDetail.media.pending;
    let completedCount = 0;
    let cachedCount = 0;
    let skippedCount = 0;

    setMediaBatchProgress({
      total: totalCount,
      completed: 0,
      cached: 0,
      skipped: 0,
      currentChapterTitle: pendingChapters[0]?.title ?? null,
    });

    try {
      publishNotice({
        tone: 'info',
        title: '开始统一缓存图片',
        message: `准备补缓存 ${totalCount} 张图片，进度会直接显示在当前页面。`,
      });

      for (const chapter of pendingChapters) {
        const chapterPayload = await fetchLibraryChapter(location.sourceId, location.novelId, chapter.id);
        const pendingAssets = chapterPayload.chapter.mediaAssets.filter((asset) => !asset.cached);

        if (pendingAssets.length === 0) {
          const chapterSkipped = chapter.media.pending;
          completedCount += chapterSkipped;
          skippedCount += chapterSkipped;
          setMediaBatchProgress((current) => current ? {
            ...current,
            completed: completedCount,
            skipped: skippedCount,
            currentChapterTitle: chapter.title,
          } : current);
          continue;
        }

        for (const asset of pendingAssets) {
          await cacheLibraryMedia(location.sourceId, location.novelId, chapter.id, asset.id);
          completedCount += 1;
          cachedCount += 1;

          setDetail((current) => {
            if (!current) {
              return current;
            }

            let didUpdateChapter = false;
            const chapters = current.novel.chapters.map((entry) => {
              if (entry.id !== chapter.id || entry.media.pending <= 0) {
                return entry;
              }

              didUpdateChapter = true;
              return {
                ...entry,
                media: {
                  ...entry.media,
                  cached: entry.media.cached + 1,
                  pending: Math.max(0, entry.media.pending - 1),
                },
              };
            });

            if (!didUpdateChapter || current.novel.media.pending <= 0) {
              return current;
            }

            return {
              ...current,
              novel: {
                ...current.novel,
                chapters,
                media: {
                  ...current.novel.media,
                  cached: current.novel.media.cached + 1,
                  pending: Math.max(0, current.novel.media.pending - 1),
                },
              },
            };
          });

          setMediaBatchProgress((current) => current ? {
            ...current,
            completed: completedCount,
            cached: cachedCount,
            skipped: skippedCount,
            currentChapterTitle: chapter.title,
          } : current);
        }
      }

      publishNotice({
        tone: cachedCount > 0 ? 'success' : 'info',
        title: cachedCount > 0 ? '图片已补齐到本地' : '图片缓存已是最新',
        message: cachedCount > 0
          ? `本次新缓存 ${cachedCount} 张图片，已跳过 ${skippedCount} 张已有图片。`
          : `没有新的图片需要缓存，已跳过 ${skippedCount} 张已有图片。`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media batch cache failed.';
      publishNotice({
        tone: 'error',
        title: '统一缓存失败',
        message: `${message} 已完成 ${completedCount}/${totalCount}。`,
      });
      await refresh();
    } finally {
      setMediaBatchBusy(false);
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
    mediaBatchBusy,
    mediaBatchProgress,
    currentTask,
    taskStreamState,
    openNovel,
    openChapter,
    refresh,
    runIncrementalSync,
    syncMissingChapters,
    redownloadAllDownloadedChapters,
    redownloadSelectedChapters,
    cacheMediaAsset,
    cacheAllMediaAssets,
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