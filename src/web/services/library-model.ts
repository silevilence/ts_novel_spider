import { startTransition, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react';

import type { AppLocation } from './app-routes';
import {
  buildLibraryNovelPath,
  buildLibraryReaderPath,
} from './app-routes';
import {
  cacheLibraryMedia,
  createLibraryAlias,
  createLibraryBookmark,
  createControlTask,
  deleteLibraryAlias,
  deleteLibraryBookmark,
  fetchLibraryChapter,
  fetchLibraryNovel,
  fetchLibraryNovels,
  fetchLibraryReaderTypography,
  fetchNovelPreview,
  fetchTask,
  fetchTranslationPreferences,
  startLibraryTranslation,
  cancelLibraryTranslation,
  fetchLibraryTranslationBuild,
  fetchLibraryTranslationChapter,
  updateLibraryAlias,
  updateLibraryBookmark,
  updateLibraryReaderTypography,
  deleteLibraryReaderTypography,
  updateLibraryReadingProgress,
  type TranslationExportMode,
  type TranslationBuildPayload,
} from './api';
import { SseTaskLogBridge } from './task-log-bridge';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import type {
  LibraryChapterDetailPayload,
  LibraryNovelDetailPayload,
  LibraryNovelSummaryPayload,
  LibraryReaderTypographyPayload,
} from '../../server/routes/library';
import type { NoticeInput } from './control-center-model';

export interface TranslationBuildState {
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
}

export interface LibraryModel {
  location: AppLocation;
  libraryOverview: {
    totalNovels: number;
    downloadedChapters: number;
    pendingChapters: number;
  };
  novels: LibraryNovelSummaryPayload['novels'];
  detail: LibraryNovelDetailPayload | null;
  chapter: LibraryChapterDetailPayload | null;
  searchQuery: string;
  mutationBusyKey: string | null;
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
  setSearchQuery: (value: string) => void;
  clearSearch: () => void;
  openNovel: (sourceId: string, novelId: string) => void;
  openChapter: (sourceId: string, novelId: string, chapterId: string) => void;
  refresh: () => Promise<void>;
  addAlias: (alias: string) => Promise<void>;
  renameAlias: (aliasId: string, alias: string) => Promise<void>;
  removeAlias: (aliasId: string) => Promise<void>;
  addBookmark: (chapterId: string, note: string) => Promise<void>;
  editBookmark: (bookmarkId: string, note: string) => Promise<void>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  runIncrementalSync: () => Promise<void>;
  syncMissingChapters: () => Promise<void>;
  redownloadAllDownloadedChapters: () => Promise<void>;
  redownloadSelectedChapters: (chapterIds: string[]) => Promise<void>;
  cacheMediaAsset: (mediaId: string) => Promise<void>;
  cacheAllMediaAssets: () => Promise<void>;
  /** 当前阅读器生效的排版配置 (合并了全局默认与当前书的覆盖) */
  readerTypography: LibraryReaderTypographyPayload['typography'] | null;
  /** 是否正在加载或保存阅读器排版 */
  readerTypographyBusy: boolean;
  /** 更新当前书籍的阅读器排版覆盖 */
  updateReaderTypography: (input: {
    fontSize?: number;
    fontSizePreset?: 'small' | 'medium' | 'large';
    lineHeight?: number;
    paragraphSpacing?: number;
    fontFamilyPreset?: 'sans' | 'serif' | 'monospace' | 'custom';
    fontFamilyCustom?: string;
  }) => Promise<void>;
  /** 重置当前书籍的阅读器排版到全局默认 */
  resetReaderTypography: () => Promise<void>;
  /** 翻译：当前阅读器视图模式 */
  translationViewMode: TranslationExportMode;
  /** 切换阅读器翻译视图 */
  setTranslationViewMode: (mode: TranslationExportMode) => void;
  /** 翻译：全局默认语言对（用于导出等） */
  translationLanguages: { sourceLang: string; targetLang: string } | null;
  /** 翻译：当前书籍的构建状态 */
  translationBuild: TranslationBuildState | null;
  /** 翻译构建是否忙碌 */
  translationBusy: boolean;
  /** 启动翻译任务 */
  startTranslation: (modelOverride?: string, fromScratch?: boolean) => Promise<void>;
  /** 取消翻译任务 */
  cancelTranslation: () => Promise<void>;
  /** 从 API 同步翻译构建状态（供轮询使用） */
  syncTranslationBuild: () => Promise<TranslationBuildPayload | null>;
}

interface UseLibraryModelOptions {
  location: AppLocation;
  onNavigate: (path: string) => void;
  onNotice: (notice: NoticeInput) => void;
}

type LibraryTaskSnapshot = NonNullable<LibraryNovelDetailPayload['activeTask']>;

export function useLibraryModel({ location, onNavigate, onNotice }: UseLibraryModelOptions): LibraryModel {
  const [libraryOverview, setLibraryOverview] = useState<LibraryModel['libraryOverview']>({
    totalNovels: 0,
    downloadedChapters: 0,
    pendingChapters: 0,
  });
  const [novels, setNovels] = useState<LibraryNovelSummaryPayload['novels']>([]);
  const [detail, setDetail] = useState<LibraryNovelDetailPayload | null>(null);
  const [chapter, setChapter] = useState<LibraryChapterDetailPayload | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [mutationBusyKey, setMutationBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const [readerTypography, setReaderTypography] = useState<LibraryModel['readerTypography']>(null);
  const [readerTypographyBusy, setReaderTypographyBusy] = useState(false);
  const [translationViewMode, setTranslationViewMode] = useState<TranslationExportMode>('original');
  const [translationLanguages, setTranslationLanguages] = useState<LibraryModel['translationLanguages']>(null);
  const [translationBuild, setTranslationBuild] = useState<TranslationBuildState | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [mediaBatchBusy, setMediaBatchBusy] = useState(false);
  const [mediaBatchProgress, setMediaBatchProgress] = useState<LibraryModel['mediaBatchProgress']>(null);
  const [currentTask, setCurrentTask] = useState<ApiTaskSnapshot | null>(null);
  const [taskStreamState, setTaskStreamState] = useState<'idle' | 'connected' | 'reconnecting'>('idle');
  const latestLocationRef = useRef(location);
  const latestSearchQueryRef = useRef(deferredSearchQuery);
  const currentTaskRef = useRef<ApiTaskSnapshot | null>(null);
  const lastObservedTaskRef = useRef<{ id: string; status: ApiTaskSnapshot['status'] } | null>(null);
  const lastPersistedProgressChapterRef = useRef<string | null>(null);
  const publishNotice = useEffectEvent(onNotice);

  latestLocationRef.current = location;
  latestSearchQueryRef.current = deferredSearchQuery;
  currentTaskRef.current = currentTask;

  const loadLocation = useEffectEvent(async (targetLocation: AppLocation): Promise<void> => {
    if (targetLocation.route.id !== 'library') {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      if (targetLocation.view === 'page') {
        const search = latestSearchQueryRef.current.trim();
        const [allPayload, payload] = search
          ? await Promise.all([
              fetchLibraryNovels(),
              fetchLibraryNovels(search),
            ])
          : await Promise.all([
              fetchLibraryNovels(),
              fetchLibraryNovels(),
            ]);

        startTransition(() => {
          setLibraryOverview({
            totalNovels: allPayload.novels.length,
            downloadedChapters: allPayload.novels.reduce((sum, novel) => sum + novel.downloadedChapters, 0),
            pendingChapters: allPayload.novels.reduce((sum, novel) => sum + novel.indexedChapters + novel.failedChapters, 0),
          });
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

        // 翻译模式：加载翻译段落并替换正文
        if (translationViewMode !== 'original' && translationLanguages) {
          const transChapter = await fetchLibraryTranslationChapter(
            sourceId, novelId, targetLocation.chapterId,
            translationLanguages.sourceLang, translationLanguages.targetLang,
          );
          if (transChapter && transChapter.status === 'completed' && transChapter.paragraphs.length > 0) {
            const content = buildTranslatedContent(transChapter.paragraphs, translationViewMode);
            if (content) {
              chapterPayload.chapter.chapter = {
                ...chapterPayload.chapter.chapter,
                content,
              };
            }
          }
        }

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
    deferredSearchQuery,
  ]);

  useEffect(() => {
    if (!location.sourceId || !location.novelId) {
      setCurrentTask(null);
      setMediaBatchProgress(null);
      lastObservedTaskRef.current = null;
      lastPersistedProgressChapterRef.current = null;
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
    if (location.view !== 'reader' || !location.sourceId || !location.novelId || !location.chapterId || !chapter) {
      return;
    }

    if (lastPersistedProgressChapterRef.current === location.chapterId) {
      return;
    }

    void updateLibraryReadingProgress(location.sourceId, location.novelId, location.chapterId)
      .then((payload) => {
        lastPersistedProgressChapterRef.current = location.chapterId;
        startTransition(() => {
          setDetail((current) => current ? {
            ...current,
            novel: {
              ...current.novel,
              readingProgress: payload.progress,
            },
          } : current);

          setChapter((current) => current ? {
            ...current,
            chapter: {
              ...current.chapter,
              readingProgress: payload.progress,
            },
          } : current);
        });
      })
      .catch(() => {
      });
  }, [chapter, location.chapterId, location.novelId, location.sourceId, location.view]);

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

  function clearSearch() {
    setSearchQuery('');
  }

  async function addAlias(alias: string) {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setMutationBusyKey('alias-create');

    try {
      await createLibraryAlias(location.sourceId, location.novelId, alias);
      publishNotice({
        tone: 'success',
        title: '别名已保存',
        message: '现在可以用这个别名参与书库检索。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alias creation failed.';
      publishNotice({ tone: 'error', title: '别名保存失败', message });
    } finally {
      setMutationBusyKey(null);
    }
  }

  async function renameAlias(aliasId: string, alias: string) {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setMutationBusyKey(`alias:${aliasId}`);

    try {
      await updateLibraryAlias(location.sourceId, location.novelId, aliasId, alias);
      publishNotice({
        tone: 'success',
        title: '别名已更新',
        message: '新的别名内容已经生效。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alias update failed.';
      publishNotice({ tone: 'error', title: '别名更新失败', message });
    } finally {
      setMutationBusyKey(null);
    }
  }

  async function removeAlias(aliasId: string) {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setMutationBusyKey(`alias:${aliasId}`);

    try {
      await deleteLibraryAlias(location.sourceId, location.novelId, aliasId);
      publishNotice({
        tone: 'success',
        title: '别名已删除',
        message: '该别名不会再参与检索。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alias deletion failed.';
      publishNotice({ tone: 'error', title: '别名删除失败', message });
    } finally {
      setMutationBusyKey(null);
    }
  }

  async function addBookmark(chapterId: string, note: string) {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setMutationBusyKey('bookmark-create');

    try {
      await createLibraryBookmark(location.sourceId, location.novelId, chapterId, note);
      publishNotice({
        tone: 'success',
        title: '书签已保存',
        message: '已经把这章记到书签列表里。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bookmark creation failed.';
      publishNotice({ tone: 'error', title: '书签保存失败', message });
    } finally {
      setMutationBusyKey(null);
    }
  }

  async function editBookmark(bookmarkId: string, note: string) {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setMutationBusyKey(`bookmark:${bookmarkId}`);

    try {
      await updateLibraryBookmark(location.sourceId, location.novelId, bookmarkId, note);
      publishNotice({
        tone: 'success',
        title: '书签备注已更新',
        message: '新的备注内容已经保存。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bookmark update failed.';
      publishNotice({ tone: 'error', title: '书签更新失败', message });
    } finally {
      setMutationBusyKey(null);
    }
  }

  async function removeBookmark(bookmarkId: string) {
    if (!location.sourceId || !location.novelId) {
      return;
    }

    setMutationBusyKey(`bookmark:${bookmarkId}`);

    try {
      await deleteLibraryBookmark(location.sourceId, location.novelId, bookmarkId);
      publishNotice({
        tone: 'success',
        title: '书签已删除',
        message: '这条书签已经从列表移除。',
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bookmark deletion failed.';
      publishNotice({ tone: 'error', title: '书签删除失败', message });
    } finally {
      setMutationBusyKey(null);
    }
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

  const loadReaderTypography = useEffectEvent(async (sourceId: string, novelId: string) => {
    try {
      const payload = await fetchLibraryReaderTypography(sourceId, novelId);
      startTransition(() => {
        setReaderTypography(payload.typography);
      });
    } catch {
      setReaderTypography(null);
    }
  });

  const handleUpdateReaderTypography: LibraryModel['updateReaderTypography'] = useEffectEvent(async (input) => {
    if (!detail) {
      return;
    }

    const sourceId = detail.novel.sourceId;
    const novelId = detail.novel.metadata.novelId;

    setReaderTypographyBusy(true);
    try {
      const payload = await updateLibraryReaderTypography(sourceId, novelId, input);
      startTransition(() => {
        setReaderTypography(payload.typography);
      });
      publishNotice({ tone: 'success', title: '排版已更新', message: '当前书的阅读器排版已更新。' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新书籍排版失败。';
      publishNotice({ tone: 'error', title: '更新失败', message });
    } finally {
      setReaderTypographyBusy(false);
    }
  });

  const handleResetReaderTypography: LibraryModel['resetReaderTypography'] = useEffectEvent(async () => {
    if (!detail) {
      return;
    }

    const sourceId = detail.novel.sourceId;
    const novelId = detail.novel.metadata.novelId;

    setReaderTypographyBusy(true);
    try {
      const payload = await deleteLibraryReaderTypography(sourceId, novelId);
      startTransition(() => {
        setReaderTypography(payload.typography);
      });
      publishNotice({ tone: 'success', title: '已恢复', message: '已恢复为全局默认排版。' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复全局排版失败。';
      publishNotice({ tone: 'error', title: '恢复失败', message });
    } finally {
      setReaderTypographyBusy(false);
    }
  });

  useEffect(() => {
    if (location.sourceId && location.novelId) {
      void loadReaderTypography(location.sourceId, location.novelId);
    }

    // 加载全局翻译默认语言对
    fetchTranslationPreferences().then(
      (prefs) => setTranslationLanguages({ sourceLang: prefs.config.sourceLang, targetLang: prefs.config.targetLang }),
      () => setTranslationLanguages(null),
    );

    // 加载翻译构建状态
    if (location.sourceId && location.novelId) {
      fetchLibraryTranslationBuild(location.sourceId, location.novelId).then(
        (payload) => setTranslationBuild(payload.translation as TranslationBuildState),
        () => setTranslationBuild(null),
      );
    }
  }, [location.sourceId, location.novelId]);

  // 翻译视图模式切换时，重新加载当前章节（以获取双语/译文内容）
  useEffect(() => {
    if (location.view === 'reader' && location.sourceId && location.novelId && location.chapterId) {
      void loadLocation(location);
    }
  }, [translationViewMode]);

  async function handleStartTranslation(modelOverride?: string, fromScratch?: boolean) {
    if (!location.sourceId || !location.novelId) return;
    setTranslationBusy(true);
    try {
      const payload = await startLibraryTranslation(location.sourceId, location.novelId, modelOverride, fromScratch);
      setTranslationBuild(payload.translation as TranslationBuildState);
      publishNotice({ tone: 'success', title: '翻译任务已启动', message: payload.translation.message ?? '后台正在处理翻译。' });
    } catch (error) {
      publishNotice({ tone: 'error', title: '翻译启动失败', message: error instanceof Error ? error.message : 'Translation start failed.' });
    } finally { setTranslationBusy(false); }
  }

  async function handleCancelTranslation() {
    if (!location.sourceId || !location.novelId) return;
    setTranslationBusy(true);
    try {
      const payload = await cancelLibraryTranslation(location.sourceId, location.novelId);
      setTranslationBuild(payload.translation as TranslationBuildState);
      publishNotice({ tone: 'info', title: '翻译已取消', message: '可以重新选择模型并发起新的翻译任务。' });
    } catch (error) {
      publishNotice({ tone: 'error', title: '取消失败', message: error instanceof Error ? error.message : 'cancel failed' });
    } finally { setTranslationBusy(false); }
  }

  async function handleSyncTranslationBuild(): Promise<TranslationBuildPayload | null> {
    if (!location.sourceId || !location.novelId) return null;
    try {
      const payload = await fetchLibraryTranslationBuild(location.sourceId, location.novelId);
      setTranslationBuild(payload.translation as TranslationBuildState);
      return payload;
    } catch {
      return null;
    }
  }

  return {
    location,
    libraryOverview,
    novels,
    detail,
    chapter,
    searchQuery,
    mutationBusyKey,
    loading,
    errorMessage,
    syncBusy,
    mediaBusyId,
    mediaBatchBusy,
    mediaBatchProgress,
    currentTask,
    taskStreamState,
    setSearchQuery,
    clearSearch,
    openNovel,
    openChapter,
    refresh,
    addAlias,
    renameAlias,
    removeAlias,
    addBookmark,
    editBookmark,
    removeBookmark,
    runIncrementalSync,
    syncMissingChapters,
    redownloadAllDownloadedChapters,
    redownloadSelectedChapters,
    cacheMediaAsset,
    cacheAllMediaAssets,
    readerTypography,
    readerTypographyBusy,
    updateReaderTypography: handleUpdateReaderTypography,
    resetReaderTypography: handleResetReaderTypography,
    translationViewMode,
    setTranslationViewMode,
    translationLanguages,
    translationBuild,
    translationBusy,
    startTranslation: handleStartTranslation,
    cancelTranslation: handleCancelTranslation,
    syncTranslationBuild: handleSyncTranslationBuild,
  };
}

/** 根据翻译模式拼接段落内容 */
function buildTranslatedContent(
  paragraphs: Array<{ paragraphIndex: number; sourceText: string; translatedText: string | null; confidence: number | null }>,
  mode: 'translated' | 'bilingual',
): string | null {
  if (paragraphs.length === 0) return null;

  if (mode === 'translated') {
    return paragraphs
      .map((p) => p.translatedText ?? p.sourceText)
      .filter((t) => t.length > 0)
      .join('\n\n') || null;
  }

  // bilingual
  return paragraphs
    .map((p) => {
      if (p.translatedText && p.translatedText !== p.sourceText) {
        return `${p.sourceText}\n\n${p.translatedText}`;
      }
      return p.sourceText;
    })
    .filter((t) => t.length > 0)
    .join('\n\n') || null;
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