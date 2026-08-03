import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  TagsInput,
  Title,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconBookmark, IconFileDownload, IconPhoto, IconTag } from '@tabler/icons-react';

import { ChapterDirectory } from './chapter-directory';
import { ManualNovelManager } from './manual-novel-manager';
import { LibraryHistoryPanel } from './library-history-panel';
import { LibraryIntelligencePanel } from './library-intelligence-panel';
import { TranslationLaunchPanel } from './translation-launch-panel';
import { ScrollspyProvider, useScrollspy, type ScrollspySection } from './scrollspy-nav';
import type { LibraryModel } from '../services/library-model';
import {
  buildLibraryExportDownloadUrl,
  fetchNovelScheduling,
  fetchNovelOpdsStatus,
  updateNovelScheduling,
  updateNovelOpdsVisible,
  updateManualLibraryMetadata,
  applyLibraryMetadataSync,
  previewLibraryMetadataSync,
  refetchLibraryChapter,
  type MetadataSyncPreview,
  type LibraryExportFormat,
  type NovelOpdsStatus,
  type SchedulingNovelDetail,
  type TranslationExportMode,
} from '../services/api';
import {
  buildTextPreview,
  calculateRemainingTaskChapters,
  formatLibraryTaskStatus,
  findPreferredReaderChapter,
  toLibraryDirectoryChapters,
} from '../services/library-view';

interface LibraryDetailViewProps {
  model: LibraryModel;
  onOpenControl: () => void;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

const LIBRARY_EXPORT_OPTIONS: Array<{
  format: LibraryExportFormat;
  label: string;
  summary: string;
  bestFor: string;
  example: string;
}> = [
  {
    format: 'markdown',
    label: 'Markdown 文档',
    summary: '像一份整理好的笔记稿，章节层次清楚，适合你后面继续改内容、做摘录或再排版。',
    bestFor: '想继续整理内容',
    example: '打开后会看到分卷、分章，读起来和整理资料都方便。',
  },
  {
    format: 'epub',
    label: 'EPUB 电子书',
    summary: '最适合直接拿去阅读器、手机或平板里看，整体体验会更像一本正常电子书。',
    bestFor: '想直接拿去阅读',
    example: '导入阅读器后，可以像普通电子书一样翻页和跳目录。',
  },
  {
    format: 'txt',
    label: 'TXT 纯文本',
    summary: '最省事的一份纯文字，只保留章节标题和正文，适合备份、复制或在简单设备里打开。',
    bestFor: '想留一份纯文字备份',
    example: '打开后就是连续的文字内容，不会有复杂排版。',
  },
];

const LIBRARY_DETAIL_DESCRIPTION_LIMIT = 420;

export function LibraryDetailView({ model, onOpenControl, onNotify }: LibraryDetailViewProps) {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isRedownloadPickerOpen, setIsRedownloadPickerOpen] = useState(false);
  const [descriptionDialog, setDescriptionDialog] = useState<{ title: string; text: string } | null>(null);
  const [selectedRedownloadChapterIds, setSelectedRedownloadChapterIds] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState('');
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkNote, setEditingBookmarkNote] = useState('');
  const [isPageNavOpen, setIsPageNavOpen] = useState(false);
  const [exportTranslationMode, setExportTranslationMode] = useState<TranslationExportMode>('original');
  const [schedulingDetail, setSchedulingDetail] = useState<SchedulingNovelDetail | null>(null);
  const [opdsStatus, setOpdsStatus] = useState<NovelOpdsStatus | null>(null);
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState({ title: '', author: '', description: '', tags: [] as string[] });
  const [syncPreview, setSyncPreview] = useState<MetadataSyncPreview | null>(null);
  const [syncChoice, setSyncChoice] = useState<Record<'title' | 'author' | 'description' | 'tags', 'old' | 'new' | 'merge'>>({ title: 'new', author: 'new', description: 'new', tags: 'new' });
  const [selectedMergedTags, setSelectedMergedTags] = useState<string[]>([]);
  const chapterDirectoryRef = useRef<HTMLDivElement | null>(null);

  const detail = model.detail?.novel;
  if (!detail) {
    return (
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)' }}>
        <Text c="dimmed">{model.loading ? '正在加载书籍详情...' : model.errorMessage ?? '未找到对应书籍。'}</Text>
      </Paper>
    );
  }

  const preferredChapterId = findPreferredReaderChapter(detail);
  const detailDescriptionPreview = buildTextPreview(detail.metadata.description, LIBRARY_DETAIL_DESCRIPTION_LIMIT);
  const resumeChapterId = detail.readingProgress?.highestChapterId ?? preferredChapterId;
  const resumeCurrentChapterId = detail.readingProgress?.currentChapterId ?? null;
  const preferredMediaChapterId = detail.chapters.find((c) => c.hasContent && c.media.total > 0)?.id
    ?? detail.chapters.find((c) => c.status === 'downloaded' && c.media.total > 0)?.id
    ?? null;
  const task = model.currentTask;
  const redownloadCandidateChapters = toLibraryDirectoryChapters(detail.chapters)
    .filter((c) => c.status === 'downloaded' || c.status === 'failed');
  const latestTaskEvent = task?.events[task.events.length - 1] ?? null;
  const taskHeading = task?.status === 'completed' || task?.status === 'failed' ? '最近一次同步' : '当前同步任务';
  const remainingTaskChapters = calculateRemainingTaskChapters(task?.progress);
  const isManual = detail.sourceId === 'manual';

  // 重置状态（路径切换时）
  useEffect(() => {
    setIsExportDialogOpen(false);
    setIsRedownloadPickerOpen(false);
    setDescriptionDialog(null);
    setSelectedRedownloadChapterIds([]);
    setAliasDraft('');
    setEditingAliasId(null);
    setEditingAliasValue('');
    setEditingBookmarkId(null);
    setEditingBookmarkNote('');
    setIsPageNavOpen(false);
  }, [model.location.path]);

  // ESC 关闭弹窗
  useEffect(() => {
    if (!isExportDialogOpen && !descriptionDialog && !isRedownloadPickerOpen && !isPageNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExportDialogOpen(false);
        setIsRedownloadPickerOpen(false);
        setDescriptionDialog(null);
        setIsPageNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [descriptionDialog, isExportDialogOpen, isRedownloadPickerOpen, isPageNavOpen]);

  // 加载定时更新状态与 OPDS 可见性
  useEffect(() => {
    if (!detail) return;
    if (detail.sourceId === 'manual') {
      setSchedulingDetail(null);
    } else {
      fetchNovelScheduling(detail.sourceId, detail.metadata.novelId)
        .then(setSchedulingDetail)
        .catch(() => {});
    }
    fetchNovelOpdsStatus(detail.sourceId, detail.metadata.novelId)
      .then(setOpdsStatus)
      .catch(() => {});
  }, [detail?.sourceId, detail?.metadata.novelId]);

  function scrollToChapterDirectory() {
    chapterDirectoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <ScrollspyProvider>
      <Stack gap="lg">
        {/* ====== 概览 Hero 卡片 —— 聚合元数据与快捷操作 ====== */}
        <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
          <div data-scrollspy id="detail-hero" data-scrollspy-label="概览" />
          <Stack gap="xs">
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>书籍详情</Text>
            <Title order={2} style={{ fontFamily: 'Alegreya, Noto Serif SC, Georgia, serif' }}>{detail.metadata.title}</Title>
            <Text size="sm" c="dimmed">作者：{detail.metadata.author || '未知作者'}</Text>
            <Group gap="sm">
              <Badge variant="light" color="green" size="lg">已采集 {detail.stats.downloaded}</Badge>
              <Badge variant="light" color="yellow" size="lg">未采集 {detail.stats.pending}</Badge>
              <Badge variant="light" color="gray" size="lg">图片 {detail.media.cached}/{detail.media.total}</Badge>
              {detail.readingProgress ? (
                <Badge variant="light" color="blue" size="lg">进度第 {detail.readingProgress.highestChapterIndex} 章</Badge>
              ) : null}
            </Group>
          </Stack>
          <Group mt="md" wrap="wrap">
            <Button variant="subtle" size="compact-sm" onClick={() => model.refresh()} loading={model.loading}>刷新详情</Button>
            <LibraryHistoryPanel sourceId={detail.sourceId} novelId={detail.metadata.novelId} onRefresh={() => model.refresh()} onNotify={onNotify} />
            {isManual ? <Button variant="default" size="compact-sm" onClick={() => { setMetadataDraft({ title: detail.metadata.title, author: detail.metadata.author, description: detail.metadata.description, tags: detail.metadata.tags }); setMetadataDialogOpen(true); }}>编辑元数据</Button> : <>
            <Button variant="default" size="compact-sm" onClick={() => void previewLibraryMetadataSync(detail.sourceId, detail.metadata.novelId).then((preview) => { if (!preview.changedFields.length) { onNotify({ tone: 'info', title: '元数据无变化', message: '远端内容与当前版本相同。' }); return; } setSyncPreview(preview); setSelectedMergedTags([...new Set([...preview.current.tags, ...preview.remote.tags])]); }).catch((error: unknown) => onNotify({ tone: 'error', title: '同步失败', message: error instanceof Error ? error.message : '请稍后重试。' }))}>同步元数据</Button>
            <Button variant="default" size="compact-sm" onClick={() => void model.runIncrementalSync()} loading={model.syncBusy}>增量同步</Button>
            <Button variant="default" size="compact-sm" onClick={() => void model.syncMissingChapters()} loading={model.syncBusy}>补录缺失</Button>
            <Button variant="default" size="compact-sm" onClick={() => void model.redownloadAllDownloadedChapters()}
              loading={model.syncBusy} disabled={detail.stats.downloaded === 0}>全部重下</Button>
            </>}
            {resumeChapterId ? (
              <Button color="brand" size="compact-sm" onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, resumeChapterId)}>
                {detail.readingProgress ? '继续阅读' : '开始阅读'}
              </Button>
            ) : null}
          </Group>
      </Paper>

      <Modal opened={metadataDialogOpen} onClose={() => setMetadataDialogOpen(false)} title="编辑元数据">
        <Stack>
          <TextInput label="标题" value={metadataDraft.title} onChange={(event) => setMetadataDraft({ ...metadataDraft, title: event.currentTarget.value })} />
          <TextInput label="作者" value={metadataDraft.author} onChange={(event) => setMetadataDraft({ ...metadataDraft, author: event.currentTarget.value })} />
          <TagsInput label="标签" value={metadataDraft.tags} onChange={(tags) => setMetadataDraft({ ...metadataDraft, tags })} splitChars={[]} placeholder="输入标签后按 Enter 添加" />
          <Textarea label="简介" minRows={5} value={metadataDraft.description} onChange={(event) => setMetadataDraft({ ...metadataDraft, description: event.currentTarget.value })} />
          <Group justify="flex-end"><Button variant="subtle" onClick={() => setMetadataDialogOpen(false)}>取消</Button><Button onClick={() => void updateManualLibraryMetadata(detail.metadata.novelId, { title: metadataDraft.title, author: metadataDraft.author, description: metadataDraft.description, tags: metadataDraft.tags }).then((result) => { setMetadataDialogOpen(false); onNotify({ tone: result.changed ? 'success' : 'info', title: result.changed ? '元数据已保存' : '内容无变化，未保存', message: result.changed ? '已创建新的元数据版本。' : '当前内容与保存版本相同。' }); return model.refresh(); }).catch((error: unknown) => onNotify({ tone: 'error', title: '保存失败', message: error instanceof Error ? error.message : '草稿仍保留，可再次保存。' }))}>保存</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={syncPreview !== null} onClose={() => setSyncPreview(null)} title="同步元数据 · 选择要采用的内容" size="lg">{syncPreview ? <Stack>{(['title', 'author', 'description'] as const).map((field) => <Paper key={field} p="sm"><Text fw={600}>{field === 'title' ? '标题' : field === 'author' ? '作者' : '简介'}</Text>{syncPreview.changedFields.includes(field) ? <><Text size="xs" c="dimmed" mt="xs">当前：{syncPreview.current[field] || '（空）'}</Text><Text size="xs" c="dimmed">远端：{syncPreview.remote[field] || '（空）'}</Text><SegmentedControl mt="xs" size="xs" value={syncChoice[field]} onChange={(value) => setSyncChoice({ ...syncChoice, [field]: value as 'old' | 'new' })} data={[{ value: 'old', label: '保留旧版' }, { value: 'new', label: '采用新版' }]} /></> : <Text size="sm" c="dimmed">未发生变化</Text>}</Paper>)}<Paper p="sm"><Text fw={600}>标签</Text>{syncPreview.changedFields.includes('tags') ? <><SegmentedControl mt="xs" size="xs" value={syncChoice.tags} onChange={(value) => setSyncChoice({ ...syncChoice, tags: value as 'old' | 'new' | 'merge' })} data={[{ value: 'old', label: '保留旧' }, { value: 'new', label: '采用新' }, { value: 'merge', label: '合并' }]} />{syncChoice.tags === 'merge' ? <Checkbox.Group mt="xs" value={selectedMergedTags} onChange={setSelectedMergedTags}>{[...new Set([...syncPreview.current.tags, ...syncPreview.remote.tags])].map((tag) => <Checkbox key={tag} value={tag} label={tag} />)}</Checkbox.Group> : null}</> : <Text size="sm" c="dimmed">未发生变化</Text>}</Paper><Group justify="flex-end"><Button variant="subtle" onClick={() => setSyncPreview(null)}>取消</Button><Button onClick={() => { const input: Partial<MetadataSyncPreview['remote']> = {}; for (const field of ['title', 'author', 'description'] as const) if (syncPreview.changedFields.includes(field) && syncChoice[field] === 'new') input[field] = syncPreview.remote[field]; if (syncPreview.changedFields.includes('tags')) input.tags = syncChoice.tags === 'old' ? syncPreview.current.tags : syncChoice.tags === 'merge' ? selectedMergedTags : syncPreview.remote.tags; void applyLibraryMetadataSync(detail.sourceId, detail.metadata.novelId, input).then(() => model.refresh()).then(() => { setSyncPreview(null); onNotify({ tone: 'success', title: '元数据已应用', message: '已写入版本历史；受影响的翻译会在下次继续翻译时重新处理。' }); }).catch((error: unknown) => onNotify({ tone: 'error', title: '应用失败', message: error instanceof Error ? error.message : '请稍后重试。' })); }}>确认应用</Button></Group></Stack> : null}</Modal>

        {/* ====== 定时更新开关 ====== */}
        {!isManual ? <Paper
          p="sm"
          radius="md"
          style={{
            border: '1px solid rgba(255,209,102,0.30)',
            background: 'rgba(255,209,102,0.04)',
            minWidth: 180,
          }}
        >
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2}>
                <Text size="xs" fw={600} style={{ color: '#ffd166' }}>
                  🕐 定时更新
                </Text>
                <Text size="xs" c="dimmed">
                  {schedulingDetail?.enabled ? '自动追更中' : '开启后自动追更'}
                </Text>
              </Stack>
              <Switch
                size="sm"
                checked={schedulingDetail?.enabled ?? false}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  const previous = schedulingDetail;
                  setSchedulingDetail((current) => current ? { ...current, enabled: next } : current);
                  updateNovelScheduling(detail.sourceId, detail.metadata.novelId, {
                    enabled: next,
                    autoTranslate: previous?.autoTranslate ?? false,
                  })
                    .then(setSchedulingDetail)
                    .catch(() => {
                      setSchedulingDetail(previous ?? null);
                      onNotify({ tone: 'error', title: '保存失败', message: '定时更新状态没有改成功，请稍后再试。' });
                    });
                }}
              />
            </Group>

            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2}>
                <Text size="xs" fw={600} style={{ color: '#ffd166' }}>
                  新增章节后自动翻译
                </Text>
                <Text size="xs" c="dimmed">
                  {schedulingDetail?.enabled
                    ? (schedulingDetail.autoTranslate
                      ? '发现新章节后，会继续翻译还没完成的内容。'
                      : '如果你不想再手动点翻译，可以在这里一起开启。')
                    : '先开启定时更新，才能自动翻译新增章节。'}
                </Text>
              </Stack>
              <Switch
                size="sm"
                checked={schedulingDetail?.autoTranslate ?? false}
                disabled={!(schedulingDetail?.enabled ?? false)}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  const previous = schedulingDetail;
                  setSchedulingDetail((current) => current ? { ...current, autoTranslate: next } : current);
                  updateNovelScheduling(detail.sourceId, detail.metadata.novelId, {
                    enabled: previous?.enabled ?? false,
                    autoTranslate: next,
                  })
                    .then(setSchedulingDetail)
                    .catch(() => {
                      setSchedulingDetail(previous ?? null);
                      onNotify({ tone: 'error', title: '保存失败', message: '自动翻译开关没有改成功，请稍后再试。' });
                    });
                }}
              />
            </Group>

            {schedulingDetail && schedulingDetail.enabled && (
              <Text size="xs" c={schedulingStatusColor(schedulingDetail)}>
                {schedulingStatusMessage(schedulingDetail)}
              </Text>
            )}
          </Stack>
        </Paper> : null}

        {/* ====== OPDS 公开分发 ====== */}
        <Paper
          p="sm"
          radius="md"
          style={{
            border: '1px solid rgba(127,208,255,0.30)',
            background: 'rgba(127,208,255,0.04)',
            minWidth: 180,
          }}
        >
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={2}>
              <Text size="xs" fw={600} style={{ color: '#7fd0ff' }}>
                📚 OPDS 分发
              </Text>
              <Text size="xs" c="dimmed">
                {opdsStatus?.opdsVisible ? '已上架' : '开启后对阅读器可见'}
              </Text>
            </Stack>
            <Switch
              size="sm"
              checked={opdsStatus?.opdsVisible ?? false}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                setOpdsStatus((prev) => prev ? { ...prev, opdsVisible: next } : null);
                updateNovelOpdsVisible(detail.sourceId, detail.metadata.novelId, next)
                  .then(setOpdsStatus)
                  .catch(() => {
                    setOpdsStatus((prev) => prev ? { ...prev, opdsVisible: !next } : null);
                  });
              }}
            />
          </Group>
        </Paper>

        {/* ====== 同步任务状态 ====== */}
        {task ? (
          <Paper p="md" radius="lg" data-scrollspy id="detail-task" data-scrollspy-label="任务" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>{taskHeading}</Text>
              <Group gap="xs">
                <Badge variant="light" color={task.status === 'completed' ? 'green' : task.status === 'failed' ? 'red' : 'yellow'}>
                  {formatLibraryTaskStatus(task.status)}
                </Badge>
                <Badge variant="light" color={model.taskStreamState === 'connected' ? 'green' : 'gray'}>
                  {model.taskStreamState === 'connected' ? '实时' : '已结束'}
                </Badge>
              </Group>
            </Group>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: `${Math.max(task.progress.percent, task.status === 'completed' ? 100 : 0)}%`, height: '100%', background: 'linear-gradient(90deg, #ff8c42, #ffd166)', borderRadius: 2, transition: 'width 300ms ease' }} />
            </div>
            <Group gap="xs" mb="xs">
              <Badge variant="light" size="sm" color="yellow">目录 {task.progress.catalogChapters}</Badge>
              <Badge variant="light" size="sm" color="green">完成 {task.progress.completedChapters}</Badge>
              <Badge variant="light" size="sm" color="gray">待处理 {remainingTaskChapters}</Badge>
              <Badge variant="light" size="sm" color="red">失败 {task.progress.failedChapters}</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {task.status === 'completed' ? '同步已结束，页面会自动带入最新目录和章节状态。'
                : task.status === 'failed' ? '任务已结束，但仍有失败章节；可直接用「补录缺失章节」继续补抓。'
                : '这里会跟着后台任务更新，不需要手动刷新页面看进度。'}
            </Text>
            {latestTaskEvent ? <Text size="xs" fw={600} mt="xs">{latestTaskEvent.message}</Text> : null}
          </Paper>
        ) : null}

        {/* ====== 元数据卡片 ====== */}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" data-scrollspy id="detail-meta" data-scrollspy-label="元数据">
          <Card padding="sm" radius="md" style={{ gridColumn: 'span 2' }}>
            <Text size="xs" c="dimmed">简介</Text>
            <Text size="sm" fw={600} lineClamp={2} mb={4}>{detail.metadata.title}</Text>
            <Text size="xs" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{detailDescriptionPreview.fullText}</Text>
            {detailDescriptionPreview.isTruncated ? (
              <Button variant="subtle" size="compact-xs" mt="xs"
                onClick={() => setDescriptionDialog({ title: detail.metadata.title, text: detailDescriptionPreview.fullText })}>
                查看全文
              </Button>
            ) : null}
          </Card>
          <Card padding="sm" radius="md"><Text size="xs" c="dimmed">作者</Text><Text size="sm" fw={600}>{detail.metadata.author || '未知'}</Text></Card>
          <Card padding="sm" radius="md"><Text size="xs" c="dimmed">章节总数</Text><Text size="sm" fw={600}>{detail.metadata.chapterCount}</Text></Card>
          <Card padding="sm" radius="md" style={{ gridColumn: 'span 2' }}>
            <Text size="xs" c="dimmed">标签</Text>
            <Group gap={4} mt={4}>
              {detail.metadata.tags.length > 0
                ? detail.metadata.tags.map((tag) => <Badge key={tag} variant="light" size="xs" color="blue">{tag}</Badge>)
                : <Text size="xs" c="dimmed">无标签</Text>}
            </Group>
          </Card>
          <Card padding="sm" radius="md"><Text size="xs" c="dimmed">失败章节</Text><Text size="sm" fw={600} c={detail.stats.failed > 0 ? 'red' : 'dimmed'}>{detail.stats.failed}</Text></Card>
          <Card padding="sm" radius="md"><Text size="xs" c="dimmed">图片缓存</Text><Text size="sm" fw={600}>{detail.media.cached}/{detail.media.total}</Text></Card>
          <Card padding="sm" radius="md" style={{ gridColumn: 'span 2' }}>
            <Text size="xs" c="dimmed">阅读进度</Text>
            <Text size="sm" fw={600}>
              {detail.readingProgress
                ? `第 ${detail.readingProgress.highestChapterIndex} 章${detail.readingProgress.highestChapterTitle ? ` · ${detail.readingProgress.highestChapterTitle}` : ''}`
                : '暂无记录'}
            </Text>
            <Text size="xs" c="dimmed">
              {detail.readingProgress ? '回看早期章节不会覆盖最高进度。' : '打开章节后自动记住阅读水位线。'}
            </Text>
            {resumeCurrentChapterId && resumeCurrentChapterId !== resumeChapterId ? (
              <Button variant="subtle" size="compact-xs" mt="xs"
                onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, resumeCurrentChapterId)}>
                最近阅读章节
              </Button>
            ) : null}
          </Card>
        </SimpleGrid>

        <TranslationLaunchPanel model={model} onNotify={onNotify} />

        {/* ====== 工具面板（别名 + 书签 + 导出 + 图片缓存） ====== */}
        <Paper p="md" radius="lg" data-scrollspy id="detail-tools" data-scrollspy-label="工具" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
          <Tabs defaultValue="alias">
            <Tabs.List>
              <Tabs.Tab value="alias" leftSection={<IconTag size={14} />}>别名映射</Tabs.Tab>
              <Tabs.Tab value="bookmarks" leftSection={<IconBookmark size={14} />}>章节书签</Tabs.Tab>
              <Tabs.Tab value="export" leftSection={<IconFileDownload size={14} />}>导出文件</Tabs.Tab>
              <Tabs.Tab value="media" leftSection={<IconPhoto size={14} />}>图片缓存</Tabs.Tab>
            </Tabs.List>

            {/* 别名映射 */}
            <Tabs.Panel value="alias" pt="md">
              <Group justify="space-between" mb="xs">
                <Badge variant="light" color="yellow">{detail.aliases.length} 条</Badge>
              </Group>
              <Text size="xs" c="dimmed" mb="sm">补充常用别称、旧译名，保存后直接参与搜索排序。</Text>
              <Group mb="sm">
                <TextInput value={aliasDraft} onChange={(e) => setAliasDraft(e.target.value)}
                  placeholder="新增别名，比如旧译名或简称" style={{ flex: 1 }} />
                <Button color="brand" size="compact-sm" onClick={() => { void model.addAlias(aliasDraft); setAliasDraft(''); }}
                  loading={model.mutationBusyKey === 'alias-create'} disabled={aliasDraft.trim().length === 0}>添加</Button>
              </Group>
              {detail.aliases.length === 0 ? (
                <Text size="xs" c="dimmed">还没有别名。</Text>
              ) : (
                <Stack gap="xs">
                  {detail.aliases.map((alias) => (
                    <Paper key={alias.id} p="xs" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
                      {editingAliasId === alias.id ? (
                        <Group>
                          <TextInput size="xs" value={editingAliasValue} onChange={(e) => setEditingAliasValue(e.target.value)} style={{ flex: 1 }} />
                          <Button size="compact-xs" color="brand" onClick={() => { void model.renameAlias(alias.id, editingAliasValue); setEditingAliasId(null); setEditingAliasValue(''); }}
                            loading={model.mutationBusyKey === `alias:${alias.id}`} disabled={editingAliasValue.trim().length === 0}>保存</Button>
                          <Button size="compact-xs" variant="subtle" onClick={() => { setEditingAliasId(null); setEditingAliasValue(''); }}>取消</Button>
                        </Group>
                      ) : (
                        <Group justify="space-between">
                          <div><Text size="sm" fw={600}>{alias.alias}</Text><Text size="xs" c="dimmed">{new Date(alias.updatedAt).toLocaleString('zh-CN')}</Text></div>
                          <Group gap="xs">
                            <Button variant="subtle" size="compact-xs" onClick={() => { setEditingAliasId(alias.id); setEditingAliasValue(alias.alias); }}>编辑</Button>
                            <Button variant="subtle" size="compact-xs" color="red" onClick={() => void model.removeAlias(alias.id)} loading={model.mutationBusyKey === `alias:${alias.id}`}>删除</Button>
                          </Group>
                        </Group>
                      )}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Tabs.Panel>

            {/* 章节书签 */}
            <Tabs.Panel value="bookmarks" pt="md">
              <Group justify="space-between" mb="xs">
                <Badge variant="light" color="orange">{detail.bookmarks.length} 条</Badge>
              </Group>
              <Text size="xs" c="dimmed" mb="sm">阅读时加入书签，这里会按章节顺序列出，点击直接跳回对应章节。</Text>
              {detail.bookmarks.length === 0 ? (
                <Text size="xs" c="dimmed">还没有书签。阅读时点"加入书签"，这里就会开始累积。</Text>
              ) : (
                <Stack gap="xs">
                  {detail.bookmarks.map((bookmark) => (
                    <Paper key={bookmark.id} p="xs" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
                      <Group justify="space-between" mb={4}>
                        <div>
                          <Text size="xs" c="dimmed">第 {bookmark.chapterIndex} 章</Text>
                          <Text size="sm" fw={600}>{bookmark.chapterTitle}</Text>
                        </div>
                        {editingBookmarkId === bookmark.id ? (
                          <Group gap="xs">
                            <TextInput size="xs" value={editingBookmarkNote} onChange={(e) => setEditingBookmarkNote(e.target.value)} placeholder="备注" />
                            <Button size="compact-xs" color="brand" onClick={() => { void model.editBookmark(bookmark.id, editingBookmarkNote); setEditingBookmarkId(null); setEditingBookmarkNote(''); }}
                              loading={model.mutationBusyKey === `bookmark:${bookmark.id}`}>保存</Button>
                            <Button size="compact-xs" variant="subtle" onClick={() => { setEditingBookmarkId(null); setEditingBookmarkNote(''); }}>取消</Button>
                          </Group>
                        ) : (
                          <Group gap="xs">
                            <Button variant="subtle" size="compact-xs"
                              onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, bookmark.chapterId)}>打开</Button>
                            <Button variant="subtle" size="compact-xs"
                              onClick={() => { setEditingBookmarkId(bookmark.id); setEditingBookmarkNote(bookmark.note); }}>编辑</Button>
                            <Button variant="subtle" size="compact-xs" color="red"
                              onClick={() => void model.removeBookmark(bookmark.id)} loading={model.mutationBusyKey === `bookmark:${bookmark.id}`}>删除</Button>
                          </Group>
                        )}
                      </Group>
                      {editingBookmarkId !== bookmark.id && bookmark.note ? (
                        <Text size="xs" c="dimmed">{bookmark.note}</Text>
                      ) : null}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Tabs.Panel>

            {/* 导出文件 */}
            <Tabs.Panel value="export" pt="md">
              <Group justify="space-between" mb="xs">
                <div>
                  <Text size="xs" c="dimmed">导出使用已采集的正文生成文件。</Text>
                </div>
                <Group gap="xs">
                  <Badge variant="light" color="green">正文 {detail.stats.downloaded} 章</Badge>
                  <Badge variant="light" color="gray">图片 {detail.media.cached}/{detail.media.total}</Badge>
                  <Badge variant="light" color="yellow">3 种格式</Badge>
                </Group>
              </Group>
              <Button color="brand" size="compact-sm" onClick={() => setIsExportDialogOpen(true)} disabled={detail.stats.downloaded === 0}>选择导出格式</Button>
              <Text size="xs" c="dimmed" mt="sm">
                {detail.stats.downloaded === 0 ? '当前还没有已采集章节，先补录正文后才能导出文件。' : '一个入口按用途选格式：Markdown 整理、EPUB 阅读、TXT 备份。'}
              </Text>
            </Tabs.Panel>

            {/* 图片缓存 */}
            <Tabs.Panel value="media" pt="md">
              <Group justify="space-between" mb="xs">
                <div>
                  <Text size="xs" c="dimmed">
                    {detail.media.total === 0 ? '这本书当前没有图片资源。' : '统一补缓存或进入有图章节单独保存。'}
                  </Text>
                </div>
                <Group gap="xs">
                  <Badge variant="light" color="green">已缓存 {detail.media.cached}</Badge>
                  <Badge variant="light" color="gray">待缓存 {detail.media.total - detail.media.cached}</Badge>
                </Group>
              </Group>
              <Group mt="sm">
                {detail.media.total > 0 ? (
                  <Button variant="default" size="compact-sm"
                    onClick={() => void model.cacheAllMediaAssets()}
                    loading={model.mediaBatchBusy}
                    disabled={detail.media.pending === 0}>
                    {detail.media.pending === 0 ? '图片已全部缓存' : '统一缓存未保存图片'}
                  </Button>
                ) : null}
                {preferredMediaChapterId ? (
                  <Button variant="subtle" size="compact-sm"
                    onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, preferredMediaChapterId)}>
                    进入有图章节
                  </Button>
                ) : null}
                <Button variant="subtle" size="compact-sm" onClick={scrollToChapterDirectory}>跳到章节目录</Button>
              </Group>
              {model.mediaBatchProgress ? (
                <Paper p="xs" mt="sm" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" fw={600}>
                      {model.mediaBatchBusy ? '统一缓存进行中' : '最近一次统一缓存'}
                    </Text>
                    <Group gap="xs">
                      <Badge variant="light" color="green" size="xs">新缓存 {model.mediaBatchProgress.cached}</Badge>
                      <Badge variant="light" color="gray" size="xs">跳过 {model.mediaBatchProgress.skipped}</Badge>
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {model.mediaBatchProgress.completed}/{model.mediaBatchProgress.total}
                    {model.mediaBatchBusy ? ` · 当前：${model.mediaBatchProgress.currentChapterTitle ?? '图片资源'}` : ' · 已按最近结果更新'}
                  </Text>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 1.5, overflow: 'hidden', marginTop: 6 }}>
                    <div style={{ width: `${model.mediaBatchProgress.total === 0 ? 0 : (model.mediaBatchProgress.completed / model.mediaBatchProgress.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #61d4a6, #ff8c42)', borderRadius: 1.5, transition: 'width 300ms ease' }} />
                  </div>
                </Paper>
              ) : null}
            </Tabs.Panel>
          </Tabs>
        </Paper>

        {/* ====== 导出格式选择弹窗 ====== */}
        {isExportDialogOpen ? (
          <Modal
            opened={isExportDialogOpen}
            onClose={() => setIsExportDialogOpen(false)}
            title={<Text size="lg" fw={700}>选择导出格式</Text>}
            size="md"
            styles={{
              content: { background: 'rgba(15,10,8,0.97)' },
              header: { background: 'rgba(15,10,8,0.97)', borderBottom: '1px solid rgba(168,133,96,0.12)' },
            }}
          >
            <Stack gap="md">
              <Text size="xs" c="dimmed">
                选择适合你使用场景的格式。如果翻译过，还可以选择导出原文、译文或双语版本。
              </Text>
              {model.translationLanguages ? (
                <SegmentedControl
                  data={[
                    { value: 'original', label: '原文' },
                    { value: 'translated', label: '纯译文' },
                    { value: 'bilingual', label: '双语对照' },
                  ]}
                  value={exportTranslationMode}
                  onChange={(v) => setExportTranslationMode(v as TranslationExportMode)}
                  fullWidth
                />
              ) : null}
              {LIBRARY_EXPORT_OPTIONS.map((opt) => {
                if (!detail) return null;
                const url = buildLibraryExportDownloadUrl(
                  detail.sourceId, detail.metadata.novelId,
                  opt.format, exportTranslationMode,
                  model.translationLanguages?.sourceLang, model.translationLanguages?.targetLang,
                );
                return (
                  <Paper key={opt.format} p="md" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
                    <Group justify="space-between" mb={4}>
                      <div>
                        <Text fw={700}>{opt.label}</Text>
                        <Text size="xs" c="dimmed">{opt.summary}</Text>
                        <Text size="xs" c="dimmed">适合：{opt.bestFor} · {opt.example}</Text>
                      </div>
                      <Button
                        variant="filled"
                        size="compact-sm"
                        component="a"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onNotify({ tone: 'info', title: '导出已开始', message: `${opt.label} 下载中。` })}
                      >
                        下载 {opt.format.toUpperCase()}
                      </Button>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </Modal>
        ) : null}

        {/* ====== 知识图谱与 AI 伴读 —— 默认收起 ====== */}
        <Accordion
          variant="separated"
          radius="lg"
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
              border: '1px solid rgba(168, 133, 96, 0.18)',
              backdropFilter: 'blur(18px)',
            },
            label: {
              padding: 0,
            },
          }}
        >
          <Accordion.Item value="ai-assistant">
            <Accordion.Control>
              <Text size="sm" fw={600}>AI 伴读与知识图谱</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <LibraryIntelligencePanel
                detailPayload={model.detail!}
                location={model.location}
                onRefresh={model.refresh}
                onNotify={onNotify}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        {/* ====== 章节目录 ====== */}
        <div ref={chapterDirectoryRef} data-scrollspy id="detail-chapters" data-scrollspy-label="目录">
          <ChapterDirectory
            chapters={toLibraryDirectoryChapters(detail.chapters, {
              readingProgress: detail.readingProgress,
              bookmarks: detail.bookmarks,
            })}
            mode="inspect"
            loading={model.loading}
            title="章节目录"
            subtitle="已下载和未下载的章节都在这里；有图章节会直接标出图片数量和本地缓存情况。"
            emptyMessage="当前作品还没有已知章节目录。"
            onPickChapter={(chapterId) => model.openChapter(detail.sourceId, detail.metadata.novelId, chapterId)}
            management={isManual ? <ManualNovelManager novel={detail} onRefresh={() => model.refresh()} onOpenChapter={(chapterId) => model.openChapter(detail.sourceId, detail.metadata.novelId, chapterId)} onNotify={onNotify} /> : null}
            {...(!isManual ? { onRefetchChapter: (chapterId: string) => { void refetchLibraryChapter(detail.sourceId, detail.metadata.novelId, chapterId).then((result) => model.refresh().then(() => onNotify({ tone: result.changed ? 'success' : 'info', title: result.changed ? '章节已更新' : '章节内容无变化', message: result.changed ? '已写入新版本。' : '未写入新版本。' }))).catch((error: unknown) => onNotify({ tone: 'error', title: '更新失败', message: error instanceof Error ? error.message : '现有内容保持不变。' })); } } : {})}
          />
        </div>

        {/* ====== 页面快捷导航（汉堡菜单） ====== */}
        <PageNavPopover
          isOpen={isPageNavOpen}
          onClose={() => setIsPageNavOpen(false)}
          chapterDirectoryRef={chapterDirectoryRef}
          onOpenControl={onOpenControl}
        />

        <ActionIcon
          variant="filled" color="gray.7" size="lg" radius="xl"
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1001, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
          aria-label={isPageNavOpen ? '关闭页面导航' : '打开页面导航'}
          onClick={() => setIsPageNavOpen((o) => !o)}
        >
          {isPageNavOpen ? '✕' : '☰'}
        </ActionIcon>
      </Stack>
    </ScrollspyProvider>
  );
}

function schedulingStatusColor(detail: SchedulingNovelDetail): string {
  switch (detail.lastCheckResult) {
    case 'new_chapters': return '#4caf50';
    case 'error': return '#f44336';
    default: return 'dimmed';
  }
}

function schedulingStatusMessage(detail: SchedulingNovelDetail): string {
  if (detail.lastCheckResult === null) return '等待首次检查';
  if (detail.lastCheckResult === 'new_chapters') return detail.lastCheckMessage ?? '已自动下载';
  if (detail.lastCheckResult === 'up_to_date') {
    const ago = detail.lastCheckedAt ? formatSchedulingTimeAgo(detail.lastCheckedAt) : '未知时间';
    return `上次检查 ${ago} · 已是最新`;
  }
  if (detail.lastCheckResult === 'error') return '上次检查失败，下轮重试';
  return '';
}

function formatSchedulingTimeAgo(iso: string | null): string {
  if (!iso) return '未知时间';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diff / 3600000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}h 前`;
  return `${Math.round(hours / 24)}d 前`;
}

/** 汉堡菜单弹出面板 —— 使用 useScrollspy 动态列出所有注册面板 */
const DETAIL_SECTIONS: ScrollspySection[] = [
  { id: 'detail-hero', label: '概览' },
  { id: 'detail-task', label: '任务' },
  { id: 'detail-meta', label: '元数据' },
  { id: 'detail-tools', label: '工具' },
  { id: 'detail-chapters', label: '目录' },
];

function PageNavPopover({
  isOpen,
  onClose,
  chapterDirectoryRef,
  onOpenControl,
}: {
  isOpen: boolean;
  onClose: () => void;
  chapterDirectoryRef: React.RefObject<HTMLDivElement | null>;
  onOpenControl: () => void;
}) {
  const { register, sections } = useScrollspy();

  useEffect(() => {
    const cleanups = DETAIL_SECTIONS.map((s) => register(s));
    return () => cleanups.forEach((fn) => fn());
  }, [register]);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onClose();
  }

  function scrollToChapterDirectory() {
    chapterDirectoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <Paper
      p="sm"
      radius="lg"
      style={{
        position: 'fixed',
        bottom: 80,
        right: 24,
        zIndex: 1000,
        background: 'rgba(15,10,8,0.95)',
        border: '1px solid rgba(168,133,96,0.22)',
        boxShadow: '0 4px 24px rgba(10,6,4,0.6)',
        minWidth: 160,
        maxHeight: '65vh',
        overflow: 'auto',
      }}
    >
      <Stack gap={4}>
        <Button variant="subtle" size="compact-sm" color="gray"
          leftSection={<IconArrowUp size={14} />}
          onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); onClose(); }}>
          回到顶部
        </Button>

        {sections.map((s) => (
          <Button key={s.id} variant="subtle" size="compact-sm" color="gray"
            onClick={() => s.id === 'detail-chapters' ? scrollToChapterDirectory() : scrollTo(s.id)}>
            {s.label}
          </Button>
        ))}

        <Button variant="subtle" size="compact-sm" color="gray"
          leftSection={<IconArrowDown size={14} />}
          onClick={() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); onClose(); }}>
          直达底部
        </Button>

      </Stack>
    </Paper>
  );
}
