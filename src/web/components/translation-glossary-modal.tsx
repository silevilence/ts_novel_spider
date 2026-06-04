import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
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

  const terms = model.translationTerms;
  const missingTerms = terms.filter((t) => !t.targetTerm);
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
            <Badge variant="light" color="yellow">共 {terms.length} 条</Badge>
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
                label={`全选`}
              />
            ) : null}
          </Group>
          <Group gap="xs">
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
          术语表会在翻译时注入到翻译模型的提示词中，确保人物名、地名、专有名词翻译一致。
        </Text>

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
            还没有术语。添加后会自动应用到翻译流程中，确保专有名词翻译一致。
          </Text>
        ) : (
          <ScrollArea.Autosize mah={420} type="hover">
            <Stack gap="xs">
              {terms.map((term) => (
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
                    <Group justify="space-between" wrap="nowrap">
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
                            {term.targetTerm ? (
                              <>
                                <Text size="xs" c="dimmed">→</Text>
                                <Text size="sm" truncate="end">{term.targetTerm}</Text>
                              </>
                            ) : (
                              <Badge variant="light" color="red" size="xs">待译</Badge>
                            )}
                          </Group>
                          <Group gap="xs" mt={2}>
                            {term.entityType ? (
                              <Badge variant="dot" color="blue" size="xs">
                                {ENTITY_TYPE_OPTIONS.find((o) => o.value === term.entityType)?.label ?? term.entityType}
                              </Badge>
                            ) : null}
                            {term.note ? (
                              <Text size="xs" c="dimmed" truncate="end">{term.note}</Text>
                            ) : null}
                            <Text size="xs" c="dimmed">
                              {new Date(term.updatedAt).toLocaleString('zh-CN')}
                            </Text>
                          </Group>
                        </div>
                      </Group>
                      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
      </Stack>
    </Modal>
  );
}
