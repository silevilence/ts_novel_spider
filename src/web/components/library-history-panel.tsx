import { useEffect, useState } from 'react';
import { Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import { fetchLibraryMetadataVersions, restoreLibraryMetadataVersion, type LibraryVersion } from '../services/api';

interface LibraryHistoryPanelProps {
  sourceId: string;
  novelId: string;
  onRefresh: () => Promise<void>;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export function LibraryHistoryPanel({ sourceId, novelId, onRefresh, onNotify }: LibraryHistoryPanelProps) {
  const [opened, setOpened] = useState(false); const [versions, setVersions] = useState<LibraryVersion[]>([]);
  useEffect(() => { if (opened) void fetchLibraryMetadataVersions(sourceId, novelId).then(setVersions).catch((error: unknown) => onNotify({ tone: 'error', title: '历史加载失败', message: error instanceof Error ? error.message : '请稍后重试。' })); }, [opened, sourceId, novelId, onNotify]);
  return <><Button variant="subtle" size="compact-sm" leftSection={<IconHistory size={15} />} onClick={() => setOpened(true)}>元数据历史</Button>
    <Modal opened={opened} onClose={() => setOpened(false)} title="元数据版本历史"><Stack>{versions.length ? versions.map((version) => <Paper key={version.version} p="sm" radius="md"><Group justify="space-between" align="start"><div><Text fw={600}>{version.version === 0 ? '初始版本 v0' : `版本 v${version.version}`}</Text><Text size="sm">{version.title} · {version.author || '未知作者'}</Text><Text size="xs" c="dimmed">{new Date(version.createdAt).toLocaleString('zh-CN')}</Text></div><Button size="compact-xs" variant="light" onClick={() => { if (!window.confirm(`还原到 v${version.version}？这会产生一个新的版本。`)) return; void restoreLibraryMetadataVersion(sourceId, novelId, version.version).then(onRefresh).then(() => { setOpened(false); onNotify({ tone: 'success', title: '已还原元数据版本', message: '已保留完整历史记录。' }); }).catch((error: unknown) => onNotify({ tone: 'error', title: '还原失败', message: error instanceof Error ? error.message : '请稍后重试。' })); }}>还原</Button></Group></Paper>) : <Text c="dimmed">暂无历史版本。</Text>}</Stack></Modal></>;
}
