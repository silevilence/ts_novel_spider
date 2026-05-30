import { useEffect, useState } from 'react';
import {
  Affix,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSettings, IconSearch, IconSend } from '@tabler/icons-react';

import { ChapterDirectory } from './chapter-directory';
import { MetadataBoard } from './metadata-board';
import type { ControlCenterModel } from '../services/control-center-model';

interface ControlConsoleProps {
  model: ControlCenterModel;
  onOpenSettings: () => void;
}

export function ControlConsole({ model, onOpenSettings }: ControlConsoleProps) {
  const pendingCount = model.preview?.chapters.filter((chapter) => chapter.status !== 'downloaded').length ?? 0;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // 移动端软键盘检测：通过 visualViewport 高度变化判断
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined' || !window.visualViewport) return;
    const onResize = () => {
      const viewport = window.visualViewport!;
      setKeyboardOpen(viewport.height < window.innerHeight * 0.78);
    };
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
    return () => {
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
    };
  }, [isMobile]);

  return (
    <Stack gap="lg" pb={80}>
      {/* 页面说明 */}
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>
            采集工作台
          </Text>
          <Title order={2} style={{ fontFamily: 'Alegreya, Noto Serif SC, Georgia, serif' }}>
            选择作品并开始采集
          </Title>
          <Text size="sm" c="dimmed" maw={640}>
            先查看作品信息和章节目录，再决定要采集哪些内容。底部操作栏始终固定，无需来回滚动。
          </Text>

          <Group gap="sm" mt="xs">
            <Badge variant="light" color="gray" size="lg">{model.selectedSource?.label ?? '加载中'}</Badge>
            <Badge variant="light" color="gray" size="lg">{pendingCount} 章待采集</Badge>
            <Badge variant="light" color="gray" size="lg">{model.chapterConcurrency} 并发 / {model.chapterRetryCount} 次重试</Badge>
          </Group>
        </Stack>
      </Paper>

      {/* 采集表单 */}
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void model.handlePreviewSubmit();
          }}
        >
          <Stack gap="md">
            <Group grow>
              <Select
                label="目标站点"
                data={model.sources.map((s) => ({ value: s.sourceId, label: s.label }))}
                value={model.selectedSourceId}
                onChange={(v) => v && model.handleSourceChange(v)}
              />
              <TextInput
                label="作品编号"
                value={model.novelId}
                onChange={(e) => model.setNovelId(e.target.value)}
                placeholder={model.selectedSource?.defaultNovelId ?? '输入作品编号'}
              />
            </Group>
            {model.selectedSource ? <Text size="xs" c="dimmed">{model.selectedSource.description}</Text> : null}
            <Group>
              <Button variant="subtle" size="compact-sm" leftSection={<IconSettings size={16} />} onClick={onOpenSettings}>
                更多设置
              </Button>
              <Text size="xs" c="dimmed">
                {model.forceRefetch ? '模式：重新采集已存在的章节' : '模式：只采集缺失的章节'}
              </Text>
            </Group>
            {model.previewError ? <Text size="sm" c="red">{model.previewError}</Text> : null}
          </Stack>
        </form>
      </Paper>

      {model.previewBusy ? (
        <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)' }}>
          <Skeleton height={20} mb="sm" radius="md" />
          <Skeleton height={16} mb="sm" width="70%" radius="md" />
          <Skeleton height={120} radius="md" />
        </Paper>
      ) : (
        <MetadataBoard preview={model.preview} loading={model.previewBusy} errorMessage={model.previewError} />
      )}

      <ChapterDirectory
        chapters={model.preview?.chapters ?? []}
        selectedChapterIds={model.selectedChapterIds}
        busy={model.isBusy}
        loading={model.previewBusy}
        onToggleChapter={model.toggleChapterSelection}
        onSelectAll={model.selectAllChapters}
        onSelectPending={model.selectPendingChapters}
        onSelectFailed={model.selectFailedChapters}
        onClearSelection={model.clearSelectedChapters}
      />

      {/* 底部悬浮操作栏 — 限高、移动端软键盘适配 */}
      {!keyboardOpen ? (
        <Affix position={{ bottom: 16, left: 0, right: 0 }} withinPortal>
          <Paper
            p="md"
            mx="auto"
            maw={1180}
            mah="30vh"
            radius="lg"
            style={{
              background: 'rgba(15,10,8,0.95)',
              backdropFilter: 'blur(18px)',
              border: '1px solid rgba(168,133,96,0.22)',
              boxShadow: '0 -8px 32px rgba(10,6,4,0.5)',
              overflowY: 'auto',
            }}
          >
            <Group justify="space-between" wrap="wrap">
              <div>
                <Text fw={700} size="sm">已选 {model.selectedChapterIds.length} 章</Text>
                <Text size="xs" c="dimmed">目录加载后自动勾选未采集章节</Text>
              </div>
              <Group>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconSettings size={16} />}
                  onClick={onOpenSettings}
                >
                  全局设置
                </Button>
                <Button
                  variant="default"
                  size="compact-sm"
                  leftSection={<IconSearch size={16} />}
                  onClick={() => void model.handlePreviewSubmit()}
                  disabled={model.isBusy || model.novelId.trim().length === 0}
                  loading={model.previewBusy}
                >
                  解析目录
                </Button>
                <Button
                  color="brand"
                  size="compact-sm"
                  leftSection={<IconSend size={16} />}
                  onClick={() => void model.handleCreateTask(model.selectedChapterIds.length > 0 ? model.selectedChapterIds : undefined)}
                  disabled={model.isBusy || model.novelId.trim().length === 0}
                  loading={model.taskBusy}
                >
                  下发采集任务
                </Button>
              </Group>
            </Group>
          </Paper>
        </Affix>
      ) : null}
    </Stack>
  );
}