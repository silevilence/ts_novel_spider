import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ActionIcon,
  Affix,
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SegmentedControl,
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
  IconAlertTriangle,
  IconArrowRight,
  IconFileDownload,
  IconMessageChatbot,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconRestore,
  IconSend,
  IconSparkles,
  IconTrash,
  IconWriting,
} from '@tabler/icons-react';

import {
  type LibraryExportFormat,
  approveRefinedChapterAgentEdits,
  type RefinedChapterAgentEdit,
  type RefinedChapterAgentMode,
  type RefinedSegment,
  type RefinedTask,
  type RefinedTaskDetail,
  type RefinedTaskStage,
  type RefinedTerm,
  type TranslationExportMode,
  refinedExportUrl,
} from '../services/api';

interface PurgeStatus { canPurge: boolean; remainingDays: number; deletedAt: string | null; }
type TaskAction = 'advance' | 'pause' | 'resume' | 'restore' | 'delete' | 'retry-failed' | 'purge';
type ReviewResolution = 'open' | 'accepted' | 'partially_accepted' | 'rejected' | 'resolved' | 'ignored' | 'superseded';
type Review = { id: string; chapterId: string; reviewRound: number; severity: string; suggestion: string; replacementText: string | null; paragraphIndices: number[]; scores: Record<string, number>; forceChange: boolean; resolved: boolean; resolution: ReviewResolution; resolutionNote: string | null; createdAt: string };

const STAGE_LABEL: Record<string, string> = {
  glossary_setup: '确认术语候选', glossary_translation: '确认术语译文', translating: '正文初翻', checking: '遗漏检查', reviewing: '审核校对', revising: '审核修订', completed: '已完成',
};

type WorkflowNodeData = { label: string; active: boolean };
function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData, 'workflow'>>) {
  return <div style={{ width: 144, borderRadius: 12, border: data.active ? '2px solid #ffd166' : '1px solid rgba(99,212,166,.8)', color: '#f1e4d1', background: data.active ? 'rgba(255,209,102,.16)' : 'rgba(30,20,15,.94)', fontWeight: 700, textAlign: 'center', padding: '12px 8px', boxShadow: data.active ? '0 0 0 4px rgba(255,209,102,.08)' : 'none' }}>
    <Handle type="target" id="target-left" position={Position.Left} style={{ opacity: 0 }} /><Handle type="source" id="source-left" position={Position.Left} style={{ opacity: 0 }} />
    <Handle type="target" id="target-right" position={Position.Right} style={{ opacity: 0 }} /><Handle type="source" id="source-right" position={Position.Right} style={{ opacity: 0 }} />
    <Handle type="target" id="target-top" position={Position.Top} style={{ opacity: 0 }} /><Handle type="source" id="source-top" position={Position.Top} style={{ opacity: 0 }} />
    <Handle type="target" id="target-bottom" position={Position.Bottom} style={{ opacity: 0 }} /><Handle type="source" id="source-bottom" position={Position.Bottom} style={{ opacity: 0 }} />
    {data.label}
  </div>;
}
const workflowNodeTypes = { workflow: WorkflowNode };

interface Props {
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
  onSaveChapterTitle: (text: string) => Promise<void>;
  onRetrySegment: (index: number) => Promise<void>;
  onResolveReview: (id: string, resolution: ReviewResolution) => Promise<void>;
  onApplyReviewReplacement: (review: Review) => Promise<void>;
  onUpdateTerm: (id: string, input: Partial<RefinedTerm>) => Promise<void>;
  onBulkUpdateTerms: (termIds: string[], status: 'confirmed' | 'excluded') => Promise<void>;
  onBulkDeleteTerms: (termIds: string[]) => Promise<void>;
  onCreateTerm: (sourceTerm: string) => Promise<void>;
  onDeleteTerm: (termId: string) => Promise<void>;
  onExtractTerms: () => Promise<void>;
  onUpdateTask: (input: { name?: string; sourceLang?: string; targetLang?: string; modelConfig?: RefinedTask['modelConfig'] }) => Promise<void>;
  onSuggestTerm: (termId: string, feedback: string) => Promise<string>;
  onAgentChat: (input: { message: string; mode: RefinedChapterAgentMode; paragraphIndices?: number[]; history?: Array<{ role: 'user' | 'assistant'; content: string }> }) => Promise<{ reply: string; mode: RefinedChapterAgentMode; appliedParagraphIndices: number[]; proposedEdits: RefinedChapterAgentEdit[] }>;
  onAction: (action: TaskAction) => Promise<void>;
}

export function RefinedTranslationTaskPanel(props: Props) {
  const { detail, terms, chapterId, segments, reviews, recycleBin, purgeStatus, modelOptions } = props;
  const task = detail.task;
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<RefinedTaskStage | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>('translation');
  const [focusedParagraph, setFocusedParagraph] = useState<number | null>(null);
  const [paragraphJump, setParagraphJump] = useState('');
  const [exportFormat, setExportFormat] = useState<LibraryExportFormat>('epub');
  const [exportMode, setExportMode] = useState<TranslationExportMode>('bilingual');
  const [exportScope, setExportScope] = useState<'completed' | 'all'>('all');
  const [termQuery, setTermQuery] = useState('');
  const [termStatus, setTermStatus] = useState<'all' | RefinedTerm['status']>('all');
  const [termType, setTermType] = useState('all');
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [newTerm, setNewTerm] = useState('');
  const [termSuggestion, setTermSuggestion] = useState<RefinedTerm | null>(null);
  const [termFeedback, setTermFeedback] = useState('');
  const [termSuggestionText, setTermSuggestionText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentMode, setAgentMode] = useState<RefinedChapterAgentMode>('read');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentSending, setAgentSending] = useState(false);
  const [agentMessages, setAgentMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [pendingProposal, setPendingProposal] = useState<{ mode: Exclude<RefinedChapterAgentMode, 'read'>; edits: RefinedChapterAgentEdit[] } | null>(null);
  const [showHistoricalReviews, setShowHistoricalReviews] = useState(false);
  const [pendingReviewJump, setPendingReviewJump] = useState<{ chapterId: string; paragraphIndex: number } | null>(null);
  const [returnToReview, setReturnToReview] = useState(false);
  const [translationFilter, setTranslationFilter] = useState<'all' | 'review_required'>('all');
  const [metadataView, setMetadataView] = useState<'source' | 'translated'>('source');
  const [configName, setConfigName] = useState(task.name);
  const [configSourceLang, setConfigSourceLang] = useState(task.sourceLang);
  const [configTargetLang, setConfigTargetLang] = useState(task.targetLang);
  const [configConcurrency, setConfigConcurrency] = useState(String(task.modelConfig.concurrency));
  const [configRounds, setConfigRounds] = useState(String(task.modelConfig.maxReviewRounds));
  const [configModels, setConfigModels] = useState<Record<string, string>>({});
  const [configThinking, setConfigThinking] = useState<Record<string, boolean>>({});
  const [configTranslationModels, setConfigTranslationModels] = useState<string[]>([]);
  const [configTranslationThinking, setConfigTranslationThinking] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logViewportRef = useRef<HTMLDivElement>(null);

  const completedSegments = detail.progress.translated + detail.progress.skipped;
  const termTypes = useMemo(() => [...new Set(terms.map((term) => term.entityType).filter((value): value is string => Boolean(value)))], [terms]);
  const filteredTerms = terms.filter((term) => (termStatus === 'all' || term.status === termStatus) && (termType === 'all' || term.entityType === termType) && `${term.sourceTerm} ${term.targetTerm ?? ''} ${term.suggestion ?? ''}`.toLocaleLowerCase().includes(termQuery.trim().toLocaleLowerCase()));
  const checkpoint = selectedCheckpoint ? detail.checkpoints.find((item) => item.stage === selectedCheckpoint) : undefined;
  const latestStageCheckpoint = detail.checkpoints.find((item) => item.stage === task.stage);
  const currentChapterId = checkpointChapterId(latestStageCheckpoint?.state) ?? chapterId;
  const currentChapter = detail.chapters.find((chapter) => chapter.chapterId === currentChapterId);
  const selectedChapter = detail.chapters.find((chapter) => chapter.chapterId === chapterId);
  const latestLogId = detail.logs[detail.logs.length - 1]?.id ?? '';
  const manualStage = task.stage === 'glossary_setup' || task.stage === 'glossary_translation';
  const hasTranslatedMetadata = Boolean(task.translatedMetadata.title || task.translatedMetadata.author || task.translatedMetadata.description || task.translatedMetadata.tags.length);
  const openReviewsByParagraph = useMemo(() => {
    const grouped = new Map<number, Review[]>();
    for (const review of reviews) {
      if (review.chapterId !== chapterId || review.resolution !== 'open') continue;
      for (const paragraphIndex of review.paragraphIndices) grouped.set(paragraphIndex, [...(grouped.get(paragraphIndex) ?? []), review]);
    }
    return grouped;
  }, [chapterId, reviews]);
  const visibleSegments = translationFilter === 'review_required' ? segments.filter((segment) => openReviewsByParagraph.has(segment.paragraphIndex)) : segments;

  useEffect(() => {
    if (recycleBin) setAgentMode('read');
  }, [recycleBin]);
  useEffect(() => {
    if (!pendingReviewJump || chapterId !== pendingReviewJump.chapterId) return;
    jumpToParagraph(pendingReviewJump.paragraphIndex);
    setPendingReviewJump(null);
  }, [chapterId, segments, pendingReviewJump]);
  useEffect(() => {
    if (!autoScrollLogs || activeTab !== 'log') return;
    const frame = requestAnimationFrame(() => logViewportRef.current?.scrollTo({ top: logViewportRef.current.scrollHeight, behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [activeTab, autoScrollLogs, latestLogId]);

  const jumpToParagraph = (paragraphIndex: number) => {
    setFocusedParagraph(paragraphIndex);
    setTimeout(() => document.getElementById(`refined-segment-${paragraphIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };
  const jumpToReview = async (review: Review) => {
    if (!review.chapterId || !review.paragraphIndices.length) return;
    setReturnToReview(true);
    setActiveTab('translation');
    const paragraphIndex = review.paragraphIndices[0]!;
    if (review.chapterId === chapterId) return jumpToParagraph(paragraphIndex);
    setPendingReviewJump({ chapterId: review.chapterId, paragraphIndex });
    await props.onSelectChapter(review.chapterId);
  };
  const applyReviewReplacement = async (review: Review) => {
    if (!review.replacementText || review.paragraphIndices.length !== 1) return;
    await props.onApplyReviewReplacement(review);
  };
  const reviewResolutionMeta = (review: Review): { label: string; color: string } => {
    switch (review.resolution) {
      case 'accepted': return { label: '已接受', color: 'green' };
      case 'partially_accepted': return { label: '部分采纳', color: 'yellow' };
      case 'rejected': return { label: '已拒绝', color: 'red' };
      case 'resolved': return { label: '已处理（旧记录）', color: 'green' };
      case 'ignored': return { label: '已忽略（旧记录）', color: 'gray' };
      case 'superseded': return { label: '已过期（已重新处理）', color: 'gray' };
      default: return { label: review.severity, color: 'orange' };
    }
  };
  const reviewResolutionActions = (review: Review, options?: { showAccepted?: boolean }) => {
    if (review.resolution !== 'open') {
      return review.resolution === 'superseded'
        ? <Text size="xs" c="dimmed">新一轮审核会生成新的意见</Text>
        : <Button size="compact-xs" variant="subtle" disabled={recycleBin} onClick={() => void props.onResolveReview(review.id, 'open')}>重新打开</Button>;
    }
    return <Group gap="xs">
      {options?.showAccepted !== false ? <Button size="compact-xs" variant="light" color="green" disabled={recycleBin} onClick={() => void props.onResolveReview(review.id, 'accepted')}>接受</Button> : null}
      <Button size="compact-xs" variant="subtle" color="yellow" disabled={recycleBin} onClick={() => void props.onResolveReview(review.id, 'partially_accepted')}>部分采纳</Button>
      <Button size="compact-xs" variant="subtle" color="red" disabled={recycleBin} onClick={() => void props.onResolveReview(review.id, 'rejected')}>拒绝</Button>
    </Group>;
  };
  const openConfiguration = () => {
    const toKey = (route: { providerId: string; modelId: string } | null | undefined) => route ? `${route.providerId}\u0000${route.modelId}` : '';
    setConfigName(task.name); setConfigSourceLang(task.sourceLang); setConfigTargetLang(task.targetLang);
    setConfigConcurrency(String(task.modelConfig.concurrency)); setConfigRounds(String(task.modelConfig.maxReviewRounds));
    setConfigModels({ termExtractionModel: toKey(task.modelConfig.termExtractionModel), termTranslationModel: toKey(task.modelConfig.termTranslationModel), omissionModel: toKey(task.modelConfig.omissionModel), reviewModel: toKey(task.modelConfig.reviewModel) });
    setConfigThinking({ termExtractionModel: task.modelConfig.termExtractionModel?.thinkingEnabled === true, termTranslationModel: task.modelConfig.termTranslationModel?.thinkingEnabled === true, omissionModel: task.modelConfig.omissionModel?.thinkingEnabled === true, reviewModel: task.modelConfig.reviewModel?.thinkingEnabled === true });
    setConfigTranslationModels((task.modelConfig.translationModels ?? []).map(toKey).filter(Boolean));
    setConfigTranslationThinking((task.modelConfig.translationModels ?? []).some((route) => route.thinkingEnabled === true));
    setConfigError(null);
    setConfigureOpen(true);
  };
  const saveConfiguration = async () => {
    setConfigSaving(true); setConfigError(null);
    try {
      const toRoute = (key: string) => { const [providerId, modelId] = (configModels[key] ?? '').split('\u0000'); return providerId && modelId ? { providerId, modelId, ...(configThinking[key] ? { thinkingEnabled: true } : {}) } : null; };
      const translationModels = configTranslationModels.flatMap((key) => { const [providerId, modelId] = key.split('\u0000'); return providerId && modelId ? [{ providerId, modelId, ...(configTranslationThinking ? { thinkingEnabled: true } : {}) }] : []; });
      await props.onUpdateTask({ name: configName, sourceLang: configSourceLang, targetLang: configTargetLang, modelConfig: { ...task.modelConfig, termExtractionModel: toRoute('termExtractionModel'), termTranslationModel: toRoute('termTranslationModel'), translationModels, omissionModel: toRoute('omissionModel'), reviewModel: toRoute('reviewModel'), concurrency: Math.max(1, Number(configConcurrency) || 1), maxReviewRounds: Math.max(1, Number(configRounds) || 1) } });
      setConfigureOpen(false);
    } catch (error) { setConfigError(error instanceof Error ? error.message : '保存配置失败，请稍后重试。'); }
    finally { setConfigSaving(false); }
  };
  const requestTermSuggestion = async () => {
    if (!termSuggestion || !termFeedback.trim()) return;
    setSuggesting(true);
    try { setTermSuggestionText(await props.onSuggestTerm(termSuggestion.id, termFeedback)); }
    finally { setSuggesting(false); }
  };
  const sendAgentMessage = async () => {
    if (!agentPrompt.trim() || !chapterId) return;
    const userMessage = agentPrompt.trim();
    const history = agentMessages;
    setAgentMessages((items) => [...items, { role: 'user', content: userMessage }]);
    setAgentPrompt(''); setAgentSending(true);
    try {
      const result = await props.onAgentChat({ message: userMessage, mode: agentMode, ...(focusedParagraph !== null ? { paragraphIndices: [focusedParagraph] } : {}), history });
      const proposal = result.proposedEdits.length ? `\n\n已生成 ${result.proposedEdits.length} 项修改提案，等待你确认；确认前不会写入译文。` : '';
      if (result.mode !== 'read' && result.proposedEdits.length) setPendingProposal({ mode: result.mode, edits: result.proposedEdits });
      setAgentMessages((items) => [...items, { role: 'assistant', content: `${result.reply}${proposal}` }]);
    } catch (error) { setAgentMessages((items) => [...items, { role: 'assistant', content: `请求失败：${error instanceof Error ? error.message : '未知错误'}` }]); }
    finally { setAgentSending(false); }
  };
  const approveProposal = async () => {
    if (!pendingProposal || !chapterId) return;
    setAgentSending(true);
    try {
      const result = await approveRefinedChapterAgentEdits(task.id, chapterId, pendingProposal);
      setAgentMessages((items) => [...items, { role: 'assistant', content: `已确认并应用段落：${result.appliedParagraphIndices.map((index) => `#${index + 1}`).join('、')}。${pendingProposal.mode === 'edit_review' ? '该章已进入自动审核。' : '已按你的选择跳过审核。'}` }]);
      setPendingProposal(null);
    } catch (error) { setAgentMessages((items) => [...items, { role: 'assistant', content: `确认修改失败：${error instanceof Error ? error.message : '未知错误'}` }]); }
    finally { setAgentSending(false); }
  };

  return <Stack gap="md">
    <Group justify="space-between" align="flex-start">
      <Stack gap={2}><Title order={3}>{task.name}</Title><Text size="sm" c="dimmed">{task.novelTitle} · {task.sourceLang} → {task.targetLang}</Text></Stack>
      <Group>
        {recycleBin ? <><Button color="green" variant="light" leftSection={<IconRestore size={15} />} onClick={() => void props.onAction('restore')}>恢复任务</Button>{purgeStatus?.canPurge ? <Button color="red" variant="light" leftSection={<IconTrash size={15} />} onClick={() => setPurgeConfirmOpen(true)}>永久删除</Button> : null}</> : <>
          {task.status === 'running'
            ? <Button variant="default" size="compact-sm" leftSection={<IconPlayerPause size={14} />} onClick={() => void props.onAction('pause')}>暂停</Button>
            : manualStage
              ? <Button color="yellow" size="compact-sm" rightSection={<IconArrowRight size={14} />} onClick={() => void props.onAction('advance')}>{task.stage === 'glossary_translation' ? '确认术语，开始自动流程' : '确认并进入下一步'}</Button>
              : <Button variant="default" size="compact-sm" leftSection={<IconPlayerPlay size={14} />} onClick={() => void props.onAction('resume')}>继续</Button>}
          <Button variant="subtle" size="compact-sm" onClick={openConfiguration}>配置</Button>
          <ActionIcon color="red" variant="subtle" onClick={() => void props.onAction('delete')}><IconTrash size={17} /></ActionIcon>
        </>}
      </Group>
    </Group>
    <Paper p="sm" radius="md" style={{ border: '1px solid rgba(255,140,105,.3)', background: 'rgba(63,30,17,.25)' }}><Group justify="space-between" align="flex-end"><Stack gap={2}><Text size="xs" fw={700} c="orange.3" tt="uppercase">导出当前结果</Text><Text size="xs" c="dimmed">导出不会改变任务内容；“全部章节”会将未完成段落保留为原文。</Text></Stack><Button component="a" href={refinedExportUrl(task.id, exportFormat, exportMode, exportScope === 'all')} leftSection={<IconFileDownload size={15} />}>下载</Button></Group><SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm"><Select label="格式" value={exportFormat} onChange={(value) => setExportFormat((value ?? 'epub') as LibraryExportFormat)} data={[{ value: 'epub', label: 'EPUB' }, { value: 'markdown', label: 'Markdown' }, { value: 'txt', label: 'TXT' }]} /><Select label="内容" value={exportMode} onChange={(value) => setExportMode((value ?? 'bilingual') as TranslationExportMode)} data={[{ value: 'bilingual', label: '双语对照' }, { value: 'translated', label: '仅译文' }, { value: 'original', label: '仅原文' }]} /><Select label="范围" value={exportScope} onChange={(value) => setExportScope(value === 'completed' ? 'completed' : 'all')} data={[{ value: 'all', label: '全部章节（未完成用原文）' }, { value: 'completed', label: '仅已完成章节' }]} /></SimpleGrid></Paper>
    <TaskActionGuidance task={task} termCount={terms.length} reviewCount={reviews.filter((review) => !review.resolved).length} hasRemainingAutomaticWork={detail.chapters.some((chapter) => chapter.status !== 'reviewed' && chapter.status !== 'failed' && chapter.status !== 'needs_attention')} recycleBin={recycleBin} onExtractTerms={props.onExtractTerms} onRetry={() => props.onAction('retry-failed')} onShowReviews={() => setActiveTab('review')} />
    <Progress value={detail.progress.total ? completedSegments / detail.progress.total * 100 : 0} color="brand" />
    <Text size="xs" c="dimmed">当前：{STAGE_LABEL[task.stage]} · 已完成 {completedSegments}/{detail.progress.total} 段 · 失败 {detail.progress.failed} · 已审核章节 {detail.progress.reviewedChapters}/{detail.stepProgress.chapters.total} · 当前章审核轮次 {detail.progress.currentRound}/{task.modelConfig.maxReviewRounds}{currentChapter ? ` · 正在处理第 ${currentChapter.chapterIndex} 章` : ''}</Text>
    <Button variant="subtle" size="compact-sm" onClick={() => setWorkflowOpen((value) => !value)}>{workflowOpen ? '收起' : '展开'} 状态机流程</Button>
    <Collapse in={workflowOpen}><Stack gap="sm"><WorkflowStateGraphCompact task={task} detail={detail} currentChapter={currentChapter ? `第 ${currentChapter.chapterIndex} 章` : '等待调度'} onSelect={setSelectedCheckpoint} /><CheckpointDetail {...(checkpoint ? { checkpoint } : {})} chapters={detail.chapters} /></Stack></Collapse>
    <Tabs value={activeTab} onChange={setActiveTab}>
      <Tabs.List><Tabs.Tab value="translation" leftSection={<IconWriting size={14} />}>译文对照</Tabs.Tab><Tabs.Tab value="glossary">术语表 ({terms.length})</Tabs.Tab><Tabs.Tab value="review">审核意见（待处理 {reviews.filter((review) => review.resolution === 'open').length} / 历史 {reviews.length}）</Tabs.Tab><Tabs.Tab value="log">操作日志</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="translation" pt="md"><Stack gap="md">
        <Paper p="sm" radius="md" style={{ border: '1px solid rgba(99,212,166,.26)', background: 'rgba(18,35,28,.2)' }}>
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap={1}><Text size="xs" fw={700} c="teal.2" tt="uppercase">任务元数据</Text><Text size="xs" c="dimmed">{task.sourceLang} → {task.targetLang}</Text></Stack>
            <SegmentedControl size="xs" value={metadataView} onChange={(value) => setMetadataView(value as 'source' | 'translated')} data={[{ value: 'source', label: '原文' }, { value: 'translated', label: '译文' }]} />
          </Group>
          {metadataView === 'source' ? <>
            <Text size="sm" fw={600} mt={8}>{task.sourceMetadata.title}</Text>
            <Text size="xs" c="dimmed">作者：{task.sourceMetadata.author}{task.sourceMetadata.tags.length ? ` · 标签：${task.sourceMetadata.tags.join(' / ')}` : ''}</Text>
            {task.sourceMetadata.description ? <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>{task.sourceMetadata.description}</Text> : <Text size="xs" c="dimmed" mt="xs">原作品未提供简介。</Text>}
          </> : hasTranslatedMetadata ? <>
            <Text size="sm" fw={600} mt={8}>{task.translatedMetadata.title ?? '—'}</Text>
            <Text size="xs" c="dimmed">作者：{task.translatedMetadata.author ?? '—'}{task.translatedMetadata.tags.length ? ` · 标签：${task.translatedMetadata.tags.join(' / ')}` : ''}</Text>
            {task.translatedMetadata.description ? <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>{task.translatedMetadata.description}</Text> : <Text size="xs" c="dimmed" mt="xs">该作品未提供可翻译的简介。</Text>}
          </> : <Text size="sm" c="dimmed" mt="sm">元数据译文尚未生成；确认术语译文后，系统会在开始第一章前自动翻译标题、作者、简介和标签。</Text>}
        </Paper>
        <Paper p="sm" radius="md" style={{ border: '1px solid rgba(168,133,96,.22)', background: 'rgba(17,12,10,.42)' }}><Text size="xs" fw={700} c="yellow" tt="uppercase">浏览与定位</Text><SimpleGrid cols={{ base: 1, md: 2 }} mt="xs"><Select label="章节" value={chapterId} onChange={(value) => value && void props.onSelectChapter(value)} data={detail.chapters.map((chapter) => ({ value: chapter.chapterId, label: `第 ${chapter.chapterIndex} 章 · ${chapter.title}` }))} /><TextInput label="跳转段落" value={paragraphJump} onChange={(event) => setParagraphJump(event.currentTarget.value)} description="段落编号显示在每个卡片左上角，例如输入 12 跳到 #12。" rightSection={<ActionIcon variant="subtle" onClick={() => { const index = Number(paragraphJump) - 1; if (Number.isInteger(index) && index >= 0) jumpToParagraph(index); }}>↵</ActionIcon>} placeholder="例如 12" /></SimpleGrid></Paper>
        <Group justify="space-between" align="flex-end"><Select label="段落筛选" value={translationFilter} onChange={(value) => setTranslationFilter(value === 'review_required' ? 'review_required' : 'all')} data={[{ value: 'all', label: `全部段落（${segments.length}）` }, { value: 'review_required', label: `仅待按审核修改（${openReviewsByParagraph.size}）` }]} /><Group>{returnToReview ? <Button size="compact-sm" variant="light" onClick={() => { setActiveTab('review'); setReturnToReview(false); }}>返回审核意见</Button> : null}<Text size="xs" c="dimmed">待修改段落会显示审核原因与可用的一键替换。</Text></Group></Group>
        <ScrollArea h="85vh">
          <Stack gap="sm">
            {selectedChapter && translationFilter === 'all' ? <ChapterTitleEditor chapter={selectedChapter} recycleBin={recycleBin} onSave={props.onSaveChapterTitle} /> : null}
            {visibleSegments.map((segment) => {
              const segmentReviews = openReviewsByParagraph.get(segment.paragraphIndex) ?? [];
              return <Paper id={`refined-segment-${segment.paragraphIndex}`} key={segment.paragraphIndex} p="sm" radius="sm" style={{ borderLeft: `3px solid ${segmentReviews.length ? '#ff8c69' : segment.status === 'pending' ? '#ffd166' : segment.status === 'failed' ? '#ff6b6b' : '#63d4a6'}`, outline: focusedParagraph === segment.paragraphIndex ? '1px solid #ffd166' : 'none', background: segmentReviews.length ? 'rgba(73,31,18,.28)' : 'rgba(11,8,7,.28)' }}>
                <Group justify="space-between" mb={5}>
                  <Badge variant="light" color={focusedParagraph === segment.paragraphIndex ? 'yellow' : segmentReviews.length ? 'orange' : 'gray'} style={{ cursor: 'pointer' }} onClick={() => setFocusedParagraph(segment.paragraphIndex)}>#{segment.paragraphIndex + 1}</Badge>
                  <Text size="xs" c="dimmed">{segmentReviews.length ? `待按 ${segmentReviews.length} 条审核意见修改` : segment.status === 'pending' ? '待翻译' : segment.status === 'failed' ? '翻译失败' : segment.status === 'skipped' ? '原文保留' : '已译'}</Text>
                </Group>
                {segmentReviews.map((review) => <Alert key={review.id} color="orange" variant="light" title={`审核意见 · ${review.severity}`} mb="sm">
                  <Text size="sm">{review.suggestion}</Text>
                  {review.replacementText && review.paragraphIndices.length === 1
                    ? <Paper p="xs" mt="xs" radius="sm" style={{ background: 'rgba(255,255,255,.04)' }}><Text size="xs" c="dimmed">可直接替换为</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{review.replacementText}</Text><Group gap="xs" mt="xs"><Button size="compact-xs" disabled={recycleBin || task.status === 'running'} onClick={() => void applyReviewReplacement(review)}>接受并替换本段</Button>{reviewResolutionActions(review, { showAccepted: false })}</Group></Paper>
                    : <><Text size="xs" c="dimmed" mt="xs">此意见需要结合上下文修改；可直接在右侧编辑，或交给章节 Agent。</Text><Group mt="xs">{reviewResolutionActions(review)}</Group></>}
                </Alert>)}
                <SimpleGrid cols={{ base: 1, md: 2 }}><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{segment.sourceText}</Text><TranslationEditor segment={segment} recycleBin={recycleBin} onSave={props.onSaveSegment} onRetry={props.onRetrySegment} /></SimpleGrid>
              </Paper>;
            })}
            {!visibleSegments.length ? <Text c="dimmed" ta="center" py="xl">本章没有待按审核修改的段落。</Text> : null}
          </Stack>
        </ScrollArea>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="glossary" pt="md"><Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 3 }}><TextInput label="搜索" value={termQuery} onChange={(event) => setTermQuery(event.currentTarget.value)} placeholder="术语、译文或 AI 建议" /><Select label="状态" value={termStatus} onChange={(value) => setTermStatus((value ?? 'all') as typeof termStatus)} data={[{ value: 'all', label: '全部状态' }, { value: 'pending', label: '待确认' }, { value: 'confirmed', label: '已确认' }, { value: 'excluded', label: '已排除' }]} /><Select label="实体类型" value={termType} onChange={(value) => setTermType(value ?? 'all')} data={[{ value: 'all', label: '全部类型' }, ...termTypes.map((type) => ({ value: type, label: type }))]} /></SimpleGrid>
        <Group><Button size="compact-sm" color="yellow" variant="light" leftSection={<IconSparkles size={14} />} disabled={recycleBin} onClick={() => void props.onExtractTerms()}>术语 AI 提取</Button><TextInput size="xs" value={newTerm} onChange={(event) => setNewTerm(event.currentTarget.value)} placeholder="新增源术语" disabled={recycleBin} /><Button size="compact-sm" disabled={recycleBin || !newTerm.trim()} onClick={() => { void props.onCreateTerm(newTerm.trim()); setNewTerm(''); }}>新增术语</Button><Button size="compact-sm" disabled={recycleBin || !selectedTerms.length} onClick={() => void props.onBulkUpdateTerms(selectedTerms, 'confirmed')}>批量确认</Button><Button size="compact-sm" variant="default" disabled={recycleBin || !selectedTerms.length} onClick={() => void props.onBulkUpdateTerms(selectedTerms, 'excluded')}>批量排除</Button><Button size="compact-sm" color="red" variant="light" leftSection={<IconTrash size={14} />} disabled={recycleBin || !selectedTerms.length} onClick={() => setBulkDeleteConfirmOpen(true)}>批量删除</Button></Group>
        <Text size="xs" c="dimmed">已选 {selectedTerms.length} 条 · 已确认 {detail.stepProgress.glossary.confirmed}/{detail.stepProgress.glossary.total} 条。表头固定在滚动区域顶部。</Text>
        <ScrollArea h={430}><Table stickyHeader striped highlightOnHover style={{ minWidth: 1050 }}><Table.Thead style={{ background: 'var(--mantine-color-body)' }}><Table.Tr><Table.Th w={46}><input type="checkbox" checked={filteredTerms.length > 0 && filteredTerms.every((term) => selectedTerms.includes(term.id))} onChange={(event) => setSelectedTerms(event.currentTarget.checked ? [...new Set([...selectedTerms, ...filteredTerms.map((term) => term.id)])] : selectedTerms.filter((id) => !filteredTerms.some((term) => term.id === id)))} /></Table.Th><Table.Th w={180}>原术语</Table.Th><Table.Th w={200}>译文</Table.Th><Table.Th w={150}>类型 / 优先级</Table.Th><Table.Th>AI 建议</Table.Th><Table.Th w={92}>状态</Table.Th><Table.Th w={150}>操作</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{filteredTerms.map((term) => <Table.Tr key={term.id}><Table.Td><input type="checkbox" checked={selectedTerms.includes(term.id)} onChange={(event) => setSelectedTerms((items) => event.currentTarget.checked ? [...items, term.id] : items.filter((id) => id !== term.id))} /></Table.Td><Table.Td>{term.sourceTerm}</Table.Td><Table.Td><TextInput key={`${term.id}:${term.targetTerm ?? ''}`} size="xs" defaultValue={term.targetTerm ?? ''} disabled={recycleBin} onBlur={(event) => void props.onUpdateTerm(term.id, { targetTerm: event.currentTarget.value, status: 'confirmed' })} /></Table.Td><Table.Td>{term.entityType ?? '—'} / {term.priority}</Table.Td><Table.Td><Text size="xs">{term.suggestion ?? '—'}</Text></Table.Td><Table.Td><Badge size="sm" style={{ minWidth: 64, whiteSpace: 'nowrap' }} color={term.status === 'confirmed' ? 'green' : term.status === 'excluded' ? 'gray' : 'yellow'}>{term.status === 'confirmed' ? '已确认' : term.status === 'excluded' ? '已排除' : '待确认'}</Badge></Table.Td><Table.Td><Group gap="xs" wrap="nowrap"><Button size="compact-xs" variant="subtle" leftSection={<IconSparkles size={13} />} disabled={recycleBin} onClick={() => { setTermSuggestion(term); setTermFeedback(''); setTermSuggestionText(''); }}>提意见</Button><ActionIcon color="red" variant="subtle" disabled={recycleBin} onClick={() => void props.onDeleteTerm(term.id)}><IconTrash size={14} /></ActionIcon></Group></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="review" pt="md"><Stack gap="xs">{(() => {
        const openReviews = reviews.filter((review) => review.resolution === 'open');
        const historicalReviews = reviews.filter((review) => review.resolution !== 'open');
        const visibleReviews = showHistoricalReviews ? [...openReviews, ...historicalReviews] : openReviews;
        return <>
          <Group justify="space-between"><Text size="xs" c="dimmed">默认只显示待处理意见；接受、部分采纳、拒绝或 Agent 修订后的意见会立即移入历史。</Text>{historicalReviews.length ? <Button size="compact-xs" variant="subtle" onClick={() => setShowHistoricalReviews((value) => !value)}>{showHistoricalReviews ? '隐藏历史意见' : `显示历史意见（${historicalReviews.length}）`}</Button> : null}</Group>
          <ScrollArea h="85vh" type="auto"><Stack gap="xs" pr="xs">{visibleReviews.length ? visibleReviews.map((review) => {
            const resolution = reviewResolutionMeta(review);
            return <Paper key={review.id} p="sm" radius="sm" style={{ borderLeft: `3px solid ${review.resolution === 'superseded' ? '#7d8792' : review.resolved ? '#63d4a6' : '#ff8c69'}`, opacity: review.resolution === 'superseded' ? .62 : 1 }}>
              <Group justify="space-between" align="flex-start"><Group gap="xs" wrap="wrap"><Badge color={resolution.color}>{resolution.label}</Badge><Badge color={review.severity.toLowerCase() === 'high' ? 'red' : review.severity.toLowerCase() === 'medium' ? 'yellow' : 'gray'}>级别：{review.severity}</Badge><Badge variant="outline" color={review.forceChange ? 'red' : 'gray'}>{review.forceChange ? '强制修订' : '非强制'}</Badge><Badge variant="light" color="blue">第 {detail.chapters.find((chapter) => chapter.chapterId === review.chapterId)?.chapterIndex ?? '？'} 章</Badge><Badge variant="light" color="violet">第 {review.reviewRound} 轮</Badge></Group>{reviewResolutionActions(review)}</Group>
              <Text size="sm" mt="xs">{review.suggestion}</Text>
              {review.resolutionNote ? <Text size="xs" c="dimmed" mt={4}>处理反馈：{review.resolutionNote}</Text> : null}
              {review.replacementText && review.paragraphIndices.length === 1 ? <Paper p="xs" mt="xs" radius="sm" style={{ background: 'rgba(255,255,255,.04)' }}><Text size="xs" c="dimmed">结构化替换文本</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{review.replacementText}</Text>{review.resolution === 'open' ? <Button size="compact-xs" mt="xs" disabled={recycleBin || task.status === 'running'} onClick={() => void applyReviewReplacement(review)}>接受并替换该段</Button> : null}</Paper> : null}
              <Group gap="xs" mt="xs">{review.paragraphIndices.length ? review.paragraphIndices.map((index) => <Button key={index} size="compact-xs" variant="light" onClick={() => void jumpToReview({ ...review, paragraphIndices: [index] })}>跳转 # {index + 1}</Button>) : <Text size="xs" c="dimmed">全章意见</Text>}</Group>
              <Text size="xs" c="dimmed">{Object.entries(review.scores).map(([key, value]) => `${key} ${value}`).join(' / ') || '未提供分项评分'} · 提出于 {new Date(review.createdAt).toLocaleString()}</Text>
            </Paper>;
          }) : <Text c="dimmed" ta="center" py="xl">{showHistoricalReviews ? '暂无审核意见。' : '当前没有待处理的审核意见。'}</Text>}</Stack></ScrollArea>
        </>;
      })()}</Stack></Tabs.Panel>
      <Tabs.Panel value="log" pt="md"><Stack gap="xs"><Group justify="space-between"><Text size="xs" c="dimmed">共 {detail.logs.length} 条操作记录</Text><Checkbox size="xs" checked={autoScrollLogs} onChange={(event) => setAutoScrollLogs(event.currentTarget.checked)} label="新日志自动滚到底部" /></Group><ScrollArea h="85vh" type="auto" viewportRef={logViewportRef}><Stack gap="xs" pr="xs">{detail.logs.map((log) => <Paper key={log.id} p="xs" radius="sm"><Text size="sm">{log.message}</Text><Text size="xs" c="dimmed">{new Date(log.createdAt).toLocaleString()}</Text></Paper>)}</Stack></ScrollArea></Stack></Tabs.Panel>
    </Tabs>
    <Affix position={{ bottom: 28, right: 28 }}><Button size="md" radius="xl" leftSection={<IconMessageChatbot size={18} />} onClick={() => setAgentOpen(true)}>章节 Agent</Button></Affix>
    <Modal opened={agentOpen} onClose={() => setAgentOpen(false)} title="章节 Agent 对话" size="lg" centered><Stack gap="sm"><Paper p="sm" radius="sm" style={{ background: 'rgba(255,209,102,.08)' }}><Text size="sm" fw={600}>{currentChapter ? `第 ${currentChapter.chapterIndex} 章 · ${currentChapter.title}` : '未选择章节'}</Text><Text size="xs" c="dimmed">每次提问都会携带 task_id、chapter_id 以及可用的段落定位工具。{focusedParagraph !== null ? `当前已附带段落 #${focusedParagraph + 1}。` : '点击译文卡片的 # 编号，可额外附带该段。'}</Text></Paper><Select label="对话模式" value={agentMode} onChange={(value) => { setAgentMode((value ?? 'read') as RefinedChapterAgentMode); setPendingProposal(null); }} data={recycleBin ? [{ value: 'read', label: '只读：仅分析与回答' }] : [{ value: 'read', label: '只读：仅分析与回答' }, { value: 'edit_review', label: '可编辑：生成提案，确认后自动审核（推荐）' }, { value: 'edit_skip_review', label: '可编辑：生成提案，确认后跳过审核' }]} /><Text size="xs" c={agentMode === 'edit_skip_review' ? 'orange.3' : 'dimmed'}>{agentMode === 'read' ? '只读模式不会向 Agent 提供写入能力。' : agentMode === 'edit_review' ? 'Agent 只能生成提案；你确认后才会写入并进入审核。' : 'Agent 只能生成提案；你确认后才会写入且跳过审核，请谨慎使用。'}</Text>{pendingProposal ? <Alert color="yellow" title="Agent 修改提案等待批准"><Stack gap="xs"><Text size="sm">确认前不会更改任何译文。请逐项确认：</Text>{pendingProposal.edits.map((edit) => <Paper key={edit.paragraphIndex} p="xs" radius="sm"><Text size="xs" c="dimmed">段落 #{edit.paragraphIndex + 1}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{edit.translatedText}</Text></Paper>)}<Group justify="flex-end"><Button size="compact-sm" variant="default" onClick={() => { setPendingProposal(null); setAgentMessages((items) => [...items, { role: 'assistant', content: '已取消该修改提案，任务译文未发生变化。' }]); }}>取消</Button><Button size="compact-sm" color={pendingProposal.mode === 'edit_skip_review' ? 'orange' : 'yellow'} loading={agentSending} onClick={() => void approveProposal()}>确认应用{pendingProposal.mode === 'edit_review' ? '并审核' : '（跳过审核）'}</Button></Group></Stack></Alert> : null}<ScrollArea h={250}><Stack gap="xs">{agentMessages.length ? agentMessages.map((message, index) => <Paper key={`${message.role}-${index}`} p="sm" radius="sm" style={{ background: message.role === 'user' ? 'rgba(255,209,102,.1)' : 'rgba(255,255,255,.045)' }}><Text size="xs" c="dimmed">{message.role === 'user' ? '你' : '章节 Agent'}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{message.content}</Text></Paper>) : <Text size="sm" c="dimmed" py="md">可以询问本章的术语、一致性、措辞理由，或在可编辑模式下要求 Agent 生成指定段落的修改提案。</Text>}</Stack></ScrollArea><Textarea label="向章节 Agent 提问" value={agentPrompt} onChange={(event) => setAgentPrompt(event.currentTarget.value)} minRows={3} placeholder="例如：检查本章人物称谓是否一致；或：将当前段落改得更口语化。" /><Group justify="flex-end"><Button loading={agentSending} disabled={!agentPrompt.trim() || !chapterId || Boolean(pendingProposal)} leftSection={<IconSend size={15} />} onClick={() => void sendAgentMessage()}>发送</Button></Group></Stack></Modal>
    <Modal opened={termSuggestion !== null} onClose={() => setTermSuggestion(null)} title="向术语 Agent 提意见" centered><Stack><Text size="sm" c="dimmed">术语：{termSuggestion?.sourceTerm}</Text><Textarea label="修改要求" value={termFeedback} onChange={(event) => setTermFeedback(event.currentTarget.value)} minRows={3} /><Button loading={suggesting} disabled={!termFeedback.trim()} onClick={() => void requestTermSuggestion()}>生成建议</Button>{termSuggestionText ? <><Textarea label="Agent 建议" value={termSuggestionText} onChange={(event) => setTermSuggestionText(event.currentTarget.value)} minRows={3} /><Group justify="flex-end"><Button variant="default" onClick={() => setTermSuggestion(null)}>取消</Button><Button onClick={() => { if (termSuggestion) void props.onUpdateTerm(termSuggestion.id, { targetTerm: termSuggestionText, status: 'confirmed' }); setTermSuggestion(null); }}>确认采纳</Button></Group></> : null}</Stack></Modal>
    <Modal opened={configureOpen} onClose={() => setConfigureOpen(false)} title="编辑任务配置" centered><Stack><TextInput label="任务名称" value={configName} onChange={(event) => setConfigName(event.currentTarget.value)} /><SimpleGrid cols={2}><TextInput label="源语言" value={configSourceLang} onChange={(event) => setConfigSourceLang(event.currentTarget.value)} /><TextInput label="目标语言" value={configTargetLang} onChange={(event) => setConfigTargetLang(event.currentTarget.value)} /></SimpleGrid><SimpleGrid cols={2}>{([['termExtractionModel', '术语提取'], ['termTranslationModel', '术语翻译'], ['omissionModel', '遗漏判定'], ['reviewModel', '审核校对']] as const).map(([key, label]) => <Stack key={key} gap={4}><Select label={label} clearable data={modelOptions} value={configModels[key] ?? null} onChange={(value) => setConfigModels((current) => ({ ...current, [key]: value ?? '' }))} /><Checkbox size="xs" label="启用模型思考" checked={configThinking[key] ?? false} disabled={!configModels[key]} onChange={(event) => { const enabled = event.currentTarget.checked; setConfigThinking((current) => ({ ...current, [key]: enabled })); }} /></Stack>)}</SimpleGrid><Stack gap={4}><MultiSelect label="正文初翻模型池" data={modelOptions} value={configTranslationModels} onChange={setConfigTranslationModels} clearable /><Checkbox size="xs" label="正文初翻启用模型思考" checked={configTranslationThinking} disabled={!configTranslationModels.length} onChange={(event) => setConfigTranslationThinking(event.currentTarget.checked)} /></Stack><Text size="xs" c="dimmed">翻译和审核可对同一模型分别设置。仅为支持原生思考的模型开启。</Text>{configError ? <Alert color="red" title="配置未保存">{configError}</Alert> : null}<SimpleGrid cols={2}><TextInput label="正文并发数" value={configConcurrency} onChange={(event) => setConfigConcurrency(event.currentTarget.value)} /><TextInput label="最大审核轮次" value={configRounds} onChange={(event) => setConfigRounds(event.currentTarget.value)} /></SimpleGrid><Button loading={configSaving} onClick={() => void saveConfiguration()}>保存配置</Button></Stack></Modal>
    <Modal opened={bulkDeleteConfirmOpen} onClose={() => setBulkDeleteConfirmOpen(false)} title="批量删除术语" centered><Stack><Text>将删除已选的 {selectedTerms.length} 条术语。此操作不能从精翻任务中恢复。</Text><Group justify="flex-end"><Button variant="default" onClick={() => setBulkDeleteConfirmOpen(false)}>取消</Button><Button color="red" onClick={() => { const termIds = selectedTerms; setBulkDeleteConfirmOpen(false); void props.onBulkDeleteTerms(termIds).then(() => setSelectedTerms((current) => current.filter((id) => !termIds.includes(id)))); }}>确认删除</Button></Group></Stack></Modal>
    <Modal opened={purgeConfirmOpen} onClose={() => setPurgeConfirmOpen(false)} title="永久删除精翻任务" centered><Stack><Text>将永久清理该任务的原文快照、译文、术语、审核记录、checkpoint 与操作日志；此操作不可恢复。</Text><Group justify="flex-end"><Button variant="default" onClick={() => setPurgeConfirmOpen(false)}>取消</Button><Button color="red" onClick={() => { setPurgeConfirmOpen(false); void props.onAction('purge'); }}>确认永久删除</Button></Group></Stack></Modal>
  </Stack>;
}

function TaskActionGuidance({ task, termCount, reviewCount, hasRemainingAutomaticWork, recycleBin, onExtractTerms, onRetry, onShowReviews }: { task: RefinedTask; termCount: number; reviewCount: number; hasRemainingAutomaticWork: boolean; recycleBin: boolean; onExtractTerms: () => Promise<void>; onRetry: () => Promise<void>; onShowReviews: () => void }) {
  if (recycleBin) return <Alert color="gray" title="回收站只读模式">可以查看和导出任务；恢复后才能修改或运行流程。</Alert>;
  if (task.status === 'needs_attention' && hasRemainingAutomaticWork) return <Alert color="blue" title="正在自动恢复后续章节"><Text size="sm">当前章节的问题会保留至全部章节完成后的最终复核；后续章节仍会继续自动翻译、检查与审核。</Text></Alert>;
  if (task.status === 'needs_attention') return <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="自动流程已结束，存在待人工复核项"><Text size="sm">翻译与审核已自动跑完；达到审核轮次上限或发生不可自动恢复的失败时，相关意见会保留到最终复核。你可以查看意见后微调，也可让 Agent 再次按全部意见修订。</Text><Group mt="sm"><Button size="compact-sm" variant="light" onClick={onShowReviews}>查看待处理审核{reviewCount ? `（${reviewCount}）` : ''}</Button><Button size="compact-sm" color="orange" leftSection={<IconRefresh size={14} />} onClick={() => void onRetry()}>让 Agent 按意见自动修订</Button></Group></Alert>;
  if (task.status === 'running') return <Alert color="blue" title={task.stage === 'glossary_setup' && !termCount ? '术语 AI 正在从原文提取候选' : '正在自动处理'}>{task.stage === 'glossary_setup' && !termCount ? '已开始术语 AI 提取；提取完成后会显示候选术语并暂停等待你的确认。' : '当前步骤会自行推进；如需人工改稿，请先暂停任务。'}</Alert>;
  if (task.stage === 'glossary_setup') return <Alert color="yellow" title={termCount ? '当前需要你处理：确认术语候选' : '当前需要你处理：生成术语候选'}><Text size="sm">{termCount ? '检查术语表后，点击“确认并进入下一步”。' : '现有粗翻术语与图谱实体均为空。请使用术语 AI 从任务原文中提取候选，然后确认。'}</Text>{!termCount ? <Button mt="sm" size="compact-sm" color="yellow" onClick={() => void onExtractTerms()}>术语 AI 提取</Button> : null}</Alert>;
  if (task.stage === 'glossary_translation') return <Alert color="yellow" title="当前需要你处理：确认术语译文"><Text size="sm">检查并确认或排除全部术语译文后，点击“确认术语，开始自动流程”。</Text></Alert>;
  if (task.stage === 'completed') return reviewCount ? <Alert color="yellow" title="自动流程已完成，等待最终复核"><Text size="sm">正文、检查与审核已自动跑完；仍有 {reviewCount} 条意见保留给最终人工复核。你可以在完成后集中处理、让章节 Agent 协助，或直接导出当前结果。</Text><Button size="compact-sm" mt="sm" variant="light" onClick={onShowReviews}>查看最终复核意见</Button></Alert> : <Alert color="green" title="任务已完成">全部章节已通过审核。你仍可手动微调、使用章节 Agent 或导出当前结果。</Alert>;
  return <Alert color="blue" title="任务已暂停">点击“继续”会从当前 checkpoint 恢复。</Alert>;
}

function WorkflowStateGraphCompact({ task, detail, currentChapter, onSelect }: { task: RefinedTask; detail: RefinedTaskDetail; currentChapter: string; onSelect: (stage: RefinedTaskStage) => void }) {
  const stages: Array<{ id: RefinedTaskStage; label: string; position: { x: number; y: number } }> = [
    { id: 'glossary_setup', label: '术语候选', position: { x: 0, y: 30 } }, { id: 'glossary_translation', label: '术语翻译', position: { x: 220, y: 30 } }, { id: 'translating', label: '正文初翻', position: { x: 440, y: 30 } },
    { id: 'checking', label: '遗漏检查', position: { x: 440, y: 190 } }, { id: 'reviewing', label: '审核校对', position: { x: 660, y: 190 } }, { id: 'revising', label: '审核修订', position: { x: 660, y: 330 } }, { id: 'completed', label: '完成', position: { x: 900, y: 190 } },
  ];
  const nodes: Array<Node<WorkflowNodeData, 'workflow'>> = stages.map((stage) => ({ id: stage.id, type: 'workflow', position: stage.position, data: { label: task.stage === stage.id ? `${stage.label} · 当前` : stage.label, active: task.stage === stage.id } }));
  const edgeStyle = { stroke: '#b89565', strokeWidth: 1.5 };
  const edges: Edge[] = [
    { id: 'glossary_setup-glossary_translation', source: 'glossary_setup', sourceHandle: 'source-right', target: 'glossary_translation', targetHandle: 'target-left', label: '人工确认' },
    { id: 'glossary_translation-translating', source: 'glossary_translation', sourceHandle: 'source-right', target: 'translating', targetHandle: 'target-left', label: '人工确认' },
    { id: 'translating-checking', source: 'translating', sourceHandle: 'source-bottom', target: 'checking', targetHandle: 'target-top', label: '已初翻' },
    { id: 'checking-reviewing', source: 'checking', sourceHandle: 'source-right', target: 'reviewing', targetHandle: 'target-left', label: '无遗漏' },
    { id: 'reviewing-completed', source: 'reviewing', sourceHandle: 'source-right', target: 'completed', targetHandle: 'target-left', label: '通过' },
  ].map((edge) => ({ ...edge, animated: task.stage === edge.source, style: edgeStyle, labelStyle: { fill: '#f0c96a', fontWeight: 700 }, labelBgStyle: { fill: '#211611', fillOpacity: .92 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#b89565' } }));
  edges.push(
    { id: 'checking-translating', source: 'checking', sourceHandle: 'source-left', target: 'translating', targetHandle: 'target-bottom', label: '补译 ↺', type: 'smoothstep', style: edgeStyle, labelStyle: { fill: '#f0c96a', fontWeight: 700 }, labelBgStyle: { fill: '#211611', fillOpacity: .92 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#b89565' } },
    { id: 'reviewing-revising', source: 'reviewing', sourceHandle: 'source-bottom', target: 'revising', targetHandle: 'target-top', label: `评分<80 / 强制项 · 第 ${detail.progress.currentRound}/${task.modelConfig.maxReviewRounds} 轮`, type: 'smoothstep', style: { ...edgeStyle, stroke: '#ffb366' }, labelStyle: { fill: '#ffca87', fontWeight: 700 }, labelBgStyle: { fill: '#211611', fillOpacity: .92 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ffb366' } },
    { id: 'revising-checking', source: 'revising', sourceHandle: 'source-left', target: 'checking', targetHandle: 'target-bottom', label: '仅修订关联段落 ↺', type: 'smoothstep', style: { ...edgeStyle, stroke: '#ffb366' }, labelStyle: { fill: '#ffca87', fontWeight: 700 }, labelBgStyle: { fill: '#211611', fillOpacity: .92 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ffb366' } },
  );
  const transitions = detail.transitions.length ? detail.transitions.slice(-14) : detail.workflow.map((item) => ({ id: item.id, fromStage: null, toStage: item.id, condition: item.id === task.stage ? '当前节点' : '历史 checkpoint', chapterId: null, reviewRound: null, createdAt: '' }));
  return <Stack gap="sm">
    <Paper p="md" radius="md" style={{ background: 'linear-gradient(145deg, rgba(47,31,20,.84), rgba(17,12,10,.7))', border: '1px solid rgba(168,133,96,.28)' }}>
      <Group justify="space-between" mb="sm"><Stack gap={0}><Text size="xs" fw={700} c="yellow" tt="uppercase">状态机 · {currentChapter}</Text><Text size="xs" c="dimmed">分支条件与回路不会随屏幕宽度重叠。</Text></Stack><Badge color={task.status === 'needs_attention' ? 'orange' : 'blue'}>{task.status === 'needs_attention' ? '等待人工介入' : `当前章审核轮次 ${detail.progress.currentRound}/${task.modelConfig.maxReviewRounds}`}</Badge></Group>
      <div style={{ height: 460, minWidth: 0 }}><ReactFlow nodes={nodes} edges={edges} nodeTypes={workflowNodeTypes} fitView fitViewOptions={{ padding: .24 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable onNodeClick={(_event, node) => onSelect(node.id as RefinedTaskStage)} proOptions={{ hideAttribution: true }}><Background color="rgba(168,133,96,.18)" gap={18} /><Controls showInteractive={false} /></ReactFlow></div>
      <Alert mt="sm" color={task.status === 'needs_attention' ? 'orange' : 'blue'} title={task.status === 'needs_attention' ? '审核校对 → 人工介入' : '循环终止条件'}>{task.status === 'needs_attention' ? '达到最大审核轮次或模型失败；请处理当前审核意见后重新处理章节。' : '评分达标后进入下一章；达到最大轮次或模型失败时停止并等待人工介入。'}</Alert>
    </Paper>
    <Paper p="sm" radius="md" style={{ border: '1px solid rgba(99,212,166,.25)', background: 'rgba(18,35,28,.22)' }}><Text size="xs" fw={700} c="teal.2" tt="uppercase">实际经过的处理路径</Text><Text size="xs" c="dimmed" mb="xs">已记录 {detail.transitions.length} 次状态转移；当前结果：{task.status === 'completed' ? '全部章节已通过审核。' : task.status === 'needs_attention' ? '自动处理停止，等待人工介入。' : `正在${STAGE_LABEL[task.stage]}。`}</Text><ScrollArea h={172} type="auto"><Stack gap={6}>{transitions.map((transition, index) => { const chapter = detail.chapters.find((item) => item.chapterId === transition.chapterId); return <Paper key={transition.id} p={5} radius="sm" style={{ background: 'rgba(0,0,0,.14)' }}><Group gap="xs" wrap="nowrap"><Badge size="xs" color={transition.toStage === task.stage ? 'yellow' : 'gray'}>{index + 1}</Badge><Text size="xs" fw={700}>{transition.fromStage ? `${STAGE_LABEL[transition.fromStage]} → ` : ''}{STAGE_LABEL[transition.toStage]}</Text></Group><Text size="xs" c="dimmed" ml={28}>触发条件：{describeTransitionCondition(transition.condition)}{chapter ? `；第 ${chapter.chapterIndex} 章` : ''}{transition.reviewRound ? `；第 ${transition.reviewRound} 轮` : ''}</Text></Paper>; })}</Stack></ScrollArea></Paper>
  </Stack>;
}

function StateNode({ node, active, onClick }: { node: { id: RefinedTaskStage; label: string }; active: boolean; onClick: (stage: RefinedTaskStage) => void }) { return <Paper p="xs" radius="sm" onClick={() => onClick(node.id)} style={{ minWidth: 116, textAlign: 'center', cursor: 'pointer', border: active ? '2px solid #ffd166' : '1px solid rgba(99,212,166,.6)', background: active ? 'rgba(255,209,102,.14)' : 'rgba(20,14,11,.72)' }}><Text size="sm" fw={700}>{node.label}{active ? ' · 当前' : ''}</Text></Paper>; }
function EdgeLabel({ label }: { label: string }) { return <Text size="xs" c="yellow.3" style={{ whiteSpace: 'nowrap' }}>── {label} ──›</Text>; }
function BranchNote({ tone, label, detail }: { tone: 'yellow' | 'orange' | 'red'; label: string; detail: string }) { return <Paper p="xs" radius="sm" style={{ borderLeft: `3px solid ${tone === 'red' ? '#ff8c69' : tone === 'orange' ? '#ffb366' : '#ffd166'}`, background: 'rgba(0,0,0,.14)' }}><Text size="xs" fw={700}>{label}</Text><Text size="xs" c="dimmed">{detail}</Text></Paper>; }

function describeTransitionCondition(condition: string): string {
  if (condition === 'paragraph snapshots + glossary + previous translations') return '调度正文初翻：注入术语表与已译上下文';
  if (condition === 'segment alignment and empty translations') return '正文初翻完成：检查段落对齐、空译文与未翻译内容';
  if (condition === 'chapter translation, glossary and adjacent chapter context') return '遗漏检查通过：审核译文、术语与相邻章节一致性';
  return condition;
}

function WorkflowStateGraph({ task, detail, currentChapter, onSelect }: { task: RefinedTask; detail: RefinedTaskDetail; currentChapter: string; onSelect: (stage: RefinedTaskStage) => void }) {
  const order = detail.workflow.map((item) => item.id);
  const activeIndex = order.indexOf(task.stage);
  const nodes: Array<{ id: RefinedTaskStage; label: string; x: number; y: number }> = [
    { id: 'glossary_setup', label: '术语候选', x: 70, y: 76 }, { id: 'glossary_translation', label: '术语翻译', x: 270, y: 76 }, { id: 'translating', label: '正文初翻', x: 470, y: 76 },
    { id: 'checking', label: '遗漏检查', x: 470, y: 244 }, { id: 'reviewing', label: '审核校对', x: 670, y: 244 }, { id: 'completed', label: '完成', x: 870, y: 244 },
  ];
  const colorFor = (node: { id: RefinedTaskStage }) => node.id === task.stage ? '#ffd166' : order.indexOf(node.id) < activeIndex ? '#63d4a6' : '#6f5840';
  return <Paper p="sm" radius="md" style={{ overflowX: 'auto', background: 'radial-gradient(circle at top left, rgba(255,209,102,.09), transparent 42%), rgba(17,12,10,.55)' }}><Group justify="space-between" mb={4}><Text size="xs" fw={700} c="yellow" tt="uppercase">实际状态机 · {currentChapter}</Text><Badge color={task.status === 'needs_attention' ? 'orange' : 'blue'}>{task.status === 'needs_attention' ? '等待人工介入' : `审核循环 ${detail.progress.currentRound}/${task.modelConfig.maxReviewRounds}`}</Badge></Group><svg viewBox="0 0 980 330" role="img" aria-label="精翻状态机流程图" style={{ minWidth: 760, width: '100%', height: 300 }}><defs><marker id="refined-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b89565" /></marker></defs><GraphEdge d="M160 76 H230" label="人工确认" x={194} y={58} /><GraphEdge d="M360 76 H430" label="人工确认" x={394} y={58} /><GraphEdge d="M560 103 V212" label="本章初翻完成" x={575} y={158} /><GraphEdge d="M560 244 H630" label="无遗漏" x={594} y={228} /><GraphEdge d="M670 212 C630 150, 570 150, 535 188" label="需补译" x={618} y={164} /><GraphEdge d="M760 244 H830" label="评分≥80且无强制项" x={794} y={228} /><GraphEdge d="M670 274 C590 322, 420 320, 425 118" label="强制修改 / 评分<80" x={544} y={313} /><GraphEdge d="M720 286 V314" label="达到最大轮次 / 模型失败 → 人工介入" x={770} y={309} dashed /><g><rect x="630" y="300" width="180" height="25" rx="12" fill="rgba(255,107,107,.14)" stroke="#ff8c69" /><text x="720" y="317" textAnchor="middle" fill="#ffb4a4" fontSize="12">需人工介入：查看意见后重新处理</text></g>{nodes.map((node) => <g key={node.id} onClick={() => onSelect(node.id)} style={{ cursor: 'pointer' }}><rect x={node.x - 72} y={node.y - 27} width="144" height="54" rx="13" fill={node.id === task.stage ? 'rgba(255,209,102,.18)' : 'rgba(30,20,15,.9)'} stroke={colorFor(node)} strokeWidth={node.id === task.stage ? 2.5 : 1.5} /><text x={node.x} y={node.y + 5} textAnchor="middle" fill="#f1e4d1" fontSize="15" fontWeight="700">{node.label}</text>{node.id === task.stage ? <circle cx={node.x + 56} cy={node.y - 15} r="5" fill="#ffd166" /> : null}</g>)}</svg></Paper>;
}

function GraphEdge({ d, label, x, y, dashed = false }: { d: string; label: string; x: number; y: number; dashed?: boolean }) { return <g><path d={d} fill="none" stroke="#b89565" strokeWidth="1.5" strokeDasharray={dashed ? '5 4' : undefined} markerEnd="url(#refined-arrow)" /><text x={x} y={y} textAnchor="middle" fill="#bba58a" fontSize="11">{label}</text></g>; }

function CheckpointDetail({ checkpoint, chapters }: { checkpoint?: { stage: RefinedTaskStage; state: Record<string, unknown>; updatedAt: string }; chapters: RefinedTaskDetail['chapters'] }) {
  if (!checkpoint) return <Text size="xs" c="dimmed">点击节点查看最近一次执行信息。</Text>;
  const chapterId = checkpointChapterId(checkpoint.state); const chapter = chapters.find((item) => item.chapterId === chapterId);
  const output = typeof checkpoint.state.output === 'string' ? checkpoint.state.output : undefined;
  const condition = checkpoint.state.event === 'advanced' ? '用户已确认并进入下一步' : checkpoint.state.event === 'agent_edit_requires_review' ? '章节 Agent 修改后自动审核' : output === 'manual intervention required' ? '自动处理未收敛，等待人工介入' : '已保存中间状态，可从此处恢复';
  return <Paper p="sm" radius="sm"><Text size="sm" fw={600}>{STAGE_LABEL[checkpoint.stage]} · {new Date(checkpoint.updatedAt).toLocaleString()}</Text><Text size="sm" c="dimmed">条件：{condition}{chapter ? `；目标：第 ${chapter.chapterIndex} 章《${chapter.title}》` : ''}</Text></Paper>;
}

function checkpointChapterId(state: Record<string, unknown> | undefined): string | null { return typeof state?.chapterId === 'string' ? state.chapterId : null; }

function ChapterTitleEditor({ chapter, recycleBin, onSave }: { chapter: RefinedTaskDetail['chapters'][number]; recycleBin: boolean; onSave: (text: string) => Promise<void> }) {
  const [draft, setDraft] = useState(chapter.translatedTitle ?? '');
  useEffect(() => { setDraft(chapter.translatedTitle ?? ''); }, [chapter.chapterId, chapter.translatedTitle]);
  return <Paper p="sm" radius="sm" style={{ borderLeft: '3px solid #ffd166', background: 'rgba(57,40,16,.3)' }}><Badge color="yellow" variant="light" mb="xs">章节标题</Badge><SimpleGrid cols={{ base: 1, md: 2 }}><Text fw={700}>{chapter.title}</Text><Stack gap="xs"><TextInput value={draft} disabled={recycleBin} placeholder="章节标题译文" onChange={(event) => setDraft(event.currentTarget.value)} /><Group><Button size="compact-xs" disabled={recycleBin || draft === (chapter.translatedTitle ?? '')} onClick={() => void onSave(draft)}>保存标题译文</Button><Text size="xs" c="dimmed">标题与正文段落分开保存、翻译与导出。</Text></Group></Stack></SimpleGrid></Paper>;
}

function TranslationEditor({ segment, recycleBin, onSave, onRetry }: { segment: RefinedSegment; recycleBin: boolean; onSave: (index: number, text: string) => Promise<void>; onRetry: (index: number) => Promise<void> }) {
  const [draft, setDraft] = useState(segment.translatedText ?? '');
  useEffect(() => setDraft(segment.translatedText ?? ''), [segment.paragraphIndex, segment.translatedText]);
  const changed = draft !== (segment.translatedText ?? '');
  return <Stack gap="xs"><Textarea autosize minRows={2} value={draft} placeholder="在此写入译文…" disabled={recycleBin} onChange={(event) => setDraft(event.currentTarget.value)} /><Group gap="xs"><Button size="compact-xs" disabled={recycleBin || !changed} onClick={() => void onSave(segment.paragraphIndex, draft)}>保存</Button><Button size="compact-xs" variant="default" disabled={recycleBin || !changed} onClick={() => setDraft(segment.translatedText ?? '')}>撤销未保存修改</Button>{segment.status === 'failed' ? <Button color="orange" size="compact-xs" disabled={recycleBin} onClick={() => void onRetry(segment.paragraphIndex)}>重试本段</Button> : null}</Group></Stack>;
}
