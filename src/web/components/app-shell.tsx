import { useEffect, useRef, useState } from 'react';
import type { HealthPayload } from '../../server/routes/health';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import type { AppRouteDefinition } from '../services/app-routes';

interface AppShellProps {
  routes: AppRouteDefinition[];
  activeRoute: AppRouteDefinition;
  onNavigate: (path: string) => void;
  health: HealthPayload | null;
  errorMessage: string | null;
  sourceCount: number;
  currentTask: ApiTaskSnapshot | null;
  getSourceLabel: (sourceId: string) => string;
  children: React.ReactNode;
}

export function AppShell({
  routes,
  activeRoute,
  onNavigate,
  health,
  errorMessage,
  sourceCount,
  currentTask,
  getSourceLabel,
  children,
}: AppShellProps) {
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const currentTaskLabel = currentTask
    ? `${getSourceLabel(currentTask.sourceId)} / ${formatTaskStatus(currentTask.status)}`
    : '空闲';

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y > 80 && !scrolledRef.current) {
        scrolledRef.current = true;
        setScrolled(true);
      } else if (y < 40 && scrolledRef.current) {
        scrolledRef.current = false;
        setScrolled(false);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <main className={`app-shell${scrolled ? ' scrolled' : ''}`}>
      <div className="shell-sticky-bar" aria-hidden={!scrolled}>
        <span className="shell-sticky-brand">TS Novel Spider</span>
        <nav className="shell-nav" aria-label="快捷导航">
          {routes.map((route) => (
            <button
              key={route.id}
              type="button"
              className={`shell-nav-button ${route.id === activeRoute.id ? 'active' : ''}`}
              aria-current={route.id === activeRoute.id ? 'page' : undefined}
              onClick={() => onNavigate(route.path)}
            >
              {route.label}
            </button>
          ))}
        </nav>
      </div>
      <header className="shell-header">
        <div className="shell-hero">
          <div className="route-header">
            <p className="eyebrow">TS Novel Spider</p>
            <h1>{activeRoute.title}</h1>
            <p className="hero-copy">{activeRoute.description}</p>
          </div>

          <nav className="shell-nav" aria-label="主导航">
            {routes.map((route) => (
              <button
                key={route.id}
                type="button"
                className={`shell-nav-button ${route.id === activeRoute.id ? 'active' : ''}`}
                aria-current={route.id === activeRoute.id ? 'page' : undefined}
                onClick={() => onNavigate(route.path)}
              >
                {route.label}
              </button>
            ))}
          </nav>

          <div className="shell-summary">
            <article className="shell-stat">
              <span className="label">服务状态</span>
              <strong>{health?.status ?? errorMessage ?? '连接中'}</strong>
            </article>
            <article className="shell-stat">
              <span className="label">当前任务</span>
              <strong>{currentTaskLabel}</strong>
            </article>
            <article className="shell-stat">
              <span className="label">可用站点</span>
              <strong>{sourceCount > 0 ? `${sourceCount} 个` : '加载中'}</strong>
            </article>
            <article className="shell-stat">
              <span className="label">最近更新时间</span>
              <strong>{health?.timestamp ?? '等待响应'}</strong>
            </article>
          </div>
        </div>
      </header>

      <div className="page-content">{children}</div>
    </main>
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