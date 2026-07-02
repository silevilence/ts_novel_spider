import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import parseExpression from 'cron-parser';

import { CronEditor } from './cron-editor';
import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Chip,
  Group,
  Input,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from '@mantine/core';
import {
  IconAdjustments,
  IconBrain,
  IconClock,
  IconDatabase,
  IconDeviceFloppy,
  IconLanguage,
  IconNetwork,
  IconTypography,
} from '@tabler/icons-react';

import { LanguagePicker } from './language-picker';
import { LlmProviderPanel } from './llm-provider-panel';
import { ModelGatewayPanel } from './model-gateway-panel';
import { Neo4jPanel } from './neo4j-panel';
import { NetworkProxyPanel } from './network-proxy-panel';
import { ReaderTypographyPanel } from './reader-typography-panel';
import {
  fetchLlmProvidersPreferences,
  fetchSchedulingConfig,
  fetchSchedulingNovels,
  fetchTranslationPreferences,
  updateSchedulingConfig,
  updateSchedulingNovels,
  updateTranslationPreferences,
  type ModelCapability,
  type SchedulingConfig,
  type SchedulingNovelEntry,
} from '../services/api';
import type {
  ControlCenterModel,
  NoticeInput,
} from '../services/control-center-model';

interface SystemPreferencesProps {
  model: ControlCenterModel;
  onOpenControl: () => void;
  onNotify: (notice: NoticeInput) => void;
}

interface AccordionPanelDef {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  badge?: ReactNode;
  content: ReactNode;
}

const PANEL_ICON_SIZE = 20;

export function SystemPreferences({ model, onNotify }: SystemPreferencesProps) {
  const theme = useMantineTheme();

  const [schedulingConfig, setSchedulingConfig] = useState<SchedulingConfig | null>(null);
  const [schedulingNovels, setSchedulingNovels] = useState<SchedulingNovelEntry[]>([]);

  useEffect(() => {
    Promise.all([
      fetchSchedulingConfig().then(setSchedulingConfig).catch(() => {}),
      fetchSchedulingNovels().then((p) => setSchedulingNovels(p.novels)).catch(() => {}),
    ]);
  }, []);

  const handleSchedulingConfigChange = async (input: Partial<SchedulingConfig>): Promise<void> => {
    const updated = await updateSchedulingConfig(input);
    setSchedulingConfig(updated);
  };

  const handleSchedulingNovelsChange = async (
    entries: Array<{ sourceId: string; novelId: string; enabled: boolean; autoTranslate?: boolean }>,
  ): Promise<void> => {
    await updateSchedulingNovels(entries);
    const entryMap = new Map(entries.map((entry) => [`${entry.sourceId}:${entry.novelId}`, entry]));
    setSchedulingNovels((prev) => prev.map((novel) => {
      const next = entryMap.get(`${novel.sourceId}:${novel.novelId}`);
      if (!next) {
        return novel;
      }

      return {
        ...novel,
        enabled: next.enabled,
        autoTranslate: next.autoTranslate ?? novel.autoTranslate,
      };
    }));
  };

  const panels = useMemo<AccordionPanelDef[]>(
    () => [
      {
        id: 'crawl',
        icon: <IconAdjustments size={PANEL_ICON_SIZE} />,
        title: '任务选项',
        description: '章节并发数、重试次数与补抓策略，新建任务时自动沿用。',
        badge: (
          <Group gap={6} wrap="nowrap">
            <Badge size="sm" variant="light" color="gray">
              {model.chapterConcurrency} 并发
            </Badge>
            <Badge size="sm" variant="light" color="gray">
              重试 {model.chapterRetryCount}
            </Badge>
          </Group>
        ),
        content: (
          <Stack gap="md">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
              <NumberInput
                label="章节并发数"
                min={1}
                max={12}
                value={model.chapterConcurrency}
                onChange={(v) => model.setChapterConcurrency(typeof v === 'number' ? v : 1)}
                hideControls
              />
              <NumberInput
                label="失败重试次数"
                min={0}
                max={5}
                value={model.chapterRetryCount}
                onChange={(v) => model.setChapterRetryCount(typeof v === 'number' ? v : 0)}
                hideControls
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              <input
                type="checkbox"
                checked={model.forceRefetch}
                onChange={(event) => model.setForceRefetch(event.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <Text size="sm">采集时也重新获取已经保存过的章节</Text>
            </label>
            <Text size="xs" c="dimmed">
              一般情况下只采集缺失的章节即可；如果原站内容有更新，再打开此选项。
            </Text>
          </Stack>
        ),
      },
      {
        id: 'proxy',
        icon: <IconNetwork size={PANEL_ICON_SIZE} />,
        title: '网络代理',
        description: '配置 HTTP/HTTPS 代理，用于特殊网络环境下的采集请求。',
        content: <NetworkProxyPanel onNotice={onNotify} />,
      },
      {
        id: 'llm',
        icon: <IconBrain size={PANEL_ICON_SIZE} />,
        title: '大模型服务商',
        description: '维护 LLM 服务地址、认证信息与模型能力映射，供翻译与知识图谱功能使用。',
        content: <LlmProviderPanel onNotice={onNotify} />,
      },
      {
        id: 'neo4j',
        icon: <IconDatabase size={PANEL_ICON_SIZE} />,
        title: 'Neo4j 图数据库',
        description: '为实体关系图谱与检索增强提供统一的图数据库入口。',
        content: <Neo4jPanel onNotice={onNotify} />,
      },
      {
        id: 'reader',
        icon: <IconTypography size={PANEL_ICON_SIZE} />,
        title: '阅读器排版',
        description: '设置默认字号、行高、字体族，可通过多语种沙箱即时预览；单本书可单独覆盖。',
        content: <ReaderTypographyPanel onNotice={onNotify} />,
      },
      {
        id: 'translation',
        icon: <IconLanguage size={PANEL_ICON_SIZE} />,
        title: '翻译默认值',
        description: '设定默认的源语言、目标语言与翻译模型偏好。',
        content: <TranslationDefaultsPanel onNotice={onNotify} />,
      },
      {
        id: 'scheduling',
        icon: <IconClock size={PANEL_ICON_SIZE} />,
        title: '定时更新',
        description: '自动检查书库中作品的更新情况，发现新章节后自动下载——你只管看，不用惦记追更。',
        badge: schedulingConfig?.enabled
          ? <Badge size="sm" variant="light" color="green">已开启</Badge>
          : <Badge size="sm" variant="light" color="gray">已关闭</Badge>,
        content: (
          <SchedulingPanel
            config={schedulingConfig}
            onConfigChange={handleSchedulingConfigChange}
            novels={schedulingNovels}
            onNovelsChange={handleSchedulingNovelsChange}
            onNotify={onNotify}
          />
        ),
      },
    ],
    [model, onNotify, theme, schedulingConfig, schedulingNovels],
  );

  return (
    <Stack gap="lg">
      {/* 页面说明 */}
      <Paper
        p="lg"
        radius="lg"
        style={{
          background: 'rgba(31, 21, 16, 0.78)',
          border: `1px solid ${theme.other.lineColor as string}`,
          backdropFilter: 'blur(18px)',
        }}
      >
        <Group mb="xs">
          <IconAdjustments size={22} color={theme.other.accentStrong as string} />
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: theme.other.accentStrong as string }}>
            全局偏好
          </Text>
        </Group>
        <Title order={3} mb="xs" style={{ fontFamily: theme.headings.fontFamily }}>
          统一管理全局默认配置
        </Title>
        <Text size="sm" c="dimmed" maw={640}>
          这里集中管理采集偏好、网络代理、LLM 模型、阅读器排版和图数据库连接。保存后，后续新任务和阅读等场景会直接复用这些默认值。
        </Text>

        <Group gap="sm" mt="md">
          <Badge variant="light" color="gray" size="lg">
            {model.chapterConcurrency} 并发
          </Badge>
          <Badge variant="light" color="gray" size="lg">
            重试 {model.chapterRetryCount} 次
          </Badge>
          <Badge variant="light" color={model.forceRefetch ? 'yellow' : 'gray'} size="lg">
            {model.forceRefetch ? '强制重新采集' : '只采集缺失章节'}
          </Badge>
        </Group>
      </Paper>

      {/* 全局模型路由网关 */}
      <ModelGatewayPanel />

      {/* Accordion 面板组 */}
      <Accordion
        variant="separated"
        radius="lg"
        multiple
        chevronPosition="right"
        styles={{
          control: {
            minHeight: 48,
            paddingLeft: '1.2rem',
            paddingRight: '1.2rem',
          },
          panel: {
            padding: '1rem 1.2rem',
            background: 'rgba(26, 20, 16, 0.6)',
          },
          item: {
            background: 'rgba(31, 21, 16, 0.84)',
            border: `1px solid ${theme.other.lineColor as string}`,
            backdropFilter: 'blur(18px)',
          },
          label: {
            padding: 0,
          },
        }}
      >
        {panels.map((panel) => (
          <Accordion.Item key={panel.id} value={panel.id}>
            <Accordion.Control
              icon={panel.icon}
            >
              <Group justify="space-between" wrap="nowrap" style={{ flex: 1 }}>
                <div>
                  <Text fw={600} size="sm">
                    {panel.title}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {panel.description}
                  </Text>
                </div>
                {panel.badge}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {panel.id === 'reader' || panel.id === 'llm' ? (
                panel.content
              ) : (
                <ScrollArea.Autosize mah="max(40vh, 360px)" offsetScrollbars>
                  {panel.content}
                </ScrollArea.Autosize>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

// ── Memoized Checkbox Item（避免 Modal 中全量重渲染） ──

interface SchedulingNovelDraft {
  enabled: boolean;
  autoTranslate: boolean;
}

interface MemoizedCheckboxItemProps {
  label: string;
  checked: boolean;
  autoTranslate: boolean;
  onToggle: (checked: boolean) => void;
  onAutoTranslateToggle: (checked: boolean) => void;
}

const MemoizedCheckboxItem = memo(function MemoizedCheckboxItemFn({
  label,
  checked,
  autoTranslate,
  onToggle,
  onAutoTranslateToggle,
}: MemoizedCheckboxItemProps) {
  return (
    <Paper p="sm" radius="md" withBorder style={{ background: 'rgba(31,21,16,0.48)' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Checkbox
          label={label}
          checked={checked}
          onChange={(event) => onToggle(event.currentTarget.checked)}
          styles={{ label: { lineHeight: 1.4 } }}
        />
        <Switch
          size="sm"
          label="自动翻译"
          checked={autoTranslate}
          disabled={!checked}
          onChange={(event) => onAutoTranslateToggle(event.currentTarget.checked)}
        />
      </Group>
      <Text size="xs" mt={6} c="dimmed">
        {checked
          ? '发现新章节后，会继续翻译还没完成的内容。'
          : '先开启这本书的定时更新，才能自动翻译新增章节。'}
      </Text>
    </Paper>
  );
});

// ── SchedulingPanel ──

interface SchedulingPanelProps {
  config: SchedulingConfig | null;
  onConfigChange: (input: Partial<SchedulingConfig>) => Promise<void>;
  novels: SchedulingNovelEntry[];
  onNovelsChange: (entries: Array<{ sourceId: string; novelId: string; enabled: boolean; autoTranslate?: boolean }>) => Promise<void>;
  onNotify: (notice: NoticeInput) => void;
}

function SchedulingPanel({ config, onConfigChange, novels, onNovelsChange, onNotify }: SchedulingPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSelections, setModalSelections] = useState<Map<string, SchedulingNovelDraft>>(new Map());

  if (!config) {
    return <Text size="sm" c="dimmed">加载中...</Text>;
  }

  const cronPreviews = config.mode === 'cron' ? computeCronPreviews(config.cronExpression) : [];

  const lastCheckRun = config.lastCheckRun;

  return (
    <Stack gap="md">
      <Switch
        label="启用定时更新"
        checked={config.enabled}
        onChange={(event) => {
          void onConfigChange({ enabled: event.currentTarget.checked });
        }}
      />

      {config.enabled && (
        <>
          <SegmentedControl
            value={config.mode}
            onChange={(value) => {
              if (value === 'interval' || value === 'cron' || value === 'weekly') {
                void onConfigChange({ mode: value });
              }
            }}
            data={[
              { label: '固定间隔', value: 'interval' },
              { label: 'Cron 表达式', value: 'cron' },
              { label: '每周定时', value: 'weekly' },
            ]}
          />

          {config.mode === 'interval' && (
            <Stack gap="xs">
              <NumberInput
                label="轮询间隔（小时）"
                min={1}
                max={168}
                value={config.intervalHours}
                onChange={(value) => {
                  if (typeof value === 'number') {
                    void onConfigChange({ intervalHours: value });
                  }
                }}
              />
              <Text size="xs" c="dimmed">
                下次预计触发：{formatNextTriggerTime(config.intervalHours)}
              </Text>
            </Stack>
          )}

          {config.mode === 'cron' && (
            <Stack gap="xs">
              <TextInput
                label="Cron 表达式"
                value={config.cronExpression}
                onChange={(event) => {
                  void onConfigChange({ cronExpression: event.currentTarget.value });
                }}
              />
              <CronEditor
                value={config.cronExpression}
                onChange={(expr: string) => void onConfigChange({ cronExpression: expr })}
              />
              {cronPreviews.length > 0 && (
                <Text size="xs" c="dimmed">
                  未来 {cronPreviews.length} 次触发：{cronPreviews.join('、')}
                </Text>
              )}
            </Stack>
          )}

          {config.mode === 'weekly' && (
            <Stack gap="xs">
              <Input.Label>每周触发日</Input.Label>
              <Chip.Group
                multiple
                value={config.weeklyDays.map(String)}
                onChange={(values) => {
                  void onConfigChange({ weeklyDays: values.map(Number).filter((d) => d >= 0 && d <= 6) });
                }}
              >
                <Group gap={4}>
                  {['日', '一', '二', '三', '四', '五', '六'].map((label, idx) => (
                    <Chip key={idx} value={String(idx)} size="xs">{label}</Chip>
                  ))}
                </Group>
              </Chip.Group>
              <Input.Wrapper label="触发时刻">
                <input
                  type="time"
                  value={config.weeklyTime}
                  onChange={(event) => {
                    void onConfigChange({ weeklyTime: event.target.value });
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
          )}

          <Button
            variant="default"
            size="compact-sm"
            onClick={() => {
              const map = new Map(novels.map((n) => [
                `${n.sourceId}:${n.novelId}`,
                { enabled: n.enabled, autoTranslate: n.autoTranslate },
              ]));
              setModalSelections(map);
              setModalOpen(true);
            }}
          >
            管理书单
          </Button>

          {lastCheckRun && (
            <Paper p="sm" radius="md" withBorder style={{ background: 'rgba(31,21,16,0.78)' }}>
              <Text size="xs" fw={600} mb={2}>上次检查轮次</Text>
              <Text size="xs" c="dimmed">
                {lastCheckRun.status === 'completed'
                  ? `检查 ${lastCheckRun.totalChecked} 本，发现更新 ${lastCheckRun.newChaptersFound} 本，跳过 ${lastCheckRun.skipped} 本，出错 ${lastCheckRun.errored} 本`
                  : '轮次进行中…'}
                {lastCheckRun.completedAt && ` · ${formatTimeAgo(lastCheckRun.completedAt)}前`}
              </Text>
            </Paper>
          )}
        </>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title="管理定时更新书单"
        size="lg"
      >
        <Stack gap="xs">
          <ScrollArea.Autosize mah={420} type="scroll">
            <Stack gap="xs">
              {novels.map((novel) => {
                const key = `${novel.sourceId}:${novel.novelId}`;
                const selection = modalSelections.get(key) ?? {
                  enabled: novel.enabled,
                  autoTranslate: novel.autoTranslate,
                };
                return (
                  <MemoizedCheckboxItem
                    key={key}
                    label={`${novel.title} — ${novel.sourceId}`}
                    checked={selection.enabled}
                    autoTranslate={selection.autoTranslate}
                    onToggle={(checked) => {
                      setModalSelections((prev) => {
                        const next = new Map(prev);
                        const current = next.get(key) ?? selection;
                        next.set(key, { ...current, enabled: checked });
                        return next;
                      });
                    }}
                    onAutoTranslateToggle={(checked) => {
                      setModalSelections((prev) => {
                        const next = new Map(prev);
                        const current = next.get(key) ?? selection;
                        next.set(key, { ...current, autoTranslate: checked });
                        return next;
                      });
                    }}
                  />
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
                .map(([key, draft]) => {
                  const [sourceId, novelId] = key.split(':');
                  return {
                    sourceId: sourceId ?? '',
                    novelId: novelId ?? '',
                    enabled: draft.enabled,
                    autoTranslate: draft.autoTranslate,
                  };
                })
                .filter((e) => e.sourceId !== '' && e.novelId !== '');
              try {
                await onNovelsChange(entries);
                setModalOpen(false);
                onNotify({ tone: 'success', title: '已保存', message: '定时更新书单已更新。' });
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

// ── TranslationDefaultsPanel ──

function TranslationDefaultsPanel({ onNotice }: { onNotice: (notice: NoticeInput) => void }) {
  const [sourceLang, setSourceLang] = useState('ja');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [translationConcurrency, setTranslationConcurrency] = useState(3);
  const [preferredModelKey, setPreferredModelKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatModelOptions, setChatModelOptions] = useState<{ group: string; items: { value: string; label: string }[] }[]>([]);

  useEffect(() => {
    Promise.all([
      fetchTranslationPreferences(),
      fetchLlmProvidersPreferences(),
    ])
      .then(([transPrefs, llmPrefs]) => {
        setSourceLang(transPrefs.config.sourceLang);
        setTargetLang(transPrefs.config.targetLang);
        setTranslationConcurrency(transPrefs.config.translationConcurrency);
        setPreferredModelKey(transPrefs.config.preferredTranslationModelKey ?? '');
        // Build chat-only model options
        const groups: { group: string; items: { value: string; label: string }[] }[] = [];
        for (const p of llmPrefs.providers) {
          if (!p.enabled) continue;
          const items = p.models
            .filter((m) => m.enabled && m.modelId && m.resolvedCapabilities.includes('chat' as ModelCapability))
            .map((m) => ({
              value: `${p.id}:${m.modelId}`,
              label: `${p.label} / ${m.label || m.modelId}`,
            }));
          if (items.length > 0) groups.push({ group: p.label, items });
        }
        setChatModelOptions(groups);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateTranslationPreferences({
        sourceLang,
        targetLang,
        translationConcurrency,
        preferredTranslationModelKey: preferredModelKey || null,
      });
      onNotice({ tone: 'success', title: '已保存', message: '翻译默认值已更新。' });
    } catch (err) {
      onNotice({ tone: 'error', title: '保存失败', message: err instanceof Error ? err.message : '未知错误' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Text size="sm" c="dimmed">正在加载翻译配置...</Text>;

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">新翻译任务会默认继承这些设定，单本书启动翻译时可以临时覆盖。</Text>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div>
          <Text size="sm" fw={600} mb={4}>源语言</Text>
          <LanguagePicker value={sourceLang} onChange={setSourceLang} placeholder="ja" />
        </div>
        <div>
          <Text size="sm" fw={600} mb={4}>目标语言</Text>
          <LanguagePicker value={targetLang} onChange={setTargetLang} placeholder="zh-CN" />
        </div>
      </div>
      <Select
        label="默认翻译模型"
        placeholder="自动选择可用模型"
        data={chatModelOptions}
        value={preferredModelKey}
        onChange={(v) => setPreferredModelKey(v ?? '')}
        searchable
        clearable
        nothingFoundMessage="暂无可用对话模型"
      />
      <NumberInput
        label="段落翻译并发数"
        min={1}
        max={12}
        value={translationConcurrency}
        onChange={(v) => setTranslationConcurrency(typeof v === 'number' ? v : 3)}
        hideControls
      />
      <Button
        variant="filled"
        color="brand"
        size="compact-sm"
        leftSection={<IconDeviceFloppy size={14} />}
        loading={saving}
        onClick={() => void handleSave()}
      >
        保存翻译默认值
      </Button>
    </Stack>
  );
}

// ── Scheduling helpers ──

function computeCronPreviews(expression: string): string[] {
  try {
    const interval = parseExpression.parse(expression);
    const previews: string[] = [];
    for (let i = 0; i < 5; i++) {
      const next = interval.next();
      const year = next.getFullYear();
      const month = String(next.getMonth() + 1).padStart(2, '0');
      const day = String(next.getDate()).padStart(2, '0');
      const hours = String(next.getHours()).padStart(2, '0');
      const minutes = String(next.getMinutes()).padStart(2, '0');
      previews.push(`${year}-${month}-${day} ${hours}:${minutes}`);
    }
    return previews;
  } catch {
    return [];
  }
}

function formatNextTriggerTime(intervalHours: number): string {
  const next = new Date(Date.now() + intervalHours * 3600 * 1000);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, '0');
  const day = String(next.getDate()).padStart(2, '0');
  const hours = String(next.getHours()).padStart(2, '0');
  const minutes = String(next.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diff / 3600000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}