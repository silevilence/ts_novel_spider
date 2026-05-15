import { useEffect, useState } from 'react';

import { AppShell } from './components/app-shell';
import { ControlConsole } from './components/control-console';
import { LibraryWorkspace } from './components/library-workspace';
import { MonitorDashboard } from './components/monitor-dashboard';
import { NotificationCenter } from './components/notification-center';
import { SystemPreferences } from './components/system-preferences';
import {
  APP_ROUTES,
  normalizePathname,
  resolveAppLocation,
} from './services/app-routes';
import {
  type NoticeInput,
  useControlCenterModel,
} from './services/control-center-model';
import { useLibraryModel } from './services/library-model';

interface AppNotice extends NoticeInput {
  id: string;
}

export function App() {
  const [currentLocation, setCurrentLocation] = useState(() => resolveAppLocation(window.location.pathname));
  const [notices, setNotices] = useState<AppNotice[]>([]);

  function pushNotice(input: NoticeInput) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setNotices((current) => [...current, { id, ...input }]);

    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, 4200);
  }

  const model = useControlCenterModel(pushNotice);
  const activeRoute = currentLocation.route;
  const libraryModel = useLibraryModel({
    location: currentLocation,
    onNavigate: navigate,
    onNotice: pushNotice,
  });

  useEffect(() => {
    const pathname = normalizePathname(window.location.pathname);
    const resolvedLocation = resolveAppLocation(pathname);

    if (pathname !== resolvedLocation.path) {
      window.history.replaceState(null, '', resolvedLocation.path);
    }

    const handlePopState = () => {
      setCurrentLocation(resolveAppLocation(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  function navigate(nextPath: string) {
    const resolvedLocation = resolveAppLocation(nextPath);

    if (resolvedLocation.path === currentLocation.path) {
      return;
    }

    window.history.pushState(null, '', resolvedLocation.path);
    setCurrentLocation(resolvedLocation);
    window.scrollTo({ top: 0, behavior: 'auto' });
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
        {activeRoute.id === 'library' ? (
          <LibraryWorkspace model={libraryModel} onOpenControl={() => navigate('/')} onNotify={pushNotice} />
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