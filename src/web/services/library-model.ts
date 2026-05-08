import { startTransition, useEffect, useRef, useState } from 'react';

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
} from './api';
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

export function useLibraryModel({ location, onNavigate, onNotice }: UseLibraryModelOptions): LibraryModel {
  const [novels, setNovels] = useState<LibraryNovelSummaryPayload['novels']>([]);
  const [detail, setDetail] = useState<LibraryNovelDetailPayload | null>(null);
  const [chapter, setChapter] = useState<LibraryChapterDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const latestLocationRef = useRef(location);

  latestLocationRef.current = location;

  async function loadLocation(targetLocation: AppLocation): Promise<void> {
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

        startTransition(() => {
          setDetail(novelPayload);
          setChapter(chapterPayload);
        });
        return;
      }

      const payload = await fetchLibraryNovel(sourceId, novelId);

      startTransition(() => {
        setDetail(payload);
        setChapter(null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Library request failed.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLocation(location);
  }, [
    location.route.id,
    location.view,
    location.sourceId,
    location.novelId,
    location.chapterId,
  ]);

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

      onNotice({
        tone: 'success',
        title: '增量同步已启动',
        message: `${payload.task.novelId} 已进入 ${payload.task.status === 'queued' ? '排队中' : '执行中'}。`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Incremental sync failed.';
      onNotice({ tone: 'error', title: '增量同步失败', message });
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
        onNotice({
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

      onNotice({
        tone: 'success',
        title: '补录任务已启动',
        message: `${payload.task.novelId} 将补抓 ${pendingIds.length} 个缺失章节。`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing chapter sync failed.';
      onNotice({ tone: 'error', title: '补录任务失败', message });
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

      onNotice({
        tone: 'success',
        title: '媒体已缓存',
        message: payload.media.fileName ?? '已生成本地离线副本。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media cache failed.';
      onNotice({ tone: 'error', title: '媒体缓存失败', message });
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
    openNovel,
    openChapter,
    refresh,
    runIncrementalSync,
    syncMissingChapters,
    cacheMediaAsset,
  };
}