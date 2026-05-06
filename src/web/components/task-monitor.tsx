import type { ApiTaskSnapshot } from '../../server/routes/control-center';

interface TaskMonitorProps {
  currentTask: ApiTaskSnapshot | null;
  recentTasks: ApiTaskSnapshot[];
  streamState: 'idle' | 'connected' | 'reconnecting';
  onPickTask: (taskId: string) => void;
  onRetryFailed: () => void;
}

export function TaskMonitor({
  currentTask,
  recentTasks,
  streamState,
  onPickTask,
  onRetryFailed,
}: TaskMonitorProps) {
  const recentEvents = currentTask?.events.slice(-12).reverse() ?? [];
  const progress = currentTask?.progress;

  return (
    <section className="panel task-monitor">
      <div className="panel-heading split">
        <div>
          <p className="eyebrow">任务监控</p>
          <h2>后台守护态执行与实时日志</h2>
        </div>
        <span className={`stream-indicator stream-${streamState}`}>SSE {streamState}</span>
      </div>

      <div className="task-layout">
        <div className="task-current card">
          {currentTask ? (
            <>
              <div className="split align-start">
                <div>
                  <p className="label">任务</p>
                  <h3>{currentTask.sourceId} / {currentTask.novelId}</h3>
                </div>
                <span className={`status-badge state-${currentTask.status}`}>{currentTask.status}</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="stats-row">
                <span>目录：{progress?.catalogChapters ?? 0}</span>
                <span>已完成：{progress?.completedChapters ?? 0}</span>
                <span>失败：{progress?.failedChapters ?? 0}</span>
                <span>已排队：{progress?.queuedChapters ?? 0}</span>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={onRetryFailed}
                  disabled={currentTask.failures.length === 0}
                >
                  重试失败章节
                </button>
              </div>
              <ul className="log-list">
                {recentEvents.map((event) => (
                  <li key={`${event.timestamp}-${event.type}`} className={`log-item level-${event.level}`}>
                    <div className="split align-start">
                      <strong>{event.message}</strong>
                      <span className="muted">{formatTimestamp(event.timestamp)}</span>
                    </div>
                    <p>{event.errorMessage ?? event.type}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="empty-state compact">
              <p>任务创建后，这里会展示后台进度、失败节点与日志流。</p>
            </div>
          )}
        </div>

        <div className="task-history card">
          <p className="label">最近任务</p>
          <ul className="history-list">
            {recentTasks.length > 0 ? recentTasks.map((task) => (
              <li key={task.id}>
                <button type="button" className="history-button" onClick={() => onPickTask(task.id)}>
                  <span>{task.sourceId} / {task.novelId}</span>
                  <span className={`status-badge state-${task.status}`}>{task.status}</span>
                </button>
              </li>
            )) : <li className="muted">暂无任务记录。</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}