import { useEffect, useRef, useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Group, PasswordInput, Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notificationInputSchema, type KnownNotificationTarget, type NotificationConfigInput, type NotificationRecord } from '../../server/contracts/notification';
import { fetchNotificationConfig, fetchNotificationRecords, fetchNotificationTargets, saveNotificationConfig, sendTestNotification } from '../services/api';
import type { NoticeInput } from '../services/control-center-model';

const STATUS_LABELS: Record<NotificationRecord['status'], string> = { queued: '等待发送', sending: '发送中', skipped: '已跳过', accepted: '接口已接受', failed: '发送失败', unknown: '结果不确定' };
type Action = 'save' | 'test';
type Field = 'baseUrl' | 'apiKey' | 'umo';
type FieldErrors = Partial<Record<Field, string | undefined>>;
const FIELD_IDS: Record<Field, string> = { baseUrl: 'notification-base-url', apiKey: 'notification-api-key', umo: 'notification-umo' };

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; action: Action } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
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
      setKeyConfigured(config.keyConfigured); setLoadError(null);
      setReady(true);
      await refreshRecords();
    } catch (err) { if (mounted.current) setLoadError(err instanceof Error ? err.message : '通知设置加载失败'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; queryEpoch.current++; }; }, []);

  function update(change: Partial<NotificationConfigInput>, connectionChanged = false) {
    if (connectionChanged) {
      queryEpoch.current++; setTargets([]); setQuerying(false); setTargetMessage('连接配置已变化，请重新查询已知会话；已填写目标仍保留。');
    }
    setDraft((current) => ({ ...current, ...change })); setError(null); setResult(null);
    setFieldErrors((current) => ({ ...current,
      ...(change.baseUrl !== undefined ? { baseUrl: undefined } : {}),
      ...(change.target !== undefined ? { umo: undefined } : {}),
      ...(change.keyAction !== undefined || change.apiKey !== undefined ? { apiKey: undefined } : {}),
    }));
  }
  function validate(action: Action | 'targets' = 'save'): FieldErrors {
    const errors: FieldErrors = {};
    const parsed = notificationInputSchema.safeParse({ ...draft, enabled: false });
    if (!parsed.success) for (const issue of parsed.error.issues) {
      const field = issue.path[0] === 'target' ? 'umo' : issue.path[0];
      if (field === 'baseUrl' || field === 'apiKey' || field === 'umo') errors[field] = issue.message;
    }
    if (draft.enabled || action !== 'save') {
      if (!draft.baseUrl.trim()) errors.baseUrl = '请填写 AstrBot 服务地址';
      if (draft.keyAction === 'clear' || (draft.keyAction === 'keep' && !keyConfigured)) errors.apiKey = '请填写 API Key';
      if (!draft.target.umo.trim()) errors.umo = '请填写或选择接收目标 UMO';
    }
    if (action === 'targets') delete errors.umo;
    return errors;
  }
  function validateField(field: Field) {
    setFieldErrors((current) => ({ ...current, [field]: validate()[field] }));
  }
  function showValidation(errors: FieldErrors) {
    setFieldErrors(errors);
    const first = (['baseUrl', 'apiKey', 'umo'] as const).find((field) => errors[field]);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return Boolean(first);
  }
  async function refreshRecords() {
    setRecordsLoading(true); setRecordsError(null);
    try {
      const payload = await fetchNotificationRecords();
      if (mounted.current) setRecords(payload.records);
    } catch { if (mounted.current) setRecordsError('发送记录读取失败，已填写的设置和测试结果仍保留。'); }
    finally { if (mounted.current) setRecordsLoading(false); }
  }
  async function queryTargets() {
    const invalid = validate('targets');
    if (showValidation(invalid)) return;
    const epoch = ++queryEpoch.current;
    setQuerying(true);
    try {
      const payload = await fetchNotificationTargets({ ...draft, enabled: false, target: { umo: '' } });
      if (mounted.current && epoch === queryEpoch.current) { setTargets(payload.targets); setTargetMessage(payload.message); }
    } catch (err) {
      if (mounted.current && epoch === queryEpoch.current) { setTargets([]); setTargetMessage(err instanceof Error ? err.message : '查询失败，仍可手写目标'); }
    } finally { if (mounted.current && epoch === queryEpoch.current) setQuerying(false); }
  }
  async function perform(action: Action) {
    const invalid = validate(action);
    if (showValidation(invalid)) return;
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
    } catch (err) { if (mounted.current) setError({ message: err instanceof Error ? err.message : '通知操作失败', action }); }
    finally { if (mounted.current) setBusy(null); }
  }

  return <Stack gap="md">
    <Text size="sm" c="dimmed">后台发送，不依赖页面在线。更新提醒在下载结束后汇总，使用同一个接收目标。</Text>
    {loadError && <Alert color="red" role="alert">{loadError}<Button variant="subtle" size="xs" onClick={() => void load()} loading={loading}>重试加载设置</Button></Alert>}
    <Paper component="section" aria-labelledby="notification-connection" p="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between"><Title order={4} size="h5" id="notification-connection">连接与接收目标</Title><Badge variant="light">AstrBot</Badge></Group>
        <TextInput id={FIELD_IDS.baseUrl} label="AstrBot 服务地址" description="填写 AstrBot 实例根地址，例如 https://bot.example.com。" value={draft.baseUrl} error={fieldErrors.baseUrl} disabled={loading || !ready || Boolean(busy)} onBlur={() => validateField('baseUrl')} onChange={(event) => update({ baseUrl: event.currentTarget.value }, true)} />
        {keyConfigured && <Select id={draft.keyAction !== 'replace' ? FIELD_IDS.apiKey : undefined} label="API Key 操作" description="已保存密钥；保留时无需再次输入。" data={[{ value: 'keep', label: '保留已存密钥' }, { value: 'replace', label: '更换密钥' }, { value: 'clear', label: '清除密钥' }]} value={draft.keyAction} error={draft.keyAction !== 'replace' ? fieldErrors.apiKey : undefined} allowDeselect={false} disabled={loading || !ready || Boolean(busy)} onChange={(value) => update({ keyAction: value as NotificationConfigInput['keyAction'], apiKey: '' }, true)} />}
        {(!keyConfigured || draft.keyAction === 'replace') && <PasswordInput aria-invalid={Boolean(fieldErrors.apiKey)} id={FIELD_IDS.apiKey} label={keyConfigured ? '新 API Key' : 'API Key'} description={!keyConfigured ? '尚未保存密钥。发送通知需要 im 权限。' : undefined} autoComplete="new-password" value={draft.apiKey ?? ''} error={fieldErrors.apiKey} disabled={loading || !ready || Boolean(busy)} onBlur={() => validateField('apiKey')} onChange={(event) => update({ apiKey: event.currentTarget.value, keyAction: keyConfigured || event.currentTarget.value ? 'replace' : 'keep' }, true)} />}
        <Autocomplete id={FIELD_IDS.umo} label="目标 UMO" description="格式：平台:消息类型:会话标识。可搜索选择，也可直接手写列表外目标。" value={draft.target.umo}
          data={targets.map((target) => target.umo)}
          renderOption={({ option }) => <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{targets.find((target) => target.umo === option.value)?.label ?? option.value}</Text>}
          filter={({ options, search }) => options.filter((option) => 'value' in option && (targets.find((target) => target.umo === option.value)?.label ?? option.value).toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))}
          error={fieldErrors.umo} disabled={loading || !ready || Boolean(busy)} onBlur={() => validateField('umo')} onChange={(umo) => update({ target: { umo } })} />
        <Group><Button variant="light" loading={querying} disabled={loading || !ready || Boolean(busy)} onClick={() => void queryTargets()}>刷新已知 UMO</Button></Group>
        <Text size="xs" c="dimmed" role="status">{targetMessage}</Text>
      </Stack>
    </Paper>
    <Paper component="section" aria-labelledby="notification-rules" p="md" withBorder>
      <Stack gap="md">
        <Title order={4} size="h5" id="notification-rules">通知规则</Title>
        <Switch label="启用消息通知" description="保存后控制后台通知；关闭时仍可手动发送测试。" checked={draft.enabled} disabled={loading || !ready || Boolean(busy)} onChange={(event) => update({ enabled: event.currentTarget.checked })} />
        <Switch label="后台任务错误通知" description="更新检查失败、采集最终失败或部分失败时汇总告警；需同时开启消息通知总开关。" checked={draft.errorEnabled} disabled={loading || !ready || Boolean(busy)} onChange={(event) => update({ errorEnabled: event.currentTarget.checked })} />
        <Text size="sm" c="dimmed">新章节下载结果提醒请在「定时更新 → 书单管理」按书开启，并保存书单设置。</Text>
        {error?.action === 'save' && <Alert color="red" role="alert">{error.message}。输入已保留，请检查后重试保存。</Alert>}
        <Group>
          <Button loading={busy === 'save'} disabled={loading || !ready || Boolean(busy)} onClick={() => void perform('save')}>保存通知设置</Button>
        </Group>
      </Stack>
    </Paper>
    <Paper component="section" aria-labelledby="notification-testing" p="md" withBorder>
      <Stack gap="md">
        <Title order={4} size="h5" id="notification-testing">测试与记录</Title>
        <Text size="xs" c="dimmed">测试使用当前表单，可在总开关关闭时发送；不会自动保存。接口接受不等于收件人已收到。</Text>
        {error?.action === 'test' && <Alert color="red" role="alert">{error.message}。输入已保留。若请求已发出，请先核对接收端和发送记录，再决定是否重新发送。</Alert>}
        <Group><Button variant="light" loading={busy === 'test'} disabled={loading || !ready || Boolean(busy)} onClick={() => void perform('test')}>发送测试通知</Button></Group>
        {result && <Alert color={result.status === 'accepted' ? 'green' : 'orange'} role="status" title={STATUS_LABELS[result.status]}>{result.result?.message}</Alert>}
        <Group justify="space-between"><Text fw={600}>最近发送记录</Text><Button variant="subtle" size="xs" loading={recordsLoading} onClick={() => void refreshRecords()}>刷新记录</Button></Group>
        {recordsError && <Alert color="red" role="alert">{recordsError}<Button variant="subtle" size="xs" loading={recordsLoading} onClick={() => void refreshRecords()}>重试读取记录</Button></Alert>}
        {!records.length && !recordsError && !recordsLoading && <Text size="sm" c="dimmed">暂无发送记录</Text>}
        {records.slice(0, 10).map((entry) => <Paper key={entry.id} p="sm" withBorder>
          <Group justify="space-between"><Text size="sm" fw={500}>{entry.event.title}</Text><Badge color={entry.status === 'accepted' ? 'green' : entry.status === 'failed' || entry.status === 'unknown' ? 'orange' : 'gray'}>{STATUS_LABELS[entry.status]}</Badge></Group>
          <Text size="xs" style={{ overflowWrap: 'anywhere' }}>{entry.event.kind} · {entry.target.umo} · 尝试 {entry.attempts} 次</Text>
          <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>事件：{entry.id} · {new Date(entry.updatedAt).toLocaleString()}</Text>
          {entry.result && <Text size="sm">{entry.result.message}</Text>}
        </Paper>)}
      </Stack>
    </Paper>
  </Stack>;
}
