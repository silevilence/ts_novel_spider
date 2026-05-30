import { useMemo, type ReactNode } from 'react';
import {
  Accordion,
  Badge,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  useMantineTheme,
} from '@mantine/core';
import {
  IconAdjustments,
  IconBrain,
  IconDatabase,
  IconNetwork,
  IconTypography,
  IconLanguage,
} from '@tabler/icons-react';

import { LlmProviderPanel } from './llm-provider-panel';
import { ModelGatewayPanel } from './model-gateway-panel';
import { Neo4jPanel } from './neo4j-panel';
import { NetworkProxyPanel } from './network-proxy-panel';
import { ReaderTypographyPanel } from './reader-typography-panel';
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
              />
              <NumberInput
                label="失败重试次数"
                min={0}
                max={5}
                value={model.chapterRetryCount}
                onChange={(v) => model.setChapterRetryCount(typeof v === 'number' ? v : 0)}
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
        content: (
          <Text size="sm" c="dimmed">
            翻译默认语言与模型偏好将在翻译面板中配置（即将在翻译启动面板中整合）。
          </Text>
        ),
      },
    ],
    [model, onNotify, theme],
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
              <ScrollArea.Autosize mah="max(40vh, 360px)" offsetScrollbars>
                {panel.content}
              </ScrollArea.Autosize>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}