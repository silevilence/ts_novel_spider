import { StatusPanel } from './status-panel';
import { TaskMonitor } from './task-monitor';
import type { ControlCenterModel } from '../services/control-center-model';

interface MonitorDashboardProps {
  model: ControlCenterModel;
}

export function MonitorDashboard({ model }: MonitorDashboardProps) {
  return (
    <div className="page-stack">
      <section className="hero route-hero">
        <div className="route-header">
          <p className="eyebrow">任务进度</p>
          <h2>查看下载进度和错误信息</h2>
          <p className="route-copy">
            任务开始后会持续更新进度。离开这个页面再回来，也能继续查看当前状态并重试失败章节。
          </p>
        </div>
        <div className="route-summary-strip">
          <article className="summary-tile">
            <span className="label">实时同步</span>
            <strong>{formatStreamState(model.streamState)}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">最近任务数</span>
            <strong>{model.recentTasks.length} 条</strong>
          </article>
          <article className="summary-tile">
            <span className="label">失败章节</span>
            <strong>{model.currentTask?.failures.length ?? 0} 章</strong>
          </article>
        </div>
      </section>

      <StatusPanel
        health={model.health}
        errorMessage={model.errorMessage}
        sourceCount={model.sources.length}
        currentTask={model.currentTask}
        currentTaskSourceLabel={model.currentTask ? model.getSourceLabel(model.currentTask.sourceId) : null}
      />

      <TaskMonitor
        currentTask={model.currentTask}
        recentTasks={model.recentTasks}
        streamState={model.streamState}
        getSourceLabel={model.getSourceLabel}
        onPickTask={(taskId) => void model.handlePickTask(taskId)}
        onRetryFailed={() => void model.handleRetryFailed()}
      />
    </div>
  );
}

function formatStreamState(state: ControlCenterModel['streamState']): string {
  switch (state) {
    case 'connected':
      return '正常';
    case 'reconnecting':
      return '重连中';
    default:
      return '未连接';
  }
}