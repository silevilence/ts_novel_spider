import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconBook, IconFileDownload, IconBookmark, IconTag } from '@tabler/icons-react';

import { ChapterDirectory } from './chapter-directory';
import { LibraryIntelligencePanel } from './library-intelligence-panel';
import { TranslationLaunchPanel } from './translation-launch-panel';
import { ScrollspyNav, ScrollspyProvider } from './scrollspy-nav';
import type { LibraryModel } from '../services/library-model';
import {
  buildLibraryExportDownloadUrl,
  type LibraryExportFormat,
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
            <Button variant="default" size="compact-sm" onClick={() => void model.runIncrementalSync()} loading={model.syncBusy}>增量同步</Button>
            <Button variant="default" size="compact-sm" onClick={() => void model.syncMissingChapters()} loading={model.syncBusy}>补录缺失</Button>
            <Button variant="default" size="compact-sm" onClick={() => void model.redownloadAllDownloadedChapters()}
              loading={model.syncBusy} disabled={detail.stats.downloaded === 0}>全部重下</Button>
            {resumeChapterId ? (
              <Button color="brand" size="compact-sm" onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, resumeChapterId)}>
                {detail.readingProgress ? '继续阅读' : '开始阅读'}
              </Button>
            ) : null}
            <Tooltip label="别名管理"><ActionIcon variant="subtle" color="gray" onClick={() => document.getElementById('detail-alias')?.scrollIntoView({ behavior: 'smooth' })}><IconTag size={18} /></ActionIcon></Tooltip>
            <Tooltip label="书签管理"><ActionIcon variant="subtle" color="gray" onClick={() => document.getElementById('detail-bookmarks')?.scrollIntoView({ behavior: 'smooth' })}><IconBookmark size={18} /></ActionIcon></Tooltip>
            <Tooltip label="导出文件"><ActionIcon variant="subtle" color="gray" onClick={() => document.getElementById('detail-export')?.scrollIntoView({ behavior: 'smooth' })}><IconFileDownload size={18} /></ActionIcon></Tooltip>
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
            <Text size="xs" lineClamp={3}>{detailDescriptionPreview.text}</Text>
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

        {/* ====== 别名管理（聚合卡片） ====== */}
        <Paper p="md" radius="lg" data-scrollspy id="detail-alias" data-scrollspy-label="别名" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>别名映射</Text>
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
        </Paper>

        {/* ====== 书签管理（聚合到 Card） ====== */}
        <Paper p="md" radius="lg" data-scrollspy id="detail-bookmarks" data-scrollspy-label="书签" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>章节书签</Text>
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
                    <Text size="xs" c="dimmed">{bookmark.note || '没有备注。'}</Text>
                  ) : null}
                </Paper>
              ))}
            </Stack>
          )}
        </Paper>

        {/* ====== 导出中枢 ====== */}
        <Paper p="md" radius="lg" data-scrollspy id="detail-export" data-scrollspy-label="导出" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
          <Group justify="space-between" mb="xs">
            <div>
              <Text size="sm" fw={600}>导出文件</Text>
              <Text size="xs" c="dimmed">导出使用已采集的正文生成文件。</Text>
            </div>
            <Group gap="xs">
              <Badge variant="light" color="green">正文 {detail.stats.downloaded} 章</Badge>
              <Badge variant="light" color="gray">图片 {detail.media.cached}/{detail.media.total}</Badge>
              <Badge variant="light" color="yellow">3 种格式</Badge>
            </Group>
          </Group>
          <Button color="brand" size="compact-sm" mt="sm" onClick={() => setIsExportDialogOpen(true)} disabled={detail.stats.downloaded === 0}>选择导出格式</Button>
          <Text size="xs" c="dimmed" mt="sm">
            {detail.stats.downloaded === 0 ? '当前还没有已采集章节，先补录正文后才能导出文件。' : '一个入口按用途选格式：Markdown 整理、EPUB 阅读、TXT 备份。'}
          </Text>
        </Paper>

        {/* ====== 图片缓存（聚合卡片） ====== */}
        <Paper p="md" radius="lg" data-scrollspy id="detail-media" data-scrollspy-label="图片" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
          <Group justify="space-between" mb="xs">
            <div>
              <Text size="sm" fw={600}>图片缓存</Text>
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
        </Paper>

        {/* ====== 知识图谱与 AI 伴读 —— 默认收起 ====== */}
        <Accordion variant="separated" radius="lg">
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
          />
        </div>

        {/* ====== 底部导航按钮 ====== */}
        <Group>
          <Button variant="subtle" size="compact-sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部</Button>
          <Button variant="subtle" size="compact-sm" onClick={onOpenControl}>返回采集台</Button>
        </Group>

        {/* ====== 页面快捷导航浮窗 ====== */}
        {isPageNavOpen ? (
          <Paper p="sm" radius="lg" style={{ position: 'fixed', bottom: 80, right: 24, zIndex: 1000, background: 'rgba(15,10,8,0.95)', border: '1px solid rgba(168,133,96,0.22)', boxShadow: '0 4px 24px rgba(10,6,4,0.6)', minWidth: 140 }}>
            <Stack gap="xs">
              <Button variant="subtle" size="compact-sm" color="gray" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setIsPageNavOpen(false); }}>↑ 回到顶部</Button>
              <Button variant="subtle" size="compact-sm" color="gray" onClick={() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); setIsPageNavOpen(false); }}>↓ 直达底部</Button>
              <Button variant="subtle" size="compact-sm" color="gray" onClick={() => { scrollToChapterDirectory(); setIsPageNavOpen(false); }}>☰ 章节目录</Button>
            </Stack>
          </Paper>
        ) : null}

        <ActionIcon
          variant="filled" color="gray.7" size="lg" radius="xl"
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1001, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
          aria-label={isPageNavOpen ? '关闭页面导航' : '打开页面导航'}
          onClick={() => setIsPageNavOpen((o) => !o)}
        >
          {isPageNavOpen ? '✕' : '☰'}
        </ActionIcon>

        <ScrollspyNav />
      </Stack>
    </ScrollspyProvider>
  );
}
