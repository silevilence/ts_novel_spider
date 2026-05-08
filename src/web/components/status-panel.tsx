import type { HealthPayload } from '../../server/routes/health';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';

interface StatusPanelProps {
  health: HealthPayload | null;
  errorMessage: string | null;
  sourceCount: number;
  currentTask: ApiTaskSnapshot | null;
  currentTaskSourceLabel: string | null;
}

export function StatusPanel({ health, errorMessage, sourceCount, currentTask, currentTaskSourceLabel }: StatusPanelProps) {
  return (
    <section className="status-panel">
      <div>
        <p className="eyebrow">运行总览</p>
        <h2>当前状态</h2>
      </div>
      <dl>
        <div>
          <dt>服务状态</dt>
          <dd>{health?.status ?? '加载中'}</dd>
        </div>
        <div>
          <dt>可用站点</dt>
          <dd>{sourceCount > 0 ? `${sourceCount} 个` : '加载中'}</dd>
        </div>
        <div>
          <dt>当前任务</dt>
          <dd>{currentTask ? `${currentTaskSourceLabel} / ${formatTaskStatus(currentTask.status)}` : '空闲'}</dd>
        </div>
        <div>
          <dt>最近更新时间</dt>
          <dd>{health?.timestamp ?? errorMessage ?? '等待响应'}</dd>
        </div>
      </dl>
    </section>
  );
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