import { useEffect, useRef, useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Group, PasswordInput, Paper, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { notificationInputSchema, type KnownNotificationTarget, type NotificationConfigInput, type NotificationRecord } from '../../server/contracts/notification';
import { fetchNotificationConfig, fetchNotificationRecords, fetchNotificationTargets, saveNotificationConfig, sendTestNotification } from '../services/api';
import type { NoticeInput } from '../services/control-center-model';

const STATUS_LABELS: Record<NotificationRecord['status'], string> = { queued: '等待发送', sending: '发送中', skipped: '已跳过', accepted: '接口已接受', failed: '发送失败', unknown: '结果不确定' };

export function NotificationPanel({ onNotice }: { onNotice: (notice: NoticeInput) => void }) {
  const [draft, setDraft] = useState<NotificationConfigInput>({ enabled: false, errorEnabled: false, channel: 'astrbot', baseUrl: '', target: { umo: '' }, keyAction: 'keep' });
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [querying, setQuerying] = useState(false);
  const [targets, setTargets] = useState<KnownNotificationTarget[]>([]);
  const [targetMessage, setTargetMessage] = useState('可手写 UMO，也可查询已知会话。查询需要 data scope，发送仅需 im scope。');
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NotificationRecord | null>(null);
  const queryEpoch = useRef(0);
  const mounted = useRef(true);

  async function load() {
    setLoading(true);
    setReady(false);
    try {
      const config = await fetchNotificationConfig();
      if (!mounted.current) return;
      setDraft({ enabled: config.enabled, errorEnabled: config.errorEnabled, channel: config.channel, baseUrl: config.baseUrl, target: config.target, keyAction: 'keep' });
      setKeyConfigured(config.keyConfigured); setError(null);
      setReady(true);
      await refreshRecords();
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : '通知设置加载失败'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; queryEpoch.current++; }; }, []);

  function update(change: Partial<NotificationConfigInput>, connectionChanged = false) {
    if (connectionChanged) {
      queryEpoch.current++; setTargets([]); setQuerying(false); setTargetMessage('连接配置已变化，请重新查询已知会话；已填写目标仍保留。');
    }
    setDraft((current) => ({ ...current, ...change })); setError(null); setResult(null);
  }
  function validationMessage() {
    const parsed = notificationInputSchema.safeParse(draft);
    if (!parsed.success) return parsed.error.issues.map((issue) => issue.message).join('；');
    if (draft.enabled && draft.keyAction === 'keep' && !keyConfigured) return '启用通知需要设置 API Key';
    return null;
  }
  async function refreshRecords() {
    const payload = await fetchNotificationRecords();
    if (mounted.current) setRecords(payload.records);
  }
  async function queryTargets() {
    const epoch = ++queryEpoch.current;
    setQuerying(true);
    try {
      const payload = await fetchNotificationTargets({ ...draft, enabled: false, target: { umo: '' } });
      if (mounted.current && epoch === queryEpoch.current) { setTargets(payload.targets); setTargetMessage(payload.message); }
    } catch (err) {
      if (mounted.current && epoch === queryEpoch.current) { setTargets([]); setTargetMessage(err instanceof Error ? err.message : '查询失败，仍可手写目标'); }
    } finally { if (mounted.current && epoch === queryEpoch.current) setQuerying(false); }
  }
  async function perform(action: 'save' | 'test') {
    const invalid = validationMessage();
    if (invalid) { setError(invalid); return; }
    setBusy(action); setError(null);
    try {
      if (action === 'save') {
        const config = await saveNotificationConfig(draft);
        if (!mounted.current) return;
        queryEpoch.current++; setQuerying(false); setTargets([]);
        setDraft({ ...draft, baseUrl: config.baseUrl, target: config.target, keyAction: 'keep', apiKey: '' });
        setKeyConfigured(config.keyConfigured);
        onNotice({ tone: 'success', title: '通知设置已保存', message: '后台任务将使用此配置。保存不会发送测试消息。' });
      } else {
        const sent = await sendTestNotification(draft);
        if (mounted.current) setResult(sent);
        await refreshRecords();
      }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : '通知操作失败'); }
    finally { if (mounted.current) setBusy(null); }
  }

  return <Stack gap="md">
    <Text size="sm" c="dimmed">后台发送，不依赖页面在线。更新提醒在下载结束后汇总，使用同一个接收目标。</Text>
    {error && <Alert color="red" role="alert">{error}<Button variant="subtle" size="xs" onClick={() => void load()} disabled={Boolean(busy)}>重新加载</Button></Alert>}
    <Switch label="启用消息通知" checked={draft.enabled} disabled={loading || !ready || Boolean(busy)} onChange={(event) => update({ enabled: event.currentTarget.checked })} />
    <Switch label="后台任务错误通知" description="更新检查失败、采集最终失败或部分失败时汇总告警。" checked={draft.errorEnabled} disabled={loading || !ready || Boolean(busy)} onChange={(event) => update({ errorEnabled: event.currentTarget.checked })} />
    <Select label="通知方式" data={[{ value: 'astrbot', label: 'AstrBot' }]} value={draft.channel} allowDeselect={false} disabled />
    <TextInput label="AstrBot 服务地址" description="填写实例根地址；后端按实例接口定义选择消息路径。" value={draft.baseUrl} disabled={loading || !ready || Boolean(busy)} onBlur={() => setError(validationMessage())} onChange={(event) => update({ baseUrl: event.currentTarget.value }, true)} />
    <Select label="API Key 操作" description={keyConfigured ? '已保存密钥，读取设置不会返回密钥。' : '尚未保存密钥。'} data={[{ value: 'keep', label: '保留已存密钥' }, { value: 'replace', label: '更换密钥' }, { value: 'clear', label: '清除密钥' }]} value={draft.keyAction} allowDeselect={false} disabled={loading || !ready || Boolean(busy)} onChange={(value) => update({ keyAction: value as NotificationConfigInput['keyAction'], apiKey: '' }, true)} />
    {draft.keyAction === 'replace' && <PasswordInput label="新 API Key" autoComplete="new-password" value={draft.apiKey ?? ''} disabled={Boolean(busy)} onChange={(event) => update({ apiKey: event.currentTarget.value }, true)} />}
    <Autocomplete label="目标 UMO" description="格式：平台:消息类型:会话标识。可搜索选择，也可直接手写列表外目标。" value={draft.target.umo}
      data={targets.map((target) => target.umo)}
      renderOption={({ option }) => <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{targets.find((target) => target.umo === option.value)?.label ?? option.value}</Text>}
      filter={({ options, search }) => options.filter((option) => 'value' in option && (targets.find((target) => target.umo === option.value)?.label ?? option.value).toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))}
      disabled={loading || !ready || Boolean(busy)} onBlur={() => setError(validationMessage())} onChange={(umo) => update({ target: { umo } })} />
    <Group><Button variant="light" loading={querying} disabled={loading || !ready || Boolean(busy)} onClick={() => void queryTargets()}>刷新已知 UMO</Button></Group>
    <Text size="xs" c="dimmed" role="status">{targetMessage}</Text>
    <Group grow>
      <Button loading={busy === 'save'} disabled={loading || !ready || Boolean(busy)} onClick={() => void perform('save')}>保存通知设置</Button>
      <Button variant="light" loading={busy === 'test'} disabled={loading || !ready || Boolean(busy)} onClick={() => void perform('test')}>发送测试通知</Button>
    </Group>
    <Text size="xs" c="dimmed">测试使用当前表单，可在总开关关闭时发送；不会自动保存。接口接受不等于收件人已收到。</Text>
    {result && <Alert color={result.status === 'accepted' ? 'green' : 'orange'} role="status" title={STATUS_LABELS[result.status]}>{result.result?.message}</Alert>}
    <Group justify="space-between"><Text fw={600}>最近发送记录</Text><Button variant="subtle" size="xs" onClick={() => void refreshRecords().catch(() => setError('发送记录读取失败'))}>刷新记录</Button></Group>
    {!records.length && <Text size="sm" c="dimmed">暂无发送记录</Text>}
    {records.slice(0, 10).map((entry) => <Paper key={entry.id} p="sm" withBorder>
      <Group justify="space-between"><Text size="sm" fw={500}>{entry.event.title}</Text><Badge color={entry.status === 'accepted' ? 'green' : entry.status === 'failed' || entry.status === 'unknown' ? 'orange' : 'gray'}>{STATUS_LABELS[entry.status]}</Badge></Group>
      <Text size="xs" style={{ overflowWrap: 'anywhere' }}>{entry.event.kind} · {entry.target.umo} · 尝试 {entry.attempts} 次</Text>
      <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>事件：{entry.id} · {new Date(entry.updatedAt).toLocaleString()}</Text>
      {entry.result && <Text size="sm">{entry.result.message}</Text>}
    </Paper>)}
  </Stack>;
}
