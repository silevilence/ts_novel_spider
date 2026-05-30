import { useEffect, useState } from 'react';
import {
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  Badge,
  useMantineTheme,
} from '@mantine/core';
import { IconRoute } from '@tabler/icons-react';

import {
  fetchLlmProvidersPreferences,
  type LlmProviderType,
} from '../services/api';
import type { ControlLlmProvidersPayload } from '../../server/routes/control-center';

export interface ModelGatewayEntry {
  providerId: string;
  modelId: string;
  providerLabel: string;
  modelLabel: string;
}

const CAPABILITY_KEYS = ['chat', 'embedding', 'rerank'] as const;
type CapKey = (typeof CAPABILITY_KEYS)[number];

const CAPABILITY_META: Record<CapKey, { label: string; color: string }> = {
  chat: { label: '💬 对话模型', color: 'blue' },
  embedding: { label: '🧬 嵌入模型', color: 'green' },
  rerank: { label: '🔄 重排模型', color: 'orange' },
};

export function ModelGatewayPanel() {
  const theme = useMantineTheme();
  const [state, setState] = useState<ControlLlmProvidersPayload | null>(null);
  const [gateway, setGateway] = useState<Record<CapKey, string>>({
    chat: '',
    embedding: '',
    rerank: '',
  });
  const [loading, setLoading] = useState(true);

  // Load providers + gateway config
  useEffect(() => {
    let active = true;

    Promise.all([
      fetchLlmProvidersPreferences(),
      import('../services/api').then(({ fetchModelGateway }) => fetchModelGateway()),
    ])
      .then(([providers, gw]) => {
        if (!active) return;
        setState(providers);
        setGateway({
          chat: gw.chat ? `${gw.chat.providerId}:${gw.chat.modelId}` : '',
          embedding: gw.embedding ? `${gw.embedding.providerId}:${gw.embedding.modelId}` : '',
          rerank: gw.rerank ? `${gw.rerank.providerId}:${gw.rerank.modelId}` : '',
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Build model options grouped by provider
  const modelOptions = useModelOptions(state);

  async function handleChange(cap: CapKey, value: string | null) {
    const next = { ...gateway, [cap]: value ?? '' };
    setGateway(next);

    try {
      const { updateModelGateway } = await import('../services/api');
      const payload: Record<string, { providerId: string; modelId: string }> = {};
      const caps = CAPABILITY_KEYS as readonly string[];
      for (const c of caps) {
        const v = c === cap ? value : gateway[c as CapKey];
        const parsed = parseGatewayValue(v);
        if (parsed) payload[c] = parsed;
      }
      await updateModelGateway(payload as Record<string, { providerId: string; modelId: string }> & {});
    } catch {
      // silently ignore save errors
    }
  }

  if (loading) {
    return (
      <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,0.6)' }}>
        <Text size="sm" c="dimmed">正在加载模型网关配置...</Text>
      </Paper>
    );
  }

  return (
    <Paper
      p="md"
      radius="lg"
      style={{
        background: 'rgba(31,21,16,0.78)',
        border: `1px solid ${theme.other.lineColor as string}`,
      }}
    >
      <Group mb="xs">
        <IconRoute size={18} color={theme.other.accentStrong as string} />
        <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.08em', color: theme.other.accentStrong as string }}>
          默认模型网关
        </Text>
      </Group>
      <Title order={6} mb="xs">按能力指定默认模型</Title>
      <Text size="xs" c="dimmed" mb="md">
        系统在未指定具体模型时，将优先使用此处配置的默认入口。
      </Text>

      <Stack gap="sm">
        {CAPABILITY_KEYS.map((cap) => (
          <Select
            key={cap}
            label={CAPABILITY_META[cap].label}
            placeholder="自动选择"
            data={modelOptions}
            value={gateway[cap]}
            onChange={(v) => void handleChange(cap, v)}
            searchable
            clearable
            nothingFoundMessage="暂无可用的此能力模型"
          />
        ))}
      </Stack>
    </Paper>
  );
}

// ── Helpers ──

function useModelOptions(state: ControlLlmProvidersPayload | null) {
  if (!state) return [];

  const groups: { group: string; items: { value: string; label: string }[] }[] = [];

  for (const provider of state.providers) {
    if (!provider.enabled) continue;
    const items = provider.models
      .filter((m) => m.enabled && m.modelId)
      .map((m) => ({
        value: `${provider.id}:${m.modelId}`,
        label: `${provider.label} / ${m.label || m.modelId}`,
      }));
    if (items.length > 0) {
      groups.push({ group: provider.label, items });
    }
  }

  return groups;
}

function parseGatewayValue(
  value: string | null,
): { providerId: string; modelId: string } | undefined {
  if (!value) return undefined;
  const [providerId, ...rest] = value.split(':');
  const modelId = rest.join(':');
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}
