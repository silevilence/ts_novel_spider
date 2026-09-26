import { useState, useEffect, useEffectEvent } from 'react';
import type { StoredTermExtractionRun, StoredTermTranslationRun, TranslationTermStatus } from '../../server/core/novel-repository';
import { fetchLibraryTermTranslation, startLibraryTermTranslation, cancelLibraryTermTranslation } from '../services/api';
import { fetchLibraryTermExtraction, startLibraryTermExtraction, cancelLibraryTermExtraction, bulkUpdateLibraryTermStatus, fetchLibraryTranslationProfile, updateLibraryTranslationProfile, fetchLlmProvidersPreferences } from '../services/api';
import {
  Alert,
  Progress,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Pagination,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import type { LibraryModel } from '../services/library-model';

interface TranslationGlossaryModalProps {
  opened: boolean;
  onClose: () => void;
  model: LibraryModel;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: '未分类' },
  { value: 'character', label: '人物' },
  { value: 'location', label: '地名' },
  { value: 'organization', label: '组织' },
  { value: 'concept', label: '概念' },
  { value: 'item', label: '物品' },
  { value: 'other', label: '其他' },
  { value: 'author', label: '作者' },
];

export function TranslationGlossaryModal({ opened, onClose, model, onNotify }: TranslationGlossaryModalProps) {
  const [sourceTerm, setSourceTerm] = useState('');
  const [targetTerm, setTargetTerm] = useState('');
  const [entityType, setEntityType] = useState<string | null>('');
  const [note, setNote] = useState('');

  // 编辑态
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [editingTargetTerm, setEditingTargetTerm] = useState('');
  const [editingEntityType, setEditingEntityType] = useState<string | null>('');
  const [editingNote, setEditingNote] = useState('');

  // 多选
  const [selectedTermIds, setSelectedTermIds] = useState<Set<string>>(new Set());

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [run, setRun] = useState<StoredTermExtractionRun | null>(null);
  const [translationRun, setTranslationRun] = useState<StoredTermTranslationRun | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [extractionModelKey, setExtractionModelKey] = useState('');
  const [extractionThinkingEnabled, setExtractionThinkingEnabled] = useState(false);
  const [configLocked, setConfigLocked] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const sourceId = model.detail?.novel.sourceId;
  const novelId = model.detail?.novel.metadata.novelId;
  const refreshTerms = useEffectEvent(() => model.fetchTranslationTerms());
  useEffect(() => {
    if (!opened || !sourceId || !novelId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null); setTranslationRun(null); setSelectedTermIds(new Set()); setLoadError(''); setPage(1);
    const poll = async () => {
      try {
        const [payload, translationPayload] = await Promise.all([
          fetchLibraryTermExtraction(sourceId, novelId), fetchLibraryTermTranslation(sourceId, novelId),
        ]);
        if (!active) return;
        setRun(payload.run); setLoadError('');
        setTranslationRun(translationPayload.run);
        await refreshTerms();
      } catch (error) { if (active) setLoadError(error instanceof Error ? error.message : '提取进度加载失败。'); }
      if (active) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    void Promise.all([fetchLibraryTranslationProfile(sourceId, novelId), fetchLlmProvidersPreferences()]).then(([{ translation: profile }, providers]) => {
      if (!active) return;
      setConfigLocked(profile.configLocked);
      setExtractionThinkingEnabled(profile.termExtractionThinkingEnabled);
      const route = profile.termExtractionModel;
      setExtractionModelKey(route?.providerId && route.modelId ? `${route.providerId}:${route.modelId}` : '');
      setModelOptions(providers.providers.filter((p) => p.enabled).flatMap((p) => p.models.filter((m) => m.enabled && m.resolvedCapabilities.includes('chat')).map((m) => ({ value: `${p.id}:${m.modelId}`, label: `${p.label} / ${m.label || m.modelId}` }))));
    }).catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : '模型配置加载失败。'); });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [opened, sourceId, novelId]);

  async function perform(action: () => Promise<unknown>) {
    setActionBusy(true);
    try { await action(); await model.fetchTranslationTerms(); }
    catch (error) { onNotify({ tone: 'error', title: '操作失败', message: error instanceof Error ? error.message : '请重试。' }); }
    finally { setActionBusy(false); }
  }
  function changeStatus(ids: string[], status: TranslationTermStatus) {
    if (!sourceId || !novelId) return;
    void perform(async () => {
      await bulkUpdateLibraryTermStatus(sourceId, novelId, ids, status);
      setSelectedTermIds(new Set());
      onNotify({ tone: 'success', title: '术语状态已更新', message: `已处理 ${ids.length} 条术语。` });
    });
  }
  const statusLabels = { pending: '待确认', confirmed: '已确认', excluded: '已排除' };
  const terms = model.translationTerms.filter((term) => statusFilter === 'all' || term.status === statusFilter);
  const pageCount = Math.max(1, Math.ceil(terms.length / 50));
  const currentPage = Math.min(page, pageCount);
  const visibleTerms = terms.slice((currentPage - 1) * 50, currentPage * 50);
  const missingTerms = model.translationTerms.filter((t) => t.status === 'confirmed' && !t.targetTerm?.trim());
  const selectableTerms = terms.filter((t) => t.id !== editingTermId);
  const allSelected = selectableTerms.length > 0 && selectableTerms.every((t) => selectedTermIds.has(t.id));
  const someSelected = selectedTermIds.size > 0 && !allSelected;

  function resetForm() {
    setSourceTerm('');
    setTargetTerm('');
    setEntityType('');
    setNote('');
  }

  function resetEditing() {
    setEditingTermId(null);
    setEditingTargetTerm('');
    setEditingEntityType('');
    setEditingNote('');
  }

  function startEdit(term: typeof terms[number]) {
    setEditingTermId(term.id);
    setEditingTargetTerm(term.targetTerm ?? '');
    setEditingEntityType(term.entityType ?? '');
    setEditingNote(term.note ?? '');
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>管理术语表</Text>}
      size="lg"
      styles={{
        content: { background: 'rgba(15,10,8,0.97)' },
        header: { background: 'rgba(15,10,8,0.97)', borderBottom: '1px solid rgba(168,133,96,0.12)' },
      }}
    >
      <Stack gap="md">
        {/* 统计与操作栏 */}
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Badge variant="light" color="yellow">共 {model.translationTerms.length} 条</Badge>
            <Badge variant="light" color="orange">待确认 {model.pendingTermCount} 条</Badge>
            {missingTerms.length > 0 ? (
              <Badge variant="light" color="red">缺译 {missingTerms.length} 条</Badge>
            ) : null}
            {terms.length > 0 ? (
              <Checkbox
                size="xs"
                indeterminate={someSelected}
                checked={allSelected}
                onChange={() => {
                  if (allSelected) {
                    setSelectedTermIds(new Set());
                  } else {
                    setSelectedTermIds(new Set(selectableTerms.map((t) => t.id)));
                  }
                }}
                label={`全选当前筛选（${selectableTerms.length} 条）`}
              />
            ) : null}
          </Group>
          <Group gap="xs">
            {selectedTermIds.size > 0 ? <><Button size="compact-sm" disabled={actionBusy} onClick={() => changeStatus([...selectedTermIds], 'confirmed')}>确认所选</Button><Button size="compact-sm" variant="light" color="gray" disabled={actionBusy} onClick={() => changeStatus([...selectedTermIds], 'excluded')}>排除所选</Button></> : null}
            {selectedTermIds.size > 0 ? (
              <Button
                color="red"
                variant="subtle"
                size="compact-sm"
                onClick={() => {
                  const ids = [...selectedTermIds];
                  setSelectedTermIds(new Set());
                  void model.removeTranslationTerms(ids);
                }}
                loading={model.mutationBusyKey === 'term-batch-delete'}
              >
                删除所选 ({selectedTermIds.size})
              </Button>
            ) : null}
            {model.detail && model.detail.knowledgeGraph.entities.length > 0 ? (
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() => void model.importTermsFromGraph()}
                loading={model.mutationBusyKey === 'term-import'}
              >
                从知识图谱导入 ({model.detail.knowledgeGraph.entities.length} 个实体)
              </Button>
            ) : null}
          </Group>
        </Group>

        <Text size="xs" c="dimmed">
          仅已确认术语参与翻译。待确认候选不计入缺译；已排除术语不会因重复提取而重新出现。
        </Text>

        <Select label="术语状态" value={statusFilter} onChange={(value) => { setStatusFilter(value ?? 'all'); setSelectedTermIds(new Set()); setPage(1); }} data={[{ value: 'all', label: '全部状态' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
        <Paper p="sm" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
          <Stack gap="xs">
            <Select label="本书术语提取模型" description="留空继承全局术语提取模型，再回退默认对话模型。" data={modelOptions} value={extractionModelKey || null} onChange={(value) => setExtractionModelKey(value ?? '')} disabled={configLocked || actionBusy || run?.status === 'running'} searchable clearable />
            <Switch label="术语提取启用模型思考" description="默认关闭，仅影响术语提取。需模型支持原生思考切换；保存后下次提取生效。" checked={extractionThinkingEnabled} disabled={configLocked || actionBusy || run?.status === 'running'} onChange={(event) => setExtractionThinkingEnabled(event.currentTarget.checked)} />
            <Group gap="xs">
              <Button variant="subtle" size="compact-sm" disabled={configLocked || actionBusy || run?.status === 'running'} onClick={() => {
                if (!sourceId || !novelId) return;
                void perform(async () => {
                  const split = extractionModelKey.indexOf(':');
                  await updateLibraryTranslationProfile(sourceId, novelId, { termExtractionModel: extractionModelKey ? { providerId: extractionModelKey.slice(0, split), modelId: extractionModelKey.slice(split + 1) } : null, termExtractionThinkingEnabled: extractionThinkingEnabled });
                  onNotify({ tone: 'success', title: '提取配置已保存', message: '下次提取使用此模型和思考设置。' });
                });
              }}>保存提取配置</Button>
              <Button size="compact-sm" loading={actionBusy} disabled={!sourceId || !novelId || run?.status === 'running'} onClick={() => {
                if (!sourceId || !novelId) return;
                void perform(async () => { const result = await startLibraryTermExtraction(sourceId, novelId); setRun(result.run); });
              }}>AI 提取候选</Button>
              {run?.status === 'running' ? <Button size="compact-sm" variant="outline" color="red" disabled={actionBusy} onClick={() => {
                if (!sourceId || !novelId) return;
                void perform(async () => { const result = await cancelLibraryTermExtraction(sourceId, novelId); setRun(result.run); });
              }}>取消提取</Button> : null}
            </Group>
            <Text size="xs" c="dimmed">提取在后台分批执行，关闭浮窗后仍会继续。修改模型后请先保存。</Text>
            {loadError ? <Alert color="red">{loadError}</Alert> : null}
            {run ? <Stack gap={4}>
              <Text size="sm" fw={600}>{run.status === 'running' ? '正在提取候选' : run.status === 'completed' ? '提取完成' : run.status === 'cancelled' ? '提取已取消' : '提取失败'}</Text>
              <Progress value={run.totalBatches ? run.completedBatches / run.totalBatches * 100 : 0} animated={run.status === 'running'} />
              <Text size="xs">已跑 {run.completedBatches}/{run.totalBatches} 批 · 识别 {run.candidates} 条候选 · 本次新增 {run.added} 条</Text>
              {run.errorMessage ? <Text size="xs" c="red">{run.errorMessage}</Text> : null}
            </Stack> : null}
          </Stack>
        </Paper>

        {/* 缺译术语翻译 */}
        <Paper p="sm" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
          <Stack gap="xs">
            <Group gap="xs">
              <Button size="compact-sm" loading={actionBusy} disabled={!sourceId || !novelId || !missingTerms.length || translationRun?.status === 'running'} onClick={() => {
                if (!sourceId || !novelId) return;
                void perform(async () => {
                  const result = await startLibraryTermTranslation(sourceId, novelId);
                  setTranslationRun(result.run);
                  onNotify({ tone: 'success', title: '术语翻译已启动', message: `正在后台翻译 ${result.run.totalTerms} 条缺译术语。` });
                });
              }}>AI 翻译缺译术语（{missingTerms.length}）</Button>
              {translationRun?.status === 'running' ? <Button size="compact-sm" variant="outline" color="red" disabled={actionBusy} onClick={() => {
                if (!sourceId || !novelId) return;
                void perform(async () => { const result = await cancelLibraryTermTranslation(sourceId, novelId); setTranslationRun(result.run); });
              }}>取消术语翻译</Button> : null}
            </Group>
            <Text size="xs" c="dimmed">翻译全书所有已确认且译文为空的术语，不受筛选或勾选影响。使用上方已保存的术语提取模型及本书目标语言；关闭浮窗后继续运行，已有译文保留。</Text>
            {translationRun ? <Stack gap={4}>
              <Text size="sm" fw={600}>{translationRun.status === 'running' ? '正在翻译术语' : translationRun.status === 'completed' ? '术语翻译完成' : translationRun.status === 'cancelled' ? '术语翻译已取消' : '术语翻译失败'}</Text>
              <Progress value={translationRun.totalTerms ? translationRun.processedTerms / translationRun.totalTerms * 100 : 0} animated={translationRun.status === 'running'} />
              <Text size="xs">已处理 {translationRun.processedTerms}/{translationRun.totalTerms} 条 · 已翻译 {translationRun.translatedTerms} 条 · 因条目变更跳过 {translationRun.skippedTerms} 条</Text>
              {translationRun.errorMessage ? <Text size="xs" c="red">{translationRun.errorMessage}</Text> : null}
              {translationRun.status === 'failed' || translationRun.status === 'cancelled' ? <Text size="xs" c="dimmed">已完成的译文已保存，可再次点击翻译剩余缺译术语。</Text> : null}
            </Stack> : null}
          </Stack>
        </Paper>

        {/* 新增表单 */}
        <Paper p="sm" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
          <Stack gap="xs">
            <Text size="xs" fw={600}>新增术语</Text>
            <Group gap="xs" wrap="wrap">
              <TextInput
                size="xs"
                value={sourceTerm}
                onChange={(e) => setSourceTerm(e.target.value)}
                placeholder="源术语（原文，必填）"
                style={{ flex: 1, minWidth: 140 }}
                error={false}
              />
              <TextInput
                size="xs"
                value={targetTerm}
                onChange={(e) => setTargetTerm(e.target.value)}
                placeholder="目标译文（留空则自动待译）"
                style={{ flex: 1, minWidth: 140 }}
              />
              <Select
                size="xs"
                data={ENTITY_TYPE_OPTIONS}
                value={entityType}
                onChange={setEntityType}
                placeholder="实体类型"
                clearable
                style={{ minWidth: 100 }}
              />
            </Group>
            <Group gap="xs" wrap="wrap">
              <TextInput
                size="xs"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="备注（选填）"
                style={{ flex: 1, minWidth: 140 }}
              />
              <Button
                color="brand"
                size="compact-sm"
                onClick={() => {
                  if (sourceTerm.trim().length === 0) return;
                  void model.addTranslationTerm({
                    sourceTerm: sourceTerm.trim(),
                    targetTerm: targetTerm.trim() || null,
                    entityType: entityType || null,
                    note: note.trim() || null,
                  });
                  resetForm();
                }}
                loading={model.mutationBusyKey === 'term-create'}
                disabled={sourceTerm.trim().length === 0}
              >
                添加
              </Button>
            </Group>
          </Stack>
        </Paper>

        {/* 术语列表 */}
        {terms.length === 0 ? (
          <Text size="xs" c="dimmed">
            当前筛选下没有术语。可先提取 AI 候选或手动添加已确认术语。
          </Text>
        ) : (
          <ScrollArea.Autosize mah={420} type="hover">
            <Stack gap="xs">
              {visibleTerms.map((term) => (
                <Paper key={term.id} p="xs" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
                  {editingTermId === term.id ? (
                    <Stack gap="xs">
                      <Group gap="xs" wrap="wrap">
                        <Text size="xs" fw={600} style={{ minWidth: 80, alignSelf: 'center' }}>
                          {term.sourceTerm}
                        </Text>
                        <TextInput
                          size="xs"
                          value={editingTargetTerm}
                          onChange={(e) => setEditingTargetTerm(e.target.value)}
                          placeholder="目标译文"
                          style={{ flex: 1, minWidth: 120 }}
                        />
                        <Select
                          size="xs"
                          data={ENTITY_TYPE_OPTIONS}
                          value={editingEntityType}
                          onChange={setEditingEntityType}
                          placeholder="类型"
                          clearable
                          style={{ minWidth: 100 }}
                        />
                      </Group>
                      <Group gap="xs" wrap="wrap">
                        <TextInput
                          size="xs"
                          value={editingNote}
                          onChange={(e) => setEditingNote(e.target.value)}
                          placeholder="备注"
                          style={{ flex: 1, minWidth: 120 }}
                        />
                        <Button
                          size="compact-xs"
                          color="brand"
                          onClick={() => {
                            void model.updateTranslationTerm(term.id, {
                              targetTerm: editingTargetTerm.trim() || null,
                              entityType: editingEntityType || null,
                              note: editingNote.trim() || null,
                            });
                            resetEditing();
                          }}
                          loading={model.mutationBusyKey === `term:${term.id}`}
                        >
                          保存
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={resetEditing}>
                          取消
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    <Group justify="space-between" wrap="wrap">
                      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                        <Checkbox
                          size="xs"
                          checked={selectedTermIds.has(term.id)}
                          onChange={() => {
                            const next = new Set(selectedTermIds);
                            if (next.has(term.id)) {
                              next.delete(term.id);
                            } else {
                              next.add(term.id);
                            }
                            setSelectedTermIds(next);
                          }}
                          aria-label={`选择术语 ${term.sourceTerm}`}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Group gap="xs" wrap="nowrap">
                            <Text size="sm" fw={600} truncate="end">{term.sourceTerm}</Text>
                            <Badge size="xs" variant="light" color={term.status === 'confirmed' ? 'green' : term.status === 'pending' ? 'orange' : 'gray'}>{statusLabels[term.status]}</Badge>
                            {term.targetTerm ? (
                              <>
                                <Text size="xs" c="dimmed">→</Text>
                                <Text size="sm" truncate="end">{term.targetTerm}</Text>
                              </>
                            ) : (
                              term.status === 'confirmed' ? <Badge variant="light" color="red" size="xs">待译</Badge> : null
                            )}
                          </Group>
                          <Group gap="xs" mt={2}>
                            {term.entityType ? (
                              <Badge variant="dot" color="blue" size="xs">
                                {ENTITY_TYPE_OPTIONS.find((o) => o.value === term.entityType)?.label ?? term.entityType}
                              </Badge>
                            ) : null}
                            {term.extractedFromChapterId ? <Text size="xs" c="dimmed">来源：{model.detail?.novel.chapters.find((chapter) => chapter.id === term.extractedFromChapterId)?.title ?? term.extractedFromChapterId}</Text> : null}
                            {term.note ? (
                              <Text size="xs" c="dimmed" truncate="end">{term.note}</Text>
                            ) : null}
                            <Text size="xs" c="dimmed">
                              {new Date(term.updatedAt).toLocaleString('zh-CN')}
                            </Text>
                          </Group>
                        </div>
                      </Group>
                      <Group gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
                        {term.status !== 'confirmed' ? <Button size="compact-xs" variant="light" disabled={actionBusy} onClick={() => changeStatus([term.id], 'confirmed')}>确认</Button> : null}
                        {term.status !== 'excluded' ? <Button size="compact-xs" variant="subtle" color="gray" disabled={actionBusy} onClick={() => changeStatus([term.id], 'excluded')}>排除</Button> : null}
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          onClick={() => startEdit(term)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          color="red"
                          onClick={() => void model.removeTranslationTerm(term.id)}
                          loading={model.mutationBusyKey === `term:${term.id}`}
                        >
                          删除
                        </Button>
                      </Group>
                    </Group>
                  )}
                </Paper>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        {pageCount > 1 ? <Pagination aria-label="术语列表分页" total={pageCount} value={currentPage} onChange={setPage} size="sm" /> : null}
      </Stack>
    </Modal>
  );
}
