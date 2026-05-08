import { useEffect, useState } from 'react';

import { AppShell } from './components/app-shell';
import { ControlConsole } from './components/control-console';
import { MonitorDashboard } from './components/monitor-dashboard';
import { NotificationCenter } from './components/notification-center';
import { SystemPreferences } from './components/system-preferences';
import { APP_ROUTES, normalizePathname, resolveAppRoute } from './services/app-routes';
import {
  type NoticeInput,
  useControlCenterModel,
} from './services/control-center-model';

interface AppNotice extends NoticeInput {
  id: string;
}

export function App() {
  const [currentPath, setCurrentPath] = useState(() => resolveAppRoute(window.location.pathname).path);
  const [notices, setNotices] = useState<AppNotice[]>([]);

  function pushNotice(input: NoticeInput) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setNotices((current) => [...current, { id, ...input }]);

    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, 4200);
  }

  const model = useControlCenterModel(pushNotice);
  const activeRoute = resolveAppRoute(currentPath);

  useEffect(() => {
    const pathname = normalizePathname(window.location.pathname);
    const resolvedRoute = resolveAppRoute(pathname);

    if (pathname !== resolvedRoute.path) {
      window.history.replaceState(null, '', resolvedRoute.path);
    }

    const handlePopState = () => {
      setCurrentPath(resolveAppRoute(window.location.pathname).path);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  function navigate(nextPath: string) {
    const resolvedRoute = resolveAppRoute(nextPath);

    if (resolvedRoute.path === currentPath) {
      return;
    }

    window.history.pushState(null, '', resolvedRoute.path);
    setCurrentPath(resolvedRoute.path);
  }

  return (
    <>
      <AppShell
        routes={APP_ROUTES}
        activeRoute={activeRoute}
        onNavigate={navigate}
        health={model.health}
        errorMessage={model.errorMessage}
        sourceCount={model.sources.length}
        currentTask={model.currentTask}
        getSourceLabel={model.getSourceLabel}
      >
        {activeRoute.id === 'control' ? (
          <ControlConsole model={model} onOpenSettings={() => navigate('/settings')} />
        ) : null}
        {activeRoute.id === 'monitor' ? <MonitorDashboard model={model} /> : null}
        {activeRoute.id === 'settings' ? (
          <SystemPreferences
            model={model}
            onOpenControl={() => navigate('/')}
            onNotify={pushNotice}
          />
        ) : null}
      </AppShell>
      <NotificationCenter notices={notices} onDismiss={(id) => setNotices((current) => current.filter((notice) => notice.id !== id))} />
    </>
  );
}