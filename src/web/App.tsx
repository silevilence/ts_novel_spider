import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';

import { AppShell } from './components/app-shell';
import { ControlConsole } from './components/control-console';
import { LibraryWorkspace } from './components/library-workspace';
import { MonitorDashboard } from './components/monitor-dashboard';
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

export function App() {
  const [currentLocation, setCurrentLocation] = useState(() => resolveAppLocation(window.location.pathname));

  function pushNotice(input: NoticeInput) {
    notifications.show({
      title: input.title,
      message: input.message,
      color: input.tone === 'success' ? 'green' : input.tone === 'error' ? 'red' : 'blue',
      autoClose: 4000,
      withBorder: true,
      style: {
        background: 'rgba(26,20,16,0.94)',
        borderColor: input.tone === 'success' ? 'rgba(97,212,166,0.3)' : input.tone === 'error' ? 'rgba(255,123,114,0.3)' : 'rgba(127,208,255,0.3)',
      },
    });
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
    </>
  );
}