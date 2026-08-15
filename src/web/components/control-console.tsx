import { useEffect, useState } from 'react';
import {
  Affix,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  SegmentedControl,
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

// 移动端布局常量（与 AppShell footer 高度 56px 对齐）
const MOBILE_FOOTER_HEIGHT = 56;
const MOBILE_AFFIX_GAP = 8;
const MOBILE_AFFIX_BOTTOM = MOBILE_FOOTER_HEIGHT + MOBILE_AFFIX_GAP;
const KEYBOARD_THRESHOLD_PX = 140;

export function ControlConsole({ model, onOpenSettings }: ControlConsoleProps) {
  const pendingCount = model.preview?.chapters.filter((chapter) => chapter.status !== 'downloaded').length ?? 0;
  const previewActionLabel = model.captureKind === 'browser' ? '浏览器预览' : '解析目录';
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // 移动端软键盘检测：基于基准高度差值 + 焦点元素兜底
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined' || !window.visualViewport) return;
    let baselineHeight = window.visualViewport.height;

    const updateKeyboardState = () => {
      const vv = window.visualViewport!;
      const heightDiff = baselineHeight - vv.height;

      // 差值超过阈值，或当前有文本输入类元素获得焦点，判定键盘打开
      const active = document.activeElement;
      const hasFocusedInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;

      setKeyboardOpen(heightDiff > KEYBOARD_THRESHOLD_PX || hasFocusedInput);
    };

    const onResize = () => {
      // 仅在 resize 时更新基准高度（键盘收起后重新校准）
      if (window.visualViewport!.height > baselineHeight * 0.95) {
        baselineHeight = window.visualViewport!.height;
      }
      updateKeyboardState();
    };

    // 焦点变化时重新检测
    const onFocusChange = () => updateKeyboardState();

    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', updateKeyboardState);
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);

    // 挂载后立即检测一次
    updateKeyboardState();

    return () => {
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', updateKeyboardState);
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
    };
  }, [isMobile]);

  return (
    <Stack gap="lg" pb={isMobile ? MOBILE_AFFIX_BOTTOM + 8 : 80}>
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
            <Badge variant="light" color={model.captureKind === 'browser' ? 'orange' : 'gray'} size="lg">
              {model.captureKind === 'browser' ? '浏览器传输 · 串行' : `${model.chapterConcurrency} 并发 / ${model.chapterRetryCount} 次重试`}
            </Badge>
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
            <div>
              <Text size="sm" fw={500} mb={6}>采集传输</Text>
              <SegmentedControl
                fullWidth
                value={model.captureKind}
                onChange={(value) => model.setCaptureKind(value as 'direct' | 'browser')}
                data={[
                  { value: 'direct', label: '服务端直连' },
                  { value: 'browser', label: '浏览器扩展', disabled: !model.selectedSource?.transports.includes('browser') },
                ]}
              />
              <Text size="xs" c="dimmed" mt={6}>
                {model.captureKind === 'browser'
                  ? '扩展会依次打开作品信息页 → 目录页；请按弹窗的“下一步”提示完成授权或验证。Cookie 不会离开浏览器。'
                  : '由服务端通过当前网络代理直接请求目标站点。'}
              </Text>
            </div>
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
        isMobile ? (
          <Affix position={{ bottom: MOBILE_AFFIX_BOTTOM, left: 0, right: 0 }} withinPortal>
            <Paper
              p="xs"
              mx="auto"
              maw={1180}
              radius="lg"
              style={{
                background: 'rgba(15,10,8,0.95)',
                backdropFilter: 'blur(18px)',
                border: '1px solid rgba(168,133,96,0.22)',
                boxShadow: '0 -8px 32px rgba(10,6,4,0.5)',
                marginLeft: 8,
                marginRight: 8,
              }}
            >
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text fw={700} size="xs">已选 {model.selectedChapterIds.length} 章</Text>
                <Group gap={4} wrap="nowrap">
                  <Button
                    variant="default"
                    size="compact-xs"
                    leftSection={<IconSearch size={12} />}
                    onClick={() => void model.handlePreviewSubmit()}
                    disabled={model.isBusy || model.novelId.trim().length === 0}
                    loading={model.previewBusy}
                  >
                    {previewActionLabel}
                  </Button>
                  <Button
                    color="brand"
                    size="compact-xs"
                    leftSection={<IconSend size={12} />}
                    onClick={() => void model.handleCreateTask(model.selectedChapterIds.length > 0 ? model.selectedChapterIds : undefined)}
                    disabled={model.isBusy || model.novelId.trim().length === 0}
                    loading={model.taskBusy}
                  >
                    下发采集
                  </Button>
                </Group>
              </Group>
            </Paper>
          </Affix>
        ) : (
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
                    {previewActionLabel}
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
        )
      ) : null}
    </Stack>
  );
}
