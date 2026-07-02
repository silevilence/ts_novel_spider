import { useCallback, useEffect, useState } from 'react';

import {
  fetchLlmProvidersPreferences,
  fetchSchedulingConfig,
  fetchSchedulingNovels,
  fetchSchedulingRuns,
  updateSchedulingConfig as apiUpdateSchedulingConfig,
  updateSchedulingNovels as apiUpdateSchedulingNovels,
  type ModelCapability,
  type SchedulingConfig,
  type SchedulingNovelEntry,
  type SchedulingRun,
} from './api';

export interface SchedulingDashboardModel {
  config: SchedulingConfig | null;
  novels: SchedulingNovelEntry[];
  runs: SchedulingRun[];
  summaryModelOptions: { group: string; items: { value: string; label: string }[] }[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateConfig: (input: Partial<SchedulingConfig>) => Promise<void>;
  updateNovels: (entries: Array<{
    sourceId: string;
    novelId: string;
    enabled: boolean;
    autoTranslate?: boolean;
    autoSummarize?: boolean;
    summarizeModel?: { providerId: string; modelId: string } | null;
  }>) => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  hasMoreRuns: boolean;
}

const RUNS_PAGE_SIZE = 20;

export function useSchedulingDashboardModel(): SchedulingDashboardModel {
  const [config, setConfig] = useState<SchedulingConfig | null>(null);
  const [novels, setNovels] = useState<SchedulingNovelEntry[]>([]);
  const [runs, setRuns] = useState<SchedulingRun[]>([]);
  const [summaryModelOptions, setSummaryModelOptions] = useState<{ group: string; items: { value: string; label: string }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runsOffset, setRunsOffset] = useState(0);
  const [hasMoreRuns, setHasMoreRuns] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configResult, novelsResult, runsResult, llmResult] = await Promise.all([
        fetchSchedulingConfig(),
        fetchSchedulingNovels(),
        fetchSchedulingRuns(RUNS_PAGE_SIZE, 0),
        fetchLlmProvidersPreferences(),
      ]);
      setConfig(configResult);
      setNovels(novelsResult.novels);
      setRuns(runsResult.runs);
      setRunsOffset(RUNS_PAGE_SIZE);
      setHasMoreRuns(runsResult.runs.length === RUNS_PAGE_SIZE);
      setSummaryModelOptions(buildChatModelOptions(llmResult.providers));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载定时更新数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (input: Partial<SchedulingConfig>) => {
    const updated = await apiUpdateSchedulingConfig(input);
    setConfig(updated);
  }, []);

  const updateNovels = useCallback(async (entries: Array<{
    sourceId: string;
    novelId: string;
    enabled: boolean;
    autoTranslate?: boolean;
    autoSummarize?: boolean;
    summarizeModel?: { providerId: string; modelId: string } | null;
  }>) => {
    await apiUpdateSchedulingNovels(entries);
    const novelsResult = await fetchSchedulingNovels();
    setNovels(novelsResult.novels);
  }, []);

  const loadMoreRuns = useCallback(async () => {
    try {
      const more = await fetchSchedulingRuns(RUNS_PAGE_SIZE, runsOffset);
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
    summaryModelOptions,
    loading,
    error,
    refresh,
    updateConfig,
    updateNovels,
    loadMoreRuns,
    hasMoreRuns,
  };
}

function buildChatModelOptions(providers: Array<{ label: string; enabled: boolean; models: Array<{ enabled: boolean; modelId: string; label: string; resolvedCapabilities: ModelCapability[] }> ; id: string }>) {
  const groups: { group: string; items: { value: string; label: string }[] }[] = [];

  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }

    const items = provider.models
      .filter((model) => model.enabled && model.modelId && model.resolvedCapabilities.includes('chat'))
      .map((model) => ({
        value: `${provider.id}:${model.modelId}`,
        label: `${provider.label} / ${model.label || model.modelId}`,
      }));

    if (items.length > 0) {
      groups.push({ group: provider.label, items });
    }
  }

  return groups;
}