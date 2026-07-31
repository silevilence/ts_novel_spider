import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArchive,
  IconArrowRight,
  IconPlus,
} from '@tabler/icons-react';

import {
  createRefinedTask,
  createRefinedTerm,
  bulkDeleteRefinedTerms,
  bulkUpdateRefinedTerms,
  chatWithRefinedChapterAgent,
  deleteRefinedTask,
  deleteRefinedTerm,
  extractRefinedTerms,
  fetchLibraryNovels,
  fetchLlmProvidersPreferences,
  fetchRefinedChapter,
  fetchRefinedPurgeStatus,
  fetchRefinedReviews,
  fetchRefinedTask,
  fetchRefinedTasks,
  fetchRefinedTerms,
  refinedTaskAction,
  resolveRefinedReview,
  retryRefinedFailedSegments,
  suggestRefinedTranslationGlossaryRevision,
  updateRefinedSegment,
  updateRefinedChapterTitle,
  updateRefinedTask,
  updateRefinedTerm,
  purgeRefinedTask,
  type RefinedSegment,
  type RefinedReview,
  type RefinedTask,
  type RefinedTaskDetail,
  type RefinedTerm,
} from '../services/api';
import { RefinedTranslationTaskPanel } from './refined-translation-task-panel';

interface Props {
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

interface PurgeStatus {
  canPurge: boolean;
  remainingDays: number;
  deletedAt: string | null;
}

type TaskAction = 'advance' | 'pause' | 'resume' | 'restore' | 'delete' | 'retry-failed' | 'purge';
type Review = RefinedReview;

const STAGE_LABEL: Record<string, string> = {
  glossary_setup: '确认术语候选',
  glossary_translation: '确认术语译法',
  translating: '正文初翻',
  checking: '遗漏检查',
  reviewing: '审核校对',
  revising: '审核修订',
  completed: '已完成',
};

export function RefinedTranslationWorkspace({ onNotify }: Props) {
  const [tasks, setTasks] = useState<RefinedTask[]>([]);
  const [purgeStatuses, setPurgeStatuses] = useState<Record<string, PurgeStatus>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RefinedTaskDetail | null>(null);
  const [terms, setTerms] = useState<RefinedTerm[]>([]);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const chapterIdRef = useRef<string | null>(null);
  const chapterSelectionVersionRef = useRef(0);
  const detailRequestVersionRef = useRef(0);
  const [segments, setSegments] = useState<RefinedSegment[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [recycleBin, setRecycleBin] = useState(false);
  const [novelOptions, setNovelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [modelKeys, setModelKeys] = useState<Record<string, string>>({});
  const [modelThinking, setModelThinking] = useState<Record<string, boolean>>({});
  const [translationModelKeys, setTranslationModelKeys] = useState<string[]>([]);
  const [translationThinking, setTranslationThinking] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newName, setNewName] = useState('');
  const [newSourceLang, setNewSourceLang] = useState('');
  const [newTargetLang, setNewTargetLang] = useState('');
  const [taskQuery, setTaskQuery] = useState('');
  const [taskStatus, setTaskStatus] = useState<'all' | 'running' | 'paused' | 'needs_attention' | 'completed'>('all');
  const filteredTasks = tasks.filter((task) => (taskStatus === 'all' || task.status === taskStatus) && `${task.name} ${task.novelTitle} ${task.author}`.toLocaleLowerCase().includes(taskQuery.trim().toLocaleLowerCase()));

  const loadTasks = async () => {
    try {
      const result = await fetchRefinedTasks(recycleBin);
      setTasks(result.tasks);
      if (recycleBin) {
        const entries = await Promise.all(result.tasks.map(async (task) => [task.id, await fetchRefinedPurgeStatus(task.id)] as const));
        setPurgeStatuses(Object.fromEntries(entries));
      } else {
        setPurgeStatuses({});
      }
      if (selectedId && !result.tasks.some((task) => task.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (error) {
      onNotify({ tone: 'error', title: '无法读取精翻任务', message: error instanceof Error ? error.message : '请稍后重试。' });
    }
  };

  const loadDetail = async (taskId: string) => {
    const requestVersion = ++detailRequestVersionRef.current;
    const selectionVersion = chapterSelectionVersionRef.current;
    try {
      const next = await fetchRefinedTask(taskId);
      setDetail(next);
      setSelectedId(taskId);
      const requestedChapterId = chapterIdRef.current;
      const activeChapterId = requestedChapterId && next.chapters.some((item) => item.chapterId === requestedChapterId) ? requestedChapterId : next.chapters[0]?.chapterId;
      const [termResult, chapter, reviewResult] = await Promise.all([
        fetchRefinedTerms(taskId),
        activeChapterId ? fetchRefinedChapter(taskId, activeChapterId) : Promise.resolve(null),
        fetchRefinedReviews(taskId),
      ]);
      if (requestVersion !== detailRequestVersionRef.current || selectionVersion !== chapterSelectionVersionRef.current) return;
      setTerms(termResult.terms);
      chapterIdRef.current = activeChapterId ?? null;
      setChapterId(activeChapterId ?? null);
      setSegments(chapter?.segments ?? []);
      setReviews(reviewResult.reviews);
    } catch (error) {
      onNotify({ tone: 'error', title: '无法打开任务', message: error instanceof Error ? error.message : '请稍后重试。' });
    }
  };

  useEffect(() => { void loadTasks(); }, [recycleBin]);
  useEffect(() => {
    void fetchLlmProvidersPreferences().then((providers) => setModelOptions(providers.providers.flatMap((provider) => provider.enabled ? provider.models.filter((model) => model.enabled && model.isConfigured && model.resolvedCapabilities.includes('chat')).map((model) => ({ value: `${provider.id}\u0000${model.modelId}`, label: `${provider.label} / ${model.modelId}` })) : [])));
  }, []);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId]);
  useEffect(() => {
    if (!selectedId) return undefined;
    const stream = new EventSource(`/api/refined-translations/tasks/${encodeURIComponent(selectedId)}/stream`);
    const refresh = () => { void loadDetail(selectedId); void loadTasks(); };
    stream.addEventListener('task_updated', refresh);
    stream.addEventListener('review_updated', refresh);
    stream.addEventListener('segment_updated', refresh);
    stream.onerror = () => { /* EventSource reconnects automatically; explicit refresh is reserved for next event. */ };
    return () => stream.close();
  }, [selectedId, recycleBin]);

  const openCreate = async () => {
    try {
      const [result, providers] = await Promise.all([fetchLibraryNovels(), fetchLlmProvidersPreferences()]);
      setNovelOptions(result.novels.filter((item) => item.downloadedChapters > 0).map((item) => ({ value: `${item.sourceId}\u0000${item.metadata.novelId}`, label: `${item.metadata.title}（已采集 ${item.downloadedChapters} 章）` })));
      setModelOptions(providers.providers.flatMap((provider) => provider.enabled ? provider.models.filter((model) => model.enabled && model.isConfigured && model.resolvedCapabilities.includes('chat')).map((model) => ({ value: `${provider.id}\u0000${model.modelId}`, label: `${provider.label} / ${model.modelId}` })) : []));
      setCreateOpen(true);
    } catch (error) {
      onNotify({ tone: 'error', title: '无法加载创建配置', message: error instanceof Error ? error.message : '请稍后重试。' });
    }
  };

  const selectChapter = async (id: string) => {
    if (!selectedId) return;
    const selectionVersion = ++chapterSelectionVersionRef.current;
    chapterIdRef.current = id;
    setChapterId(id);
    const chapter = await fetchRefinedChapter(selectedId, id);
    if (selectionVersion !== chapterSelectionVersionRef.current) return;
    setSegments(chapter.segments);
  };

  const saveSegment = async (index: number, text: string) => {
    if (!selectedId || !chapterId) return;
    await updateRefinedSegment(selectedId, chapterId, index, text);
    setSegments((current) => current.map((segment) => segment.paragraphIndex === index ? { ...segment, translatedText: text, status: text.trim() ? 'translated' : 'pending' } : segment));
  };

  const runAction = async (action: TaskAction) => {
    if (!selectedId) return;
    try {
      if (action === 'delete') {
        await deleteRefinedTask(selectedId);
        setDetail(null);
        setSelectedId(null);
      } else if (action === 'purge') {
        await purgeRefinedTask(selectedId);
        setDetail(null);
        setSelectedId(null);
      } else if (action === 'retry-failed') {
        await retryRefinedFailedSegments(selectedId);
      } else {
        await refinedTaskAction(selectedId, action);
      }
    } catch (error) {
      onNotify({ tone: 'error', title: '操作未完成', message: error instanceof Error ? error.message : '请稍后重试。' });
      return;
    }
    await loadTasks();
    if (action !== 'delete' && action !== 'purge') await loadDetail(selectedId);
  };

  return <Stack gap="lg">
    <Paper p="lg" radius="lg" style={{ background: 'linear-gradient(120deg, rgba(44,29,20,.92), rgba(25,18,15,.88))', border: '1px solid rgba(255,209,102,.25)' }}>
      <Group justify="space-between" align="flex-start">
        <Stack gap={3}>
          <Text size="xs" fw={700} c="yellow" tt="uppercase" style={{ letterSpacing: '.14em' }}>Refined Translation</Text>
          <Title order={2} style={{ fontFamily: 'Alegreya, Noto Serif SC, Georgia, serif' }}>精翻工作区</Title>
          <Text size="sm" c="dimmed">任务级原文快照、术语、译文与审核物料；与书库粗翻彼此独立。</Text>
        </Stack>
        <Group>
          <Button variant="subtle" color="gray" leftSection={<IconArchive size={16} />} onClick={() => setRecycleBin((value) => !value)}>{recycleBin ? '返回任务' : '回收站'}</Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => void openCreate()}>新建精翻任务</Button>
        </Group>
      </Group>
    </Paper>
    {detail ? <Stack gap="sm">
      <Group justify="space-between"><Button variant="subtle" leftSection={<IconArrowRight size={15} style={{ transform: 'rotate(180deg)' }} />} onClick={() => { setDetail(null); setSelectedId(null); }}>返回任务列表</Button><Text size="xs" c="dimmed">工作区使用完整宽度，便于阅读、校对与导出。</Text></Group>
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,.72)', border: '1px solid rgba(168,133,96,.18)' }}>
        <RefinedTranslationTaskPanel
          detail={detail}
          terms={terms}
          chapterId={chapterId}
          segments={segments}
          reviews={reviews}
          recycleBin={recycleBin}
          {...(purgeStatuses[detail.task.id] ? { purgeStatus: purgeStatuses[detail.task.id] } : {})}
          modelOptions={modelOptions}
          onSelectChapter={selectChapter}
          onSaveSegment={saveSegment}
          onSaveChapterTitle={async (translatedTitle) => { if (!selectedId || !chapterId) return; await updateRefinedChapterTitle(selectedId, chapterId, translatedTitle); await loadDetail(selectedId); }}
          onRetrySegment={async (paragraphIndex) => { if (!selectedId || !chapterId) return; await retryRefinedFailedSegments(selectedId, chapterId, paragraphIndex); await loadDetail(selectedId); }}
          onResolveReview={async (reviewId, resolution) => {
            if (!selectedId) return;
            await resolveRefinedReview(selectedId, reviewId, resolution);
            setReviews((items) => items.map((item) => item.id === reviewId ? { ...item, resolution, resolved: resolution !== 'open' } : item));
          }}
          onApplyReviewReplacement={async (review) => {
            if (!selectedId || !review.replacementText || review.paragraphIndices.length !== 1) return;
            const paragraphIndex = review.paragraphIndices[0]!;
            await updateRefinedSegment(selectedId, review.chapterId, paragraphIndex, review.replacementText);
            await resolveRefinedReview(selectedId, review.id, 'resolved');
            setReviews((items) => items.map((item) => item.id === review.id ? { ...item, resolution: 'accepted', resolutionNote: '已一键接受结构化替换文本。', resolved: true } : item));
            if (chapterId === review.chapterId) setSegments((items) => items.map((segment) => segment.paragraphIndex === paragraphIndex ? { ...segment, translatedText: review.replacementText!, status: 'translated' } : segment));
            onNotify({ tone: 'success', title: '已应用审核替换', message: `已替换第 ${paragraphIndex + 1} 段，并从待处理审核中移除。` });
          }}
          onUpdateTerm={async (termId, input) => {
            if (!selectedId) return;
            const result = await updateRefinedTerm(selectedId, termId, input);
            setTerms((current) => current.map((term) => term.id === termId ? result.term : term));
          }}
          onBulkUpdateTerms={async (termIds, status) => {
            if (!selectedId) return;
            const result = await bulkUpdateRefinedTerms(selectedId, termIds, status);
            setTerms((current) => current.map((term) => result.terms.find((updated) => updated.id === term.id) ?? term));
          }}
          onBulkDeleteTerms={async (termIds) => {
            if (!selectedId) return;
            const result = await bulkDeleteRefinedTerms(selectedId, termIds);
            setTerms((current) => current.filter((term) => !result.deletedIds.includes(term.id)));
          }}
          onCreateTerm={async (sourceTerm) => { if (!selectedId) return; const result = await createRefinedTerm(selectedId, { sourceTerm }); setTerms((current) => [...current, result.term]); }}
          onDeleteTerm={async (termId) => { if (!selectedId) return; await deleteRefinedTerm(selectedId, termId); setTerms((current) => current.filter((term) => term.id !== termId)); }}
          onExtractTerms={async () => {
            if (!selectedId) return;
            try {
              const result = await extractRefinedTerms(selectedId);
              setTerms(result.terms);
              onNotify({ tone: 'success', title: '术语 AI 提取完成', message: `当前共有 ${result.terms.length} 条候选术语。` });
            } catch (error) {
              onNotify({ tone: 'error', title: '术语 AI 提取失败', message: error instanceof Error ? error.message : '请检查模型配置。' });
            }
          }}
          onUpdateTask={async (input) => {
            if (!selectedId) return;
            await updateRefinedTask(selectedId, input);
            await loadDetail(selectedId);
            await loadTasks();
          }}
          onSuggestTerm={async (termId, feedback) => selectedId ? (await suggestRefinedTranslationGlossaryRevision(selectedId, termId, feedback)).suggestion : ''}
          onAgentChat={async (input) => {
            if (!selectedId || !chapterId) throw new Error('请先选择章节。');
            return chatWithRefinedChapterAgent(selectedId, chapterId, input);
          }}
          onAction={runAction}
        />
      </Paper>
    </Stack> : <Stack gap="md">
      <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,.54)', border: '1px solid rgba(168,133,96,.18)' }}>
        <Group justify="space-between" align="flex-end"><Stack gap={2}><Title order={3}>{recycleBin ? '精翻任务回收站' : '全部精翻任务'}</Title><Text size="sm" c="dimmed">按任务快速筛选；选择卡片后进入全宽工作区。</Text></Stack><Text size="sm" c="yellow">共 {filteredTasks.length} 个任务</Text></Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm"><TextInput value={taskQuery} onChange={(event) => setTaskQuery(event.currentTarget.value)} label="搜索任务" placeholder="任务名、小说名或作者" /><Select label="任务状态" value={taskStatus} onChange={(value) => setTaskStatus((value ?? 'all') as typeof taskStatus)} data={[{ value: 'all', label: '全部状态' }, { value: 'running', label: '正在处理' }, { value: 'paused', label: '已暂停' }, { value: 'needs_attention', label: '待任务结束后复核' }, { value: 'completed', label: '已完成' }]} /></SimpleGrid>
      </Paper>
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="lg">
        {filteredTasks.map((task) => <TaskCard key={task.id} task={task} selected={false} recycleBin={recycleBin} {...(purgeStatuses[task.id] ? { purgeStatus: purgeStatuses[task.id] } : {})} onClick={() => setSelectedId(task.id)} />)}
      </SimpleGrid>
      {!filteredTasks.length ? <Paper p="xl" radius="md"><Text c="dimmed" ta="center">{tasks.length ? '没有符合当前筛选条件的任务。' : recycleBin ? '回收站为空。' : '还没有精翻任务。'}</Text></Paper> : null}
    </Stack>}
    <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="从已抓取小说创建精翻任务" centered>
      <Stack>
        <Select label="翻译源" data={novelOptions} value={newSource} onChange={(value) => setNewSource(value ?? '')} searchable />
        <TextInput label="任务名称（可留空）" value={newName} onChange={(event) => setNewName(event.currentTarget.value)} placeholder="默认：小说名 精翻任务 日期" />
        <SimpleGrid cols={2}><TextInput label="源语言（留空继承偏好）" value={newSourceLang} onChange={(event) => setNewSourceLang(event.currentTarget.value)} placeholder="ja" /><TextInput label="目标语言（留空继承偏好）" value={newTargetLang} onChange={(event) => setNewTargetLang(event.currentTarget.value)} placeholder="zh-CN" /></SimpleGrid>
        <Text size="xs" c="dimmed">未选择时自动继承全局翻译模型。可分别覆盖任务内各自动步骤。</Text>
        <SimpleGrid cols={2}>{([['termExtractionModel', '术语提取'], ['termTranslationModel', '术语翻译'], ['omissionModel', '遗漏判定'], ['reviewModel', '审核校对']] as const).map(([key, label]) => <Stack key={key} gap={4}><Select label={label} data={modelOptions} clearable value={modelKeys[key] ?? null} onChange={(value) => setModelKeys((current) => ({ ...current, [key]: value ?? '' }))} /><Checkbox size="xs" label="启用模型思考" checked={modelThinking[key] ?? false} disabled={!modelKeys[key]} onChange={(event) => { const enabled = event.currentTarget.checked; setModelThinking((current) => ({ ...current, [key]: enabled })); }} /></Stack>)}</SimpleGrid><Stack gap={4}><MultiSelect label="正文初翻模型池" description="按段落轮转分配，配合任务并发数执行。" data={modelOptions} value={translationModelKeys} onChange={setTranslationModelKeys} clearable /><Checkbox size="xs" label="正文初翻启用模型思考" checked={translationThinking} disabled={!translationModelKeys.length} onChange={(event) => setTranslationThinking(event.currentTarget.checked)} /></Stack><Text size="xs" c="dimmed">仅在所选模型支持原生思考时开启；翻译、审核等步骤可分别设置。</Text>
        <Button disabled={!newSource} onClick={() => {
          const [sourceId, novelId] = newSource.split('\u0000');
          if (!sourceId || !novelId) return;
          const route = (key: string) => {
            const [providerId, modelId] = (modelKeys[key] ?? '').split('\u0000');
            return providerId && modelId ? { providerId, modelId, ...(modelThinking[key] ? { thinkingEnabled: true } : {}) } : null;
          };
          const translationModels = translationModelKeys.flatMap((key) => { const [providerId, modelId] = key.split('\u0000'); return providerId && modelId ? [{ providerId, modelId, ...(translationThinking ? { thinkingEnabled: true } : {}) }] : []; });
          void createRefinedTask({ sourceId, novelId, ...(newName.trim() ? { name: newName.trim() } : {}), ...(newSourceLang.trim() ? { sourceLang: newSourceLang.trim() } : {}), ...(newTargetLang.trim() ? { targetLang: newTargetLang.trim() } : {}), modelConfig: { termExtractionModel: route('termExtractionModel'), termTranslationModel: route('termTranslationModel'), translationModels, omissionModel: route('omissionModel'), reviewModel: route('reviewModel') } }).then(({ task }) => {
            setCreateOpen(false); setNewName(''); setNewSourceLang(''); setNewTargetLang(''); setModelKeys({}); setModelThinking({}); setTranslationModelKeys([]); setTranslationThinking(false); setSelectedId(task.id); void loadTasks();
            onNotify({ tone: 'success', title: '精翻任务已创建', message: '已将正文和术语候选快照到独立任务。' });
          }).catch((error: unknown) => onNotify({ tone: 'error', title: '创建失败', message: error instanceof Error ? error.message : '请稍后再试。' }));
        }}>创建并进入术语确认</Button>
      </Stack>
    </Modal>
  </Stack>;
}

function TaskCard({ task, selected, recycleBin, purgeStatus, onClick }: { task: RefinedTask; selected: boolean; recycleBin: boolean; purgeStatus?: PurgeStatus; onClick: () => void }) {
  return <Paper p="md" radius="md" onClick={onClick} style={{ cursor: 'pointer', border: selected ? '1px solid #ffd166' : '1px solid rgba(168,133,96,.18)', background: 'rgba(31,21,16,.72)' }}>
    <Group justify="space-between" wrap="nowrap" align="flex-start"><Text fw={700} lineClamp={1} style={{ minWidth: 0, flex: 1 }}>{task.name}</Text><Badge style={{ flexShrink: 0, whiteSpace: 'nowrap' }} color={task.deletedAt ? 'red' : task.status === 'completed' ? 'green' : task.status === 'needs_attention' ? 'orange' : 'yellow'}>{task.deletedAt ? '回收站' : task.status === 'completed' ? '已完成' : task.status === 'needs_attention' ? '需人工介入' : STAGE_LABEL[task.stage]}</Badge></Group>
    <Text size="xs" c="dimmed" mt={5}>{task.novelTitle}</Text>
    {task.progress ? <><Progress mt="xs" size="xs" value={task.progress.total ? task.progress.completed / task.progress.total * 100 : 0} color={task.progress.failed ? 'orange' : 'brand'} /><Text size="xs" c="dimmed" mt={3}>进度 {task.progress.completed}/{task.progress.total} 段{task.progress.failed ? ` · 失败 ${task.progress.failed}` : ''}</Text></> : null}
    {recycleBin && purgeStatus ? <Text size="xs" c={purgeStatus.canPurge ? 'red.3' : 'yellow.3'} mt={4}>标记于 {purgeStatus.deletedAt ? new Date(purgeStatus.deletedAt).toLocaleDateString() : '—'} · {purgeStatus.canPurge ? '已可永久删除' : `${purgeStatus.remainingDays} 天后可永久删除`}</Text> : null}
    <Text size="xs" c="dimmed" mt={4}>更新于 {new Date(task.updatedAt).toLocaleString()}</Text>
  </Paper>;
}
