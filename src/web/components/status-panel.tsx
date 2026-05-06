import type { HealthPayload } from '../../server/routes/health';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';

interface StatusPanelProps {
  health: HealthPayload | null;
  errorMessage: string | null;
  sourceCount: number;
  currentTask: ApiTaskSnapshot | null;
}

export function StatusPanel({ health, errorMessage, sourceCount, currentTask }: StatusPanelProps) {
  return (
    <section className="status-panel">
      <div>
        <p className="eyebrow">运行总览</p>
        <h2>前端管控中心与后台任务已接通</h2>
      </div>
      <dl>
        <div>
          <dt>后端服务</dt>
          <dd>{health?.status ?? 'loading'}</dd>
        </div>
        <div>
          <dt>已挂载源</dt>
          <dd>{sourceCount > 0 ? `${sourceCount} 个` : '加载中'}</dd>
        </div>
        <div>
          <dt>当前任务</dt>
          <dd>{currentTask ? `${currentTask.sourceId} / ${currentTask.status}` : '空闲'}</dd>
        </div>
        <div>
          <dt>最近心跳</dt>
          <dd>{health?.timestamp ?? errorMessage ?? '等待响应'}</dd>
        </div>
      </dl>
    </section>
  );
}