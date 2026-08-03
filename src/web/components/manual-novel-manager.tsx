import { useEffect, useState } from 'react';
import { ActionIcon, Button, Group, Modal, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';

import type { LibraryNovelDetailPayload } from '../../server/routes/library';
import {
  createManualLibraryVolume,
  deleteManualLibraryChapter,
  deleteManualLibraryVolume,
  fetchLibraryChapter,
  fetchManualLibraryVolumes,
  renameManualLibraryVolume,
  reorderManualLibraryChapters,
  saveManualLibraryChapter,
  type ManualVolume,
} from '../services/api';

interface ManualNovelManagerProps {
  novel: LibraryNovelDetailPayload['novel'];
  onRefresh: () => Promise<void>;
  onOpenChapter: (chapterId: string) => void;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export function ManualNovelManager({ novel, onRefresh, onOpenChapter, onNotify }: ManualNovelManagerProps) {
  const [volumes, setVolumes] = useState<ManualVolume[]>([]);
  const [volumeTitle, setVolumeTitle] = useState('');
  const [chapterModal, setChapterModal] = useState<{ id?: string; title: string; volumeTitle: string | null } | null>(null);

  const reload = () => fetchManualLibraryVolumes(novel.metadata.novelId).then(setVolumes).catch(() => setVolumes([]));
  useEffect(() => { void reload(); }, [novel.metadata.novelId]);

  async function createVolume() {
    try { await createManualLibraryVolume(novel.metadata.novelId, volumeTitle); setVolumeTitle(''); await reload(); onNotify({ tone: 'success', title: '卷已创建', message: '可将章节移动到此卷。' }); }
    catch (error) { onNotify({ tone: 'error', title: '创建失败', message: error instanceof Error ? error.message : '请稍后重试。' }); }
  }

  async function saveChapter() {
    if (!chapterModal?.title.trim()) return;
    try {
      const content = chapterModal.id ? (await fetchLibraryChapter('manual', novel.metadata.novelId, chapterModal.id)).chapter.chapter.content : '';
      await saveManualLibraryChapter(novel.metadata.novelId, { ...(chapterModal.id ? { chapterId: chapterModal.id } : {}), title: chapterModal.title, ...(chapterModal.volumeTitle ? { volumeTitle: chapterModal.volumeTitle } : {}), content });
      setChapterModal(null); await onRefresh(); await reload(); onNotify({ tone: 'success', title: chapterModal.id ? '章节已更新' : '章节已创建', message: '正文可在阅读页继续编辑。' });
    } catch (error) { onNotify({ tone: 'error', title: '保存失败', message: error instanceof Error ? error.message : '请稍后重试。' }); }
  }

  async function reorder(chapterId: string, volumeTitle: string | null | undefined, direction: -1 | 1) {
    const ids = novel.chapters.map((chapter) => chapter.id);
    const volumeChapterPositions = novel.chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(({ chapter }) => (chapter.volumeTitle ?? null) === (volumeTitle ?? null));
    const indexInVolume = volumeChapterPositions.findIndex(({ chapter }) => chapter.id === chapterId);
    const targetInVolume = indexInVolume + direction;
    if (indexInVolume < 0 || targetInVolume < 0 || targetInVolume >= volumeChapterPositions.length) return;
    const sourceIndex = volumeChapterPositions[indexInVolume]!.index;
    const targetIndex = volumeChapterPositions[targetInVolume]!.index;
    [ids[sourceIndex], ids[targetIndex]] = [ids[targetIndex]!, ids[sourceIndex]!];
    try { await reorderManualLibraryChapters(novel.metadata.novelId, ids); await onRefresh(); }
    catch (error) { onNotify({ tone: 'error', title: '排序失败', message: error instanceof Error ? error.message : '请稍后重试。' }); }
  }

  return <Stack gap="sm" py="xs">
      <Group justify="space-between"><Text fw={700}>手动管理</Text><Button size="compact-sm" leftSection={<IconPlus size={15} />} onClick={() => setChapterModal({ title: '', volumeTitle: null })}>新建章节</Button></Group>
      <Group align="end"><TextInput label="新建卷" value={volumeTitle} onChange={(event) => setVolumeTitle(event.currentTarget.value)} style={{ flex: 1 }} /><Button disabled={!volumeTitle.trim()} onClick={() => void createVolume()}>创建卷</Button></Group>
      {volumes.map((volume) => <Paper key={volume.title} p="xs" radius="md" style={{ background: 'rgba(255,255,255,0.03)' }}><Group justify="space-between"><Text size="sm">{volume.title} · {volume.chapterCount} 章</Text><Group gap="xs"><Button size="compact-xs" variant="subtle" onClick={() => { const next = window.prompt('卷名', volume.title); if (next?.trim() && next !== volume.title) void renameManualLibraryVolume(novel.metadata.novelId, volume.title, next).then(reload).then(() => onRefresh()); }}>重命名</Button><Button size="compact-xs" color="red" variant="subtle" onClick={() => { if (window.confirm(`删除卷「${volume.title}」及其全部 ${volume.chapterCount} 章？此操作不可撤销。`)) void deleteManualLibraryVolume(novel.metadata.novelId, volume.title).then(() => onRefresh()).then(reload); }}>删除卷</Button></Group></Group></Paper>)}
      {novel.chapters.map((chapter) => { const volumeChapters = novel.chapters.filter((entry) => (entry.volumeTitle ?? null) === (chapter.volumeTitle ?? null)); const indexInVolume = volumeChapters.findIndex((entry) => entry.id === chapter.id); return <Group key={chapter.id} justify="space-between" wrap="nowrap"><div><Text size="sm">{chapter.index}. {chapter.title}</Text><Text size="xs" c="dimmed">{chapter.volumeTitle ?? '未分卷'}</Text></div><Group gap={2}><ActionIcon variant="subtle" disabled={indexInVolume === 0} onClick={() => void reorder(chapter.id, chapter.volumeTitle, -1)}><IconArrowUp size={15} /></ActionIcon><ActionIcon variant="subtle" disabled={indexInVolume === volumeChapters.length - 1} onClick={() => void reorder(chapter.id, chapter.volumeTitle, 1)}><IconArrowDown size={15} /></ActionIcon><ActionIcon variant="subtle" onClick={() => setChapterModal({ id: chapter.id, title: chapter.title, volumeTitle: chapter.volumeTitle ?? null })}><IconEdit size={15} /></ActionIcon><ActionIcon color="red" variant="subtle" onClick={() => { if (window.confirm(`删除章节「${chapter.title}」？`)) void deleteManualLibraryChapter(novel.metadata.novelId, chapter.id).then(onRefresh); }}><IconTrash size={15} /></ActionIcon><Button size="compact-xs" variant="subtle" onClick={() => onOpenChapter(chapter.id)}>编辑正文</Button></Group></Group>; })}
    <Modal opened={chapterModal !== null} onClose={() => setChapterModal(null)} title={chapterModal?.id ? '编辑章节' : '新建章节'}><Stack><TextInput label="章节标题" value={chapterModal?.title ?? ''} onChange={(event) => { const title = event.currentTarget.value; setChapterModal((current) => current ? { ...current, title } : current); }} /><Select label="所属卷" clearable data={volumes.map((volume) => ({ value: volume.title, label: volume.title }))} value={chapterModal?.volumeTitle ?? null} onChange={(value) => setChapterModal((current) => current ? { ...current, volumeTitle: value } : current)} /><Group justify="flex-end"><Button variant="subtle" onClick={() => setChapterModal(null)}>取消</Button><Button onClick={() => void saveChapter()}>保存</Button></Group></Stack></Modal>
  </Stack>;
}
