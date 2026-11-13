import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, TagsInput, Text, Textarea, TextInput } from '@mantine/core';
import { MAX_EBOOK_BYTES, type EbookImportSummary, type EbookMetadata } from '../../server/contracts/ebook';
import { confirmEbookImport, fetchEbookImports, restoreLibraryNovelFromTrash, retryEbookImport, uploadEbook } from '../services/api';

const STATUS = { uploaded: '待解析', parsing: '正在解析', ready: '待确认', failed: '解析失败', completed: '已入库' };

export function EbookImportPanel({ opened, onClose, onImported, onOpenBook }: {
  opened: boolean; onClose: () => void; onImported: () => void; onOpenBook: (novelId: string) => void;
}) {
  const [entries, setEntries] = useState<EbookImportSummary[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<EbookImportSummary | null>(null);
  const [draft, setDraft] = useState<EbookMetadata>({ title: '', author: '', description: '', tags: [] });
  const [encoding, setEncoding] = useState<string | null>(null);
  const refresh = async () => { const result = await fetchEbookImports(); setEntries(result.imports); };
  useEffect(() => {
    if (!opened) return;
    let active = true;
    const refreshVisible = () => { void fetchEbookImports().then(result => { if (active) setEntries(result.imports); }).catch(err => { if (active) setError(String(err)); }); };
    refreshVisible();
    const timer = window.setInterval(refreshVisible, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [opened]);
  const act = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await operation(); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : '操作失败。'); }
    finally { setBusy(null); }
  };
  const upload = async (files: File[]) => {
    setUploading(true); setError('');
    const failures: string[] = [];
    let duplicates = 0;
    try {
      for (const [index, file] of files.entries()) {
        setMessage(`正在上传 ${index + 1}/${files.length}：${file.name}`);
        try {
          if (file.size > MAX_EBOOK_BYTES) throw new Error('文件超过 32 MB');
          const result = await uploadEbook(file);
          if (result.duplicate) duplicates++;
        } catch (err) { failures.push(`${file.name}：${err instanceof Error ? err.message : '上传失败'}`); }
      }
      await refresh();
      setMessage(`上传结束：${files.length - failures.length} 个已接收，${duplicates} 个重复文件已跳过。解析完成后请预览并确认入库。`);
      setError(failures.join('\n'));
    } finally { setUploading(false); }
  };
  return <>
    <Modal opened={opened} onClose={onClose} title="导入电子书" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">选择文字为主的 EPUB 或 TXT，每个文件最多 32 MB。保留原件，阅读时使用项目排版；上传结束后可关闭窗口，解析继续运行。</Text>
        <Button component="label" loading={uploading} disabled={uploading}>选择文件（可多选）<input aria-label="选择电子书文件" hidden type="file" accept=".epub,.txt" multiple disabled={uploading} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void upload(files).catch(err => setError(String(err))); }} /></Button>
        {message ? <Text size="sm" role="status">{message}</Text> : null}
        {error ? <Alert color="red" title="操作未完成" style={{ whiteSpace: 'pre-wrap' }}>{error}</Alert> : null}
        {!entries.length ? <Text c="dimmed">暂无导入记录。</Text> : entries.map(entry => <Paper key={entry.id} withBorder p="sm">
          <Stack gap="xs"><Group justify="space-between"><Text fw={500} style={{ overflowWrap: 'anywhere' }}>{entry.fileName}</Text><Badge>{entry.deleted ? '已在回收站' : STATUS[entry.status]}</Badge></Group>
            {entry.error ? <Text c="red" size="sm">{entry.error}</Text> : null}
            {entry.preview ? <Text size="sm">{entry.preview.title} · {entry.preview.chapterCount} 章{entry.preview.encoding ? ` · ${entry.preview.encoding}` : ''}</Text> : null}
            {entry.sameTitleCount && !entry.novelId ? <Text size="sm" c="orange">书库已有同名书籍，本文件内容不同，确认后将独立入库。</Text> : null}
            <Group>
              {entry.status === 'ready' ? <Button size="xs" onClick={() => { setSelected(entry); setDraft({ title: entry.preview!.title, author: entry.preview!.author, description: entry.preview!.description, tags: entry.preview!.tags }); setEncoding(entry.preview!.encoding ?? null); }}>预览并确认</Button> : null}
              {entry.status === 'failed' || entry.status === 'uploaded' ? <Button size="xs" loading={busy === entry.id} onClick={() => void act(entry.id, () => retryEbookImport(entry.id))}>重试解析</Button> : null}
              {entry.status === 'failed' && entry.format === 'txt' ? <Button size="xs" variant="light" disabled={Boolean(busy)} onClick={() => void act(entry.id, () => retryEbookImport(entry.id, 'gb18030'))}>按 GB18030 重试</Button> : null}
              {entry.novelId && !entry.deleted ? <Button size="xs" variant="light" onClick={() => { onClose(); onOpenBook(entry.novelId!); }}>打开书籍</Button> : null}
              {entry.novelId && entry.deleted ? <Button size="xs" disabled={Boolean(entry.purging)} loading={busy === entry.id} onClick={() => void act(entry.id, async () => { await restoreLibraryNovelFromTrash('manual', entry.novelId!); onImported(); })}>从回收站恢复</Button> : null}
            </Group>
          </Stack>
        </Paper>)}
      </Stack>
    </Modal>
    <Modal opened={Boolean(selected)} onClose={() => setSelected(null)} title="确认电子书内容" size="lg">
      {selected?.preview ? <Stack>
        {error ? <Alert color="red">{error}</Alert> : null}
        {selected.preview.warnings.map((warning, index) => <Alert key={index} color="yellow">{warning}</Alert>)}
        <TextInput label="书名" required value={draft.title} onChange={event => setDraft({ ...draft, title: event.currentTarget.value })} error={!draft.title.trim() ? '请填写书名' : undefined} />
        <TextInput label="作者" value={draft.author} onChange={event => setDraft({ ...draft, author: event.currentTarget.value })} />
        <Textarea label="简介" value={draft.description} onChange={event => setDraft({ ...draft, description: event.currentTarget.value })} autosize maxRows={5} />
        <TagsInput label="标签" value={draft.tags} onChange={tags => setDraft({ ...draft, tags })} />
        {selected.format === 'txt' ? <Group align="end"><Select label="文本编码" value={encoding} onChange={setEncoding} data={[{ value: 'utf-8', label: 'UTF-8' }, { value: 'gb18030', label: 'GB18030' }]} /><Button variant="light" disabled={!encoding || Boolean(busy)} onClick={() => void act(selected.id, async () => { await retryEbookImport(selected.id, encoding!); setSelected(null); })}>切换编码并重新预览</Button></Group> : null}
        <Text size="sm">共 {selected.preview.chapterCount} 章，以下为前 3 章片段：</Text>
        <Paper withBorder p="sm" style={{ maxHeight: 250, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selected.preview.excerpt}</Paper>
        <Button disabled={!draft.title.trim() || Boolean(busy)} loading={busy === selected.id} onClick={() => void act(selected.id, async () => { await confirmEbookImport(selected.id, draft); setSelected(null); onImported(); })}>确认入库</Button>
      </Stack> : null}
    </Modal>
  </>;
}
