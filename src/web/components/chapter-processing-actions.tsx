import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Progress, Select, Stack, Text } from '@mantine/core';
import { fetchLibraryTermExtraction, fetchLibraryTranslationBuild, fetchLibraryTranslationProfile, startLibraryTermExtraction, startLibraryTranslation } from '../services/api';

interface Props { sourceId: string; novelId: string; chapterId: string; title: string; }

/** All library entry points share the same chapter scope and confirmation dialog. */
export function ChapterProcessingActions(props: Props) {
  const identity = `${props.sourceId}/${props.novelId}/${props.chapterId}`;
  return <ChapterProcessingDialog key={identity} {...props} />;
}

function ChapterProcessingDialog({ sourceId, novelId, chapterId, title }: Props) {
  const [opened, setOpened] = useState(false);
  const [operation, setOperation] = useState('retry');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [model, setModel] = useState('加载配置…');
  const [ready, setReady] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setReady(false); setError('');
    void fetchLibraryTranslationProfile(sourceId, novelId).then(({ translation }) => {
      if (!active) return;
      const route = operation.startsWith('extract') ? translation.termExtractionModel : translation.translationModels[0];
      setModel(route?.providerId && route.modelId ? `${route.providerId} / ${route.modelId}` : '继承全局模型配置（启动时校验可用性）');
      setReady(true);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '配置加载失败'); });
    return () => { active = false; };
  }, [opened, sourceId, novelId, operation]);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (operation.startsWith('extract')) {
          const { run } = await fetchLibraryTermExtraction(sourceId, novelId);
          if (active && run?.chapterIds?.includes(chapterId)) {
            setMessage(`${run.status}：成功 ${run.completedBatches}/${run.totalBatches} 批，新增 ${run.added} 条。${run.errorMessage ?? run.message ?? ''}`);
            setProgress(run.totalBatches ? run.completedBatches / run.totalBatches * 100 : 0);
          }
        } else {
          const { translation } = await fetchLibraryTranslationBuild(sourceId, novelId);
          if (active && translation) {
            if (translation.chapterIds && !translation.chapterIds.includes(chapterId)) {
              setMessage('最近一次翻译运行不包含本章。可在翻译面板查看该运行的明细。'); setProgress(0);
            } else {
              setMessage(`${translation.chapterIds ? `所选 ${translation.chapterIds.length} 章` : '全书'}运行：${translation.message} ${translation.errorMessage ?? ''}`);
              setProgress(translation.progressPercent);
            }
          }
        }
      } catch { /* No build is expected before the first operation. Launch errors are displayed separately. */ }
      if (active) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [opened, operation, sourceId, novelId, chapterId]);
  async function start() {
    setBusy(true); setError('');
    try {
      if (operation.startsWith('extract')) await startLibraryTermExtraction(sourceId, novelId, { chapterIds: [chapterId], fromScratch: operation === 'extract-new' });
      else await startLibraryTranslation(sourceId, novelId, undefined, operation === 'retranslate', [chapterId]);
      if (alive.current) setMessage('已提交后台任务，关闭窗口后仍会继续。');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '无法启动'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <>
    <Button size="compact-sm" variant="light" onClick={() => setOpened(true)}>本章术语与翻译</Button>
    <Modal opened={opened} onClose={() => setOpened(false)} title={`处理章节：${title}`}>
      <Stack>
        <Select label="操作" value={operation} disabled={busy} onChange={(value) => { setOperation(value ?? 'retry'); setConfirmed(false); setMessage(''); }} data={[
          { value: 'retry', label: '补译失败或缺失部分' }, { value: 'retranslate', label: '整章重新翻译' },
          { value: 'extract', label: '提取本章术语 / 重试失败批次' }, { value: 'extract-new', label: '重新提取本章术语' },
        ]} />
        <Text size="sm">范围：仅「{title}」。模型：{model}</Text>
        <Text size="xs" c="dimmed">补译复用有效检查点；原文、语言、术语或模型变化后失效的部分会重新生成。整章重译包含标题，成功后更新旧译文，失败保留原文与已有译文。这里的进度为运行范围进度，不代表全书完成率。</Text>
        {operation === 'retranslate' ? <Checkbox label="确认重新生成本章标题与正文译文" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} /> : null}
        {error ? <Alert color="red" title="操作未完成">{error}</Alert> : null}
        {message ? <><Text size="sm" role="status">{message}</Text><Progress value={progress} aria-label="章节处理进度" /></> : null}
        <Button loading={busy} disabled={!ready || (operation === 'retranslate' && !confirmed)} onClick={() => void start()}>开始处理本章</Button>
      </Stack>
    </Modal>
  </>;
}
