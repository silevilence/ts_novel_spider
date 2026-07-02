import { useEffect, useState } from 'react';
import parseExpression from 'cron-parser';
import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Chip,
  Group,
  Input,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconClock,
  IconDeviceFloppy,
  IconFileText,
} from '@tabler/icons-react';

import { CronEditor } from './cron-editor';
import { useSchedulingDashboardModel } from '../services/scheduling-dashboard-model';
import type {
  SchedulingConfig,
  SchedulingNovelEntry,
  SchedulingRun,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';

interface SchedulingDashboardProps {
  onNotify: (notice: NoticeInput) => void;
}

interface SchedulingNovelDraft {
  enabled: boolean;
  autoTranslate: boolean;
  autoSummarize: boolean;
  summarizeModel: { providerId: string; modelId: string } | null;
}

export function SchedulingDashboard({ onNotify }: SchedulingDashboardProps) {
  const model = useSchedulingDashboardModel();
  const [drafts, setDrafts] = useState<Map<string, SchedulingNovelDraft>>(new Map());
  const [savingNovels, setSavingNovels] = useState(false);

  useEffect(() => {
    setDrafts(new Map(model.novels.map((novel) => [
      buildNovelKey(novel),
      {
        enabled: novel.enabled,
        autoTranslate: novel.autoTranslate,
        autoSummarize: novel.autoSummarize,
        summarizeModel: novel.summarizeModel,
      },
    ])));
  }, [model.novels]);

  async function updateConfig(input: Partial<SchedulingConfig>) {
    try {
      await model.updateConfig(input);
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '保存失败',
        message: error instanceof Error ? error.message : '定时更新配置没有保存成功。',
      });
    }
  }

  async function saveNovels() {
    setSavingNovels(true);
    try {
      const entries = model.novels.map((novel) => {
        const draft = drafts.get(buildNovelKey(novel)) ?? {
          enabled: novel.enabled,
          autoTranslate: novel.autoTranslate,
          autoSummarize: novel.autoSummarize,
          summarizeModel: novel.summarizeModel,
        };

        return {
          sourceId: novel.sourceId,
          novelId: novel.novelId,
          enabled: draft.enabled,
          autoTranslate: draft.autoTranslate,
          autoSummarize: draft.autoSummarize,
          summarizeModel: draft.summarizeModel,
        };
      });

      await model.updateNovels(entries);
      onNotify({ tone: 'success', title: '已保存', message: '定时更新书单设置已更新。' });
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '保存失败',
        message: error instanceof Error ? error.message : '书单设置没有保存成功。',
      });
    } finally {
      setSavingNovels(false);
    }
  }

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
  if (!config) {
    return null;
  }

  const cronPreviews = config.mode === 'cron' ? computeCronPreviews(config.cronExpression) : [];

  return (
    <Stack gap="lg" p="lg">
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
          <IconClock size={22} color="#ffd166" />
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>
            定时更新
          </Text>
        </Group>
        <Title order={3} mb="xs">定时更新管理</Title>
        <Text size="sm" c="dimmed" maw={680}>
          自动检查书库中的作品更新，统一管理追更、自动翻译和更新总结。发现新章节后，系统可以继续下载、翻译，并为你整理一段简洁的更新摘要。
        </Text>
      </Paper>

      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text size="sm" fw={600}>启用定时更新</Text>
              <Text size="xs" c="dimmed">开启后，后台会按你设定的节奏自动巡检书库里的作品。</Text>
            </Stack>
            <Switch
              checked={config.enabled}
              onChange={(event) => {
                void updateConfig({ enabled: event.currentTarget.checked });
              }}
            />
          </Group>

          <SegmentedControl
            value={config.mode}
            onChange={(value) => {
              if (value === 'interval' || value === 'cron' || value === 'weekly') {
                void updateConfig({ mode: value });
              }
            }}
            data={[
              { label: '固定间隔', value: 'interval' },
              { label: 'Cron 表达式', value: 'cron' },
              { label: '每周定时', value: 'weekly' },
            ]}
          />

          {config.mode === 'interval' ? (
            <Stack gap="xs">
              <NumberInput
                label="轮询间隔（小时）"
                min={1}
                max={168}
                value={config.intervalHours}
                onChange={(value) => {
                  if (typeof value === 'number') {
                    void updateConfig({ intervalHours: value });
                  }
                }}
              />
              <Text size="xs" c="dimmed">下次预计触发：{formatNextTriggerTime(config.intervalHours)}</Text>
            </Stack>
          ) : null}

          {config.mode === 'cron' ? (
            <Stack gap="xs">
              <TextInput
                label="Cron 表达式"
                value={config.cronExpression}
                onChange={(event) => {
                  void updateConfig({ cronExpression: event.currentTarget.value });
                }}
              />
              <CronEditor
                value={config.cronExpression}
                onChange={(expr) => {
                  void updateConfig({ cronExpression: expr });
                }}
              />
              {cronPreviews.length > 0 ? (
                <Text size="xs" c="dimmed">未来 {cronPreviews.length} 次触发：{cronPreviews.join('、')}</Text>
              ) : null}
            </Stack>
          ) : null}

          {config.mode === 'weekly' ? (
            <Stack gap="xs">
              <Input.Label>每周触发日</Input.Label>
              <Chip.Group
                multiple
                value={config.weeklyDays.map(String)}
                onChange={(values) => {
                  void updateConfig({ weeklyDays: values.map(Number).filter((value) => value >= 0 && value <= 6) });
                }}
              >
                <Group gap={4}>
                  {['日', '一', '二', '三', '四', '五', '六'].map((label, index) => (
                    <Chip key={index} value={String(index)} size="xs">{label}</Chip>
                  ))}
                </Group>
              </Chip.Group>
              <Input.Wrapper label="触发时刻">
                <input
                  type="time"
                  value={config.weeklyTime}
                  onChange={(event) => {
                    void updateConfig({ weeklyTime: event.target.value });
                  }}
                  style={{
                    background: 'rgba(31,21,16,0.78)',
                    border: '1px solid rgba(168,133,96,0.22)',
                    borderRadius: 'var(--mantine-radius-sm)',
                    color: 'var(--mantine-color-dark-text)',
                    padding: '8px 12px',
                    fontSize: 'var(--mantine-font-size-sm)',
                  }}
                />
              </Input.Wrapper>
            </Stack>
          ) : null}

          <Select
            label="默认更新总结模型"
            placeholder="沿用模型网关默认对话模型"
            data={model.summaryModelOptions}
            value={formatModelRouteValue(config.summaryModel)}
            searchable
            clearable
            nothingFoundMessage="暂无可用对话模型"
            onChange={(value) => {
              void updateConfig({ summaryModel: parseModelRouteValue(value) });
            }}
          />

          {config.lastCheckRun ? (
            <Paper p="sm" radius="md" withBorder style={{ background: 'rgba(31,21,16,0.64)' }}>
              <Text size="xs" fw={600} mb={2}>最近一轮</Text>
              <Text size="xs" c="dimmed">
                {config.lastCheckRun.status === 'completed'
                  ? `检查 ${config.lastCheckRun.totalChecked} 本，发现更新 ${config.lastCheckRun.newChaptersFound} 本，跳过 ${config.lastCheckRun.skipped} 本，出错 ${config.lastCheckRun.errored} 本`
                  : '轮次进行中…'}
                {config.lastCheckRun.completedAt ? ` · ${formatTimeAgo(config.lastCheckRun.completedAt)}前` : ''}
              </Text>
            </Paper>
          ) : null}
        </Stack>
      </Paper>

      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600}>书单管理</Text>
              <Text size="xs" c="dimmed">支持批量开启追更，也可以逐本控制自动翻译、自动总结和单书总结模型覆盖。</Text>
            </Stack>
            <Group gap="xs">
              <Button variant="default" size="compact-sm" onClick={() => applyBatchEnabled(setDrafts, model.novels, true)}>全部开启</Button>
              <Button variant="default" size="compact-sm" onClick={() => applyBatchEnabled(setDrafts, model.novels, false)}>全部关闭</Button>
              <Button
                color="brand"
                size="compact-sm"
                leftSection={<IconDeviceFloppy size={14} />}
                loading={savingNovels}
                onClick={() => void saveNovels()}
              >
                保存书单设置
              </Button>
            </Group>
          </Group>

          {model.novels.length === 0 ? (
            <Text size="sm" c="dimmed">书库里还没有作品，先去采集工作台或本地书库添加作品。</Text>
          ) : (
            <ScrollArea>
              <Table striped highlightOnHover withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>作品</Table.Th>
                    <Table.Th>定时更新</Table.Th>
                    <Table.Th>自动翻译</Table.Th>
                    <Table.Th>自动总结</Table.Th>
                    <Table.Th>单书总结模型</Table.Th>
                    <Table.Th>上次检查</Table.Th>
                    <Table.Th>结果</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {model.novels.map((novel) => {
                    const key = buildNovelKey(novel);
                    const draft = drafts.get(key) ?? {
                      enabled: novel.enabled,
                      autoTranslate: novel.autoTranslate,
                      autoSummarize: novel.autoSummarize,
                      summarizeModel: novel.summarizeModel,
                    };

                    return (
                      <Table.Tr key={key}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" fw={500}>{novel.title}</Text>
                            {novel.hasSummary ? (
                              <Badge variant="light" color="blue" leftSection={<IconFileText size={12} />}>
                                有摘要
                              </Badge>
                            ) : null}
                          </Group>
                          <Text size="xs" c="dimmed">{novel.sourceId}/{novel.novelId}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Checkbox
                            checked={draft.enabled}
                            onChange={(event) => {
                              updateDraft(setDrafts, key, { enabled: event.currentTarget.checked });
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Switch
                            size="sm"
                            checked={draft.autoTranslate}
                            disabled={!draft.enabled}
                            onChange={(event) => {
                              updateDraft(setDrafts, key, { autoTranslate: event.currentTarget.checked });
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Switch
                            size="sm"
                            label="自动总结"
                            checked={draft.autoSummarize}
                            disabled={!draft.enabled}
                            onChange={(event) => {
                              updateDraft(setDrafts, key, { autoSummarize: event.currentTarget.checked });
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Select
                            placeholder="沿用默认"
                            data={model.summaryModelOptions}
                            value={formatModelRouteValue(draft.summarizeModel)}
                            searchable
                            clearable
                            nothingFoundMessage="暂无可用对话模型"
                            disabled={!draft.enabled || !draft.autoSummarize}
                            onChange={(value) => {
                              updateDraft(setDrafts, key, { summarizeModel: parseModelRouteValue(value) });
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{novel.lastCheckedAt ? formatDateTime(novel.lastCheckedAt) : '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={resultBadgeColor(novel.lastCheckResult)}>
                            {resultBadgeLabel(novel.lastCheckResult)}
                          </Badge>
                          <Text size="xs" c="dimmed" mt={4}>{novel.lastCheckMessage ?? '暂无检查消息'}</Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Stack>
      </Paper>

      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600}>运行记录</Text>
              <Text size="xs" c="dimmed">每一轮定时更新都会保留检查概览；展开后可以查看小说级的更新总结。</Text>
            </Stack>
            {model.hasMoreRuns ? (
              <Button variant="default" size="compact-sm" onClick={() => void model.loadMoreRuns()}>
                加载更多
              </Button>
            ) : null}
          </Group>

          {model.runs.length === 0 ? (
            <Text size="sm" c="dimmed">暂无运行记录</Text>
          ) : (
            <Accordion variant="separated" radius="md">
              {model.runs.map((run) => (
                <Accordion.Item key={run.id} value={run.id}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Stack gap={2}>
                        <Text size="sm" fw={600}>{formatDateTime(run.startedAt)}</Text>
                        <Text size="xs" c="dimmed">
                          {run.completedAt ? `耗时 ${formatDuration(run.startedAt, run.completedAt)}` : '仍在执行中'}
                        </Text>
                      </Stack>
                      <Group gap={6} wrap="wrap" justify="flex-end">
                        <Badge variant="light" color={run.status === 'completed' ? 'green' : 'yellow'}>
                          {run.status === 'completed' ? '已完成' : '进行中'}
                        </Badge>
                        <Badge variant="light" color="gray">扫描 {run.totalChecked}</Badge>
                        <Badge variant="light" color="blue">更新 {run.newChaptersFound}</Badge>
                        <Badge variant="light" color="gray">跳过 {run.skipped}</Badge>
                        <Badge variant="light" color="red">出错 {run.errored}</Badge>
                      </Group>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      <Text size="xs" c="dimmed">
                        开始：{formatDateTime(run.startedAt)}
                        {run.completedAt ? ` · 完成：${formatDateTime(run.completedAt)}` : ''}
                      </Text>
                      {run.summaries.length === 0 ? (
                        <Text size="sm" c="dimmed">本轮没有保存章节总结</Text>
                      ) : (
                        run.summaries.map((summary) => (
                          <Paper key={summary.id} p="sm" radius="md" withBorder style={{ background: 'rgba(31,21,16,0.52)' }}>
                            <Group justify="space-between" align="flex-start" wrap="nowrap">
                              <Stack gap={2}>
                                <Text size="sm" fw={600}>{findNovelTitle(model.novels, summary.sourceId, summary.novelId)}</Text>
                                <Text size="xs" c="dimmed">更新章节：{summary.chapterIds.join('、')}</Text>
                              </Stack>
                              <Badge variant="light" color="blue">{summary.modelId}</Badge>
                            </Group>
                            <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>{summary.summary}</Text>
                          </Paper>
                        ))
                      )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function buildNovelKey(novel: Pick<SchedulingNovelEntry, 'sourceId' | 'novelId'>): string {
  return `${novel.sourceId}:${novel.novelId}`;
}

function updateDraft(
  setDrafts: React.Dispatch<React.SetStateAction<Map<string, SchedulingNovelDraft>>>,
  key: string,
  patch: Partial<SchedulingNovelDraft>,
) {
  setDrafts((current) => {
    const next = new Map(current);
    const previous = next.get(key) ?? {
      enabled: false,
      autoTranslate: false,
      autoSummarize: false,
      summarizeModel: null,
    };
    next.set(key, { ...previous, ...patch });
    return next;
  });
}

function applyBatchEnabled(
  setDrafts: React.Dispatch<React.SetStateAction<Map<string, SchedulingNovelDraft>>>,
  novels: SchedulingNovelEntry[],
  enabled: boolean,
) {
  setDrafts((current) => {
    const next = new Map(current);
    for (const novel of novels) {
      const key = buildNovelKey(novel);
      const previous = next.get(key) ?? {
        enabled: novel.enabled,
        autoTranslate: novel.autoTranslate,
        autoSummarize: novel.autoSummarize,
        summarizeModel: novel.summarizeModel,
      };
      next.set(key, { ...previous, enabled });
    }
    return next;
  });
}

function parseModelRouteValue(value: string | null): { providerId: string; modelId: string } | null {
  if (!value) {
    return null;
  }

  const [providerId, modelId] = value.split(':');
  if (!providerId || !modelId) {
    return null;
  }

  return { providerId, modelId };
}

function formatModelRouteValue(value: { providerId: string; modelId: string } | null): string | null {
  return value ? `${value.providerId}:${value.modelId}` : null;
}

function findNovelTitle(novels: SchedulingNovelEntry[], sourceId: string, novelId: string): string {
  return novels.find((novel) => novel.sourceId === sourceId && novel.novelId === novelId)?.title ?? `${sourceId}/${novelId}`;
}

function computeCronPreviews(expression: string): string[] {
  try {
    const interval = parseExpression.parse(expression);
    const previews: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const nextIso = interval.next().toISOString();
      if (nextIso) {
        previews.push(formatDateTime(nextIso));
      }
    }
    return previews;
  } catch {
    return [];
  }
}

function formatNextTriggerTime(intervalHours: number): string {
  return formatDateTime(new Date(Date.now() + intervalHours * 3600 * 1000).toISOString());
}

function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(startedAt: string, completedAt: string): string {
  const diffMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (diffMs < 60_000) {
    return `${Math.max(1, Math.round(diffMs / 1000))} 秒`;
  }

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }

  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${remainMinutes} 分钟`;
}

function formatTimeAgo(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时`;
  return `${Math.floor(diffHours / 24)} 天`;
}

function resultBadgeColor(result: SchedulingNovelEntry['lastCheckResult']): string {
  switch (result) {
    case 'new_chapters':
      return 'blue';
    case 'up_to_date':
      return 'green';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

function resultBadgeLabel(result: SchedulingNovelEntry['lastCheckResult']): string {
  switch (result) {
    case 'new_chapters':
      return '发现更新';
    case 'up_to_date':
      return '已是最新';
    case 'error':
      return '检查出错';
    default:
      return '尚未检查';
  }
}