import { startTransition, useEffect, useEffectEvent, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconNetwork, IconPlugConnected } from '@tabler/icons-react';

import {
  fetchNetworkProxy,
  updateNetworkProxy,
  validateNetworkProxy,
  type UpdateNetworkProxyInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import type { ControlNetworkProxyPayload } from '../../server/routes/control-center';

interface ProxyDraft {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: string;
  username: string;
  password: string;
  bypassHosts: string;
  targetUrl: string;
}

const DEFAULT_TARGET_URL = 'https://ncode.syosetu.com/';

interface NetworkProxyPanelProps {
  onNotice?: (notice: NoticeInput) => void;
}

export function NetworkProxyPanel({ onNotice }: NetworkProxyPanelProps) {
  const [state, setState] = useState<ControlNetworkProxyPayload | null>(null);
  const [draft, setDraft] = useState<ProxyDraft>(() => createEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hydrateState = useEffectEvent((payload: ControlNetworkProxyPayload) => {
    startTransition(() => {
      setState(payload);
      setDraft(createDraftFromPayload(payload));
      setErrorMessage(null);
    });
  });

  useEffect(() => {
    let active = true;

    void fetchNetworkProxy()
      .then((payload) => {
        if (!active) {
          return;
        }

        hydrateState(payload);
      })
      .catch((error) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load proxy config.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);

    try {
      const payload = await updateNetworkProxy(toUpdateInput(draft));
      hydrateState(payload);
      onNotice?.({
        tone: 'success',
        title: '代理配置已保存',
        message: formatProxySummary(payload.config),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save proxy config.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: '代理配置保存失败', message });
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);

    try {
      const payload = await validateNetworkProxy(draft.targetUrl.trim());
      startTransition(() => {
        setState(payload);
        setErrorMessage(null);
      });
      onNotice?.({
        tone: payload.validation?.ok ? 'success' : 'error',
        title: '代理测试完成',
        message: payload.validation?.message ?? '代理连接测试已完成。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Proxy validation failed.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: '代理测试失败', message });
    } finally {
      setValidating(false);
    }
  }

  const isDirty = state ? isDraftDirty(draft, state) : false;
  const validation = state?.validation ?? null;
  const proxySummary = formatProxySummary(state?.config ?? null);

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Group mb={4}>
            <IconNetwork size={18} color="#ffd166" />
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.08em', color: '#ffd166' }}>网络代理</Text>
          </Group>
          <Title order={4}>设置代理连接</Title>
          <Text size="xs" c="dimmed" maw={480}>如果访问站点需要代理，可以在这里统一设置。保存后，后续预览和采集都会使用这份配置。</Text>
        </div>
        <Group gap="xs">
          <Badge variant="light" color={draft.enabled ? 'green' : 'gray'}>{draft.enabled ? '代理已启用' : '当前直连'}</Badge>
          <Badge variant="light" color={validation?.ok ? 'green' : validation ? 'red' : 'gray'}>
            {validation ? (validation.ok ? '校验成功' : '校验失败') : '未校验'}
          </Badge>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Card padding="sm" radius="md"><Text size="xs" c="dimmed">当前出口</Text><Text size="sm" fw={600}>{proxySummary}</Text></Card>
        <Card padding="sm" radius="md"><Text size="xs" c="dimmed">绕过主机</Text><Text size="sm" fw={600}>{state?.config.bypassHosts.length ?? 0} 条规则</Text></Card>
        <Card padding="sm" radius="md"><Text size="xs" c="dimmed">最近探测</Text><Text size="sm" fw={600}>{validation?.checkedAt ?? '等待首次校验'}</Text></Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Switch
          label="启用代理出站"
          checked={draft.enabled}
          onChange={(e) => setDraft((c) => ({ ...c, enabled: e.currentTarget.checked }))}
        />
        <Select
          label="协议"
          data={[{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }]}
          value={draft.protocol}
          onChange={(v) => v && setDraft((c) => ({ ...c, protocol: v as 'http' | 'https' }))}
        />
        <TextInput label="主机" value={draft.host} onChange={(e) => setDraft((c) => ({ ...c, host: e.target.value }))} placeholder="127.0.0.1" />
        <NumberInput label="端口" value={draft.port ? Number(draft.port) : ''} onChange={(v) => setDraft((c) => ({ ...c, port: String(v ?? '') }))} min={1} placeholder="7890" hideControls />
        <TextInput label="用户名" value={draft.username} onChange={(e) => setDraft((c) => ({ ...c, username: e.target.value }))} placeholder="可选" />
        <PasswordInput label="密码" value={draft.password} onChange={(e) => setDraft((c) => ({ ...c, password: e.target.value }))} placeholder="可选" />
      </SimpleGrid>

      <Textarea
        label="绕过主机列表（每行一个）"
        value={draft.bypassHosts}
        onChange={(e) => setDraft((c) => ({ ...c, bypassHosts: e.target.value }))}
        placeholder="localhost\n127.0.0.1"
        rows={4}
      />
      <TextInput
        label="校验目标地址"
        value={draft.targetUrl}
        onChange={(e) => setDraft((c) => ({ ...c, targetUrl: e.target.value }))}
        placeholder={DEFAULT_TARGET_URL}
      />

      <Card padding="sm" radius="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={600}>连接状态</Text>
            <Text size="xs" c="dimmed">
              {validation
                ? `${validation.message} ${validation.statusCode ? `HTTP ${validation.statusCode} · ` : ''}${validation.latencyMs} ms`
                : '先保存设置，再测试目标地址连通性。'}
            </Text>
          </div>
          <Badge variant="light" color={validation?.usingProxy ? 'green' : 'gray'}>
            {validation?.usingProxy ? '经代理' : '直连'}
          </Badge>
        </Group>
      </Card>

      <Group>
        <Button variant="default" onClick={handleSave} loading={saving} disabled={validating}>
          保存配置
        </Button>
        <Button color="brand" onClick={handleValidate} loading={validating} disabled={state === null || isDirty || saving}
          leftSection={<IconPlugConnected size={16} />}>
          测试连接
        </Button>
      </Group>
      {isDirty ? <Text size="xs" c="dimmed">你有未保存的修改，先保存后才能测试连接。</Text> : null}
      {errorMessage ? <Text size="sm" c="red">{errorMessage}</Text> : null}
    </Stack>
  );
}

function createEmptyDraft(): ProxyDraft {
  return {
    enabled: false,
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
    bypassHosts: '',
    targetUrl: DEFAULT_TARGET_URL,
  };
}

function createDraftFromPayload(payload: ControlNetworkProxyPayload): ProxyDraft {
  return {
    enabled: payload.config.enabled,
    protocol: payload.config.protocol,
    host: payload.config.host,
    port: payload.config.port ? String(payload.config.port) : '',
    username: payload.config.username,
    password: payload.config.password,
    bypassHosts: payload.config.bypassHosts.join('\n'),
    targetUrl: payload.validation?.targetUrl ?? DEFAULT_TARGET_URL,
  };
}

function toUpdateInput(draft: ProxyDraft): UpdateNetworkProxyInput {
  const trimmedPort = draft.port.trim();

  return {
    enabled: draft.enabled,
    protocol: draft.protocol,
    host: draft.host.trim(),
    port: trimmedPort.length > 0 ? Number(trimmedPort) : null,
    username: draft.username.trim(),
    password: draft.password.trim(),
    bypassHosts: splitBypassHosts(draft.bypassHosts),
  };
}

function splitBypassHosts(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isDraftDirty(draft: ProxyDraft, payload: ControlNetworkProxyPayload): boolean {
  const left = JSON.stringify(toUpdateInput(draft));
  const right = JSON.stringify({
    enabled: payload.config.enabled,
    protocol: payload.config.protocol,
    host: payload.config.host,
    port: payload.config.port,
    username: payload.config.username,
    password: payload.config.password,
    bypassHosts: payload.config.bypassHosts,
  } satisfies UpdateNetworkProxyInput);

  return left !== right;
}

function formatProxySummary(config: ControlNetworkProxyPayload['config'] | null): string {
  if (!config || !config.enabled || !config.isConfigured || config.port === null) {
    return '未启用代理，当前所有请求将直接出站。';
  }

  const credentials = config.username.length > 0 ? `${config.username}@` : '';
  return `${config.protocol}://${credentials}${config.host}:${config.port}`;
}