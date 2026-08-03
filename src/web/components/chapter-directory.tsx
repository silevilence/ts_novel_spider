import { useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import { Accordion, Badge, Button, Checkbox, Group, Paper, ScrollArea, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconSearch, IconChevronDown } from '@tabler/icons-react';
import type { ChapterPersistStatus } from '../../server/core/spider';
import {
  filterChapterGroups,
  groupResolvedChapters,
} from '../services/chapter-groups';
import { summarizeChapterMedia } from '../services/library-view';

export interface ChapterDirectoryEntry {
  id: string;
  index: number;
  title: string;
  url: string;
  volumeTitle?: string;
  status: ChapterPersistStatus;
  isNew: boolean;
  wasDownloaded: boolean;
  isCurrentProgress?: boolean;
  isProgressWatermark?: boolean;
  bookmarkCount?: number;
  versionChangeCount?: number;
  media?: {
    total: number;
    cached: number;
    pending: number;
  };
}

interface ChapterDirectoryProps {
  chapters: ChapterDirectoryEntry[];
  mode?: 'select' | 'inspect';
  selectedChapterIds?: string[];
  activeChapterId?: string | null;
  busy?: boolean;
  loading: boolean;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  onToggleChapter?: (chapterId: string) => void;
  onSelectAll?: () => void;
  onSelectPending?: () => void;
  onSelectFailed?: () => void;
  onClearSelection?: () => void;
  onPickChapter?: (chapterId: string) => void;
  onRefetchChapter?: (chapterId: string) => void;
  management?: ReactNode;
}

export function ChapterDirectory({
  chapters,
  mode = 'select',
  selectedChapterIds = [],
  activeChapterId = null,
  busy = false,
  loading,
  title = '选择要下载的章节',
  subtitle,
  emptyMessage = '读取目录后，这里会显示所有章节。',
  onToggleChapter,
  onSelectAll,
  onSelectPending,
  onSelectFailed,
  onClearSelection,
  onPickChapter,
  onRefetchChapter,
  management,
}: ChapterDirectoryProps) {
  const selectionMode = mode === 'select';
  const selectedSet = new Set(selectedChapterIds);
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [contextChapter, setContextChapter] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const grouped = groupResolvedChapters(chapters);
  const filteredGroups = filterChapterGroups(grouped, deferredQuery);

  useEffect(() => {
    setCollapsedGroups((current) => {
      const nextState: Record<string, boolean> = {};

      for (const group of grouped) {
        nextState[group.id] = current[group.id] ?? false;
      }

      return nextState;
    });
  }, [chapters]);

  const allCollapsed = filteredGroups.length > 0 && filteredGroups.every((group) => collapsedGroups[group.id]);

  return (
    <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.6)', border: '1px solid rgba(168,133,96,0.12)' }}>
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>章节目录</Text>
            <Title order={3}>{title}</Title>
          </div>
          <Group gap="xs">
            {selectionMode ? (
              <>
                <Button variant="subtle" size="compact-sm" onClick={onSelectAll} disabled={busy || chapters.length === 0}>全选</Button>
                <Button variant="subtle" size="compact-sm" onClick={onSelectPending} disabled={busy || chapters.length === 0}>选中待采集</Button>
                <Button variant="subtle" size="compact-sm" onClick={onSelectFailed} disabled={busy || chapters.length === 0}>选中失败项</Button>
                <Button variant="subtle" size="compact-sm" onClick={onClearSelection} disabled={busy || selectedChapterIds.length === 0}>清空</Button>
              </>
            ) : null}
            <Button variant="subtle" size="compact-sm"
              onClick={() =>
                setCollapsedGroups((current) => {
                  const nextValue = !allCollapsed;
                  const nextState: Record<string, boolean> = {};
                  for (const group of filteredGroups) { nextState[group.id] = nextValue; }
                  return { ...current, ...nextState };
                })
              }
              disabled={filteredGroups.length === 0}>
              {allCollapsed ? '展开全部分组' : '折叠全部分组'}
            </Button>
          </Group>
        </Group>

        <Group gap="sm" wrap="wrap">
          <TextInput
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索卷名、章节标题或编号"
            style={{ flex: 1, minWidth: 200 }}
          />
          <Group gap="xs">
            {selectionMode ? <Badge variant="light" color="blue" size="sm">已选 {selectedChapterIds.length}</Badge> : null}
            {!selectionMode ? <Badge variant="light" color="green" size="sm">可阅读 {chapters.filter((c) => c.wasDownloaded).length}</Badge> : null}
            <Badge variant="light" color="gray" size="sm">{selectionMode ? '待采集' : '未下载'} {chapters.filter((c) => c.status !== 'downloaded').length}</Badge>
          </Group>
        </Group>

        {subtitle ? <Text size="xs" c="dimmed">{subtitle}</Text> : null}

        {management}

        {chapters.length === 0 ? (
          <Paper p="md" radius="md" style={{ background: 'rgba(38,26,20,0.4)' }}>
            <Text size="sm" c="dimmed">{loading ? '正在读取目录，请稍候。' : emptyMessage}</Text>
          </Paper>
        ) : filteredGroups.length === 0 ? (
          <Paper p="md" radius="md" style={{ background: 'rgba(38,26,20,0.4)' }}>
            <Text size="sm" c="dimmed">没有匹配当前搜索条件的章节。</Text>
          </Paper>
        ) : (
          <ScrollArea.Autosize mah="60vh">
            <Stack gap="xs">
              {filteredGroups.map((group) => {
                const isCollapsed = collapsedGroups[group.id] ?? false;
                return (
                  <Paper key={group.id} radius="md" style={{ background: 'rgba(38,26,20,0.5)', border: '1px solid rgba(168,133,96,0.08)', overflow: 'hidden' }}>
                    <Group
                      p="sm"
                      style={{ cursor: 'pointer', background: isCollapsed ? 'transparent' : 'rgba(168,133,96,0.06)' }}
                      onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !isCollapsed }))}
                      justify="space-between"
                      wrap="wrap"
                    >
                      <div>
                        <Text size="sm" fw={600}>{group.title}</Text>
                        <Text size="xs" c="dimmed">第 #{group.chapters[0]?.index ?? 0} 章 - 第 #{group.chapters[group.chapters.length - 1]?.index ?? 0} 章</Text>
                      </div>
                      <Group gap="xs">
                        <Badge variant="light" color="gray" size="sm">{group.summary.total} 章</Badge>
                        <Badge variant="light" color="orange" size="sm">{selectionMode ? '待采集' : '未下载'} {group.summary.pendingCount}</Badge>
                        {group.summary.newCount > 0 ? <Badge variant="light" color="cyan" size="sm">新增 {group.summary.newCount}</Badge> : null}
                        {group.summary.failedCount > 0 ? <Badge variant="light" color="red" size="sm">失败 {group.summary.failedCount}</Badge> : null}
                        <IconChevronDown size={14} style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                      </Group>
                    </Group>
                    {!isCollapsed ? (
                      <Stack gap={2} px="sm" pb="sm">
                        {group.chapters.map((chapter) => {
                          const checked = selectedSet.has(chapter.id);
                          const isActive = activeChapterId === chapter.id;
                          const mediaSummary = summarizeChapterMedia(chapter.media);

                          return (
                            <Paper
                              key={chapter.id}
                              p="xs"
                              radius="sm"
                              style={{
                                background: isActive ? 'rgba(255,140,66,0.12)' : 'rgba(26,18,12,0.4)',
                                border: isActive ? '1px solid rgba(255,140,66,0.3)' : '1px solid transparent',
                              }}
                              onContextMenu={(event) => {
                                if (!selectionMode && onRefetchChapter) {
                                  event.preventDefault();
                                  setContextChapter({ id: chapter.id, title: chapter.title, x: event.clientX, y: event.clientY });
                                }
                              }}
                            >
                              {selectionMode ? (
                                <Stack gap={4}>
                                  <Group gap="xs" wrap="nowrap">
                                    <Checkbox checked={checked} disabled={busy} onChange={() => onToggleChapter?.(chapter.id)} size="xs" />
                                    <div style={{ flex: 1 }}>
                                      <Text size="xs" c="dimmed">#{chapter.index}</Text>
                                      <Text size="sm" fw={500}>{chapter.title}</Text>
                                    </div>
                                  </Group>
                                  <Group gap={4} wrap="wrap">
                                    {isActive ? <Badge variant="light" color="green" size="xs">阅读中</Badge> : null}
                                    {chapter.isCurrentProgress ? <Badge variant="light" color="green" size="xs">当前进度</Badge> : null}
                                    {chapter.isProgressWatermark ? <Badge variant="light" color="blue" size="xs">最高进度</Badge> : null}
                                    {(chapter.bookmarkCount ?? 0) > 0 ? <Badge variant="light" color="cyan" size="xs">书签 {chapter.bookmarkCount}</Badge> : null}
                                    {(chapter.versionChangeCount ?? 0) > 0 ? <Badge variant="light" color="violet" size="xs">发生过 {chapter.versionChangeCount} 次变更</Badge> : null}
                                    {chapter.isNew ? <Badge variant="light" color="orange" size="xs">新增</Badge> : null}
                                    {chapter.wasDownloaded ? <Badge variant="light" color="green" size="xs">{selectionMode ? '已下载' : '可阅读'}</Badge> : null}
                                    {mediaSummary.hasMedia ? <Badge variant="light" color="gray" size="xs">{mediaSummary.presenceLabel}</Badge> : null}
                                    {mediaSummary.cacheLabel ? <Badge variant="light" color={mediaSummary.cacheComplete ? 'green' : 'gray'} size="xs">{mediaSummary.cacheLabel}</Badge> : null}
                                    {chapter.status !== 'downloaded' ? <Badge variant="light" color={chapter.status === 'failed' ? 'red' : 'gray'} size="xs">{formatChapterStatus(chapter.status)}</Badge> : null}
                                  </Group>
                                </Stack>
                              ) : (
                                <Group gap="xs" wrap="nowrap" style={{ cursor: chapter.wasDownloaded ? 'pointer' : 'default' }}
                                  onClick={() => chapter.wasDownloaded ? onPickChapter?.(chapter.id) : undefined}>
                                  <div style={{ flex: 1 }}>
                                    <Text size="xs" c="dimmed">#{chapter.index}</Text>
                                    <Text size="sm" fw={500}>{chapter.title}</Text>
                                  </div>
                                  <Group gap={4} wrap="wrap" justify="flex-end" style={{ flex: '0 0 auto', maxWidth: '60%' }}>
                                    {isActive ? <Badge variant="light" color="green" size="xs">阅读中</Badge> : null}
                                    {chapter.isCurrentProgress ? <Badge variant="light" color="green" size="xs">当前进度</Badge> : null}
                                    {chapter.isProgressWatermark ? <Badge variant="light" color="blue" size="xs">最高进度</Badge> : null}
                                    {(chapter.bookmarkCount ?? 0) > 0 ? <Badge variant="light" color="cyan" size="xs">书签 {chapter.bookmarkCount}</Badge> : null}
                                    {(chapter.versionChangeCount ?? 0) > 0 ? <Badge variant="light" color="violet" size="xs">发生过 {chapter.versionChangeCount} 次变更</Badge> : null}
                                    {chapter.isNew ? <Badge variant="light" color="orange" size="xs">新增</Badge> : null}
                                    {chapter.wasDownloaded ? <Badge variant="light" color="green" size="xs">可阅读</Badge> : null}
                                    {mediaSummary.hasMedia ? <Badge variant="light" color="gray" size="xs">{mediaSummary.presenceLabel}</Badge> : null}
                                    {mediaSummary.cacheLabel ? <Badge variant="light" color={mediaSummary.cacheComplete ? 'green' : 'gray'} size="xs">{mediaSummary.cacheLabel}</Badge> : null}
                                    {chapter.status !== 'downloaded' ? <Badge variant="light" color={chapter.status === 'failed' ? 'red' : 'gray'} size="xs">{formatChapterStatus(chapter.status)}</Badge> : null}
                                  </Group>
                                </Group>
                              )}
                            </Paper>
                          );
                        })}
                      </Stack>
                    ) : null}
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}
        {contextChapter ? <Paper p="xs" shadow="xl" style={{ position: 'fixed', left: contextChapter.x, top: contextChapter.y, zIndex: 300, background: 'var(--mantine-color-body)' }}><Text size="xs" mb="xs">{contextChapter.title}</Text><Button size="compact-xs" onClick={() => { onRefetchChapter?.(contextChapter.id); setContextChapter(null); }}>重新抓取本章</Button></Paper> : null}
      </Stack>
    </Paper>
  );
}

function formatChapterStatus(status: ChapterPersistStatus): string {
  switch (status) {
    case 'indexed':
      return '已索引';
    case 'downloaded':
      return '已下载';
    case 'failed':
      return '已失败';
    default:
      return status;
  }
}
