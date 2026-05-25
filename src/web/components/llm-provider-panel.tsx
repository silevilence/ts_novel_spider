import { startTransition, useEffect, useEffectEvent, useState } from 'react';

import {
  discoverLlmProviderModels,
  fetchLlmProvidersPreferences,
  updateLlmProvidersPreferences,
  validateLlmProviderModel,
  type DiscoverLlmProviderModelsInput,
  type LlmProviderType,
  type ModelCapability,
  type ModelCapabilityMode,
  type UpdateLlmModelInput,
  type UpdateLlmProviderInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import type { ControlLlmProviderModelsPayload, ControlLlmProvidersPayload } from '../../server/routes/control-center';

interface LlmProviderPanelProps {
  onNotice?: (notice: NoticeInput) => void;
}

interface ProviderDraft extends UpdateLlmProviderInput {
  models: ModelDraft[];
}

interface ModelDraft extends UpdateLlmModelInput {}

const CAPABILITY_OPTIONS: Array<{ value: ModelCapability; label: string }> = [
  { value: 'chat', label: '对话生成' },
  { value: 'embedding', label: '向量嵌入' },
  { value: 'rerank', label: '重排序' },
];

const PROVIDER_TYPE_OPTIONS: Array<{
  value: LlmProviderType;
  label: string;
  description: string;
  defaultBaseUrl: string;
}> = [
  {
    value: 'openai-compatible',
    label: 'OpenAI 兼容接口',
    description: '适合 DeepSeek、OpenRouter、Cherry Studio 一类的兼容协议。',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    description: '适合 Claude 官方或兼容 Anthropic Messages 协议的服务。',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
  },
  {
    value: 'google-generative-ai',
    label: 'Google Generative AI',
    description: '适合 Gemini / Google Generative AI 原生接口。',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    description: '适合本地或自托管 Ollama 服务，默认走原生 /api 接口。',
    defaultBaseUrl: 'http://127.0.0.1:11434',
  },
];

export function LlmProviderPanel({ onNotice }: LlmProviderPanelProps) {
  const [state, setState] = useState<ControlLlmProvidersPayload | null>(null);
  const [draft, setDraft] = useState<ProviderDraft[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [collapsedModelIds, setCollapsedModelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [catalogProviderId, setCatalogProviderId] = useState<string | null>(null);
  const [catalogModels, setCatalogModels] = useState<ControlLlmProviderModelsPayload['models']>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hydrateState = useEffectEvent((payload: ControlLlmProvidersPayload) => {
    startTransition(() => {
      setState(payload);
      setDraft(payload.providers.map(createDraftFromProvider));
      setSelectedProviderId((current) => current ?? payload.providers[0]?.id ?? null);
      setErrorMessage(null);
    });
  });

  useEffect(() => {
    if (draft.length === 0) {
      if (selectedProviderId !== null) {
        setSelectedProviderId(null);
      }

      if (catalogProviderId !== null) {
        setCatalogProviderId(null);
        setCatalogModels([]);
        setCatalogError(null);
        setCatalogQuery('');
      }

      return;
    }

    if (!selectedProviderId || !draft.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(draft[0]?.id ?? null);
    }

    if (catalogProviderId && !draft.some((provider) => provider.id === catalogProviderId)) {
      setCatalogProviderId(null);
      setCatalogModels([]);
      setCatalogError(null);
      setCatalogQuery('');
    }
  }, [catalogProviderId, draft, selectedProviderId]);

  useEffect(() => {
    setCollapsedModelIds((current) => {
      const availableModelIds = new Set(
        draft.flatMap((provider) => provider.models.map((model) => model.id)),
      );

      return current.filter((modelId) => availableModelIds.has(modelId));
    });
  }, [draft]);

  useEffect(() => {
    let active = true;

    void fetchLlmProvidersPreferences()
      .then((payload) => {
        if (!active) {
          return;
        }

        hydrateState(payload);
      })
      .catch((error) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load model providers.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);

    try {
      const payload = await updateLlmProvidersPreferences(serializeProviderDrafts(draft));
      hydrateState(payload);
      onNotice?.({
        tone: 'success',
        title: '模型服务已保存',
        message: payload.providers.length === 0 ? '当前没有启用任何模型服务。' : `已保存 ${payload.providers.length} 个模型服务配置。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save model providers.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: '模型服务保存失败', message });
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate(providerId: string, modelId: string) {
    setValidatingId(`${providerId}:${modelId}`);

    try {
      const payload = await validateLlmProviderModel(providerId, modelId);
      hydrateState(payload);
      const validation = payload.validations.find(
        (entry) => entry.providerId === providerId && entry.modelId === modelId,
      );
      onNotice?.({
        tone: validation?.ok ? 'success' : 'error',
        title: validation?.ok ? '模型连通性测试完成' : '模型连通性测试失败',
        message: validation?.message ?? '模型探测已结束。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model validation failed.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: '模型连通性测试失败', message });
    } finally {
      setValidatingId(null);
    }
  }

  async function handleDiscoverModels(provider: ProviderDraft) {
    setCatalogLoading(true);
    setCatalogProviderId(provider.id);
    setCatalogError(null);
    setCatalogModels([]);

    try {
      const payload = await discoverLlmProviderModels(buildDiscoveryInput(provider));
      setCatalogModels(payload.models);
      setCatalogError(null);
      setCatalogQuery('');
      onNotice?.({
        tone: 'info',
        title: '模型列表已刷新',
        message:
          payload.models.length === 0
            ? '接口已连通，但这次没有返回可添加的模型。'
            : `共拉取到 ${payload.models.length} 个候选模型。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load available models.';
      setCatalogModels([]);
      setCatalogError(message);
      onNotice?.({ tone: 'error', title: '模型列表拉取失败', message });
    } finally {
      setCatalogLoading(false);
    }
  }

  const isDirty = state ? isProviderDraftDirty(draft, state) : false;
  const providerCount = draft.length;
  const modelCount = draft.reduce((sum, provider) => sum + provider.models.length, 0);
  const defaultCount = draft.reduce(
    (sum, provider) => sum + provider.models.reduce((modelSum, model) => modelSum + model.defaultFor.length, 0),
    0,
  );
  const selectedProvider = draft.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedProviderState = state?.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const catalogOpen = selectedProvider ? catalogProviderId === selectedProvider.id : false;
  const existingModelIds = new Set(
    (selectedProvider?.models ?? [])
      .map((model) => model.modelId.trim().toLowerCase())
      .filter((modelId) => modelId.length > 0),
  );
  const normalizedCatalogQuery = catalogQuery.trim().toLowerCase();
  const visibleCatalogModels = normalizedCatalogQuery.length === 0
    ? catalogModels
    : catalogModels.filter((model) =>
        [model.label, model.modelId, model.description ?? '']
          .join(' ')
          .toLowerCase()
          .includes(normalizedCatalogQuery),
      );

  return (
    <section className="panel provider-panel">
      <div className="panel-heading split align-start">
        <div>
          <p className="eyebrow">模型服务</p>
          <h2>统一管理调用入口</h2>
          <p className="panel-note">
            这里维护各家模型服务的地址、凭证和可用模型。保存后，后续翻译、检索或图谱功能都可以复用这套默认配置。
          </p>
        </div>
        <div className="badge-row">
          <span className="status-badge state-completed">{providerCount} 个服务</span>
          <span className="status-badge ok">{modelCount} 个模型</span>
        </div>
      </div>

      <div className="provider-summary">
        <article className="card">
          <h3>服务数量</h3>
          <p>{providerCount === 0 ? '还未添加' : `已配置 ${providerCount} 个服务`}</p>
        </article>
        <article className="card">
          <h3>模型数量</h3>
          <p>{modelCount === 0 ? '还未添加' : `共 ${modelCount} 个模型实例`}</p>
        </article>
        <article className="card">
          <h3>默认能力</h3>
          <p>{defaultCount === 0 ? '尚未指定默认模型' : `已设置 ${defaultCount} 项默认能力`}</p>
        </article>
      </div>

      {draft.length === 0 ? (
        <div className="card preference-empty">
          <h3>还没有模型服务</h3>
          <p className="panel-note">先添加一个服务，再把需要的模型挂进去。</p>
          <div className="action-row wrap">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const provider = createEmptyProvider();
                setDraft([provider]);
                setSelectedProviderId(provider.id);
              }}
            >
              添加第一个服务
            </button>
          </div>
        </div>
      ) : (
        <div className="provider-workbench">
          <aside className="card provider-sidebar">
            <div className="panel-heading">
              <p className="eyebrow">服务列表</p>
              <h3>先选提供商，再编辑挂载模型</h3>
              <p className="panel-note">左侧看服务，右侧看当前服务的详细配置和模型清单。</p>
            </div>
            <div className="provider-sidebar-list">
              {draft.map((provider) => {
                const providerState = state?.providers.find((entry) => entry.id === provider.id) ?? null;
                const typeLabel = getProviderTypeMeta(provider.type).label;

                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`provider-nav-card ${provider.id === selectedProviderId ? 'active' : ''}`}
                    onClick={() => setSelectedProviderId(provider.id)}
                  >
                    <div className="provider-nav-head">
                      <strong>{provider.label.trim() || '未命名服务'}</strong>
                      <span className={`status-badge ${provider.enabled ? 'state-running' : 'state-failed'}`}>
                        {provider.enabled ? '启用中' : '已停用'}
                      </span>
                    </div>
                    <p>{typeLabel}</p>
                    <div className="badge-row">
                      <span className="count-chip">{provider.models.length} 个模型</span>
                      <span className={`count-chip ${providerState?.isConfigured ? 'accent' : 'danger'}`}>
                        {providerState?.isConfigured ? '凭证已填' : '待补凭证'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const provider = createEmptyProvider();
                setDraft((current) => [...current, provider]);
                setSelectedProviderId(provider.id);
              }}
            >
              添加服务
            </button>
          </aside>

          {selectedProvider ? (
            <div className="provider-detail-stack">
              <section className="card provider-card provider-section">
                <div className="provider-card-header">
                  <div>
                    <p className="eyebrow">提供商</p>
                    <h3>{selectedProvider.label.trim() || '未命名服务'}</h3>
                    <p className="panel-note">
                      {getProviderTypeMeta(selectedProvider.type).description}
                    </p>
                  </div>
                  <div className="action-row wrap">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setDraft((current) => current.filter((entry) => entry.id !== selectedProvider.id))}
                    >
                      删除服务
                    </button>
                  </div>
                </div>

                <div className="provider-grid">
                  <label className="checkbox-field proxy-toggle">
                    <input
                      type="checkbox"
                      checked={selectedProvider.enabled}
                      onChange={(event) =>
                        updateProviderField(setDraft, selectedProvider.id, 'enabled', event.target.checked)
                      }
                    />
                    <span>启用这个服务</span>
                  </label>
                  <label>
                    <span>服务名称</span>
                    <input
                      value={selectedProvider.label}
                      onChange={(event) => updateProviderField(setDraft, selectedProvider.id, 'label', event.target.value)}
                      placeholder="例如 深度求索 / Anthropic 官方"
                    />
                  </label>
                  <label>
                    <span>协议类型</span>
                    <select
                      value={selectedProvider.type}
                      onChange={(event) =>
                        updateProviderType(
                          setDraft,
                          selectedProvider.id,
                          event.target.value as LlmProviderType,
                        )
                      }
                    >
                      {PROVIDER_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>API 地址</span>
                    <input
                      value={selectedProvider.baseUrl}
                      onChange={(event) => updateProviderField(setDraft, selectedProvider.id, 'baseUrl', event.target.value)}
                      placeholder={getProviderTypeMeta(selectedProvider.type).defaultBaseUrl}
                    />
                  </label>
                  {selectedProvider.type === 'openai-compatible' ? (
                    <label>
                      <span>组织 ID</span>
                      <input
                        value={selectedProvider.organization}
                        onChange={(event) => updateProviderField(setDraft, selectedProvider.id, 'organization', event.target.value)}
                        placeholder="可选"
                      />
                    </label>
                  ) : (
                    <div className="card provider-inline-note span-full">
                      <p className="panel-note">
                        {selectedProvider.type === 'anthropic'
                          ? 'Anthropic 协议使用 Messages API；当前只需要地址和 API Key。'
                          : selectedProvider.type === 'google-generative-ai'
                            ? 'Google Generative AI 当前只需要地址和 API Key。'
                            : 'Ollama 一般只需要服务地址；本地部署通常不需要 API Key。'}
                      </p>
                    </div>
                  )}
                  <label>
                    <span>{selectedProvider.type === 'ollama' ? 'API Key（可选）' : 'API Key'}</span>
                    <input
                      type="password"
                      value={selectedProvider.apiKey}
                      onChange={(event) => updateProviderField(setDraft, selectedProvider.id, 'apiKey', event.target.value)}
                      placeholder={selectedProvider.type === 'google-generative-ai' ? 'AIza...' : selectedProvider.type === 'ollama' ? '本地部署通常留空' : '输入 API Key'}
                    />
                  </label>
                </div>
              </section>

              <section className="card model-section">
                <div className="model-section-head">
                  <div>
                    <p className="eyebrow">模型列表</p>
                    <h3>这个提供商挂载的模型</h3>
                    <p className="panel-note">模型层只负责具体 model id、能力映射和逐个连通性测试。</p>
                  </div>
                  <div className="model-section-head-side">
                    <div className="badge-row">
                      <span className="count-chip">{selectedProvider.models.length} 个模型</span>
                      <span className={`count-chip ${selectedProviderState?.isConfigured ? 'accent' : 'danger'}`}>
                        {selectedProviderState?.isConfigured ? '服务凭证已完整' : '服务凭证未完整'}
                      </span>
                    </div>
                    <div className="action-row wrap compact-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => appendModel(setDraft, selectedProvider.id, createEmptyModel())}
                      >
                        手动添加模型
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void handleDiscoverModels(selectedProvider)}
                        disabled={catalogLoading || saving || validatingId !== null}
                      >
                        {catalogLoading && catalogOpen ? '拉取中...' : catalogOpen ? '刷新模型列表' : '从接口拉取模型列表'}
                      </button>
                      {catalogOpen ? (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            setCatalogProviderId(null);
                            setCatalogError(null);
                            setCatalogQuery('');
                          }}
                        >
                          收起列表
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {catalogOpen ? (
                  <div className="card model-discovery-card">
                    <div className="model-discovery-toolbar">
                      <label className="toolbar-search">
                        <span className="visually-hidden">搜索模型</span>
                        <input
                          value={catalogQuery}
                          onChange={(event) => setCatalogQuery(event.target.value)}
                          placeholder="按模型名或 ID 过滤"
                        />
                      </label>
                      <span className="count-chip accent">{visibleCatalogModels.length} 个候选</span>
                    </div>
                    {catalogError ? <p className="error-text">{catalogError}</p> : null}
                    {catalogLoading ? <p className="panel-note">正在从当前接口配置拉取模型列表...</p> : null}
                    {!catalogLoading && visibleCatalogModels.length === 0 ? (
                      <p className="panel-note">
                        {catalogModels.length === 0 ? '接口没有返回可添加的模型。' : '没有匹配当前筛选条件的模型。'}
                      </p>
                    ) : null}
                    {!catalogLoading && visibleCatalogModels.length > 0 ? (
                      <div className="model-discovery-list">
                        {visibleCatalogModels.map((model) => {
                          const isAdded = existingModelIds.has(model.modelId.trim().toLowerCase());

                          return (
                            <article
                              key={model.modelId}
                              className={`model-discovery-item ${isAdded ? 'is-disabled' : ''}`}
                            >
                              <div className="model-discovery-copy">
                                <strong>{model.label || model.modelId}</strong>
                                <p>{model.modelId}</p>
                                {model.description ? <p className="panel-note">{model.description}</p> : null}
                              </div>
                              <div className="model-discovery-actions">
                                <div className="badge-row">
                                  {model.detectedCapabilities.map((capability) => (
                                    <span key={capability} className="count-chip">
                                      {CAPABILITY_OPTIONS.find((option) => option.value === capability)?.label ?? capability}
                                    </span>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={isAdded}
                                  onClick={() =>
                                    appendModel(
                                      setDraft,
                                      selectedProvider.id,
                                      createDiscoveredModelDraft(model),
                                    )
                                  }
                                >
                                  {isAdded ? '已添加' : '添加到当前服务'}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedProvider.models.length === 0 ? (
                  <div className="card preference-empty">
                    <h3>这个服务还没有模型</h3>
                    <p className="panel-note">可以先手动添加，也可以直接从上面的接口列表里挑选。</p>
                  </div>
                ) : (
                  <div className="model-list">
                    {selectedProvider.models.map((model) => {
                      const modelState = selectedProviderState?.models.find((entry) => entry.id === model.id) ?? null;
                      const validation = state?.validations.find(
                        (entry) => entry.providerId === selectedProvider.id && entry.modelId === model.id,
                      );
                      const validationKey = `${selectedProvider.id}:${model.id}`;
                      const resolvedCapabilities = modelState?.resolvedCapabilities ?? model.capabilities;
                      const isCollapsed = collapsedModelIds.includes(model.id);

                      return (
                        <div key={model.id} className={`card model-card ${isCollapsed ? 'is-collapsed' : ''}`}>
                          <div className="model-card-header">
                            <div className="model-summary-copy">
                              <h4>{model.label.trim() || '未命名模型'}</h4>
                              <p className="model-summary-id">{model.modelId.trim() || '未填写模型 ID'}</p>
                              <p className="panel-note">
                                当前能力：{formatCapabilityList(resolvedCapabilities)}
                              </p>
                            </div>
                            <div className="model-card-header-side">
                              <div className="badge-row">
                                <span className={`status-badge ${model.enabled ? 'state-running' : 'state-failed'}`}>
                                  {model.enabled ? '已启用' : '已停用'}
                                </span>
                                <span
                                  className={`status-badge ${validation ? (validation.ok ? 'ok' : 'state-failed') : 'state-completed'}`}
                                >
                                  {validation ? (validation.ok ? '最近测试成功' : '最近测试失败') : '尚未测试'}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="ghost-button model-card-toggle"
                                onClick={() =>
                                  setCollapsedModelIds((current) =>
                                    current.includes(model.id)
                                      ? current.filter((entry) => entry !== model.id)
                                      : [...current, model.id],
                                  )
                                }
                              >
                                {isCollapsed ? '展开模型' : '折叠模型'}
                              </button>
                            </div>
                          </div>

                          {!isCollapsed ? (
                            <>
                          <div className="model-grid">
                            <label className="checkbox-field proxy-toggle">
                              <input
                                type="checkbox"
                                checked={model.enabled}
                                onChange={(event) =>
                                  updateModelField(setDraft, selectedProvider.id, model.id, 'enabled', event.target.checked)
                                }
                              />
                              <span>参与默认调度</span>
                            </label>
                            <label>
                              <span>显示名称</span>
                              <input
                                value={model.label}
                                onChange={(event) =>
                                  updateModelField(setDraft, selectedProvider.id, model.id, 'label', event.target.value)
                                }
                                placeholder="例如默认翻译模型"
                              />
                            </label>
                            <label>
                              <span>模型 ID</span>
                              <input
                                value={model.modelId}
                                onChange={(event) =>
                                  updateModelField(setDraft, selectedProvider.id, model.id, 'modelId', event.target.value)
                                }
                                placeholder={selectedProvider.type === 'anthropic' ? 'claude-sonnet-4-5' : selectedProvider.type === 'google-generative-ai' ? 'gemini-2.5-flash' : selectedProvider.type === 'ollama' ? 'llama3.2 / bge-reranker-v2-m3' : 'gpt-4o-mini'}
                              />
                            </label>
                            {resolvedCapabilities.includes('chat') ? (
                              <label>
                                <span>上下文 Token 上限（0=不限制，按条目数截断）</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={10000}
                                  value={model.contextWindowTokens ?? 0}
                                  onChange={(event) =>
                                    updateModelField(setDraft, selectedProvider.id, model.id, 'contextWindowTokens', Number(event.target.value) || 0)
                                  }
                                  placeholder="如 DeepSeek V3 填 1000000"
                                />
                              </label>
                            ) : null}
                            <label>
                              <span>能力来源</span>
                              <select
                                value={model.capabilityMode}
                                onChange={(event) =>
                                  updateModelField(
                                    setDraft,
                                    selectedProvider.id,
                                    model.id,
                                    'capabilityMode',
                                    event.target.value as ModelCapabilityMode,
                                  )
                                }
                              >
                                <option value="manual">手动指定</option>
                                <option value="auto">根据模型 ID 自动判断</option>
                              </select>
                            </label>

                            <div className="span-full capability-stack">
                              <div>
                                <span>默认承担的能力</span>
                                <p className="panel-note capability-note">没有指定具体模型时，系统会优先从这里选择对应能力的默认入口。</p>
                                <div className="capability-choice-row">
                                  {CAPABILITY_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className={`ghost-button capability-chip ${model.defaultFor.includes(option.value) ? 'active' : ''}`}
                                      onClick={() =>
                                        toggleModelCapability(
                                          setDraft,
                                          selectedProvider.id,
                                          model.id,
                                          'defaultFor',
                                          option.value,
                                        )
                                      }
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {model.capabilityMode === 'manual' ? (
                                <div>
                                  <span>手动标记这个模型的能力</span>
                                  <p className="panel-note capability-note">这里表示这个模型实际支持哪些能力，决定它能不能参与对应任务和连通性测试。</p>
                                  <div className="capability-choice-row">
                                    {CAPABILITY_OPTIONS.map((option) => (
                                      <button
                                        key={option.value}
                                        type="button"
                                        className={`ghost-button capability-chip ${model.capabilities.includes(option.value) ? 'active' : ''}`}
                                        onClick={() =>
                                          toggleModelCapability(
                                            setDraft,
                                            selectedProvider.id,
                                            model.id,
                                            'capabilities',
                                            option.value,
                                          )
                                        }
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="panel-note">
                                  自动判断只是在推断这个模型支持什么；真正作为默认入口，还要看上面的“默认承担的能力”有没有勾选。
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="card model-validation-card">
                            <div className="split align-start">
                              <div>
                                <h4>连通性与鉴权</h4>
                                <p className="panel-note">
                                  {validation
                                    ? `${validation.message} ${validation.statusCode ? `HTTP ${validation.statusCode} · ` : ''}${validation.latencyMs} ms`
                                    : '先保存服务配置，再测试当前模型是否可访问。'}
                                </p>
                              </div>
                              <div className="badge-row">
                                <span className={`status-badge ${modelState?.isConfigured ? 'state-completed' : 'state-failed'}`}>
                                  {modelState?.isConfigured ? '模型 ID 已填写' : '模型 ID 未填写'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="action-row wrap">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleValidate(selectedProvider.id, model.id)}
                              disabled={loading || saving || isDirty || validatingId !== null}
                            >
                              {validatingId === validationKey ? '测试中...' : '测试当前模型'}
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() =>
                                setDraft((current) =>
                                  current.map((entry) =>
                                    entry.id === selectedProvider.id
                                      ? {
                                          ...entry,
                                          models: entry.models.filter((modelEntry) => modelEntry.id !== model.id),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              删除模型
                            </button>
                          </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      )}

      <div className="action-row wrap">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            const provider = createEmptyProvider();
            setDraft((current) => [...current, provider]);
            setSelectedProviderId(provider.id);
          }}
        >
          添加服务
        </button>
        <button type="button" className="primary-button" onClick={handleSave} disabled={loading || saving || validatingId !== null}>
          {saving ? '保存中...' : '保存模型服务'}
        </button>
      </div>

      {isDirty ? <p className="panel-note">你有未保存的修改，先保存后再做连通性测试。</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}

function buildDiscoveryInput(provider: ProviderDraft): DiscoverLlmProviderModelsInput {
  return {
    label: provider.label.trim(),
    type: provider.type,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl.trim(),
    apiKey: provider.apiKey.trim(),
    organization: provider.organization.trim(),
  };
}

function createDraftFromProvider(provider: ControlLlmProvidersPayload['providers'][number]): ProviderDraft {
  return {
    id: provider.id,
    label: provider.label,
    type: provider.type,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    organization: provider.organization,
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label,
      modelId: model.modelId,
      enabled: model.enabled,
      capabilityMode: model.capabilityMode,
      capabilities: [...model.capabilities],
      defaultFor: [...model.defaultFor],
    })),
  };
}

function createEmptyProvider(): ProviderDraft {
  return {
    id: createLocalId('provider'),
    label: '',
    type: 'openai-compatible',
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    organization: '',
    models: [createEmptyModel()],
  };
}

function createEmptyModel(): ModelDraft {
  return {
    id: createLocalId('model'),
    label: '',
    modelId: '',
    enabled: true,
    capabilityMode: 'manual',
    capabilities: ['chat'],
    defaultFor: [],
  };
}

function createDiscoveredModelDraft(model: ControlLlmProviderModelsPayload['models'][number]): ModelDraft {
  return {
    id: createLocalId('model'),
    label: model.label.trim() || model.modelId,
    modelId: model.modelId,
    enabled: true,
    capabilityMode: 'manual',
    capabilities: model.detectedCapabilities.length > 0 ? [...model.detectedCapabilities] : ['chat'],
    defaultFor: [],
  };
}

function createLocalId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function serializeProviderDrafts(draft: ProviderDraft[]): UpdateLlmProviderInput[] {
  return draft.map((provider) => ({
    id: provider.id,
    label: provider.label.trim(),
    type: provider.type,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl.trim(),
    apiKey: provider.apiKey.trim(),
    organization: provider.organization.trim(),
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label.trim(),
      modelId: model.modelId.trim(),
      enabled: model.enabled,
      capabilityMode: model.capabilityMode,
      capabilities: [...model.capabilities],
      defaultFor: [...model.defaultFor],
    })),
  }));
}

function isProviderDraftDirty(draft: ProviderDraft[], state: ControlLlmProvidersPayload): boolean {
  const left = JSON.stringify(serializeProviderDrafts(draft));
  const right = JSON.stringify(
    state.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      type: provider.type,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      organization: provider.organization,
      models: provider.models.map((model) => ({
        id: model.id,
        label: model.label,
        modelId: model.modelId,
        enabled: model.enabled,
        capabilityMode: model.capabilityMode,
        capabilities: model.capabilities,
        defaultFor: model.defaultFor,
      })),
    })),
  );

  return left !== right;
}

function updateProviderField<TKey extends keyof ProviderDraft>(
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft[]>>,
  providerId: string,
  key: TKey,
  value: ProviderDraft[TKey],
): void {
  setDraft((current) =>
    current.map((provider) => (provider.id === providerId ? { ...provider, [key]: value } : provider)),
  );
}

function appendModel(
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft[]>>,
  providerId: string,
  model: ModelDraft,
): void {
  setDraft((current) =>
    current.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: [...provider.models, model],
          }
        : provider,
    ),
  );
}

function updateModelField<TKey extends keyof ModelDraft>(
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft[]>>,
  providerId: string,
  modelId: string,
  key: TKey,
  value: ModelDraft[TKey],
): void {
  setDraft((current) =>
    current.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: provider.models.map((model) =>
              model.id === modelId ? { ...model, [key]: value } : model,
            ),
          }
        : provider,
    ),
  );
}

function toggleModelCapability(
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft[]>>,
  providerId: string,
  modelId: string,
  key: 'capabilities' | 'defaultFor',
  capability: ModelCapability,
): void {
  setDraft((current) =>
    current.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: provider.models.map((model) => {
              if (model.id !== modelId) {
                return model;
              }

              const nextValues = model[key].includes(capability)
                ? model[key].filter((entry) => entry !== capability)
                : [...model[key], capability];

              return {
                ...model,
                [key]: nextValues.length > 0 || key === 'defaultFor' ? nextValues : ['chat'],
              };
            }),
          }
        : provider,
    ),
  );
}

function formatCapabilityList(capabilities: ModelCapability[]): string {
  if (capabilities.length === 0) {
    return '未指定';
  }

  return capabilities
    .map((capability) => CAPABILITY_OPTIONS.find((entry) => entry.value === capability)?.label ?? capability)
    .join(' / ');
}

function getProviderTypeMeta(type: LlmProviderType) {
  return PROVIDER_TYPE_OPTIONS.find((option) => option.value === type) ?? PROVIDER_TYPE_OPTIONS[0]!;
}

function updateProviderType(
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft[]>>,
  providerId: string,
  type: LlmProviderType,
): void {
  const meta = getProviderTypeMeta(type);

  setDraft((current) =>
    current.map((provider) => {
      if (provider.id !== providerId) {
        return provider;
      }

      const previousMeta = getProviderTypeMeta(provider.type);
      const nextBaseUrl =
        provider.baseUrl.trim().length === 0 || provider.baseUrl === previousMeta.defaultBaseUrl
          ? meta.defaultBaseUrl
          : provider.baseUrl;

      return {
        ...provider,
        type,
        baseUrl: nextBaseUrl,
        organization: type === 'openai-compatible' ? provider.organization : '',
      };
    }),
  );
}