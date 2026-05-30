import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Indicator,
  Modal,
  PasswordInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconPencil,
  IconPlugConnected,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';

import {
  discoverLlmProviderModels,
  fetchLlmProvidersPreferences,
  updateLlmProvidersPreferences,
  validateLlmProviderModel,
  type DiscoverLlmProviderModelsInput,
  type LlmProviderType,
  type ModelCapability,
  type UpdateLlmModelInput,
  type UpdateLlmProviderInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import type { ControlLlmProvidersPayload, ControlLlmProviderModelsPayload } from '../../server/routes/control-center';

// ── Types ──

interface LlmProviderPanelProps {
  onNotice?: (notice: NoticeInput) => void;
}

interface ProviderDraft extends UpdateLlmProviderInput {
  models: ModelDraft[];
}

interface ModelDraft extends UpdateLlmModelInput {}

interface ProviderFormData {
  label: string;
  type: LlmProviderType;
  baseUrl: string;
  apiKey: string;
  organization: string;
}

// ── Constants ──

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  chat: '💬 对话',
  embedding: '🧬 嵌入',
  rerank: '🔄 重排',
};

const CAPABILITY_COLORS: Record<ModelCapability, string> = {
  chat: 'blue',
  embedding: 'green',
  rerank: 'orange',
};

const PROVIDER_TYPE_OPTIONS: Array<{
  value: LlmProviderType;
  label: string;
  defaultBaseUrl: string;
}> = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口', defaultBaseUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic Messages', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  { value: 'google-generative-ai', label: 'Google Generative AI', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { value: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434' },
];

function getTypeMeta(type: LlmProviderType) {
  return PROVIDER_TYPE_OPTIONS.find((o) => o.value === type) ?? PROVIDER_TYPE_OPTIONS[0]!;
}

function emptyProviderForm(type?: LlmProviderType): ProviderFormData {
  const resolvedType = type ?? 'openai-compatible';
  return { label: '', type: resolvedType, baseUrl: '', apiKey: '', organization: '' };
}

function createEmptyDraft(type?: LlmProviderType): ProviderDraft {
  return {
    id: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: '',
    type: type ?? 'openai-compatible',
    enabled: true,
    baseUrl: '',
    apiKey: '',
    organization: '',
    models: [],
  };
}

// ── Component ──

export function LlmProviderPanel({ onNotice }: LlmProviderPanelProps) {
  const theme = useMantineTheme();

  // Data state
  const [serverState, setServerState] = useState<ControlLlmProvidersPayload | null>(null);
  const [draft, setDraft] = useState<ProviderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [editModalOpen, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [discoverModalOpen, { open: openDiscover, close: closeDiscover }] = useDisclosure(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [discoveringProviderId, setDiscoveringProviderId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>(emptyProviderForm());

  // Discovery state
  const [catalogModels, setCatalogModels] = useState<ControlLlmProviderModelsPayload['models']>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogFilter, setCatalogFilter] = useState('');

  // Validation state
  const [validatingKey, setValidatingKey] = useState<string | null>(null);

  // Expanded model IDs
  const [expandedModelIds, setExpandedModelIds] = useState<Set<string>>(new Set());

  // ── Load ──
  useEffect(() => {
    let active = true;
    fetchLlmProvidersPreferences()
      .then((payload) => {
        if (active) {
          applyServerPayload(payload);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function applyServerPayload(payload: ControlLlmProvidersPayload) {
    startTransition(() => {
      setServerState(payload);
      setDraft(payload.providers.map(toDraft));
      setError(null);
    });
  }

  // ── Edit Modal ──
  function handleAddProvider() {
    setEditingProviderId(null);
    setFormData(emptyProviderForm());
    openEdit();
  }

  function handleEditProvider(providerId: string) {
    const provider = draft.find((p) => p.id === providerId);
    if (!provider) return;
    setEditingProviderId(providerId);
    setFormData({
      label: provider.label,
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      organization: provider.organization ?? '',
    });
    openEdit();
  }

  function handleSaveProvider() {
    const fd = formData;
    if (editingProviderId) {
      setDraft((prev) =>
        prev.map((p) =>
          p.id === editingProviderId
            ? { ...p, label: fd.label, type: fd.type, baseUrl: fd.baseUrl, apiKey: fd.apiKey, organization: fd.organization }
            : p,
        ),
      );
    } else {
      const newProvider = createEmptyDraft(fd.type);
      newProvider.label = fd.label;
      newProvider.baseUrl = fd.baseUrl;
      newProvider.apiKey = fd.apiKey;
      newProvider.organization = fd.organization;
      setDraft((prev) => [...prev, newProvider]);
    }
    closeEdit();
  }

  function handleDeleteProvider(providerId: string) {
    setDraft((prev) => prev.filter((p) => p.id !== providerId));
    if (editingProviderId === providerId) closeEdit();
    if (discoveringProviderId === providerId) closeDiscover();
  }

  function handleToggleProvider(providerId: string) {
    setDraft((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, enabled: !p.enabled } : p)),
    );
  }

  // ── Model management (inside edit modal) ──
  function handleAddModel(providerId: string) {
    const model: ModelDraft = {
      id: `new-model-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: '',
      modelId: '',
      enabled: true,
      capabilityMode: 'auto',
      capabilities: ['chat'],
      defaultFor: [],
      contextWindowTokens: 0,
    };
    setDraft((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, models: [...p.models, model] } : p)),
    );
  }

  function handleRemoveModel(providerId: string, modelId: string) {
    setDraft((prev) =>
      prev.map((p) =>
        p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p,
      ),
    );
  }

  function handleModelField(
    providerId: string,
    modelId: string,
    field: keyof ModelDraft,
    value: unknown,
  ) {
    setDraft((prev) =>
      prev.map((p) =>
        p.id === providerId
          ? { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, [field]: value } : m)) }
          : p,
      ),
    );
  }

  // ── Discovery ──
  function handleOpenDiscover(providerId: string) {
    const provider = draft.find((p) => p.id === providerId);
    if (!provider) return;
    setDiscoveringProviderId(providerId);
    setCatalogModels([]);
    setCatalogError(null);
    setCatalogFilter('');
    setCatalogLoading(true);
    openDiscover();

    discoverLlmProviderModels(buildDiscoveryInput(provider))
      .then((payload) => setCatalogModels(payload.models))
      .catch((err) => setCatalogError(err instanceof Error ? err.message : '拉取失败'))
      .finally(() => setCatalogLoading(false));
  }

  function handleImportModels(providerId: string, modelIds: string[]) {
    const toImport = catalogModels.filter((m) => modelIds.includes(m.modelId));
    let importedCount = 0;
    setDraft((prev) =>
      prev.map((p) => {
        if (p.id !== providerId) return p;
        const existing = new Set(p.models.map((m) => m.modelId.toLowerCase()));
        const newModels = toImport
          .filter((m) => !existing.has(m.modelId.toLowerCase()))
          .map((m) => ({
            id: `import-${providerId}-${m.modelId}-${Date.now()}`,
            label: m.label || m.modelId,
            modelId: m.modelId,
            enabled: true,
            capabilityMode: 'auto' as const,
            capabilities: m.detectedCapabilities.length > 0 ? m.detectedCapabilities : (['chat'] as ModelCapability[]),
            defaultFor: [] as ModelCapability[],
            contextWindowTokens: 0,
          }));
        importedCount = newModels.length;
        return { ...p, models: [...p.models, ...newModels] };
      }),
    );
    onNotice?.({ tone: 'success', title: '模型已导入', message: `成功导入 ${importedCount} 个模型。` });
  }

  // ── Validation ──
  async function handleValidate(providerId: string, modelId: string) {
    const key = `${providerId}:${modelId}`;
    setValidatingKey(key);
    try {
      const payload = await validateLlmProviderModel(providerId, modelId);
      applyServerPayload(payload);
    } catch {
      onNotice?.({ tone: 'error', title: '测试失败', message: '模型连通性测试出错。' });
    } finally {
      setValidatingKey(null);
    }
  }

  // ── Save ──
  async function handleSave() {
    setSaving(true);
    try {
      const inputs: UpdateLlmProviderInput[] = draft.map((p) => ({
        id: p.id.startsWith('new-') ? '' : p.id,
        label: p.label,
        type: p.type,
        enabled: p.enabled,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        organization: p.organization || '',
        models: p.models.map((m) => ({
            id: (m.id.startsWith('new-model-') || m.id.startsWith('import-')) ? '' : m.id,
          label: m.label,
          modelId: m.modelId,
          enabled: m.enabled,
          capabilityMode: m.capabilityMode,
          capabilities: m.capabilities,
          defaultFor: m.defaultFor,
          contextWindowTokens: m.contextWindowTokens ?? 0,
        })),
      }));
      const payload = await updateLlmProvidersPreferences(inputs);
      applyServerPayload(payload);
      onNotice?.({ tone: 'success', title: '已保存', message: `已保存 ${payload.providers.length} 个服务配置。` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      onNotice?.({ tone: 'error', title: '保存失败', message: msg });
    } finally {
      setSaving(false);
    }
  }

  // ── Computed ──
  const providerCount = draft.length;
  const modelCount = draft.reduce((s, p) => s + p.models.length, 0);

  const editingProvider = editingProviderId ? draft.find((p) => p.id === editingProviderId) : null;
  const editingServerProvider = editingProviderId ? serverState?.providers.find((p) => p.id === editingProviderId) : null;

  const discoverProvider = discoveringProviderId ? draft.find((p) => p.id === discoveringProviderId) : null;
  const existingModelIds = new Set(
    (discoverProvider?.models ?? []).map((m) => m.modelId.trim().toLowerCase()).filter(Boolean),
  );
  const filteredCatalog = catalogFilter.trim()
    ? catalogModels.filter((m) =>
        [m.label, m.modelId, m.description ?? ''].join(' ').toLowerCase().includes(catalogFilter.trim().toLowerCase()),
      )
    : catalogModels;

  // ── Render ──
  if (loading) {
    return (
      <Stack gap="md">
        <Text size="sm" c="dimmed">正在加载模型服务配置...</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      {error ? (
        <Text size="sm" c="red">{error}</Text>
      ) : null}

      {/* Summary strip */}
      <Group gap="sm" wrap="wrap">
        <Badge variant="light" color="gray" size="lg">{providerCount} 个服务</Badge>
        <Badge variant="light" color="gray" size="lg">{modelCount} 个模型</Badge>
        <Button
          variant="light"
          size="compact-sm"
          color="brand"
          leftSection={<IconPlus size={16} />}
          onClick={handleAddProvider}
        >
          添加服务
        </Button>
        <Button
          variant="filled"
          size="compact-sm"
          color="brand"
          loading={saving}
          onClick={() => void handleSave()}
        >
          保存全部
        </Button>
      </Group>

      {/* Provider Cards Grid */}
      {draft.length === 0 ? (
        <Card p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.6)' }}>
          <Stack align="center" gap="md">
            <IconBrain size={48} opacity={0.3} />
            <Text c="dimmed">尚未配置任何模型服务</Text>
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={handleAddProvider}>
              添加第一个服务
            </Button>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {draft.map((provider) => {
            const serverProv = serverState?.providers.find((p) => p.id === provider.id);
            const configured = serverProv?.isConfigured ?? false;
            const typeMeta = getTypeMeta(provider.type);
            const enabledModelCount = provider.models.filter((m) => m.enabled).length;

            return (
              <Card
                key={provider.id}
                padding="md"
                radius="lg"
                style={{
                  background: provider.enabled
                    ? 'rgba(31,21,16,0.84)'
                    : 'rgba(20,14,10,0.6)',
                  border: `1px solid ${theme.other.lineColor as string}`,
                  opacity: provider.enabled ? 1 : 0.6,
                }}
              >
                <Stack gap="xs">
                  {/* Header row */}
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={700} size="sm" truncate>
                      {provider.label.trim() || '未命名'}
                    </Text>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="编辑">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="gray"
                          onClick={() => handleEditProvider(provider.id)}
                        >
                          <IconPencil size={15} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="删除">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="red"
                          onClick={() => handleDeleteProvider(provider.id)}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  {/* Status indicators */}
                  <Group gap={6} wrap="wrap">
                    <Badge size="xs" variant="light" color="gray">
                      {typeMeta.label}
                    </Badge>
                    <Indicator
                      color={configured ? 'green' : 'yellow'}
                      size={6}
                      withBorder
                      label=""
                    >
                      <Badge size="xs" variant="light" color={configured ? 'green' : 'yellow'}>
                        {configured ? '已配置' : '待补凭证'}
                      </Badge>
                    </Indicator>
                  </Group>

                  {/* Model count */}
                  <Text size="xs" c="dimmed">
                    {provider.models.length} 个模型
                    {enabledModelCount < provider.models.length ? `（${enabledModelCount} 个启用）` : ''}
                  </Text>

                  {/* Actions */}
                  <Group gap={4} mt="auto">
                    <Tooltip label="切换启停">
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        color={provider.enabled ? 'green' : 'gray'}
                        onClick={() => handleToggleProvider(provider.id)}
                        leftSection={provider.enabled ? <IconCheck size={14} /> : <IconX size={14} />}
                      >
                        {provider.enabled ? '已启用' : '已停用'}
                      </Button>
                    </Tooltip>
                    <Tooltip label="从接口拉取模型列表">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="gray"
                        onClick={() => handleOpenDiscover(provider.id)}
                      >
                        <IconDownload size={15} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}

      {/* ── Edit Provider Modal ── */}
      <Modal
        opened={editModalOpen}
        onClose={closeEdit}
        title={
          <Title order={4}>
            {editingProviderId ? '编辑服务' : '添加服务'}
          </Title>
        }
        size="lg"
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        <Stack gap="md">
          <TextInput
            label="服务名称"
            value={formData.label}
            onChange={(e) => setFormData((f) => ({ ...f, label: e.target.value }))}
            placeholder="例如 深度求索"
          />
          <Select
            label="协议类型"
            data={PROVIDER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={formData.type}
            onChange={(v) => {
              const newType = (v as LlmProviderType) ?? 'openai-compatible';
              const meta = getTypeMeta(newType);
              setFormData((f) => ({ ...f, type: newType, baseUrl: f.baseUrl || meta.defaultBaseUrl }));
            }}
          />
          <TextInput
            label="API 地址"
            value={formData.baseUrl}
            onChange={(e) => setFormData((f) => ({ ...f, baseUrl: e.target.value }))}
            placeholder={getTypeMeta(formData.type).defaultBaseUrl}
          />
          {formData.type === 'openai-compatible' ? (
            <TextInput
              label="组织 ID（可选）"
              value={formData.organization}
              onChange={(e) => setFormData((f) => ({ ...f, organization: e.target.value }))}
              placeholder="可选"
            />
          ) : null}
          <PasswordInput
            label={formData.type === 'ollama' ? 'API Key（可选）' : 'API Key'}
            value={formData.apiKey}
            onChange={(e) => setFormData((f) => ({ ...f, apiKey: e.target.value }))}
            placeholder={formData.type === 'ollama' ? '本地部署通常留空' : '输入 API Key'}
          />

          {/* Model list inside edit modal */}
          {editingProvider && editingProviderId ? (
            <>
              <Group justify="space-between" mt="md">
                <Text fw={600} size="sm">
                  模型列表（{editingProvider.models.length} 个）
                </Text>
                <Button
                  variant="light"
                  size="compact-xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => handleAddModel(editingProviderId!)}
                >
                  手动添加
                </Button>
              </Group>

              {editingProvider.models.length === 0 ? (
                <Text size="xs" c="dimmed">暂无模型，可从接口拉取或手动添加。</Text>
              ) : (
                <ScrollArea.Autosize mah={300} mx="auto">
                  <Table verticalSpacing="xs" fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>显示名 / ID</Table.Th>
                        <Table.Th>能力</Table.Th>
                        <Table.Th>状态</Table.Th>
                        <Table.Th w={80}>操作</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {editingProvider.models.map((model) => {
                        const serverModel = editingServerProvider?.models.find((m) => m.id === model.id);
                        const resolvedCaps = serverModel?.resolvedCapabilities ?? model.capabilities;
                        const validation = serverState?.validations.find(
                          (v) => v.providerId === editingProviderId && v.modelId === model.id,
                        );
                        const isExpanded = expandedModelIds.has(model.id);

                        return (
                          <>
                            <Table.Tr key={model.id}>
                              <Table.Td>
                                <Text size="xs" fw={600} truncate maw={180}>
                                  {model.label.trim() || '未命名'}
                                </Text>
                                <Text size="xs" c="dimmed" truncate maw={180}>
                                  {model.modelId.trim() || '未填 ID'}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={3} wrap="wrap">
                                  {resolvedCaps.map((cap) => (
                                    <Badge key={cap} size="xs" variant="light" color={CAPABILITY_COLORS[cap]}>
                                      {CAPABILITY_LABELS[cap]}
                                    </Badge>
                                  ))}
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={4} wrap="nowrap">
                                  <Indicator
                                    color={validation?.ok ? 'green' : validation ? 'red' : 'gray'}
                                    size={6}
                                    processing={validatingKey === `${editingProviderId}:${model.id}`}
                                    withBorder
                                  />
                                  <Text size="xs" c="dimmed">
                                    {model.enabled ? '启用' : '停用'}
                                  </Text>
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={2}>
                                  <Tooltip label="展开详情">
                                    <ActionIcon
                                      variant="subtle"
                                      size="xs"
                                      onClick={() => {
                                        setExpandedModelIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(model.id)) next.delete(model.id);
                                          else next.add(model.id);
                                          return next;
                                        });
                                      }}
                                    >
                                      {isExpanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                                    </ActionIcon>
                                  </Tooltip>
                                  <Tooltip label="测试连通性">
                                    <ActionIcon
                                      variant="subtle"
                                      size="xs"
                                      color="blue"
                                      loading={validatingKey === `${editingProviderId}:${model.id}`}
                                      onClick={() => void handleValidate(editingProviderId!, model.id)}
                                    >
                                      <IconPlugConnected size={13} />
                                    </ActionIcon>
                                  </Tooltip>
                                  <Tooltip label="删除模型">
                                    <ActionIcon
                                      variant="subtle"
                                      size="xs"
                                      color="red"
                                      onClick={() => handleRemoveModel(editingProviderId!, model.id)}
                                    >
                                      <IconTrash size={13} />
                                    </ActionIcon>
                                  </Tooltip>
                                </Group>
                              </Table.Td>
                            </Table.Tr>

                            {/* Expanded row */}
                            {isExpanded ? (
                              <Table.Tr key={`${model.id}-expanded`}>
                                <Table.Td colSpan={4}>
                                  <Stack gap="xs" p="xs">
                                    <TextInput
                                      label="显示名称"
                                      size="xs"
                                      value={model.label}
                                      onChange={(e) => handleModelField(editingProviderId!, model.id, 'label', e.target.value)}
                                    />
                                    <TextInput
                                      label="模型 ID"
                                      size="xs"
                                      value={model.modelId}
                                      onChange={(e) => handleModelField(editingProviderId!, model.id, 'modelId', e.target.value)}
                                      placeholder={editingProvider.type === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'}
                                    />
                                    {resolvedCaps.includes('chat') ? (
                                      <TextInput
                                        label="上下文 Token 上限（0=不限制）"
                                        size="xs"
                                        type="number"
                                        value={model.contextWindowTokens ?? 0}
                                        onChange={(e) => handleModelField(editingProviderId!, model.id, 'contextWindowTokens', Number(e.target.value) || 0)}
                                      />
                                    ) : null}
                                    <Checkbox
                                      label="参与默认调度"
                                      size="xs"
                                      checked={model.enabled}
                                      onChange={(e) => handleModelField(editingProviderId!, model.id, 'enabled', e.currentTarget.checked)}
                                    />
                                  </Stack>
                                </Table.Td>
                              </Table.Tr>
                            ) : null}
                          </>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              )}
            </>
          ) : null}

          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={closeEdit}>取消</Button>
            <Button onClick={handleSaveProvider} color="brand">
              {editingProviderId ? '保存' : '添加'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Model Discovery Modal ── */}
      <Modal
        opened={discoverModalOpen}
        onClose={closeDiscover}
        title={<Title order={4}>从接口拉取模型列表</Title>}
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="按模型名或 ID 筛选"
            value={catalogFilter}
            onChange={(e) => setCatalogFilter(e.target.value)}
          />

          {catalogError ? <Text size="sm" c="red">{catalogError}</Text> : null}
          {catalogLoading ? <Text size="sm" c="dimmed">正在拉取...</Text> : null}

          {!catalogLoading && filteredCatalog.length === 0 && !catalogError ? (
            <Text size="sm" c="dimmed">
              {catalogModels.length === 0 ? '接口未返回可用模型。' : '没有匹配筛选的模型。'}
            </Text>
          ) : null}

          {!catalogLoading && filteredCatalog.length > 0 && discoverProvider ? (
            <Checkbox.Group
              onChange={(vals) => handleImportModels(discoverProvider.id, vals)}
            >
              <ScrollArea.Autosize mah={360}>
                <Stack gap="xs">
                  {filteredCatalog.map((model) => {
                    const isAdded = existingModelIds.has(model.modelId.trim().toLowerCase());
                    return (
                      <Card key={model.modelId} padding="sm" radius="md">
                        <Group>
                          <Checkbox
                            value={model.modelId}
                            disabled={isAdded}
                            label={
                              <div>
                                <Text size="sm" fw={600}>{model.label || model.modelId}</Text>
                                <Text size="xs" c="dimmed">{model.modelId}</Text>
                                {model.description ? <Text size="xs" c="dimmed" lineClamp={1}>{model.description}</Text> : null}
                              </div>
                            }
                          />
                          <Group gap={3} ml="auto">
                            {model.detectedCapabilities.map((cap) => (
                              <Badge key={cap} size="xs" variant="light" color={CAPABILITY_COLORS[cap]}>
                                {CAPABILITY_LABELS[cap]}
                              </Badge>
                            ))}
                            {isAdded ? <Badge size="xs" color="gray">已添加</Badge> : null}
                          </Group>
                        </Group>
                      </Card>
                    );
                  })}
                </Stack>
              </ScrollArea.Autosize>
            </Checkbox.Group>
          ) : null}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeDiscover}>关闭</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// ── Helpers ──

function toDraft(p: ControlLlmProvidersPayload['providers'][number]): ProviderDraft {
  return {
    id: p.id,
    label: p.label,
    type: p.type,
    enabled: p.enabled,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    organization: p.organization ?? '',
    models: p.models.map((m) => ({
      id: m.id,
      label: m.label,
      modelId: m.modelId,
      enabled: m.enabled,
      capabilityMode: m.capabilityMode,
      capabilities: [...m.capabilities] as ModelCapability[],
      defaultFor: [...m.defaultFor] as ModelCapability[],
      contextWindowTokens: m.contextWindowTokens,
    })),
  };
}

function buildDiscoveryInput(provider: ProviderDraft): DiscoverLlmProviderModelsInput {
  return {
    label: provider.label,
    type: provider.type,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    organization: provider.organization || '',
    models: [] as never[],
  } as DiscoverLlmProviderModelsInput;
}
