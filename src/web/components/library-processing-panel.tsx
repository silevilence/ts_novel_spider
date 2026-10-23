import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, Progress, Select, Stack, Switch, Text } from '@mantine/core';
import { defaultProcessingSettings, processingStageLabels, processingStatusLabels, type ProcessingJobView, type ProcessingSettings } from '../../server/contracts/library-processing';
import { bulkUpdateLibraryTermStatus, controlLibraryProcessing, fetchLibraryProcessing, fetchLibraryTranslationTerms, saveLibraryProcessing } from '../services/api';
import type { StoredTranslationTermRow } from '../../server/core/novel-repository';

/** Available from both the library and scheduling list, independent of remote-fetch settings. */
export function LibraryProcessingPanel({ sourceId, novelId }: { sourceId: string; novelId: string }) {
  return <ProcessingPanel key={`${sourceId}/${novelId}`} sourceId={sourceId} novelId={novelId} />;
}
function ProcessingPanel({ sourceId, novelId }: { sourceId: string; novelId: string }) {
  const [opened, setOpened] = useState(false);
  const [settings, setSettings] = useState<ProcessingSettings>(defaultProcessingSettings);
  const [jobs, setJobs] = useState<ProcessingJobView[]>([]);
  const [terms, setTerms] = useState<StoredTranslationTermRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [candidateJob, setCandidateJob] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!opened) return;
    let active = true; let timer: ReturnType<typeof setTimeout>; let first = true;
    const poll = async () => {
      try {
        const data = await fetchLibraryProcessing(sourceId, novelId);
        if (!active) return;
        setJobs(data.jobs);
        if (first) { setSettings(data.settings); setLoaded(true); first = false; }
        const glossary = await fetchLibraryTranslationTerms(sourceId, novelId);
        if (active) setTerms(glossary.terms);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '无法读取任务'); }
      if (active) timer = setTimeout(() => void poll(), 2000);
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [opened, sourceId, novelId]);
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); const data = await fetchLibraryProcessing(sourceId, novelId); if (alive.current) { setNotice(message); setJobs(data.jobs); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { if (alive.current) setBusy(false); }
  }
  const candidates = terms.filter((term) => jobs.find((job) => job.id === candidateJob)?.candidateIds.includes(term.id) && term.status === 'pending');
  return <>
    <Button variant="subtle" size="compact-sm" onClick={() => setOpened(true)}>更新后处理与进度</Button>
    <Modal opened={opened} onClose={() => setOpened(false)} title="更新后处理" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">成功下载的新内容可继续处理术语和译文。此设置不启用远端定时抓取；未开启下面选项时，原有定时自动翻译设置继续生效。</Text>
        <Switch label="更新后自动提取术语" checked={settings.extractTerms} disabled={!loaded || busy} onChange={(event) => setSettings({ ...settings, extractTerms: event.currentTarget.checked })} />
        <Switch label="更新后自动翻译正文" checked={settings.translate} disabled={!loaded || busy} onChange={(event) => setSettings({ ...settings, translate: event.currentTarget.checked })} />
        <Select label="新术语确认方式" disabled={!loaded || busy || !settings.extractTerms} value={settings.candidatePolicy} onChange={(value) => setSettings({ ...settings, candidatePolicy: value === 'automatic' ? 'automatic' : 'manual' })} data={[{ value: 'manual', label: '等待我确认（默认）' }, { value: 'automatic', label: '全自动：确认本轮新候选并继续' }]} />
        <Text size="xs" c="dimmed">设置用于下一轮更新；在途任务沿用启动时的策略。历史候选和已排除词条不会被自动确认。</Text>
        <Button loading={busy} disabled={!loaded} onClick={() => void perform(() => saveLibraryProcessing(sourceId, novelId, settings), '设置已保存，下轮更新生效。')}>保存后处理设置</Button>
        {error ? <Alert color="red">{error}</Alert> : null}{notice ? <Text role="status">{notice}</Text> : null}
        {jobs.length === 0 ? <Text c="dimmed">尚无后处理记录。采集完成与译文准备完成会分别记录。</Text> : null}
        {[...jobs].reverse().map((job) => <Paper key={job.id} withBorder p="sm"><Stack gap="xs">
          <Group justify="space-between"><Text fw={600}>{processingStageLabels[job.stage]}</Text><Badge>{processingStatusLabels[job.status]}</Badge></Group>
          <Text size="sm">目标：{(job.chapterTitles ?? Object.keys(job.chapterHashes)).join('、')} · {job.message}</Text>
          {job.progress ? <><Text size="xs" role="status">{job.progress.message}</Text><Progress value={job.progress.percent} aria-label={`${processingStageLabels[job.stage]}进度`} /></> : null}
          <Group gap="xs">
            {job.stage === 'confirmation' ? <Button size="compact-sm" onClick={() => { setCandidateJob(job.id); setSelected([]); }}>查看本轮候选（{job.candidateIds.length}）</Button> : null}
            {['paused', 'failed'].includes(job.status) ? <Button size="compact-sm" disabled={busy} onClick={() => void perform(() => controlLibraryProcessing(sourceId, novelId, job.id, 'resume'), '已请求继续')}>继续 / 重试</Button> : null}
            {['running', 'waiting', 'queued'].includes(job.status) ? <Button size="compact-sm" disabled={busy} variant="default" onClick={() => void perform(() => controlLibraryProcessing(sourceId, novelId, job.id, 'pause'), '已暂停')}>暂停</Button> : null}
            {!['completed', 'cancelled'].includes(job.status) ? <Button size="compact-sm" disabled={busy} color="red" variant="subtle" onClick={() => void perform(() => controlLibraryProcessing(sourceId, novelId, job.id, 'cancel'), '已取消')}>取消</Button> : null}
          </Group>
        </Stack></Paper>)}
        {candidateJob ? <Paper withBorder p="sm"><Stack gap="xs"><Text fw={600}>本轮待确认术语</Text>
          {!candidates.length ? <Text size="sm" c="dimmed">本轮候选已处理，无需再次确认。</Text> : null}
          {candidates.map((term) => <Checkbox key={term.id} label={`${term.sourceTerm} → ${term.targetTerm ?? '待翻译'} · ${term.note ?? ''}`} checked={selected.includes(term.id)} onChange={(event) => setSelected(event.currentTarget.checked ? [...selected, term.id] : selected.filter((id) => id !== term.id))} />)}
          <Button variant="subtle" size="compact-sm" onClick={() => setSelected(candidates.map((term) => term.id))}>选择本轮全部候选</Button>
          <Group>{(['confirmed', 'excluded'] as const).map((status) => <Button key={status} disabled={!selected.length || busy} variant={status === 'excluded' ? 'default' : 'filled'} onClick={() => void perform(async () => { await bulkUpdateLibraryTermStatus(sourceId, novelId, selected, status); if (alive.current) setSelected([]); }, '候选已处理，满足条件后将自动继续。')}>{status === 'confirmed' ? '确认选中' : '排除选中'}</Button>)}</Group>
        </Stack></Paper> : null}
      </Stack>
    </Modal>
  </>;
}
