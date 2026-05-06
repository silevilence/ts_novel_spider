import type { HealthPayload } from '../../server/routes/health';

interface StatusPanelProps {
  health: HealthPayload | null;
  errorMessage: string | null;
}

export function StatusPanel({ health, errorMessage }: StatusPanelProps) {
  return (
    <section className="status-panel">
      <div>
        <p className="eyebrow">基础架构</p>
        <h2>开发环境已联通</h2>
      </div>
      <dl>
        <div>
          <dt>后端服务</dt>
          <dd>{health?.status ?? 'loading'}</dd>
        </div>
        <div>
          <dt>时间戳</dt>
          <dd>{health?.timestamp ?? '等待响应'}</dd>
        </div>
        <div>
          <dt>状态信息</dt>
          <dd>{errorMessage ?? 'Express API 与 Vite 前端通信正常。'}</dd>
        </div>
      </dl>
    </section>
  );
}