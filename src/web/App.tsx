import { startTransition, useEffect, useEffectEvent, useState } from 'react';

import { ChapterDirectory } from './components/chapter-directory';
import { MetadataBoard } from './components/metadata-board';
import { StatusPanel } from './components/status-panel';
import { TaskMonitor } from './components/task-monitor';
import {
  createControlTask,
  fetchControlSources,
  fetchHealth,
  fetchNovelPreview,
  fetchRecentTasks,
  fetchTask,
} from './services/api';
import { SseTaskLogBridge } from './services/task-log-bridge';
import type { HealthPayload } from '../server/routes/health';
import type {
  ApiTaskSnapshot,
  ControlPreviewPayload,
  ControlSourcesPayload,
} from '../server/routes/control-center';

export function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ControlPreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sources, setSources] = useState<ControlSourcesPayload['sources']>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('mock-html');
  const [novelId, setNovelId] = useState('demo');
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [currentTask, setCurrentTask] = useState<ApiTaskSnapshot | null>(null);
  const [recentTasks, setRecentTasks] = useState<ApiTaskSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'reconnecting'>('idle');
  const [forceRefetch, setForceRefetch] = useState(false);
  const [chapterConcurrency, setChapterConcurrency] = useState(4);
  const [chapterRetryCount, setChapterRetryCount] = useState(1);

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
    setBusy(true);

    try {
      const payload = await fetchNovelPreview(sourceId, targetNovelId);
      hydratePreview(payload);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Preview request failed.');
    } finally {
      setBusy(false);
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
          void refreshPreview(defaultSource.sourceId, defaultSource.defaultNovelId);
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
          setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
        }
      });

    return () => {
      active = false;
    };
  }, [refreshPreview]);

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
  }, [currentTask?.id, currentTask?.status, hydrateTask]);

  const selectedSource = sources.find((source) => source.sourceId === selectedSourceId) ?? null;

  async function handlePreviewSubmit() {
    await refreshPreview(selectedSourceId, novelId.trim());
  }

  async function handleCreateTask(chapterIds?: string[]) {
    setBusy(true);

    try {
      const payload = await createControlTask({
        sourceId: selectedSourceId,
        novelId: novelId.trim(),
        ...(chapterIds && chapterIds.length > 0 ? { chapterIds } : {}),
        forceRefetch,
        chapterConcurrency,
        chapterRetryCount,
      });

      hydrateTask(payload.task);
      await refreshRecentTasks();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Task creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePickTask(taskId: string) {
    try {
      const payload = await fetchTask(taskId);
      hydrateTask(payload.task);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Task query failed.');
    }
  }

  async function handleRetryFailed() {
    const failedIds = currentTask?.failures.map((failure) => failure.chapterId) ?? [];

    if (failedIds.length === 0) {
      return;
    }

    await handleCreateTask(failedIds);
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

  return (
    <main className="app-shell">
      <section className="hero control-hero">
        <div>
          <p className="eyebrow">TS Novel Spider</p>
          <h1>前端交互界面与管控中心</h1>
          <p className="hero-copy">
            统一编排爬虫策略、目录差异、高并发章节抓取与后台日志流。关闭视图不会中断服务端任务，重新进入即可恢复监控。
          </p>
        </div>
        <form
          className="control-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handlePreviewSubmit();
          }}
        >
          <label>
            <span>爬虫策略</span>
            <select value={selectedSourceId} onChange={(event) => handleSourceChange(event.target.value)}>
              {sources.map((source) => (
                <option key={source.sourceId} value={source.sourceId}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>目标 ID</span>
            <input
              value={novelId}
              onChange={(event) => setNovelId(event.target.value)}
              placeholder={selectedSource?.defaultNovelId ?? '输入小说 ID'}
            />
          </label>
          <label>
            <span>并发数</span>
            <input
              type="number"
              min={1}
              max={12}
              value={chapterConcurrency}
              onChange={(event) => setChapterConcurrency(Number(event.target.value) || 1)}
            />
          </label>
          <label>
            <span>重试次数</span>
            <input
              type="number"
              min={0}
              max={5}
              value={chapterRetryCount}
              onChange={(event) => setChapterRetryCount(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={forceRefetch} onChange={(event) => setForceRefetch(event.target.checked)} />
            <span>强制重新抓取已下载章节</span>
          </label>
          <div className="action-row wide">
            <button type="submit" className="primary-button" disabled={busy || novelId.trim().length === 0}>
              解析目录
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || novelId.trim().length === 0}
              onClick={() => void handleCreateTask(selectedChapterIds.length > 0 ? selectedChapterIds : undefined)}
            >
              下发抓取任务
            </button>
          </div>
        </form>
      </section>

      <StatusPanel
        health={health}
        errorMessage={errorMessage}
        sourceCount={sources.length}
        currentTask={currentTask}
      />

      <MetadataBoard preview={preview} loading={busy} errorMessage={previewError} />

      <ChapterDirectory
        chapters={preview?.chapters ?? []}
        selectedChapterIds={selectedChapterIds}
        busy={busy}
        onToggleChapter={toggleChapterSelection}
        onSelectAll={() => setSelectedChapterIds((preview?.chapters ?? []).map((chapter) => chapter.id))}
        onSelectPending={() => setSelectedChapterIds(defaultSelectedChapterIds(preview?.chapters ?? []))}
        onSelectFailed={() => setSelectedChapterIds((preview?.chapters ?? []).filter((chapter) => chapter.status === 'failed').map((chapter) => chapter.id))}
        onClearSelection={() => setSelectedChapterIds([])}
      />

      <TaskMonitor
        currentTask={currentTask}
        recentTasks={recentTasks}
        streamState={streamState}
        onPickTask={(taskId) => void handlePickTask(taskId)}
        onRetryFailed={() => void handleRetryFailed()}
      />
    </main>
  );
}

function defaultSelectedChapterIds(chapters: Array<{ id: string; status: string }>): string[] {
  return chapters
    .filter((chapter) => chapter.status !== 'downloaded')
    .map((chapter) => chapter.id);
}