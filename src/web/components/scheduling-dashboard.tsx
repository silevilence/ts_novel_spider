import { useEffect, useState } from 'react';
import { LibraryProcessingPanel } from './library-processing-panel';
import parseExpression from 'cron-parser';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Chip,
  Group,
  Input,
  NumberInput,
  Paper,
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
import { fetchNotificationConfig } from '../services/api';
import type { NotificationConfig } from '../../server/contracts/notification';
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
  autoSummarize: boolean;
  notifyOnUpdate: boolean;
  summarizeModel: { providerId: string; modelId: string } | null;
}

export function SchedulingDashboard({ onNotify }: SchedulingDashboardProps) {
  const model = useSchedulingDashboardModel();
  const [drafts, setDrafts] = useState<Map<string, SchedulingNovelDraft>>(new Map());
  const [savingNovels, setSavingNovels] = useState(false);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig | null>(null);
  const [notificationError, setNotificationError] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationRefresh, setNotificationRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setNotificationLoading(true);
    setNotificationError(false);
    void fetchNotificationConfig().then((value) => {
      if (active) setNotificationConfig(value);
    }).catch(() => {
      if (active) { setNotificationConfig(null); setNotificationError(true); }
    }).finally(() => { if (active) setNotificationLoading(false); });
    const refreshOnFocus = () => setNotificationRefresh((value) => value + 1);
    window.addEventListener('focus', refreshOnFocus);
    return () => { active = false; window.removeEventListener('focus', refreshOnFocus); };
  }, [notificationRefresh]);

  useEffect(() => {
    setDrafts(new Map(model.novels.map((novel) => [
      buildNovelKey(novel),
      {
        enabled: novel.enabled,
        autoSummarize: novel.autoSummarize,
        notifyOnUpdate: novel.notifyOnUpdate,
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
          autoSummarize: novel.autoSummarize,
          notifyOnUpdate: novel.notifyOnUpdate,
          summarizeModel: novel.summarizeModel,
        };

        return {
          sourceId: novel.sourceId,
          novelId: novel.novelId,
          enabled: draft.enabled,
          autoSummarize: draft.autoSummarize,
          notifyOnUpdate: draft.notifyOnUpdate,
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
  const notificationStatus = notificationLoading ? '正在读取全局通知状态'
    : notificationError || !notificationConfig ? '无法确认全局通知状态，请重试读取'
    : !notificationConfig.keyConfigured || !notificationConfig.baseUrl || !notificationConfig.target.umo ? '全局通知尚未配置完整'
    : !notificationConfig.enabled ? '全局消息通知已关闭'
    : '全局通知已启用';
  const notificationReady = !notificationLoading && !notificationError && Boolean(notificationConfig?.enabled && notificationConfig.keyConfigured && notificationConfig.baseUrl && notificationConfig.target.umo);
  const unsavedCount = model.novels.filter((novel) => {
    const draft = drafts.get(buildNovelKey(novel));
    return draft && (draft.enabled !== novel.enabled || draft.notifyOnUpdate !== novel.notifyOnUpdate
      || draft.autoSummarize !== novel.autoSummarize
      || formatModelRouteValue(draft.summarizeModel) !== formatModelRouteValue(novel.summarizeModel));
  }).length;

  return (
    <Stack gap="lg" p={{ base: 'xs', sm: 'lg' }} className="scheduling-dashboard">
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
              aria-label="启用定时更新"
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
              <Text size="sm" c="dimmed">管理追更、通知和更新总结。自动翻译与术语提取统一在「更新后处理与进度」中设置。</Text>
              {unsavedCount > 0 ? <Text size="sm" c="orange" role="status">{unsavedCount} 本书有未保存的修改</Text> : null}
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

          <Alert color={notificationReady ? 'gray' : 'yellow'} title={notificationStatus} role="status">
            <Stack gap="xs">
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{notificationReady
                ? `接收目标：${notificationConfig?.target.umo}。接口接受后仍需在接收端确认。`
                : '可先保存按书提醒偏好；全局通知启用且连接与接收目标配置完整后，后续更新才会发送通知。'}</Text>
              <Text size="xs">修改下方开关与模型后，点击「保存书单设置」。更新后处理在弹窗中单独保存。</Text>
              <Group gap="xs">
                <Button component="a" href="/settings#notifications" target="_blank" rel="noopener noreferrer" size="xs" variant="light">配置全局通知（新标签页）</Button>
                <Button size="xs" variant="subtle" loading={notificationLoading} onClick={() => setNotificationRefresh((value) => value + 1)}>刷新通知状态</Button>
              </Group>
            </Stack>
          </Alert>

          {model.novels.length === 0 ? (
            <Text size="sm" c="dimmed">书库里还没有作品，先去采集工作台或本地书库添加作品。</Text>
          ) : (
            <Table className="scheduling-books" verticalSpacing="md" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>作品</Table.Th>
                  <Table.Th>追更与通知</Table.Th>
                  <Table.Th>更新总结</Table.Th>
                  <Table.Th>最近检查</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {model.novels.map((novel) => {
                  const key = buildNovelKey(novel);
                  const draft = drafts.get(key) ?? {
                    enabled: novel.enabled,
                    autoSummarize: novel.autoSummarize,
                    notifyOnUpdate: novel.notifyOnUpdate,
                    summarizeModel: novel.summarizeModel,
                  };

                  return (
                    <Table.Tr key={key}>
                      <Table.Td>
                        <Stack gap="xs">
                          <Text size="sm" fw={500}>{novel.title}</Text>
                          <Text size="xs" c="dimmed">{novel.sourceId}/{novel.novelId}</Text>
                          {novel.hasSummary ? (
                            <Badge variant="light" color="blue" leftSection={<IconFileText size={12} />}>
                              有摘要
                            </Badge>
                          ) : null}
                          <Group><LibraryProcessingPanel sourceId={novel.sourceId} novelId={novel.novelId} /></Group>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap="sm">
                          <Switch
                            label="定时更新"
                            aria-label={`${novel.title} 定时更新`}
                            checked={draft.enabled}
                            onChange={(event) => {
                              updateDraft(setDrafts, key, { enabled: event.currentTarget.checked });
                            }}
                          />
                          <Switch
                            size="sm"
                            label="更新时通知"
                            aria-label={`${novel.title} 更新时通知`}
                            checked={draft.notifyOnUpdate}
                            disabled={!draft.enabled}
                            onChange={(event) => updateDraft(setDrafts, key, { notifyOnUpdate: event.currentTarget.checked })}
                          />
                          <Text size="xs" c="dimmed">{draft.notifyOnUpdate !== novel.notifyOnUpdate || draft.enabled !== novel.enabled
                            ? '有未保存的修改'
                            : !draft.enabled ? '本书定时更新已关闭'
                            : !draft.notifyOnUpdate ? '本书更新提醒已关闭'
                            : !notificationReady ? notificationStatus
                            : !config.enabled ? '等待开启定时更新总开关'
                            : '已启用，下载有新章节时通知'}</Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap="sm">
                          <Switch
                            size="sm"
                            label="自动总结"
                            aria-label={`${novel.title} 自动总结`}
                            checked={draft.autoSummarize}
                            disabled={!draft.enabled}
                            onChange={(event) => {
                              updateDraft(setDrafts, key, { autoSummarize: event.currentTarget.checked });
                            }}
                          />
                          <Select
                            label="单书总结模型"
                            aria-label={`${novel.title} 单书总结模型`}
                            placeholder="沿用默认总结模型"
                            comboboxProps={{ width: 400, position: 'bottom-start', withinPortal: true }}
                            styles={{ dropdown: { maxWidth: 'calc(100vw - 32px)' }, option: { overflowWrap: 'anywhere' } }}
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
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap="xs" align="flex-start">
                          <Badge variant="light" color={resultBadgeColor(novel.lastCheckResult)}>
                            {resultBadgeLabel(novel.lastCheckResult)}
                          </Badge>
                          <Text size="xs" c="dimmed">{novel.lastCheckedAt ? formatDateTime(novel.lastCheckedAt) : '尚无检查时间'}</Text>
                          {novel.lastCheckMessage && novel.lastCheckMessage !== resultBadgeLabel(novel.lastCheckResult) ? (
                            <Text size="sm">{novel.lastCheckMessage}</Text>
                          ) : null}
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Paper>

      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600}>运行记录</Text>
              <Text size="sm" c="dimmed">展开查看本轮检查的作品、新章节和下载结果；AI 总结单独展示。</Text>
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
                    <Group justify="space-between" wrap="wrap" align="flex-start">
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
                        <Badge variant="light" color="gray">检查成功 {run.totalChecked} 本</Badge>
                        <Badge variant="light" color="blue">发现更新 {run.newChaptersFound} 本</Badge>
                        <Badge variant="light" color="gray">跳过 {run.skipped} 本</Badge>
                        <Badge variant="light" color="red">出错 {run.errored} 本</Badge>
                      </Group>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      <Text size="xs" c="dimmed">
                        开始：{formatDateTime(run.startedAt)}
                        {run.completedAt ? ` · 完成：${formatDateTime(run.completedAt)}` : ''}
                      </Text>
                      <SchedulingRunDetails run={run} />
                      {run.summaries.length === 0 ? (
                        <Text size="sm" c="dimmed">本轮未生成 AI 总结，不影响更新与下载记录。</Text>
                      ) : (
                        run.summaries.map((summary) => (
                          <Paper key={summary.id} p="sm" radius="md" withBorder style={{ background: 'rgba(31,21,16,0.52)' }}>
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2}>
                                <Text size="sm" fw={600}>{findNovelTitle(model.novels, summary.sourceId, summary.novelId)}</Text>
                                <Text size="xs" c="dimmed">更新章节：{summary.chapterIds.join('、')}</Text>
                              </Stack>
                              <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>总结模型：{summary.modelId}</Text>
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

export function SchedulingRunDetails({ run }: { run: SchedulingRun }) {
  if (!run.results) {
    return <Text size="sm" c="dimmed">旧版运行记录未保存逐书明细，无法还原本轮更新的作品；升级后的新轮次会记录书名和章节。</Text>;
  }
  if (run.results.length === 0) {
    return <Text size="sm" c="dimmed">{run.status === 'running' ? '正在检查，尚无已完成的作品明细。' : '本轮没有作品检查明细。'}</Text>;
  }
  const priority = { new_chapters: 0, error: 1, skipped: 2, up_to_date: 3 };
  return <Stack gap="sm">
    <Text size="sm" fw={600}>逐书检查明细</Text>
    {[...run.results].sort((a, b) => priority[a.result] - priority[b.result]).map((result) => (
      <Paper key={`${result.sourceId}:${result.novelId}`} withBorder p="sm" radius="sm">
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start">
            <Text size="sm" fw={600} style={{ flex: '1 1 240px', overflowWrap: 'anywhere' }}>{result.title}</Text>
            <Badge variant="light" color={result.result === 'skipped' ? 'gray' : resultBadgeColor(result.result)}>
              {result.result === 'skipped' ? '已跳过' : resultBadgeLabel(result.result)}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">{result.sourceId}/{result.novelId} · {formatDateTime(result.checkedAt)}</Text>
          <Text size="sm">{result.message}</Text>
          {result.chapters.length > 0 ? (
            <Stack gap={4}>
              {result.chapters.map((chapter) => (
                <Text size="sm" key={chapter.id}>{chapter.title}（{chapter.id}） · {chapter.downloaded ? '已下载' : '未下载成功'}</Text>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Paper>
    ))}
  </Stack>;
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
      autoSummarize: false,
      notifyOnUpdate: false,
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
        autoSummarize: novel.autoSummarize,
        notifyOnUpdate: novel.notifyOnUpdate,
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

  const separator = value.indexOf(':');
  if (separator < 0) return null;
  const providerId = value.slice(0, separator);
  const modelId = value.slice(separator + 1);
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
