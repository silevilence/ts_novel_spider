import { useEffect, useState } from 'react';

import { StatusPanel } from './components/status-panel';
import { fetchHealth } from './services/api';
import type { HealthPayload } from '../server/routes/health';

export function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetchHealth()
      .then((payload) => {
        if (active) {
          setHealth(payload);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">TS Novel Spider</p>
        <h1>前后端基础架构已就位</h1>
        <p className="hero-copy">
          当前工程已具备 Express 服务端、Vite React 前端、严格 TypeScript 配置与并行开发脚本，后续可直接接入爬虫策略与任务调度核心。
        </p>
      </section>
      <StatusPanel health={health} errorMessage={errorMessage} />
    </main>
  );
}