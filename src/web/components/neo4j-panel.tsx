import { startTransition, useEffect, useEffectEvent, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  PasswordInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDatabase, IconPlugConnected } from '@tabler/icons-react';

import {
  fetchNeo4jPreferences,
  updateNeo4jPreferences,
  validateNeo4jPreferences,
  type UpdateNeo4jInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import type { ControlNeo4jPayload } from '../../server/routes/control-center';

interface Neo4jPanelProps {
  onNotice?: (notice: NoticeInput) => void;
}

interface Neo4jDraft extends UpdateNeo4jInput {}

export function Neo4jPanel({ onNotice }: Neo4jPanelProps) {
  const [state, setState] = useState<ControlNeo4jPayload | null>(null);
  const [draft, setDraft] = useState<Neo4jDraft>(createEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hydrateState = useEffectEvent((payload: ControlNeo4jPayload) => {
    startTransition(() => {
      setState(payload);
      setDraft({
        enabled: payload.config.enabled,
        uri: payload.config.uri,
        username: payload.config.username,
        password: payload.config.password,
        database: payload.config.database,
      });
      setErrorMessage(null);
    });
  });

  useEffect(() => {
    let active = true;

    void fetchNeo4jPreferences()
      .then((payload) => {
        if (!active) {
          return;
        }

        hydrateState(payload);
      })
      .catch((error) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load Neo4j preferences.');
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
      const payload = await updateNeo4jPreferences({
        enabled: draft.enabled,
        uri: draft.uri.trim(),
        username: draft.username.trim(),
        password: draft.password.trim(),
        database: draft.database.trim(),
      });
      hydrateState(payload);
      onNotice?.({
        tone: 'success',
        title: 'Neo4j 配置已保存',
        message: payload.config.enabled ? '图数据库连接信息已更新。' : '图数据库连接已关闭。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save Neo4j preferences.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: 'Neo4j 配置保存失败', message });
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);

    try {
      const payload = await validateNeo4jPreferences();
      startTransition(() => {
        setState(payload);
        setErrorMessage(null);
      });
      onNotice?.({
        tone: payload.validation?.ok ? 'success' : 'error',
        title: 'Neo4j 连通性测试完成',
        message: payload.validation?.message ?? '图数据库探测已结束。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Neo4j validation failed.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: 'Neo4j 连通性测试失败', message });
    } finally {
      setValidating(false);
    }
  }

  const validation = state?.validation ?? null;
  const isDirty = state
    ? JSON.stringify(draft) !==
      JSON.stringify({
        enabled: state.config.enabled,
        uri: state.config.uri,
        username: state.config.username,
        password: state.config.password,
        database: state.config.database,
      })
    : false;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Group mb={4}>
            <IconDatabase size={18} color="#ffd166" />
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.08em', color: '#ffd166' }}>图数据库</Text>
          </Group>
          <Title order={4}>配置 Neo4j 连接</Title>
          <Text size="xs" c="dimmed" maw={480}>用于实体关系图谱和检索增强功能。保存后可测试连接是否可用。</Text>
        </div>
        <Group gap="xs">
          <Badge variant="light" color={draft.enabled ? 'green' : 'gray'}>{draft.enabled ? '已启用' : '未启用'}</Badge>
          <Badge variant="light" color={validation?.ok ? 'green' : validation ? 'red' : 'gray'}>
            {validation ? (validation.ok ? '测试成功' : '测试失败') : '未测试'}
          </Badge>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Card padding="sm" radius="md"><Text size="xs" c="dimmed">连接地址</Text><Text size="sm" fw={600}>{state?.config.uri || '未填写'}</Text></Card>
        <Card padding="sm" radius="md"><Text size="xs" c="dimmed">默认数据库</Text><Text size="sm" fw={600}>{state?.config.database || '服务器默认'}</Text></Card>
        <Card padding="sm" radius="md"><Text size="xs" c="dimmed">最近探测</Text><Text size="sm" fw={600}>{validation?.checkedAt ?? '等待首次测试'}</Text></Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Switch
          label="启用 Neo4j"
          checked={draft.enabled}
          onChange={(e) => setDraft((c) => ({ ...c, enabled: e.currentTarget.checked }))}
        />
        <TextInput label="连接 URI" value={draft.uri} onChange={(e) => setDraft((c) => ({ ...c, uri: e.target.value }))} placeholder="neo4j://127.0.0.1:7687" />
        <TextInput label="用户名" value={draft.username} onChange={(e) => setDraft((c) => ({ ...c, username: e.target.value }))} placeholder="neo4j" />
        <PasswordInput label="密码" value={draft.password} onChange={(e) => setDraft((c) => ({ ...c, password: e.target.value }))} placeholder="输入密码" />
        <TextInput label="数据库名" value={draft.database} onChange={(e) => setDraft((c) => ({ ...c, database: e.target.value }))} placeholder="留空使用默认" />
      </SimpleGrid>

      <Card padding="sm" radius="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={600}>连通性状态</Text>
            <Text size="xs" c="dimmed">
              {validation
                ? `${validation.message} ${validation.serverAgent ? `${validation.serverAgent} · ` : ''}${validation.latencyMs} ms`
                : '先保存配置，再测试图数据库是否可连通。'}
            </Text>
          </div>
          <Badge variant="light" color={state?.config.isConfigured ? 'green' : 'yellow'}>
            {state?.config.isConfigured ? '信息完整' : '待补充'}
          </Badge>
        </Group>
      </Card>

      <Group>
        <Button variant="default" onClick={handleSave} loading={saving} disabled={validating}>保存 Neo4j 配置</Button>
        <Button color="brand" onClick={handleValidate} loading={validating} disabled={state === null || isDirty || saving}
          leftSection={<IconPlugConnected size={16} />}>测试连接</Button>
      </Group>

      {isDirty ? <Text size="xs" c="dimmed">你有未保存的修改，先保存后才能测试连接。</Text> : null}
      {errorMessage ? <Text size="sm" c="red">{errorMessage}</Text> : null}
    </Stack>
  );
}

function createEmptyDraft(): Neo4jDraft {
  return {
    enabled: false,
    uri: '',
    username: '',
    password: '',
    database: '',
  };
}