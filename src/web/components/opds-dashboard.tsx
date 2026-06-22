import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Grid,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconBook, IconBooks, IconClock, IconActivity } from '@tabler/icons-react';

import { CronEditor } from './cron-editor';
import { useOpdsDashboardModel } from '../services/opds-dashboard-model';
import type { NoticeInput } from '../services/control-center-model';

interface OpdsDashboardProps {
  onNotify: (notice: NoticeInput) => void;
}

function formatTimeAgo(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天`;
}

export function OpdsDashboard({ onNotify }: OpdsDashboardProps) {
  const model = useOpdsDashboardModel();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSelections, setModalSelections] = useState<Map<string, boolean>>(new Map());

  const stats = useMemo(() => {
    const visibleNovels = model.novels.filter((n) => n.opdsVisible);
    const visibleCount = visibleNovels.length;
    const translatedCount = visibleNovels.filter((n) => n.hasTranslation).length;
    return {
      visibleCount,
      originalCount: visibleCount,
      translatedCount,
      bilingualCount: translatedCount,
    };
  }, [model.novels]);

  if (model.loading && !model.config) {
    return (
      <Stack gap="lg" p="lg">
        <Text size="sm" c="dimmed">加载中...</Text>
      </Stack>
    );
  }

  if (model.error && !model.config) {
    return (
      <Stack gap="lg" p="lg">
        <Text size="sm" c="red">加载失败：{model.error}</Text>
        <Button variant="default" size="sm" onClick={() => void model.refresh()}>重试</Button>
      </Stack>
    );
  }

  const config = model.config;

  return (
    <Stack gap="lg" p="lg">
      {/* 页面标题区 */}
      <Paper
        p="lg"
        radius="lg"
        style={{
          background: 'rgba(31, 21, 16, 0.78)',
          border: '1px solid rgba(168,133,96,0.22)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <Group mb="xs">
          <IconBooks size={22} color="#ffd166" />
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>
            OPDS 书源
          </Text>
        </Group>
        <Title order={3} mb="xs">OPDS 书源服务</Title>
        <Text size="sm" c="dimmed" maw={640}>
          将书库中的作品通过 OPDS 协议分发给阅读器应用。开启后，支持 OPDS 1.2 与 2.0 的阅读器可通过书源地址浏览和下载。
        </Text>
      </Paper>

      {/* 配置区 */}
      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text size="sm" fw={600}>启用 OPDS 书源</Text>
              <Text size="xs" c="dimmed">开启后，后台将按扫描周期自动生成 EPUB 制品</Text>
            </Stack>
            <Switch
              checked={config?.enabled ?? false}
              onChange={(event) => {
                void model.updateConfig({ enabled: event.currentTarget.checked })
                  .then(() => {
                    onNotify({ tone: 'success', title: '已更新', message: event.currentTarget.checked ? 'OPDS 书源已开启' : 'OPDS 书源已关闭' });
                  })
                  .catch(() => {
                    onNotify({ tone: 'error', title: '操作失败', message: '无法更新 OPDS 配置' });
                  });
              }}
            />
          </Group>

          {config?.enabled && (
            <>
              <Stack gap="xs">
                <TextInput
                  label="扫描周期（Cron 表达式）"
                  value={config.scanCronExpression}
                  onChange={(event) => {
                    void model.updateConfig({ scanCronExpression: event.currentTarget.value })
                      .catch(() => {});
                  }}
                />
                <CronEditor
                  value={config.scanCronExpression}
                  onChange={(expr: string) => {
                    void model.updateConfig({ scanCronExpression: expr })
                      .catch(() => {});
                  }}
                />
                <Text size="xs" c="dimmed">
                  后台按此周期扫描上架书籍，当内容更新时间晚于制品生成时间时自动重构 EPUB。
                </Text>
              </Stack>

              <Button
                variant="default"
                size="compact-sm"
                onClick={() => {
                  const map = new Map(model.novels.map((n) => [`${n.sourceId}:${n.novelId}`, n.opdsVisible]));
                  setModalSelections(map);
                  setModalOpen(true);
                }}
              >
                管理上架书单
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      {/* 统计卡片区 */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group gap="xs" mb={4}>
              <IconBook size={16} color="#ffd166" />
              <Text size="xs" c="dimmed">上架书籍</Text>
            </Group>
            <Title order={2}>{stats.visibleCount}</Title>
            <Text size="xs" c="dimmed">本作品已公开分发</Text>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group gap="xs" mb={4}>
              <IconActivity size={16} color="#7fd0ff" />
              <Text size="xs" c="dimmed">版本分布</Text>
            </Group>
            <Group gap="xs">
              <Badge variant="light" color="gray">原文 {stats.originalCount}</Badge>
              <Badge variant="light" color="blue">译文 {stats.translatedCount}</Badge>
              <Badge variant="light" color="blue">双语 {stats.bilingualCount}</Badge>
            </Group>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group gap="xs" mb={4}>
              <IconClock size={16} color="#61d4a6" />
              <Text size="xs" c="dimmed">最近扫描</Text>
            </Group>
            {config?.lastRun ? (
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {config.lastRun.status === 'completed' ? '已完成' : '进行中'}
                  {config.lastRun.completedAt && ` · ${formatTimeAgo(config.lastRun.completedAt)}前`}
                </Text>
                <Text size="xs" c="dimmed">
                  扫描 {config.lastRun.totalScanned} · 生成 {config.lastRun.compiled} · 跳过 {config.lastRun.skipped} · 出错 {config.lastRun.errored}
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">暂无扫描记录</Text>
            )}
          </Paper>
        </Grid.Col>
      </Grid>

      {/* 审计日志列表 */}
      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Text size="sm" fw={600} mb="md">扫描审计日志</Text>
        {model.runs.length === 0 ? (
          <Text size="sm" c="dimmed">暂无审计记录</Text>
        ) : (
          <Stack gap="md">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>开始时间</Table.Th>
                  <Table.Th>完成时间</Table.Th>
                  <Table.Th>扫描</Table.Th>
                  <Table.Th>生成</Table.Th>
                  <Table.Th>跳过</Table.Th>
                  <Table.Th>出错</Table.Th>
                  <Table.Th>状态</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {model.runs.map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>{formatTimeAgo(run.startedAt)}前</Table.Td>
                    <Table.Td>{run.completedAt ? `${formatTimeAgo(run.completedAt)}前` : '—'}</Table.Td>
                    <Table.Td>{run.totalScanned}</Table.Td>
                    <Table.Td>{run.compiled}</Table.Td>
                    <Table.Td>{run.skipped}</Table.Td>
                    <Table.Td>{run.errored}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={run.status === 'completed' ? 'green' : 'yellow'}>
                        {run.status === 'completed' ? '已完成' : '进行中'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {model.hasMoreRuns && (
              <Button variant="default" size="compact-sm" onClick={() => void model.loadMoreRuns()}>
                加载更多
              </Button>
            )}
          </Stack>
        )}
      </Paper>

      {/* 上架书单 Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title="管理 OPDS 上架书单"
        size="lg"
      >
        <Stack gap="xs">
          <ScrollArea.Autosize mah={420} type="scroll">
            <Stack gap="xs">
              {model.novels.map((novel) => {
                const key = `${novel.sourceId}:${novel.novelId}`;
                return (
                  <Paper
                    key={key}
                    p="sm"
                    radius="sm"
                    style={{ border: '1px solid rgba(168,133,96,0.15)' }}
                  >
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Stack gap={2}>
                        <Text size="sm" fw={500}>{novel.title}</Text>
                        <Text size="xs" c="dimmed">{novel.sourceId}/{novel.novelId}</Text>
                      </Stack>
                      <Switch
                        size="sm"
                        checked={modalSelections.get(key) ?? false}
                        onChange={(event) => {
                          setModalSelections((prev) => {
                            const next = new Map(prev);
                            next.set(key, event.currentTarget.checked);
                            return next;
                          });
                        }}
                      />
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setModalOpen(false)}>取消</Button>
          <Button
            color="brand"
            onClick={async () => {
              const entries = [...modalSelections.entries()]
                .map(([key, visible]) => {
                  const [sourceId, novelId] = key.split(':');
                  return { sourceId: sourceId ?? '', novelId: novelId ?? '', visible };
                })
                .filter((e) => e.sourceId !== '' && e.novelId !== '');
              try {
                await model.updateNovels(entries);
                setModalOpen(false);
                onNotify({ tone: 'success', title: '已保存', message: 'OPDS 上架书单已更新。' });
              } catch {
                onNotify({ tone: 'error', title: '保存失败', message: '无法保存书单，请重试。' });
              }
            }}
          >
            保存
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
