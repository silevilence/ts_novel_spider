import { useEffect, useState } from 'react';
import { Badge, Button, Code, Group, Paper, Stack, Text } from '@mantine/core';

import {
  createBrowserPairingToken,
  fetchBrowserCaptureAudits,
  fetchBrowserCaptureStatus,
  fetchBrowserPairings,
  revokeBrowserPairing,
  type BrowserCaptureAuditView,
  type BrowserCapturePairingView,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';

export function BrowserCapturePanel({ onNotice }: { onNotice: (notice: NoticeInput) => void }) {
  const [connected, setConnected] = useState(false);
  const [pairings, setPairings] = useState<BrowserCapturePairingView[]>([]);
  const [audits, setAudits] = useState<BrowserCaptureAuditView[]>([]);
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [status, pairingPayload, auditPayload] = await Promise.all([
      fetchBrowserCaptureStatus(),
      fetchBrowserPairings(),
      fetchBrowserCaptureAudits(),
    ]);
    setConnected(status.connected);
    setPairings(pairingPayload.pairings);
    setAudits(auditPayload.audits);
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => onNotice({
      tone: 'error', title: '浏览器桥接状态读取失败', message: error instanceof Error ? error.message : String(error),
    }));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function generateToken() {
    setBusy(true);
    try {
      const result = await createBrowserPairingToken();
      setToken(result);
      await navigator.clipboard?.writeText(result.token);
      onNotice({ tone: 'success', title: '配对令牌已生成', message: '令牌已复制；请在过期前粘贴到扩展设置页。' });
    } catch (error) {
      onNotice({ tone: 'error', title: '配对令牌生成失败', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(pairingId: string) {
    await revokeBrowserPairing(pairingId);
    await refresh();
    onNotice({ tone: 'success', title: '浏览器已解绑', message: '对应长期密钥已撤销。' });
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Text fw={600}>用户授权浏览器传输</Text>
          <Text size="xs" c="dimmed">扩展只回传渲染后的 DOM，不回传 Cookie 或站点验证凭据。</Text>
        </div>
        <Badge color={connected ? 'green' : 'gray'} variant="light">{connected ? '扩展已连接' : '扩展未连接'}</Badge>
      </Group>

      <Button onClick={() => void generateToken()} loading={busy}>生成一次性配对令牌</Button>
      {token ? (
        <Paper p="sm" withBorder>
          <Text size="xs" c="dimmed" mb={4}>在扩展设置页输入（有效至 {new Date(token.expiresAt).toLocaleTimeString()}）</Text>
          <Code block>{token.token}</Code>
        </Paper>
      ) : null}

      <Stack gap="xs">
        {pairings.length === 0 ? <Text size="sm" c="dimmed">尚未配对浏览器。</Text> : pairings.map((pairing) => (
          <Paper key={pairing.id} p="sm" withBorder>
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={500}>{pairing.name}</Text>
                <Text size="xs" c="dimmed">
                  {pairing.revokedAt ? '已撤销' : pairing.lastConnectedAt ? `最近连接 ${new Date(pairing.lastConnectedAt).toLocaleString()}` : '尚未连接'}
                </Text>
              </div>
              <Button size="compact-xs" color="red" variant="subtle" disabled={Boolean(pairing.revokedAt)} onClick={() => void revoke(pairing.id)}>解绑</Button>
            </Group>
          </Paper>
        ))}
      </Stack>

      <Stack gap="xs">
        <Text size="sm" fw={600}>最近采集审计</Text>
        {audits.length === 0 ? <Text size="sm" c="dimmed">暂无采集审计。</Text> : audits.map((audit) => (
          <Paper key={audit.id} p="sm" withBorder>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Text size="sm" fw={500}>{audit.sourceId} / {audit.novelId} · {formatAuditPhase(audit.phase)}</Text>
                <Text size="xs" c="dimmed">
                  {new Date(audit.completedAt).toLocaleString()}{audit.taskId ? ` · 任务 ${audit.taskId}` : ' · 预览'}
                </Text>
                {audit.failureReason ? <Text size="xs" c="red" mt={4}>{audit.failureReason}</Text> : null}
              </div>
              <Badge color={audit.status === 'succeeded' ? 'green' : audit.status === 'aborted' ? 'orange' : 'red'} variant="light">
                {audit.status === 'succeeded' ? '成功' : audit.status === 'aborted' ? '已中止' : '失败'}
              </Badge>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function formatAuditPhase(phase: BrowserCaptureAuditView['phase']): string {
  return ({ task: '任务', metadata: '元数据', catalog: '目录', chapter: '章节' })[phase];
}
