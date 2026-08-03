import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Drawer, Group, Modal, NumberInput, Paper, Progress, SegmentedControl, Slider, Stack, Text, TextInput, Title } from '@mantine/core';
import MDEditor from '@uiw/react-md-editor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { ChapterDirectory } from './chapter-directory';
import { FontFamilyPicker } from './font-family-picker';
import { ReaderFabBar } from './reader-fab-bar';
import { TranslationProfilePanel } from './translation-profile-panel';
import type { LibraryModel } from '../services/library-model';
import { resolveManualAssetUrls, toLibraryDirectoryChapters } from '../services/library-view';
import { fetchLibraryChapterVersions, refetchLibraryChapter, restoreLibraryChapterVersion, saveManualLibraryChapter, type LibraryVersion } from '../services/api';

interface LibraryReaderViewProps {
  model: LibraryModel;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
  isReaderDirectoryOpen: boolean;
  setIsReaderDirectoryOpen: (v: boolean) => void;
  readerBookmarkNote: string;
  setReaderBookmarkNote: (v: string) => void;
  editingBookmarkId: string | null;
  setEditingBookmarkId: (v: string | null) => void;
  editingBookmarkNote: string;
  setEditingBookmarkNote: (v: string) => void;
  isReaderTypographyOpen: boolean;
  setIsReaderTypographyOpen: (v: boolean) => void;
  readerTypographyDraft: {
    fontSize: number; fontSizePreset: 'small' | 'medium' | 'large'; lineHeight: number;
    paragraphSpacing: number; fontFamilyPreset: 'sans' | 'serif' | 'monospace' | 'custom'; fontFamilyCustom: string;
  } | null;
  setReaderTypographyDraft: (v: LibraryReaderViewProps['readerTypographyDraft']) => void;
  readerTypographyDirty: boolean;
  setReaderTypographyDirty: (v: boolean) => void;
  isTranslationPanelOpen: boolean;
  setIsTranslationPanelOpen: (v: boolean) => void;
}

export function LibraryReaderView(props: LibraryReaderViewProps) {
  const { model, onNotify, isReaderDirectoryOpen, setIsReaderDirectoryOpen, readerBookmarkNote, setReaderBookmarkNote,
    editingBookmarkId, setEditingBookmarkId, editingBookmarkNote, setEditingBookmarkNote,
    isReaderTypographyOpen, setIsReaderTypographyOpen, readerTypographyDraft, setReaderTypographyDraft,
    readerTypographyDirty, setReaderTypographyDirty, isTranslationPanelOpen, setIsTranslationPanelOpen } = props;

  const detail = model.detail?.novel;
  const chapter = model.chapter?.chapter;
  const readerChapter = model.chapter?.chapter.chapter;
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [pendingAssets, setPendingAssets] = useState<PendingManualAsset[]>([]);
  const [chapterHistoryOpen, setChapterHistoryOpen] = useState(false);
  const [chapterVersions, setChapterVersions] = useState<LibraryVersion[]>([]);
  const pendingAssetsRef = useRef<PendingManualAsset[]>([]);

  const discardPendingAssets = () => {
    setPendingAssets((current) => {
      current.forEach((asset) => URL.revokeObjectURL(asset.objectUrl));
      return [];
    });
  };
  const closeContentEditor = () => {
    if (readerChapter && contentDraft !== readerChapter.content && !window.confirm('有未保存的修改，确定放弃吗？')) return;
    discardPendingAssets();
    setEditingContent(false);
    setContentDraft(readerChapter?.content ?? '');
  };

  useEffect(() => { pendingAssetsRef.current = pendingAssets; }, [pendingAssets]);
  useEffect(() => () => { pendingAssetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.objectUrl)); }, []);
  useEffect(() => {
    if (!readerChapter) return;
    discardPendingAssets();
    setEditingContent(false);
    setContentDraft(readerChapter.content);
  }, [readerChapter?.id, readerChapter?.content]);
  useEffect(() => {
    if (chapterHistoryOpen && detail && readerChapter) {
      void fetchLibraryChapterVersions(detail.sourceId, detail.metadata.novelId, readerChapter.id).then(setChapterVersions).catch(() => setChapterVersions([]));
    }
  }, [chapterHistoryOpen, detail?.sourceId, detail?.metadata.novelId, readerChapter?.id]);

  if (!detail) return null;
  if (!chapter || !readerChapter) {
    return <Paper p="lg" radius="lg"><Text c="dimmed">{model.loading ? '加载中...' : model.errorMessage ?? '章节未下载。'}</Text></Paper>;
  }
  const currentChapterBookmarks = detail.bookmarks.filter((b) => b.chapterId === model.location.chapterId);
  const isManual = detail.sourceId === 'manual';
  const renderedChapterContent = isManual
    ? resolveManualAssetUrls(readerChapter.content, detail.metadata.novelId)
    : readerChapter.content;

  return (
    <Stack gap="md">
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>离线阅读</Text>
          <Title order={2} style={{ fontFamily: 'Alegreya, Noto Serif SC, Georgia, serif' }}>{readerChapter.title}</Title>
          <Text size="sm" c="dimmed">{detail.metadata.title} / {detail.metadata.author || '未知作者'}</Text>
        </Stack>
        <Group mt="md" wrap="wrap">
          <Button variant="subtle" size="compact-sm" onClick={() => model.openNovel(detail.sourceId, detail.metadata.novelId)}>返回详情</Button>
          {chapter.previousChapterId ? <Button variant="default" size="compact-sm" onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.previousChapterId!)}>上一章</Button> : null}
          {chapter.nextChapterId ? <Button variant="default" size="compact-sm" onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.nextChapterId!)}>下一章</Button> : null}
          <Button variant="subtle" size="compact-sm" onClick={() => setIsReaderDirectoryOpen(true)}>打开目录</Button>
          {isManual ? <Button variant="default" size="compact-sm" onClick={() => setEditingContent(true)}>编辑正文</Button> : null}
          {!isManual ? <Button variant="default" size="compact-sm" onClick={() => void refetchLibraryChapter(detail.sourceId, detail.metadata.novelId, readerChapter.id).then((result) => model.refresh().then(() => onNotify({ tone: result.changed ? 'success' : 'info', title: result.changed ? '章节已更新' : '章节内容无变化', message: result.changed ? '远端内容已保存为新版本，翻译会在下次继续时更新。' : '未写入新版本。' }))).catch((error: unknown) => onNotify({ tone: 'error', title: '更新失败', message: error instanceof Error ? error.message : '现有内容保持不变。' }))}>重新抓取本章</Button> : null}
          <Button variant="subtle" size="compact-sm" onClick={() => setChapterHistoryOpen(true)}>章节历史</Button>
          <Button color="brand" size="compact-sm" onClick={() => { void model.addBookmark(readerChapter.id, readerBookmarkNote); setReaderBookmarkNote(''); }}
            loading={model.mutationBusyKey === 'bookmark-create'}>加入书签</Button>
        </Group>
        {/* 阅读进度 + 双语模式 */}
        <Group mt="sm" gap="xs" wrap="wrap" justify="space-between">
          <Group gap="xs">
            <Text size="xs" c="dimmed">阅读进度</Text>
            <div style={{ width: 80, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, Math.round((readerChapter.index / detail.metadata.chapterCount) * 100))}%`, height: '100%', background: 'linear-gradient(90deg, #61d4a6, #ff8c42)', borderRadius: 2, transition: 'width 300ms ease' }} />
            </div>
            <Text size="xs" c="dimmed">{readerChapter.index}/{detail.metadata.chapterCount}</Text>
          </Group>
          {model.translationViewMode !== undefined ? (
            <SegmentedControl
              size="xs"
              data={[
                { value: 'original', label: '原文' },
                { value: 'translated', label: '译文' },
                { value: 'bilingual', label: '双语' },
              ]}
              value={model.translationViewMode}
              onChange={(v) => model.setTranslationViewMode(v as 'original' | 'translated' | 'bilingual')}
            />
          ) : null}
        </Group>
      </Paper>

      <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,0.6)', border: '1px solid rgba(168,133,96,0.12)' }}>
        <Group mb="xs"><Badge variant="light" color="green">第 {readerChapter.index} 章</Badge>
          {detail.readingProgress ? <Badge variant="light" color="gray">最高第 {detail.readingProgress.highestChapterIndex} 章</Badge> : null}</Group>
        <TextInput value={readerBookmarkNote} onChange={(e) => setReaderBookmarkNote(e.target.value)} placeholder="书签备注" mb="xs" />
        {currentChapterBookmarks.map((b) => (
          <Paper key={b.id} p="xs" radius="md" mb="xs" style={{ background: 'rgba(38,26,20,0.6)' }}>
            <Group justify="space-between">
              <div><Text size="sm" fw={600}>{b.note || '无备注'}</Text><Text size="xs" c="dimmed">{new Date(b.updatedAt).toLocaleString('zh-CN')}</Text></div>
              {editingBookmarkId === b.id ? (
                <Group gap="xs"><TextInput size="xs" value={editingBookmarkNote} onChange={(e) => setEditingBookmarkNote(e.target.value)} />
                  <Button size="compact-xs" color="brand" onClick={() => { void model.editBookmark(b.id, editingBookmarkNote); setEditingBookmarkId(null); }} loading={model.mutationBusyKey === `bookmark:${b.id}`}>保存</Button>
                  <Button size="compact-xs" variant="subtle" onClick={() => setEditingBookmarkId(null)}>取消</Button></Group>
              ) : (
                <Group gap="xs"><Button variant="subtle" size="compact-xs" onClick={() => { setEditingBookmarkId(b.id); setEditingBookmarkNote(b.note); }}>编辑</Button>
                  <Button variant="subtle" size="compact-xs" color="red" onClick={() => void model.removeBookmark(b.id)} loading={model.mutationBusyKey === `bookmark:${b.id}`}>删除</Button></Group>
              )}
            </Group>
          </Paper>
        ))}
      </Paper>

      <Paper p="lg" radius="lg" maw={760} mx="auto" w="100%" style={{ background: 'rgba(38,26,20,0.7)', border: '1px solid rgba(168,133,96,0.12)' }}>
        <Group mb="md"><Badge variant="light" color="gray">{chapter.mediaAssets.length} 张图片</Badge>
          <Text size="xs" c="dimmed">{chapter.mediaAssets.length === 0 ? '无图片。' : `已缓存 ${readerChapter.media.cached} 张。`}</Text></Group>
        <div className="reader-copy" style={{ fontSize: `${model.readerTypography?.fontSize ?? 1.03}rem`, lineHeight: model.readerTypography?.lineHeight ?? 1.9, fontFamily: resolveReaderFontFamily(model.readerTypography) }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{ img: ({ src, alt }) => <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', borderRadius: 14 }} /> }}>{renderedChapterContent}</ReactMarkdown>
        </div>
        <Group justify="center" mt="lg">
          {chapter.previousChapterId ? <Button variant="default" size="compact-sm" onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.previousChapterId!)}>上一章</Button> : <div style={{ width: 80 }} />}
          <Button variant="subtle" size="compact-sm" onClick={() => setIsReaderDirectoryOpen(true)}>章节目录</Button>
          {chapter.nextChapterId ? <Button variant="default" size="compact-sm" onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.nextChapterId!)}>下一章</Button> : <div style={{ width: 80 }} />}
        </Group>
      </Paper>

      <Modal opened={editingContent} onClose={closeContentEditor} title="编辑 Markdown 正文" size="xl" lockScroll={false}>
        <Stack><MDEditor className="manual-markdown-editor" data-color-mode="dark" value={contentDraft} onChange={(value) => setContentDraft(value ?? '')} height={520} preview="live" />
          <Group><Button component="label" variant="light" size="compact-sm">插入图片<input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple onChange={(event) => { void Promise.all([...event.currentTarget.files ?? []].map(readManualImage)).then((assets) => { const valid = assets.filter((asset): asset is NonNullable<typeof asset> => asset !== null); setPendingAssets((current) => [...current, ...valid]); setContentDraft((current) => `${current}${current.endsWith('\n') || !current ? '' : '\n\n'}${valid.map((asset) => `![图片](${asset.objectUrl})`).join('\n\n')}`); }); event.currentTarget.value = ''; }} /></Button><Text size="xs" c="dimmed">保存时会上传图片并替换为 manual:// 引用。</Text></Group>
          <Group justify="flex-end"><Button variant="subtle" onClick={closeContentEditor}>取消</Button><Button onClick={() => { const content = pendingAssets.reduce((value, asset) => value.replaceAll(asset.objectUrl, `manual://${asset.id}`), contentDraft); void saveManualLibraryChapter(detail.metadata.novelId, { chapterId: readerChapter.id, title: readerChapter.title, ...(readerChapter.volumeTitle ? { volumeTitle: readerChapter.volumeTitle } : {}), content, assets: pendingAssets.map(({ id, mimeType, base64 }) => ({ id, mimeType, base64 })) }).then((result) => { if (!result.changed) { onNotify({ tone: 'info', title: '内容无变化，未保存', message: '当前草稿与已保存版本相同。' }); return; } discardPendingAssets(); setEditingContent(false); onNotify({ tone: 'success', title: '正文已保存', message: '已创建新的章节版本。' }); return model.refresh(); }).catch((error: unknown) => onNotify({ tone: 'error', title: '保存失败', message: error instanceof Error ? error.message : '草稿仍保留，可再次保存。' })); }}>保存</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={chapterHistoryOpen} onClose={() => setChapterHistoryOpen(false)} title="章节版本历史"><Stack>{chapterVersions.length ? chapterVersions.map((version) => <Paper key={version.version} p="sm"><Group justify="space-between"><div><Text fw={600}>{version.version === 0 ? '初始版本 v0' : `版本 v${version.version}`}</Text><Text size="xs" c="dimmed">{new Date(version.createdAt).toLocaleString('zh-CN')}</Text></div><Button size="compact-xs" variant="light" onClick={() => { if (!window.confirm(`还原到 v${version.version}？`)) return; void restoreLibraryChapterVersion(detail.sourceId, detail.metadata.novelId, readerChapter.id, version.version).then(() => model.refresh()).then(() => { setChapterHistoryOpen(false); onNotify({ tone: 'success', title: '章节已还原', message: '已创建新的版本。' }); }).catch((error: unknown) => onNotify({ tone: 'error', title: '还原失败', message: error instanceof Error ? error.message : '请稍后重试。' })); }}>还原</Button></Group></Paper>) : <Text c="dimmed">暂无历史版本。</Text>}</Stack></Modal>

      <ReaderFabBar items={[
        { key: 'typography', label: '排版', ariaLabel: '调整排版', onClick: () => {
          if (model.readerTypography) { setReaderTypographyDraft({ fontSize: model.readerTypography.fontSize, fontSizePreset: model.readerTypography.fontSizePreset, lineHeight: model.readerTypography.lineHeight, paragraphSpacing: model.readerTypography.paragraphSpacing, fontFamilyPreset: model.readerTypography.fontFamilyPreset, fontFamilyCustom: model.readerTypography.fontFamilyCustom }); setReaderTypographyDirty(false); }
          setIsReaderTypographyOpen(true);
        }},
        { key: 'directory', label: '目录', ariaLabel: '章节目录', onClick: () => setIsReaderDirectoryOpen(true) },
        { key: 'translation', label: '翻译', ariaLabel: '翻译设置', onClick: () => setIsTranslationPanelOpen(true), accent: model.translationViewMode !== 'original' },
      ]} />

      {isReaderTypographyOpen && model.readerTypography && readerTypographyDraft ? (
        <Modal opened={isReaderTypographyOpen} onClose={() => setIsReaderTypographyOpen(false)} title="阅读器排版" size="sm">
          <Stack gap="md">
            <Text size="xs" c="dimmed">{model.readerTypography.source === 'novel' ? '当前书独立配置' : '跟随全局默认'}{readerTypographyDirty ? ' · 未保存' : ''}</Text>
            <SegmentedControl data={[{ value: 'small', label: '小' }, { value: 'medium', label: '中' }, { value: 'large', label: '大' }]}
              value={readerTypographyDraft.fontSizePreset}
              onChange={(v) => { const sizes: Record<string, number> = { small: 0.95, medium: 1.03, large: 1.16 }; setReaderTypographyDraft({ ...readerTypographyDraft, fontSize: sizes[v] ?? 1.03, fontSizePreset: v as 'small' | 'medium' | 'large' }); setReaderTypographyDirty(true); }} fullWidth />
            <NumberInput label="精确字号 (rem)" min={0.7} max={2.2} step={0.01} value={readerTypographyDraft.fontSize}
              onChange={(v) => { if (typeof v === 'number') { setReaderTypographyDraft({ ...readerTypographyDraft, fontSize: v }); setReaderTypographyDirty(true); } }}
              hideControls />
            <Text size="sm">行高：{readerTypographyDraft.lineHeight.toFixed(2)}</Text>
            <Slider min={1.2} max={3} step={0.05} value={readerTypographyDraft.lineHeight} onChange={(v) => { setReaderTypographyDraft({ ...readerTypographyDraft, lineHeight: v }); setReaderTypographyDirty(true); }} />
            <Text size="sm">段间距：{readerTypographyDraft.paragraphSpacing.toFixed(2)} rem</Text>
            <Slider min={0} max={3.5} step={0.05} value={readerTypographyDraft.paragraphSpacing} onChange={(v) => { setReaderTypographyDraft({ ...readerTypographyDraft, paragraphSpacing: v }); setReaderTypographyDirty(true); }} />
            <FontFamilyPicker preset={readerTypographyDraft.fontFamilyPreset} fontFamilyCustom={readerTypographyDraft.fontFamilyCustom}
              onPresetChange={(p) => { setReaderTypographyDraft({ ...readerTypographyDraft, fontFamilyPreset: p }); setReaderTypographyDirty(true); }}
              onCustomChange={(v) => { setReaderTypographyDraft({ ...readerTypographyDraft, fontFamilyCustom: v }); setReaderTypographyDirty(true); }} />
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => { void model.resetReaderTypography(); setIsReaderTypographyOpen(false); }}>恢复默认</Button>
              <Button color="brand" onClick={() => { void model.updateReaderTypography(readerTypographyDraft); setIsReaderTypographyOpen(false); }}>保存</Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}

      <Drawer
        opened={isReaderDirectoryOpen}
        onClose={() => setIsReaderDirectoryOpen(false)}
        title={<><Text size="xs" c="dimmed" tt="uppercase">章节目录</Text><Text size="lg" fw={700}>{detail.metadata.title}</Text></>}
        position="right"
        size="md"
        styles={{
          content: { background: 'rgba(15,10,8,0.97)', borderLeft: '1px solid rgba(168,133,96,0.18)' },
          header: { background: 'rgba(15,10,8,0.97)', borderBottom: '1px solid rgba(168,133,96,0.12)' },
        }}
      >
        <ChapterDirectory chapters={toLibraryDirectoryChapters(detail.chapters, { readingProgress: detail.readingProgress, bookmarks: detail.bookmarks })}
          mode="inspect" activeChapterId={readerChapter.id}
          loading={model.loading} title="章节目录" subtitle="点已下载章节就能切换阅读。" emptyMessage="暂无本地章节。"
          onPickChapter={(chapterId) => { model.openChapter(detail.sourceId, detail.metadata.novelId, chapterId); setIsReaderDirectoryOpen(false); }} />
      </Drawer>

      <Drawer
        opened={isTranslationPanelOpen}
        onClose={() => setIsTranslationPanelOpen(false)}
        title={<><Text size="xs" c="dimmed" tt="uppercase">翻译设置</Text><Text size="lg" fw={700}>翻译视图与导出</Text></>}
        position="right"
        size="md"
        styles={{
          content: { background: 'rgba(15,10,8,0.97)', borderLeft: '1px solid rgba(168,133,96,0.18)' },
          header: { background: 'rgba(15,10,8,0.97)', borderBottom: '1px solid rgba(168,133,96,0.12)' },
        }}
      >
        <TranslationProfilePanel model={model} onNotify={onNotify} />
      </Drawer>
    </Stack>
  );
}

function resolveReaderFontFamily(typography: { fontFamilyPreset: string; fontFamilyCustom: string } | null | undefined): string {
  if (!typography) return '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", sans-serif';
  switch (typography.fontFamilyPreset) {
    case 'serif': return '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", Georgia, serif';
    case 'monospace': return '"Noto Sans Mono CJK SC", "Source Han Mono SC", "Courier New", monospace';
    case 'custom': return typography.fontFamilyCustom || '"Noto Sans CJK SC", sans-serif';
    default: return '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", sans-serif';
  }
}

type PendingManualAsset = { id: string; mimeType: string; base64: string; objectUrl: string };

async function readManualImage(file: File): Promise<{ id: string; mimeType: string; base64: string; objectUrl: string } | null> {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
  const base64 = dataUrl.split(',', 2)[1];
  return base64 ? { id: crypto.randomUUID(), mimeType: file.type, base64, objectUrl: URL.createObjectURL(file) } : null;
}
