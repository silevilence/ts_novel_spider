import { Anchor, Badge, Card, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { IconBook, IconTag, IconListNumbers, IconExternalLink } from '@tabler/icons-react';
import type { ControlPreviewPayload } from '../../server/routes/control-center';

interface MetadataBoardProps {
  preview: ControlPreviewPayload | null;
  loading: boolean;
  errorMessage: string | null;
}

export function MetadataBoard({ preview, loading, errorMessage }: MetadataBoardProps) {
  const metadata = preview?.metadata;
  const snapshotSummary = preview?.snapshotSummary;

  if (loading) {
    return (
      <Stack gap="md">
        <Skeleton height={28} width={200} />
        <Skeleton height={16} width="80%" />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Skeleton height={120} /><Skeleton height={120} />
          <Skeleton height={120} /><Skeleton height={120} />
        </SimpleGrid>
      </Stack>
    );
  }

  if (!metadata) {
    return (
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.6)', border: '1px solid rgba(168,133,96,0.12)' }}>
        <Text c="dimmed">{errorMessage ?? '选择站点并输入作品编号后，点击"解析目录"即可查看作品信息。'}</Text>
      </Paper>
    );
  }

  return (
    <Stack gap="md">
      <div>
        <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>作品信息</Text>
        <Title order={3}>作品简介和下载情况</Title>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <div style={{ gridColumn: 'span 2' }}>
          <Card padding="md" radius="lg" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
            <Group mb="xs"><IconBook size={16} style={{ color: '#c77d5a' }} /><Text size="xs" fw={600} c="dimmed" tt="uppercase">标题</Text></Group>
            <Title order={4}>{metadata.title}</Title>
            <Text size="sm" c="dimmed" mt="xs">作者：{metadata.author || '未知作者'}</Text>
          </Card>
        </div>

        <Card padding="md" radius="lg" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
          <Group mb="xs"><IconListNumbers size={16} style={{ color: '#61d4a6' }} /><Text size="xs" fw={600} c="dimmed" tt="uppercase">章节总数</Text></Group>
          <Title order={2} style={{ color: '#f0e6d8' }}>{metadata.chapterCount}</Title>
        </Card>

        <Card padding="md" radius="lg" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
          <Group mb="xs"><IconExternalLink size={16} style={{ color: '#7fd0ff' }} /><Text size="xs" fw={600} c="dimmed" tt="uppercase">信息页</Text></Group>
          <Anchor href={metadata.infoPageUrl} target="_blank" rel="noreferrer" size="sm">打开原站</Anchor>
        </Card>

        <div style={{ gridColumn: 'span 2' }}>
          <Card padding="md" radius="lg" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">简介</Text>
            <Text size="sm">{metadata.description || '暂无简介。'}</Text>
          </Card>
        </div>

        <Card padding="md" radius="lg" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
          <Group mb="xs"><IconTag size={16} style={{ color: '#ffd166' }} /><Text size="xs" fw={600} c="dimmed" tt="uppercase">标签</Text></Group>
          <Group gap="xs">
            {metadata.tags.length > 0
              ? metadata.tags.map((tag) => <Badge key={tag} variant="light" color="orange.4" size="sm">{tag}</Badge>)
              : <Text size="xs" c="dimmed">无标签</Text>}
          </Group>
        </Card>

        <Card padding="md" radius="lg" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">本地快照</Text>
          {snapshotSummary ? (
            <Stack gap={4}>
              {[
                { label: '已下载', value: snapshotSummary.downloadedChapters, color: 'green' },
                { label: '失败', value: snapshotSummary.failedChapters, color: 'red' },
                { label: '仅索引', value: snapshotSummary.indexedChapters, color: 'gray' },
                { label: '新增', value: snapshotSummary.newChapters, color: 'orange' },
              ].map(({ label, value, color }) => (
                <Group key={label} gap="xs"><Badge variant="light" color={color} size="sm">{label}</Badge><Text size="sm">{value}</Text></Group>
              ))}
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">首次解析，尚无本地快照。</Text>
          )}
        </Card>
      </SimpleGrid>
    </Stack>
  );
}