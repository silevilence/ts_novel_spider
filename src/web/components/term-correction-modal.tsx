import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Pagination, Paper, Select, Stack, Text } from '@mantine/core';
import type { TermChange, TermCorrection } from '../../server/contracts/term-correction';
import { applyTermCorrection, fetchTermCorrections, previewTermCorrection, suggestTermCorrection } from '../services/api';

interface Props { sourceId: string; novelId: string; chapters: Array<{ id: string; title: string }>; onOpenedChange?: (opened: boolean) => void; }
export function TermCorrectionModal(props: Props) { return <CorrectionDialog key={`${props.sourceId}/${props.novelId}`} {...props} />; }
function CorrectionDialog({ sourceId, novelId, chapters, onOpenedChange }: Props) {
  const [opened, setOpened] = useState(false);
  useEffect(() => { onOpenedChange?.(opened); return () => onOpenedChange?.(false); }, [opened, onOpenedChange]);
  const [changes, setChanges] = useState<TermChange[]>([]);
  const [records, setRecords] = useState<TermCorrection[]>([]);
  const [changeId, setChangeId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [record, setRecord] = useState<TermCorrection | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    void fetchTermCorrections(sourceId, novelId).then((data) => { if (active) { setChanges(data.changes); setRecords(data.corrections); } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '读取失败'); });
    return () => { active = false; };
  }, [opened, sourceId, novelId]);
  function invalidatePreview() { setRecord(null); setSelected([]); setPage(1); }
  async function perform(action: () => Promise<{ correction: TermCorrection }>, message = '正在处理，请稍候…') {
    setBusy(true); setActivity(message); setError('');
    try { const result = await action(); if (alive.current) { setRecord(result.correction); setSelected([]); setRecords((current) => [result.correction, ...current.filter((item) => item.id !== result.correction.id)]); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { if (alive.current) { setBusy(false); setActivity(''); } }
  }
  return <>
    <Button variant="light" size="compact-sm" onClick={() => setOpened(true)}>矫正已有译文</Button>
    <Modal opened={opened} onClose={() => setOpened(false)} title="术语矫正 · 历史译文" size="xl"><Stack>
      <Text size="sm" c="dimmed">先在术语表保存新译名，再选择变更检查影响范围。预览和 AI 建议均不会直接修改译文，确认应用后才写入。这里只处理书库译文。</Text>
      <Select label="术语译名变更" data={changes.filter((change) => change.after).map((change) => ({ value: change.id, label: `${change.sourceTerm}：${change.before ?? '空'} → ${change.after} · ${change.createdAt}` }))} value={changeId} onChange={(id) => { setChangeId(id); invalidatePreview(); }} searchable disabled={busy} />
      <Select label="检查范围" placeholder="全书（含书名、简介和卷标题）" data={chapters.map((chapter) => ({ value: chapter.id, label: chapter.title }))} value={chapterId} onChange={(id) => { setChapterId(id); invalidatePreview(); }} clearable searchable disabled={busy} />
      <Button loading={busy} disabled={!changeId} onClick={() => { setPage(1); void perform(() => previewTermCorrection(sourceId, novelId, changeId!, chapterId ? [chapterId] : undefined)); }}>预览受影响译文</Button>
      <Select label="历史预览与应用记录" placeholder="查看修改前后文本或撤销" data={records.map((item) => ({ value: item.id, label: `${item.oldTerm} → ${item.newTerm} · ${item.createdAt}` }))} value={record?.id ?? null} disabled={busy} onChange={(id) => { setRecord(records.find((item) => item.id === id) ?? null); setSelected([]); setPage(1); }} />
      {error ? <Alert color="red" title="未完成操作">{error}</Alert> : null}
      {activity ? <Text role="status" size="sm">{activity}</Text> : null}
      {record ? <>
        <Text role="status">共 {record.targets.length} 项，已应用 {record.targets.filter((target) => target.applied && !target.reverted).length} 项。未选择和待核对的项目保持不变。</Text>
        <Group>
          <Button variant="subtle" disabled={busy} onClick={() => setSelected(record.targets.filter((target) => target.suggestion && !target.applied && target.classification !== 'aligned').map((target) => target.id))}>选择全部可应用建议</Button>
          <Button disabled={busy || !selected.length} onClick={() => void perform(() => applyTermCorrection(sourceId, novelId, record.id, selected))}>确认应用选中修正</Button>
        </Group>
        {record.targets.slice((page - 1) * 25, page * 25).map((target) => <Paper key={target.id} withBorder p="sm"><Stack gap="xs">
          <Group justify="space-between"><Checkbox label={`${target.title} · ${target.paragraphIndex === null ? '标题' : `段落 ${target.paragraphIndex}`}`} disabled={busy || !target.suggestion || target.applied || target.classification === 'aligned'} checked={selected.includes(target.id)} onChange={(event) => setSelected(event.currentTarget.checked ? [...selected, target.id] : selected.filter((id) => id !== target.id))} /><Badge color={target.classification === 'review' ? 'orange' : 'green'}>{target.reverted ? '已撤销' : target.applied ? '已应用' : target.classification === 'aligned' ? '已一致' : target.classification === 'replace' ? '可替换' : '需核对'}</Badge></Group>
          <Text size="xs" c="dimmed">{target.reason}</Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>原文：{target.sourceText}</Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>修改前：{target.before}</Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>建议：{target.suggestion ?? '尚无建议，请核对语境后生成 AI 建议'}</Text>
          {!target.applied && target.classification !== 'aligned' ? <Button size="compact-sm" variant="default" disabled={busy} onClick={() => void perform(() => suggestTermCorrection(sourceId, novelId, record.id, target.id), '正在生成 AI 修订建议；生成后仍需选择并确认，当前译文不会改变。')}>生成 AI 修订建议</Button> : null}
          {target.applied && !target.reverted ? <Button size="compact-sm" variant="default" disabled={busy} onClick={() => void perform(() => applyTermCorrection(sourceId, novelId, record.id, [target.id], true))}>撤销此项修正</Button> : null}
        </Stack></Paper>)}
        {record.targets.length > 25 ? <Pagination total={Math.ceil(record.targets.length / 25)} value={page} onChange={setPage} /> : null}
      </> : null}
    </Stack></Modal>
  </>;
}
