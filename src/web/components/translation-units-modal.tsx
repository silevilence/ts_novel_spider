import { useEffect, useState } from 'react';
import { ChapterProcessingActions } from './chapter-processing-actions';
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, Pagination, Paper, ScrollArea, SegmentedControl, Stack, Text } from '@mantine/core';
import { fetchLibraryTranslationUnits, type TranslationUnitStatus, type TranslationUnitStatuses } from '../services/api';
import { buildLibraryReaderPath } from '../services/app-routes';

export type TranslationStatusFilter = TranslationUnitStatus['status'];
const labels: Record<TranslationStatusFilter, string> = { translated: '已译', failed: '失败', pending: '待译' };

interface Props {
  sourceId: string;
  novelId: string;
  status: TranslationStatusFilter | null;
  revision: string;
  onStatusChange: (status: TranslationStatusFilter) => void;
  onClose: () => void;
}

export function TranslationUnitsModal({ sourceId, novelId, status, revision, onStatusChange, onClose }: Props) {
  const [detail, setDetail] = useState<TranslationUnitStatuses | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const opened = status !== null;

  useEffect(() => {
    if (!opened) return;
    let active = true;
    setError(null);
    void fetchLibraryTranslationUnits(sourceId, novelId).then((result) => {
      if (active) setDetail(result);
    }, (cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : '无法加载翻译明细');
    });
    return () => { active = false; };
  }, [sourceId, novelId, opened, revision, refresh]);

  return (
    <Modal opened={opened} onClose={onClose} title="翻译明细" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">包含书名与简介、卷标题和已下载章节。待译包括尚未完成及正在翻译的单元；失败章节可能已有部分译文。</Text>
        {error ? <Alert color="red" title="加载失败">{error}<Button variant="subtle" size="compact-xs" onClick={() => setRefresh((value) => value + 1)}>重新加载明细</Button></Alert> : null}
        {!detail && !error ? <Loader size="sm" aria-label="加载翻译明细" /> : null}
        {detail ? <>
          <Text size="xs" c="dimmed">{detail.scope === 'run' ? '本轮翻译明细' : '当前内容明细（旧任务按已保存的译文和检查点恢复，可能与历史统计不同）'}</Text>
          <SegmentedControl fullWidth value={status ?? 'translated'}
            onChange={(value) => onStatusChange(value as TranslationStatusFilter)}
            data={(Object.keys(labels) as TranslationStatusFilter[]).map((value) => ({
              value, label: `${labels[value]} ${detail.units.filter((unit) => unit.status === value).length}`,
            }))} />
          <TranslationUnitList key={status} sourceId={sourceId} novelId={novelId}
            units={detail.units.filter((unit) => unit.status === status)} />
        </> : null}
      </Stack>
    </Modal>
  );
}

export function TranslationUnitList({ sourceId, novelId, units }: {
  sourceId: string; novelId: string; units: TranslationUnitStatus[];
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(units.length / 50));
  const currentPage = Math.min(page, pages);
  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">共 {units.length} 个翻译单元</Text>
      <ScrollArea.Autosize mah="55vh">
        <Stack gap="xs">
          {units.length === 0 ? <Text size="sm" c="dimmed">此状态下暂无翻译单元。</Text> : null}
          {units.slice((currentPage - 1) * 50, currentPage * 50).map((unit) => (
            <Paper key={unit.id} withBorder p="sm" radius="md">
              <Group gap="xs" align="flex-start" wrap="nowrap">
                <Badge variant="light" color={unit.kind === 'chapter' ? 'orange' : 'gray'} style={{ flexShrink: 0 }}>
                  {unit.kind === 'meta' ? '书名与简介' : unit.kind === 'volume' ? '卷标题' : `第 ${unit.index} 章`}
                </Badge>
                {unit.kind === 'chapter'
                  ? <Anchor size="sm" href={buildLibraryReaderPath(sourceId, novelId, unit.id)} style={{ overflowWrap: 'anywhere' }}>{unit.title}</Anchor>
                  : <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{unit.title}</Text>}
              </Group>
              {unit.kind === 'chapter' ? <ChapterProcessingActions sourceId={sourceId} novelId={novelId} chapterId={unit.id} title={unit.title} /> : null}
              {unit.status === 'failed' ? <Text size="xs" c="red.3" mt="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {unit.errorMessage || '未保存失败详情，可继续翻译重试。'}
              </Text> : null}
            </Paper>
          ))}
        </Stack>
      </ScrollArea.Autosize>
      {pages > 1 ? <Pagination total={pages} value={currentPage} onChange={setPage} size="sm" aria-label="翻译明细分页" /> : null}
    </Stack>
  );
}
