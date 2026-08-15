import { Badge, Button, Code, Grid, Group, Indicator, Paper, Progress, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { IconActivity, IconPlayerPlay, IconCheck, IconX, IconClock } from '@tabler/icons-react';

import { StatusPanel } from './status-panel';
import type { ControlCenterModel } from '../services/control-center-model';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import { calculateRemainingTaskChapters } from '../services/library-view';
import { formatTaskStatus, isActiveTaskStatus } from '../services/task-status';

interface MonitorDashboardProps {
  model: ControlCenterModel;
}

export function MonitorDashboard({ model }: MonitorDashboardProps) {
  return (
    <Stack gap="lg">
      {/* 页面说明 */}
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="xs">
          <Group>
            <IconActivity size={20} color="#ffd166" />
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>
              任务大盘
            </Text>
          </Group>
          <Title order={2} style={{ fontFamily: 'Alegreya, Noto Serif SC, Georgia, serif' }}>
            查看采集进度和任务状态
          </Title>
          <Text size="sm" c="dimmed" maw={640}>
            任务开始后持续更新进度。离开页面再回来也能继续查看当前状态并重试失败章节。
          </Text>

          <Group gap="sm" mt="xs">
            <Indicator
              color={model.streamState === 'connected' ? 'green' : model.streamState === 'reconnecting' ? 'yellow' : 'gray'}
              size={8}
              withBorder
              processing={model.streamState === 'connected'}
              label=""
            >
              <Badge variant="light" color={model.streamState === 'connected' ? 'green' : model.streamState === 'reconnecting' ? 'yellow' : 'gray'} size="lg">
                {formatStreamState(model.streamState)}
              </Badge>
            </Indicator>
            <Badge variant="light" color="gray" size="lg">{model.recentTasks.length} 条任务</Badge>
            <Badge variant="light" color={model.currentTask?.failures.length ? 'red' : 'gray'} size="lg">
              {model.currentTask?.failures.length ?? 0} 章失败
            </Badge>
          </Group>
        </Stack>
      </Paper>

      <StatusPanel
        health={model.health}
        errorMessage={model.errorMessage}
        sourceCount={model.sources.length}
        currentTask={model.currentTask}
        currentTaskSourceLabel={model.currentTask ? model.getSourceLabel(model.currentTask.sourceId) : null}
      />

      {/* Grid 双栏布局：左侧任务列表 + 右侧任务详情 */}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Text size="xs" fw={600} c="dimmed" mb="sm" tt="uppercase">最近任务</Text>
            <ScrollArea.Autosize mah="calc(100vh - 380px)">
              {model.recentTasks.length > 0 ? (
                <Stack gap={0}>
                  {model.recentTasks.map((task, i) => (
                    <TaskTimelineItem
                      key={task.id}
                      task={task}
                      isActive={task.id === model.currentTask?.id}
                      isLast={i === model.recentTasks.length - 1}
                      sourceLabel={model.getSourceLabel(task.sourceId)}
                      onPick={() => void model.handlePickTask(task.id)}
                    />
                  ))}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">暂无任务记录。</Text>
              )}
            </ScrollArea.Autosize>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 7 }}>
          <CurrentTaskDetail
            currentTask={model.currentTask}
            sourceLabel={model.currentTask ? model.getSourceLabel(model.currentTask.sourceId) : ''}
            onRetryFailed={() => void model.handleRetryFailed()}
            onBrowserControl={(action) => void model.handleBrowserTaskControl(action)}
          />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function formatStreamState(state: ControlCenterModel['streamState']): string {
  switch (state) {
    case 'connected':
      return '实时连接';
    case 'reconnecting':
      return '重连中';
    default:
      return '未连接';
  }
}

/** Timeline 风格的任务列表项 — 左侧时间线 + 右侧任务卡片 */
function TaskTimelineItem({ task, isActive, isLast, sourceLabel, onPick }: {
  task: ApiTaskSnapshot;
  isActive: boolean;
  isLast: boolean;
  sourceLabel: string;
  onPick: () => void;
}) {
  const statusIcon = task.status === 'completed' ? <IconCheck size={14} />
    : task.status === 'failed' || task.status === 'aborted' ? <IconX size={14} />
    : task.status === 'running' ? <IconPlayerPlay size={14} />
    : <IconClock size={14} />;

  const statusColor = task.status === 'completed' ? 'green'
    : task.status === 'failed' || task.status === 'aborted' ? 'red'
    : task.status === 'running' ? 'blue'
    : 'yellow';

  return (
    <Group gap={0} wrap="nowrap" style={{ position: 'relative', minHeight: 44 }}>
      {/* 时间线竖线 + 节点 */}
      <div style={{ width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch', flexShrink: 0 }}>
        <div style={{
          width: 16, height: 16, borderRadius: '50%',
          background: isActive ? 'var(--mantine-color-orange-5)' : `var(--mantine-color-${statusColor}-6)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', flexShrink: 0, marginTop: 4,
        }}>
          {statusIcon}
        </div>
        {!isLast ? (
          <div style={{
            width: 2, flex: 1, minHeight: 8,
            background: 'rgba(168,133,96,0.2)', marginTop: 2,
          }} />
        ) : null}
      </div>

      {/* 任务卡片 */}
      <Button
        variant={isActive ? 'light' : 'subtle'}
        color={isActive ? 'orange.5' : 'gray.5'}
        size="compact-sm"
        onClick={onPick}
        fullWidth
        styles={{ inner: { justifyContent: 'flex-start' }, label: { flex: 1 } }}
        style={{ textAlign: 'left' }}
      >
        <Group justify="space-between" wrap="nowrap" style={{ width: '100%' }}>
          <Stack gap={0}>
            <Text size="xs" fw={isActive ? 600 : 400} truncate>{sourceLabel} / {task.novelId}</Text>
            <Text size="xs" c="dimmed">{task.progress.catalogChapters} 章 · {task.progress.completedChapters} 完成</Text>
          </Stack>
          <Badge size="xs" variant="light" color={statusColor}>
            {formatTaskStatus(task.status)}
          </Badge>
        </Group>
      </Button>
    </Group>
  );
}

/** 右侧任务详情面板 — 进度条 + 事件日志 */
function CurrentTaskDetail({ currentTask, sourceLabel, onRetryFailed, onBrowserControl }: {
  currentTask: ApiTaskSnapshot | null;
  sourceLabel: string;
  onRetryFailed: () => void;
  onBrowserControl: (action: 'pause' | 'continue' | 'abort') => void;
}) {
  if (!currentTask) {
    return (
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Text size="sm" c="dimmed">选择左侧任务查看进度和详情。</Text>
      </Paper>
    );
  }

  const progress = currentTask.progress;
  const recentEvents = currentTask.events.slice(-20).reverse();
  const remainingChapters = calculateRemainingTaskChapters(progress);

  return (
    <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" c="dimmed">当前任务</Text>
            <Text size="md" fw={600}>{sourceLabel} / {currentTask.novelId}</Text>
            <Badge size="xs" variant="light" color={currentTask.kind === 'browser' ? 'orange' : 'gray'}>
              {currentTask.kind === 'browser' ? '浏览器传输' : '服务端直连'}
            </Badge>
            <Code block style={{ marginTop: 4, fontSize: 11 }}>
              {`source: ${currentTask.sourceId}  novel: ${currentTask.novelId}  chapters: ${currentTask.progress.catalogChapters}`}
            </Code>
          </div>
          <Badge variant="light" color={currentTask.status === 'completed' ? 'green' : currentTask.status === 'failed' ? 'red' : 'yellow'}>
            {formatTaskStatus(currentTask.status)}
          </Badge>
        </Group>

        {/* 总进度条 */}
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="xs" c="dimmed">总体进度</Text>
            <Text size="xs" c="dimmed">{progress?.percent ?? 0}%</Text>
          </Group>
          <Progress value={progress?.percent ?? 0} size="sm" color="orange" striped={currentTask.status === 'running'} animated={currentTask.status === 'running'} />
        </div>

        <Group gap="xs">
          <Badge variant="light" size="sm" color="gray">目录 {progress?.catalogChapters ?? 0}</Badge>
          <Badge variant="light" size="sm" color="green">完成 {progress?.completedChapters ?? 0}</Badge>
          <Badge variant="light" size="sm" color="red">失败 {progress?.failedChapters ?? 0}</Badge>
          <Badge variant="light" size="sm" color="yellow">待处理 {remainingChapters}</Badge>
        </Group>

        <Button variant="subtle" size="compact-sm" onClick={onRetryFailed} disabled={currentTask.failures.length === 0 && !(currentTask.kind === 'browser' && currentTask.status === 'failed')}>
          重试失败章节
        </Button>

        {currentTask.kind === 'browser' && isActiveTaskStatus(currentTask.status) ? (
          <Group gap="xs">
            {currentTask.status === 'running' ? (
              <Button variant="default" size="compact-sm" onClick={() => onBrowserControl('pause')}>暂停</Button>
            ) : currentTask.status === 'paused' || currentTask.status === 'waiting_user' ? (
              <Button color="orange" size="compact-sm" onClick={() => onBrowserControl('continue')}>继续并重试当前页</Button>
            ) : null}
            <Button color="red" variant="subtle" size="compact-sm" onClick={() => onBrowserControl('abort')}>中止</Button>
          </Group>
        ) : null}

        {/* 事件日志 — 高度自适应当前视窗 */}
        <div>
          <Text size="xs" fw={600} c="dimmed" mb="xs" tt="uppercase">事件日志</Text>
          <ScrollArea.Autosize mah="calc(100vh - 580px)">
            <Stack gap={4}>
              {recentEvents.length > 0 ? recentEvents.map((event) => (
                <Paper key={`${event.timestamp}-${event.type}`} p="xs" radius="sm" style={{ background: 'rgba(38,26,20,0.6)' }}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="xs" fw={500}>{event.message}</Text>
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{formatTimestamp(event.timestamp)}</Text>
                  </Group>
                  {event.errorMessage ? <Text size="xs" c="red" mt={2}>{event.errorMessage}</Text> : null}
                </Paper>
              )) : <Text size="xs" c="dimmed">暂无事件。</Text>}
            </Stack>
          </ScrollArea.Autosize>
        </div>
      </Stack>
    </Paper>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}
