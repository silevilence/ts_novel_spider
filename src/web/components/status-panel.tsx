import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconHeartbeat, IconWorld, IconPlayerPlay, IconClock } from '@tabler/icons-react';
import type { HealthPayload } from '../../server/routes/health';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import { formatTaskStatus } from '../services/task-status';

interface StatusPanelProps {
  health: HealthPayload | null;
  errorMessage: string | null;
  sourceCount: number;
  currentTask: ApiTaskSnapshot | null;
  currentTaskSourceLabel: string | null;
}
export function StatusPanel({ health, errorMessage, sourceCount, currentTask, currentTaskSourceLabel }: StatusPanelProps) {
  const taskStatus = currentTask ? formatTaskStatus(currentTask.status) : null;
  return (
    <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
      <Stack gap="sm">
        <div>
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>运行总览</Text>
          <Title order={3}>当前状态</Title>
        </div>
        <Group gap="md" wrap="wrap">
          <StatusItem icon={<IconHeartbeat size={16} />} label="服务状态" value={health?.status ?? '加载中'}
            color={health?.status === 'ok' ? 'green' : 'gray'} />
          <StatusItem icon={<IconWorld size={16} />} label="可用站点" value={sourceCount > 0 ? `${sourceCount} 个` : '加载中'}
            color={sourceCount > 0 ? 'green' : 'gray'} />
          <StatusItem icon={<IconPlayerPlay size={16} />} label="当前任务"
            value={currentTask ? `${currentTaskSourceLabel} / ${taskStatus}` : '空闲'}
            color={currentTask ? (currentTask.status === 'running' ? 'blue' : currentTask.status === 'failed' ? 'red' : 'green') : 'gray'} />
          <StatusItem icon={<IconClock size={16} />} label="最近更新"
            value={health?.timestamp ?? errorMessage ?? '等待响应'} color="gray" />
        </Group>
      </Stack>
    </Paper>
  );
}

function StatusItem({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text c="dimmed" style={{ display: 'flex', alignItems: 'center' }}>{icon}</Text>
      <Text size="xs" c="dimmed" span>{label}</Text>
      <Badge variant="light" color={color} size="sm">{value}</Badge>
    </Group>
  );
}
