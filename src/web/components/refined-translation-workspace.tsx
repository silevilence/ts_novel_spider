import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Affix,
  Alert,
  Badge,
  Button,
  Code,
  Collapse,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconArchive,
  IconArrowRight,
  IconFileDownload,
  IconMessageChatbot,
  IconPlayerPause,
  IconPlus,
  IconPlayerPlay,
  IconRefresh,
  IconRestore,
  IconSend,
  IconSparkles,
  IconTrash,
  IconWriting,
} from '@tabler/icons-react';

import {
  createRefinedTask,
  createRefinedTerm,
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
  refinedExportUrl,
  refinedTaskAction,
  resolveRefinedReview,
  retryRefinedFailedSegments,
  suggestRefinedTranslationGlossaryRevision,
  updateRefinedSegment,
  updateRefinedChapterTitle,
  updateRefinedTask,
  updateRefinedTerm,
  purgeRefinedTask,
  type LibraryExportFormat,
  type RefinedSegment,
  type RefinedChapterAgentMode,
  type RefinedTask,
  type RefinedTaskDetail,
  type RefinedTaskStage,
  type RefinedTerm,
  type TranslationExportMode,
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
type Review = { id: string; chapterId: string; severity: string; suggestion: string; replacementText: string | null; paragraphIndices: number[]; scores: Record<string, number>; resolved: boolean; resolution: 'open' | 'accepted' | 'partially_accepted' | 'rejected' | 'resolved' | 'ignored' | 'superseded'; resolutionNote: string | null };

const STAGE_LABEL: Record<string, string> = {
  glossary_setup: '确认术语候选',
  glossary_translation: '术语自动翻译',
  translating: '正文初翻',
  checking: '遗漏检查',
  reviewing: '审核校对',
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
  const [translationModelKeys, setTranslationModelKeys] = useState<string[]>([]);
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
        <SimpleGrid cols={2}>{([['termExtractionModel', '术语提取'], ['termTranslationModel', '术语翻译'], ['omissionModel', '遗漏判定'], ['reviewModel', '审核校对']] as const).map(([key, label]) => <Select key={key} label={label} data={modelOptions} clearable value={modelKeys[key] ?? null} onChange={(value) => setModelKeys((current) => ({ ...current, [key]: value ?? '' }))} />)}</SimpleGrid><MultiSelect label="正文初翻模型池" description="按段落轮转分配，配合任务并发数执行。" data={modelOptions} value={translationModelKeys} onChange={setTranslationModelKeys} clearable />
        <Button disabled={!newSource} onClick={() => {
          const [sourceId, novelId] = newSource.split('\u0000');
          if (!sourceId || !novelId) return;
          const route = (key: string) => {
            const [providerId, modelId] = (modelKeys[key] ?? '').split('\u0000');
            return providerId && modelId ? { providerId, modelId } : null;
          };
          const translationModels = translationModelKeys.flatMap((key) => { const [providerId, modelId] = key.split('\u0000'); return providerId && modelId ? [{ providerId, modelId }] : []; });
          void createRefinedTask({ sourceId, novelId, ...(newName.trim() ? { name: newName.trim() } : {}), ...(newSourceLang.trim() ? { sourceLang: newSourceLang.trim() } : {}), ...(newTargetLang.trim() ? { targetLang: newTargetLang.trim() } : {}), modelConfig: { termExtractionModel: route('termExtractionModel'), termTranslationModel: route('termTranslationModel'), translationModels, omissionModel: route('omissionModel'), reviewModel: route('reviewModel') } }).then(({ task }) => {
            setCreateOpen(false); setNewName(''); setNewSourceLang(''); setNewTargetLang(''); setModelKeys({}); setTranslationModelKeys([]); setSelectedId(task.id); void loadTasks();
            onNotify({ tone: 'success', title: '精翻任务已创建', message: '已将正文和术语候选快照到独立任务。' });
          }).catch((error: unknown) => onNotify({ tone: 'error', title: '创建失败', message: error instanceof Error ? error.message : '请稍后再试。' }));
        }}>创建并进入术语确认</Button>
      </Stack>
    </Modal>
  </Stack>;
}

function TaskCard({ task, selected, recycleBin, purgeStatus, onClick }: { task: RefinedTask; selected: boolean; recycleBin: boolean; purgeStatus?: PurgeStatus; onClick: () => void }) {
  return <Paper p="md" radius="md" onClick={onClick} style={{ cursor: 'pointer', border: selected ? '1px solid #ffd166' : '1px solid rgba(168,133,96,.18)', background: 'rgba(31,21,16,.72)' }}>
    <Group justify="space-between" wrap="nowrap"><Text fw={700} lineClamp={1}>{task.name}</Text><Badge color={task.deletedAt ? 'red' : task.status === 'completed' ? 'green' : task.status === 'needs_attention' ? 'orange' : 'yellow'}>{task.deletedAt ? '回收站' : task.status === 'completed' ? '已完成' : task.status === 'needs_attention' ? '需人工介入' : STAGE_LABEL[task.stage]}</Badge></Group>
    <Text size="xs" c="dimmed" mt={5}>{task.novelTitle}</Text>
    {task.progress ? <><Progress mt="xs" size="xs" value={task.progress.total ? task.progress.completed / task.progress.total * 100 : 0} color={task.progress.failed ? 'orange' : 'brand'} /><Text size="xs" c="dimmed" mt={3}>进度 {task.progress.completed}/{task.progress.total} 段{task.progress.failed ? ` · 失败 ${task.progress.failed}` : ''}</Text></> : null}
    {recycleBin && purgeStatus ? <Text size="xs" c={purgeStatus.canPurge ? 'red.3' : 'yellow.3'} mt={4}>标记于 {purgeStatus.deletedAt ? new Date(purgeStatus.deletedAt).toLocaleDateString() : '—'} · {purgeStatus.canPurge ? '已可永久删除' : `${purgeStatus.remainingDays} 天后可永久删除`}</Text> : null}
    <Text size="xs" c="dimmed" mt={4}>更新于 {new Date(task.updatedAt).toLocaleString()}</Text>
  </Paper>;
}

function TaskPanel({ detail, terms, chapterId, segments, reviews, recycleBin, purgeStatus, modelOptions, onSelectChapter, onSaveSegment, onRetrySegment, onResolveReview, onUpdateTerm, onBulkUpdateTerms, onCreateTerm, onDeleteTerm, onUpdateTask, onSuggestTerm, onSuggestSegment, onAction }: {
  detail: RefinedTaskDetail;
  terms: RefinedTerm[];
  chapterId: string | null;
  segments: RefinedSegment[];
  reviews: Review[];
  recycleBin: boolean;
  purgeStatus?: PurgeStatus;
  modelOptions: Array<{ value: string; label: string }>;
  onSelectChapter: (id: string) => Promise<void>;
  onSaveSegment: (index: number, text: string) => Promise<void>;
  onRetrySegment: (index: number) => Promise<void>;
  onResolveReview: (id: string, resolution: 'open' | 'resolved' | 'ignored') => Promise<void>;
  onUpdateTerm: (id: string, input: Partial<RefinedTerm>) => Promise<void>;
  onBulkUpdateTerms: (termIds: string[], status: 'confirmed' | 'excluded') => Promise<void>;
  onCreateTerm: (sourceTerm: string) => Promise<void>;
  onDeleteTerm: (termId: string) => Promise<void>;
  onUpdateTask: (input: { name?: string; sourceLang?: string; targetLang?: string; modelConfig?: RefinedTask['modelConfig'] }) => Promise<void>;
  onSuggestTerm: (termId: string, feedback: string) => Promise<string>;
  onSuggestSegment: (paragraphIndex: number, feedback: string) => Promise<string>;
  onAction: (action: TaskAction) => Promise<void>;
}) {
  const task = detail.task;
  const completed = detail.progress.translated + detail.progress.skipped;
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<LibraryExportFormat>('epub');
  const [exportMode, setExportMode] = useState<TranslationExportMode>('bilingual');
  const [exportScope, setExportScope] = useState<'completed' | 'all'>('all');
  const [paragraphJump, setParagraphJump] = useState('');
  const [suggestionTarget, setSuggestionTarget] = useState<{ kind: 'term'; term: RefinedTerm } | { kind: 'segment'; segment: RefinedSegment } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>('translation');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<RefinedTaskStage | null>(null);
  const [termQuery, setTermQuery] = useState('');
  const [termStatus, setTermStatus] = useState<'all' | RefinedTerm['status']>('all');
  const [termType, setTermType] = useState<string>('all');
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [newTerm, setNewTerm] = useState('');
  const [configureOpen, setConfigureOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [configName, setConfigName] = useState(task.name);
  const [configSourceLang, setConfigSourceLang] = useState(task.sourceLang);
  const [configTargetLang, setConfigTargetLang] = useState(task.targetLang);
  const [configConcurrency, setConfigConcurrency] = useState(String(task.modelConfig.concurrency));
  const [configRounds, setConfigRounds] = useState(String(task.modelConfig.maxReviewRounds));
  const [configModels, setConfigModels] = useState<Record<string, string>>({});
  const [configTranslationModels, setConfigTranslationModels] = useState<string[]>([]);
  const filteredTerms = terms.filter((term) => (termStatus === 'all' || term.status === termStatus) && (termType === 'all' || term.entityType === termType) && `${term.sourceTerm} ${term.targetTerm ?? ''} ${term.suggestion ?? ''}`.toLocaleLowerCase().includes(termQuery.trim().toLocaleLowerCase()));
  const termTypes = [...new Set(terms.map((term) => term.entityType).filter((type): type is string => Boolean(type)))];
  const checkpoint = selectedCheckpoint ? detail.checkpoints.find((item) => item.stage === selectedCheckpoint) : null;

  const requestSuggestion = async () => {
    if (!suggestionTarget || !feedback.trim()) return;
    setSuggesting(true);
    try {
      setSuggestion(suggestionTarget.kind === 'term'
        ? await onSuggestTerm(suggestionTarget.term.id, feedback)
        : await onSuggestSegment(suggestionTarget.segment.paragraphIndex, feedback));
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSuggestion = async () => {
    if (!suggestionTarget || !suggestion.trim()) return;
    if (suggestionTarget.kind === 'term') await onUpdateTerm(suggestionTarget.term.id, { targetTerm: suggestion, status: 'confirmed' });
    else await onSaveSegment(suggestionTarget.segment.paragraphIndex, suggestion);
    setSuggestionTarget(null); setFeedback(''); setSuggestion('');
  };

  const closeSuggestion = () => { setSuggestionTarget(null); setFeedback(''); setSuggestion(''); };
  const openConfiguration = () => {
    const toKey = (route: { providerId: string; modelId: string } | null | undefined) => route ? `${route.providerId}\u0000${route.modelId}` : '';
    setConfigName(task.name); setConfigSourceLang(task.sourceLang); setConfigTargetLang(task.targetLang); setConfigConcurrency(String(task.modelConfig.concurrency)); setConfigRounds(String(task.modelConfig.maxReviewRounds));
    setConfigModels({ termExtractionModel: toKey(task.modelConfig.termExtractionModel), termTranslationModel: toKey(task.modelConfig.termTranslationModel), omissionModel: toKey(task.modelConfig.omissionModel), reviewModel: toKey(task.modelConfig.reviewModel) }); setConfigTranslationModels((task.modelConfig.translationModels ?? []).map(toKey).filter(Boolean));
    setConfigureOpen(true);
  };
  const saveConfiguration = async () => {
    const toRoute = (key: string) => { const [providerId, modelId] = (configModels[key] ?? '').split('\u0000'); return providerId && modelId ? { providerId, modelId } : null; };
    const translationModels = configTranslationModels.flatMap((key) => { const [providerId, modelId] = key.split('\u0000'); return providerId && modelId ? [{ providerId, modelId }] : []; });
    await onUpdateTask({ name: configName, sourceLang: configSourceLang, targetLang: configTargetLang, modelConfig: { ...task.modelConfig, termExtractionModel: toRoute('termExtractionModel'), termTranslationModel: toRoute('termTranslationModel'), translationModels, omissionModel: toRoute('omissionModel'), reviewModel: toRoute('reviewModel'), concurrency: Math.max(1, Number(configConcurrency) || 1), maxReviewRounds: Math.max(1, Number(configRounds) || 1) } });
    setConfigureOpen(false);
  };
  const jumpToIssue = (paragraphIndex: number) => { setActiveTab('translation'); setTimeout(() => document.getElementById(`refined-segment-${paragraphIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); };

  return <Stack gap="md">
    <Group justify="space-between">
      <Stack gap={2}><Title order={3}>{task.name}</Title><Text size="sm" c="dimmed">{task.novelTitle} · {task.sourceLang} → {task.targetLang}</Text></Stack>
      <Group>
        {recycleBin ? <><Button color="green" variant="light" leftSection={<IconRestore size={15} />} onClick={() => void onAction('restore')}>恢复任务</Button>{purgeStatus?.canPurge ? <Button color="red" variant="light" leftSection={<IconTrash size={15} />} onClick={() => setPurgeConfirmOpen(true)}>永久删除</Button> : null}</> : <>
          <Button variant="default" size="compact-sm" leftSection={task.status === 'running' ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />} onClick={() => void onAction(task.status === 'running' ? 'pause' : 'resume')}>{task.status === 'running' ? '暂停' : task.stage === 'glossary_setup' ? '启动' : '继续'}</Button>
          <Button color="yellow" size="compact-sm" rightSection={<IconArrowRight size={14} />} onClick={() => void onAction('advance')}>下一步骤</Button>
          {detail.progress.failed ? <Button color="orange" variant="light" size="compact-sm" leftSection={<IconRefresh size={14} />} onClick={() => void onAction('retry-failed')}>重试失败段落</Button> : null}
          <Button variant="subtle" size="compact-sm" onClick={openConfiguration}>配置</Button>
          <ActionIcon color="red" variant="subtle" onClick={() => void onAction('delete')}><IconTrash size={17} /></ActionIcon>
        </>}
      </Group>
    </Group>
    <Progress value={detail.progress.total ? completed / detail.progress.total * 100 : 0} color="brand" />
    <Text size="xs" c="dimmed">{STAGE_LABEL[task.stage]} · 已完成 {completed}/{detail.progress.total} 段 · 失败 {detail.progress.failed} · 已审核章节 {detail.progress.reviewedChapters}/{detail.stepProgress.chapters.total} · 当前轮次 {detail.progress.currentRound}</Text>
    <Button variant="subtle" size="compact-sm" onClick={() => setWorkflowOpen((value) => !value)}>{workflowOpen ? '收起' : '展开'} 流程图</Button>
    <Collapse in={workflowOpen}><Stack gap="xs"><Group gap="xs" wrap="wrap">{detail.workflow.map((item, index) => <Group key={item.id} gap={4}><Paper p="xs" radius="sm" onClick={() => setSelectedCheckpoint(item.id)} style={{ cursor: 'pointer', border: item.id === task.stage ? '1px solid #ffd166' : '1px solid rgba(168,133,96,.3)', background: item.id === task.stage ? 'rgba(255,209,102,.12)' : 'transparent' }}><Text size="xs">{item.label}</Text></Paper>{index < detail.workflow.length - 1 ? <Text c="dimmed">→</Text> : null}</Group>)}</Group>{checkpoint ? <Paper p="xs" radius="sm"><Text size="xs" c="dimmed">{STAGE_LABEL[checkpoint.stage]} · {new Date(checkpoint.updatedAt).toLocaleString()}</Text><Code block>{JSON.stringify(checkpoint.state, null, 2)}</Code></Paper> : null}</Stack></Collapse>
    <Tabs value={activeTab} onChange={setActiveTab}>
      <Tabs.List><Tabs.Tab value="translation" leftSection={<IconWriting size={14} />}>译文对照</Tabs.Tab><Tabs.Tab value="glossary">术语表 ({terms.length})</Tabs.Tab><Tabs.Tab value="review">审核意见 ({reviews.length})</Tabs.Tab><Tabs.Tab value="log">操作日志</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="translation" pt="md">
        <SimpleGrid cols={{ base: 1, md: 5 }} mb="sm" spacing="xs">
          <Select label="章节" value={chapterId} onChange={(value) => value && void onSelectChapter(value)} data={detail.chapters.map((chapter) => ({ value: chapter.chapterId, label: `第 ${chapter.chapterIndex} 章 · ${chapter.title}` }))} />
          <TextInput label="跳转段落" value={paragraphJump} onChange={(event) => setParagraphJump(event.currentTarget.value)} rightSection={<ActionIcon variant="subtle" onClick={() => { const index = Number(paragraphJump) - 1; if (Number.isInteger(index) && index >= 0) jumpToIssue(index); }}>↵</ActionIcon>} placeholder="例如 12" />
          <Select label="格式" value={exportFormat} onChange={(value) => setExportFormat((value ?? 'epub') as LibraryExportFormat)} data={[{ value: 'epub', label: 'EPUB' }, { value: 'markdown', label: 'Markdown' }, { value: 'txt', label: 'TXT' }]} />
          <Select label="内容" value={exportMode} onChange={(value) => setExportMode((value ?? 'bilingual') as TranslationExportMode)} data={[{ value: 'bilingual', label: '双语对照' }, { value: 'translated', label: '仅译文' }, { value: 'original', label: '仅原文' }]} />
          <Select label="范围" value={exportScope} onChange={(value) => setExportScope(value === 'completed' ? 'completed' : 'all')} data={[{ value: 'all', label: '全部章节（未完成用原文）' }, { value: 'completed', label: '仅已完成章节' }]} />
        </SimpleGrid>
        <Group justify="flex-end" mb="sm"><Button component="a" href={refinedExportUrl(task.id, exportFormat, exportMode, exportScope === 'all')} leftSection={<IconFileDownload size={15} />}>导出当前结果</Button></Group>
        <ScrollArea h={460}><Stack gap="sm">{segments.map((segment) => <Paper id={`refined-segment-${segment.paragraphIndex}`} key={segment.paragraphIndex} p="sm" radius="sm" style={{ borderLeft: `3px solid ${segment.status === 'pending' ? '#ffd166' : segment.status === 'failed' ? '#ff6b6b' : '#63d4a6'}`, background: 'rgba(11,8,7,.28)' }}><SimpleGrid cols={{ base: 1, md: 2 }}><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{segment.sourceText}</Text><TranslationEditor segment={segment} recycleBin={recycleBin} onSave={onSaveSegment} onRetry={onRetrySegment} onSuggest={() => setSuggestionTarget({ kind: 'segment', segment })} /></SimpleGrid></Paper>)}</Stack></ScrollArea>
      </Tabs.Panel>
      <Tabs.Panel value="glossary" pt="md"><Stack gap="sm"><SimpleGrid cols={{ base: 1, sm: 3 }}><TextInput label="搜索" value={termQuery} onChange={(event) => setTermQuery(event.currentTarget.value)} placeholder="术语、译文或 AI 建议" /><Select label="状态" value={termStatus} onChange={(value) => setTermStatus((value ?? 'all') as typeof termStatus)} data={[{ value: 'all', label: '全部状态' }, { value: 'pending', label: '待确认' }, { value: 'confirmed', label: '已确认' }, { value: 'excluded', label: '已排除' }]} /><Select label="实体类型" value={termType} onChange={(value) => setTermType(value ?? 'all')} data={[{ value: 'all', label: '全部类型' }, ...termTypes.map((type) => ({ value: type, label: type }))]} /></SimpleGrid><Group><TextInput size="xs" value={newTerm} onChange={(event) => setNewTerm(event.currentTarget.value)} placeholder="新增源术语" disabled={recycleBin} /><Button size="compact-sm" disabled={recycleBin || !newTerm.trim()} onClick={() => { void onCreateTerm(newTerm.trim()); setNewTerm(''); }}>新增术语</Button><Button size="compact-sm" disabled={recycleBin || !selectedTerms.length} onClick={() => void onBulkUpdateTerms(selectedTerms, 'confirmed')}>批量确认</Button><Button size="compact-sm" variant="default" disabled={recycleBin || !selectedTerms.length} onClick={() => void onBulkUpdateTerms(selectedTerms, 'excluded')}>批量排除</Button><Text size="xs" c="dimmed">已选 {selectedTerms.length} 条 · 术语 {detail.stepProgress.glossary.confirmed}/{detail.stepProgress.glossary.total} 已确认</Text></Group><ScrollArea h={430}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th><input type="checkbox" checked={filteredTerms.length > 0 && filteredTerms.every((term) => selectedTerms.includes(term.id))} onChange={(event) => setSelectedTerms(event.currentTarget.checked ? [...new Set([...selectedTerms, ...filteredTerms.map((term) => term.id)])] : selectedTerms.filter((id) => !filteredTerms.some((term) => term.id === id)))} /></Table.Th><Table.Th>原术语</Table.Th><Table.Th>译文</Table.Th><Table.Th>类型 / 优先级</Table.Th><Table.Th>AI 建议</Table.Th><Table.Th>状态</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{filteredTerms.map((term) => <Table.Tr key={term.id}><Table.Td><input type="checkbox" checked={selectedTerms.includes(term.id)} onChange={(event) => setSelectedTerms((items) => event.currentTarget.checked ? [...items, term.id] : items.filter((id) => id !== term.id))} /></Table.Td><Table.Td>{term.sourceTerm}</Table.Td><Table.Td><TextInput key={`${term.id}:${term.targetTerm ?? ''}`} size="xs" defaultValue={term.targetTerm ?? ''} disabled={recycleBin} onBlur={(event) => void onUpdateTerm(term.id, { targetTerm: event.currentTarget.value, status: 'confirmed' })} /></Table.Td><Table.Td>{term.entityType ?? '—'} / {term.priority}</Table.Td><Table.Td><Text size="xs">{term.suggestion ?? '—'}</Text></Table.Td><Table.Td><Badge size="sm" color={term.status === 'confirmed' ? 'green' : term.status === 'excluded' ? 'gray' : 'yellow'}>{term.status === 'confirmed' ? '已确认' : term.status === 'excluded' ? '已排除' : '待确认'}</Badge></Table.Td><Table.Td><Group gap="xs"><Button size="compact-xs" variant="subtle" leftSection={<IconSparkles size={13} />} disabled={recycleBin} onClick={() => setSuggestionTarget({ kind: 'term', term })}>提意见</Button><ActionIcon color="red" variant="subtle" disabled={recycleBin} onClick={() => void onDeleteTerm(term.id)}><IconTrash size={14} /></ActionIcon></Group></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea></Stack></Tabs.Panel>
      <Tabs.Panel value="review" pt="md"><Stack gap="xs">{reviews.length ? reviews.map((review) => <Paper key={review.id} p="sm" radius="sm" style={{ borderLeft: `3px solid ${review.resolved ? '#63d4a6' : '#ff8c69'}` }}><Group justify="space-between"><Badge color={review.resolution === 'ignored' ? 'gray' : review.resolved ? 'green' : 'orange'}>{review.resolution === 'ignored' ? '已忽略' : review.resolved ? '已处理' : review.severity}</Badge><Group gap="xs">{review.resolved ? <Button size="compact-xs" variant="subtle" disabled={recycleBin} onClick={() => void onResolveReview(review.id, 'open')}>重新打开</Button> : <><Button size="compact-xs" variant="subtle" disabled={recycleBin} onClick={() => void onResolveReview(review.id, 'ignored')}>忽略</Button><Button size="compact-xs" variant="subtle" disabled={recycleBin} onClick={() => void onResolveReview(review.id, 'resolved')}>标记已处理</Button></>}</Group></Group><Text size="sm" mt="xs">{review.suggestion}</Text><Group gap="xs" mt="xs">{review.paragraphIndices.length ? review.paragraphIndices.map((index) => <Button key={index} size="compact-xs" variant="light" onClick={() => jumpToIssue(index)}>跳转第 {index + 1} 段</Button>) : <Text size="xs" c="dimmed">全章意见</Text>}</Group><Text size="xs" c="dimmed">{Object.entries(review.scores).map(([key, value]) => `${key} ${value}`).join(' / ')}</Text></Paper>) : <Text c="dimmed" ta="center" py="xl">该章尚无审核意见。</Text>}</Stack></Tabs.Panel>
      <Tabs.Panel value="log" pt="md"><Stack gap="xs">{detail.logs.map((log) => <Paper key={log.id} p="xs" radius="sm"><Text size="sm">{log.message}</Text><Text size="xs" c="dimmed">{new Date(log.createdAt).toLocaleString()}</Text></Paper>)}</Stack></Tabs.Panel>
    </Tabs>
    <Modal opened={suggestionTarget !== null} onClose={closeSuggestion} title="向 Agent 提意见" centered>
      <Stack>
        <Text size="sm" c="dimmed">{suggestionTarget?.kind === 'term' ? `术语：${suggestionTarget.term.sourceTerm}` : `段落 ${suggestionTarget ? suggestionTarget.segment.paragraphIndex + 1 : ''}`}</Text>
        <Textarea label="修改要求" value={feedback} onChange={(event) => setFeedback(event.currentTarget.value)} placeholder="例如：语气更克制，保留人物称谓。" minRows={3} />
        <Button loading={suggesting} disabled={!feedback.trim()} onClick={() => void requestSuggestion()}>生成建议</Button>
        {suggestion ? <><Textarea label="Agent 建议（可继续编辑）" value={suggestion} onChange={(event) => setSuggestion(event.currentTarget.value)} minRows={3} /><Group justify="flex-end"><Button variant="default" onClick={closeSuggestion}>取消</Button><Button onClick={() => void acceptSuggestion()}>确认采纳</Button></Group></> : null}
      </Stack>
    </Modal>
    <Modal opened={configureOpen} onClose={() => setConfigureOpen(false)} title="编辑任务配置" centered>
      <Stack>
        <TextInput label="任务名称" value={configName} onChange={(event) => setConfigName(event.currentTarget.value)} />
        <SimpleGrid cols={2}><TextInput label="源语言" value={configSourceLang} onChange={(event) => setConfigSourceLang(event.currentTarget.value)} /><TextInput label="目标语言" value={configTargetLang} onChange={(event) => setConfigTargetLang(event.currentTarget.value)} /></SimpleGrid>
        <SimpleGrid cols={2}>{([['termExtractionModel', '术语提取'], ['termTranslationModel', '术语翻译'], ['omissionModel', '遗漏判定'], ['reviewModel', '审核校对']] as const).map(([key, label]) => <Select key={key} label={label} clearable data={modelOptions} value={configModels[key] ?? null} onChange={(value) => setConfigModels((current) => ({ ...current, [key]: value ?? '' }))} />)}</SimpleGrid><MultiSelect label="正文初翻模型池" data={modelOptions} value={configTranslationModels} onChange={setConfigTranslationModels} clearable />
        <SimpleGrid cols={2}><TextInput label="正文并发数" value={configConcurrency} onChange={(event) => setConfigConcurrency(event.currentTarget.value)} /><TextInput label="最大审核轮次" value={configRounds} onChange={(event) => setConfigRounds(event.currentTarget.value)} /></SimpleGrid>
        <Button onClick={() => void saveConfiguration()}>保存配置</Button>
      </Stack>
    </Modal>
    <Modal opened={purgeConfirmOpen} onClose={() => setPurgeConfirmOpen(false)} title="永久删除精翻任务" centered>
      <Stack><Text>将永久清理该任务的原文快照、译文、术语、审核记录、checkpoint 与操作日志；此操作不可恢复。</Text><Group justify="flex-end"><Button variant="default" onClick={() => setPurgeConfirmOpen(false)}>取消</Button><Button color="red" onClick={() => { setPurgeConfirmOpen(false); void onAction('purge'); }}>确认永久删除</Button></Group></Stack>
    </Modal>
  </Stack>;
}

function TranslationEditor({ segment, recycleBin, onSave, onRetry, onSuggest }: { segment: RefinedSegment; recycleBin: boolean; onSave: (index: number, text: string) => Promise<void>; onRetry: (index: number) => Promise<void>; onSuggest: () => void }) {
  const [draft, setDraft] = useState(segment.translatedText ?? '');
  useEffect(() => setDraft(segment.translatedText ?? ''), [segment.paragraphIndex, segment.translatedText]);
  const changed = draft !== (segment.translatedText ?? '');
  return <Stack gap="xs"><Textarea autosize minRows={2} value={draft} placeholder="在此写入译文…" disabled={recycleBin} onChange={(event) => setDraft(event.currentTarget.value)} /><Group gap="xs"><Button size="compact-xs" disabled={recycleBin || !changed} onClick={() => void onSave(segment.paragraphIndex, draft)}>保存</Button><Button size="compact-xs" variant="default" disabled={recycleBin || !changed} onClick={() => setDraft(segment.translatedText ?? '')}>撤销未保存修改</Button>{segment.status === 'failed' ? <Button color="orange" size="compact-xs" disabled={recycleBin} onClick={() => void onRetry(segment.paragraphIndex)}>重试本段</Button> : null}<Button variant="subtle" size="compact-xs" leftSection={<IconSparkles size={14} />} disabled={recycleBin} onClick={onSuggest}>向 Agent 提意见</Button></Group></Stack>;
}
