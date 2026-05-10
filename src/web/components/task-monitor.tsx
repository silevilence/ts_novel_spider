import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import { calculateRemainingTaskChapters } from '../services/library-view';

interface TaskMonitorProps {
  currentTask: ApiTaskSnapshot | null;
  recentTasks: ApiTaskSnapshot[];
  streamState: 'idle' | 'connected' | 'reconnecting';
  getSourceLabel: (sourceId: string) => string;
  onPickTask: (taskId: string) => void;
  onRetryFailed: () => void;
}

export function TaskMonitor({
  currentTask,
  recentTasks,
  streamState,
  getSourceLabel,
  onPickTask,
  onRetryFailed,
}: TaskMonitorProps) {
  const recentEvents = currentTask?.events.slice(-12).reverse() ?? [];
  const progress = currentTask?.progress;
  const remainingChapters = calculateRemainingTaskChapters(progress);

  return (
    <section className="panel task-monitor">
      <div className="panel-heading split">
        <div>
          <p className="eyebrow">任务监控</p>
          <h2>实时进度和下载记录</h2>
        </div>
        <span className={`stream-indicator stream-${streamState}`}>实时同步 {formatStreamState(streamState)}</span>
      </div>

      <div className="task-layout">
        <div className="task-current card">
          {currentTask ? (
            <>
              <div className="split align-start">
                <div>
                  <p className="label">任务</p>
                  <h3>{getSourceLabel(currentTask.sourceId)} / {currentTask.novelId}</h3>
                </div>
                <span className={`status-badge state-${currentTask.status}`}>{formatTaskStatus(currentTask.status)}</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="stats-row">
                <span>目录：{progress?.catalogChapters ?? 0}</span>
                <span>已完成：{progress?.completedChapters ?? 0}</span>
                <span>失败：{progress?.failedChapters ?? 0}</span>
                <span>待处理：{remainingChapters}</span>
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
              <p>开始下载后，这里会显示进度、错误信息和最近记录。</p>
            </div>
          )}
        </div>

        <div className="task-history card">
          <p className="label">最近任务</p>
          <ul className="history-list">
            {recentTasks.length > 0 ? recentTasks.map((task) => (
              <li key={task.id}>
                <button type="button" className="history-button" onClick={() => onPickTask(task.id)}>
                  <span>{getSourceLabel(task.sourceId)} / {task.novelId}</span>
                  <span className={`status-badge state-${task.status}`}>{formatTaskStatus(task.status)}</span>
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

function formatTaskStatus(status: ApiTaskSnapshot['status']): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '已失败';
    default:
      return status;
  }
}

function formatStreamState(streamState: TaskMonitorProps['streamState']): string {
  switch (streamState) {
    case 'connected':
      return '正常';
    case 'reconnecting':
      return '重连中';
    default:
      return '未连接';
  }
}