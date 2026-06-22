import { useCallback, useEffect, useState } from 'react';

import {
  fetchOpdsConfig,
  fetchOpdsNovels,
  fetchOpdsRuns,
  updateOpdsConfig as apiUpdateOpdsConfig,
  updateOpdsNovels as apiUpdateOpdsNovels,
  type OpdsCompilationRun,
  type OpdsConfig,
  type OpdsNovelEntry,
} from './api';

export interface OpdsDashboardModel {
  config: OpdsConfig | null;
  novels: OpdsNovelEntry[];
  runs: OpdsCompilationRun[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateConfig: (input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>) => Promise<void>;
  updateNovels: (entries: Array<{ sourceId: string; novelId: string; visible: boolean }>) => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  hasMoreRuns: boolean;
}

const RUNS_PAGE_SIZE = 20;

export function useOpdsDashboardModel(): OpdsDashboardModel {
  const [config, setConfig] = useState<OpdsConfig | null>(null);
  const [novels, setNovels] = useState<OpdsNovelEntry[]>([]);
  const [runs, setRuns] = useState<OpdsCompilationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runsOffset, setRunsOffset] = useState(0);
  const [hasMoreRuns, setHasMoreRuns] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configResult, novelsResult, runsResult] = await Promise.all([
        fetchOpdsConfig(),
        fetchOpdsNovels(),
        fetchOpdsRuns(RUNS_PAGE_SIZE, 0),
      ]);
      setConfig(configResult);
      setNovels(novelsResult.novels);
      setRuns(runsResult.runs);
      setRunsOffset(RUNS_PAGE_SIZE);
      setHasMoreRuns(runsResult.runs.length === RUNS_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 OPDS 数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    async (input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>) => {
      const updated = await apiUpdateOpdsConfig(input);
      setConfig(updated);
    },
    [],
  );

  const updateNovels = useCallback(
    async (entries: Array<{ sourceId: string; novelId: string; visible: boolean }>) => {
      await apiUpdateOpdsNovels(entries);
      const novelsResult = await fetchOpdsNovels();
      setNovels(novelsResult.novels);
    },
    [],
  );

  const loadMoreRuns = useCallback(async () => {
    try {
      const more = await fetchOpdsRuns(RUNS_PAGE_SIZE, runsOffset);
      setRuns((prev) => [...prev, ...more.runs]);
      setRunsOffset((prev) => prev + RUNS_PAGE_SIZE);
      setHasMoreRuns(more.runs.length === RUNS_PAGE_SIZE);
    } catch {
      setHasMoreRuns(false);
    }
  }, [runsOffset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    config,
    novels,
    runs,
    loading,
    error,
    refresh,
    updateConfig,
    updateNovels,
    loadMoreRuns,
    hasMoreRuns,
  };
}
