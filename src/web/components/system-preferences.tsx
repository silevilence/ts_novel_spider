import { useState } from 'react';

import { LlmProviderPanel } from './llm-provider-panel';
import { Neo4jPanel } from './neo4j-panel';
import { NetworkProxyPanel } from './network-proxy-panel';
import { ReaderTypographyPanel } from './reader-typography-panel';
import { LanguagePicker } from './language-picker';
import type {
  ControlCenterModel,
  NoticeInput,
} from '../services/control-center-model';

interface SystemPreferencesProps {
  model: ControlCenterModel;
  onOpenControl: () => void;
  onNotify: (notice: NoticeInput) => void;
}

export function SystemPreferences({ model, onOpenControl, onNotify }: SystemPreferencesProps) {
  const [crawlOpen, setCrawlOpen] = useState(true);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [neo4jOpen, setNeo4jOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);

  const foldStates = [crawlOpen, proxyOpen, llmOpen, neo4jOpen, readerOpen, translationOpen];
  const allExpanded = foldStates.every(Boolean);
  const allCollapsed = foldStates.every((open) => !open);

  function toggleAllFold() {
    const next = !allExpanded;
    setCrawlOpen(next);
    setProxyOpen(next);
    setLlmOpen(next);
    setNeo4jOpen(next);
    setReaderOpen(next);
    setTranslationOpen(next);
  }

  return (
    <div className="settings-stack">
      <section className="hero route-hero">
        <div className="route-header">
          <p className="eyebrow">系统偏好</p>
          <h2>统一管理全局默认配置</h2>
          <p className="route-copy">
            这里集中管理任务选项、网络代理、阅读器排版、模型服务和图数据库连接。保存后，后续新任务和阅读等能力都会直接复用这些默认值。
          </p>
        </div>

        <div className="settings-summary-strip">
          <article className="summary-tile">
            <span className="label">默认并发</span>
            <strong>{model.chapterConcurrency}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">重试次数</span>
            <strong>{model.chapterRetryCount}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">目录策略</span>
            <strong>{model.forceRefetch ? '重新下载已存在章节' : '只下载缺少章节'}</strong>
          </article>
        </div>

        <div className="action-row wrap">
          <button type="button" className="ghost-button" onClick={onOpenControl}>
            返回开始抓取
          </button>
          <button type="button" className="ghost-button" onClick={toggleAllFold}>
            {allCollapsed ? '展开全部' : '折叠全部'}
          </button>
        </div>
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">任务选项</p>
            <h2>默认任务设置</h2>
            <p className="panel-note">这些设置会自动用于之后创建的抓取任务。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setCrawlOpen((current) => !current)}>
            {crawlOpen ? '收起' : '展开'}
          </button>
        </div>

        {crawlOpen ? (
          <div className="fold-content">
            <div className="panel preferences-panel">
              <div className="preferences-grid">
                <label>
                  <span>章节并发数</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={model.chapterConcurrency}
                    onChange={(event) => model.setChapterConcurrency(Number(event.target.value) || 1)}
                  />
                </label>
                <label>
                  <span>失败重试次数</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={model.chapterRetryCount}
                    onChange={(event) => model.setChapterRetryCount(Number(event.target.value) || 0)}
                  />
                </label>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={model.forceRefetch}
                  onChange={(event) => model.setForceRefetch(event.target.checked)}
                />
                <span>下载时也重新获取已经保存过的章节</span>
              </label>
              <p className="panel-note">
                一般情况下只下载缺少的章节即可；如果原站内容有更新，再打开这个选项。
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">网络代理</p>
            <h2>代理设置</h2>
            <p className="panel-note">只有需要走代理时再展开这里，平时可以保持收起。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setProxyOpen((current) => !current)}>
            {proxyOpen ? '收起' : '展开'}
          </button>
        </div>

        {proxyOpen ? (
          <div className="fold-content">
            <NetworkProxyPanel onNotice={onNotify} />
          </div>
        ) : null}
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">模型服务</p>
            <h2>大模型服务提供商</h2>
            <p className="panel-note">维护默认服务地址、认证信息和模型能力映射，后续翻译和检索功能会用到这里。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setLlmOpen((current) => !current)}>
            {llmOpen ? '收起' : '展开'}
          </button>
        </div>

        {llmOpen ? (
          <div className="fold-content">
            <LlmProviderPanel onNotice={onNotify} />
          </div>
        ) : null}
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">图数据库</p>
            <h2>Neo4j 连接</h2>
            <p className="panel-note">为后续实体关系图谱和检索增强准备统一的数据库入口。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setNeo4jOpen((current) => !current)}>
            {neo4jOpen ? '收起' : '展开'}
          </button>
        </div>

        {neo4jOpen ? (
          <div className="fold-content">
            <Neo4jPanel onNotice={onNotify} />
          </div>
        ) : null}
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">阅读器排版</p>
            <h2>全局排版与预览</h2>
            <p className="panel-note">设置字号、行高、字体族等排版参数，并通过多语种沙箱即时预览效果。书籍详情页支持单独覆盖。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setReaderOpen((current) => !current)}>
            {readerOpen ? '收起' : '展开'}
          </button>
        </div>

        {readerOpen ? (
          <div className="fold-content">
            <ReaderTypographyPanel onNotice={onNotify} />
          </div>
        ) : null}
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">翻译默认值</p>
            <h2>全局翻译偏好</h2>
            <p className="panel-note">为新建翻译任务设定默认语言对、模型路径和质量阈值。每本书可以在详情页单独覆盖。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setTranslationOpen((current) => !current)}>
            {translationOpen ? '收起' : '展开'}
          </button>
        </div>

        {translationOpen ? (
          <div className="fold-content">
            <TranslationPreferencesSection onNotice={onNotify} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function TranslationPreferencesSection({ onNotice }: { onNotice: (n: NoticeInput) => void }) {
  const [sourceLang, setSourceLang] = useState('ja');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [concurrency, setConcurrency] = useState(2);
  const [autoRejectUntranslated, setAutoRejectUntranslated] = useState(true);
  const [defaultExport, setDefaultExport] = useState<'original' | 'translated' | 'bilingual'>('original');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [availableChatModels, setAvailableChatModels] = useState<Array<{ providerLabel: string; providerId: string; modelId: string; modelLabel: string }>>([]);
  const [translateModelKey, setTranslateModelKey] = useState('');
  const [enableLlmLog, setEnableLlmLog] = useState(false);

  // Load existing prefs on mount
  if (!loaded) {
    setLoaded(true);
    Promise.all([
      import('../services/api').then(({ fetchTranslationPreferences }) => fetchTranslationPreferences()),
      import('../services/api').then(({ fetchLlmProvidersPreferences }) => fetchLlmProvidersPreferences()),
    ]).then(
      ([prefs, llmPayload]) => {
        setSourceLang(prefs.config.sourceLang);
        setTargetLang(prefs.config.targetLang);
        setConcurrency(prefs.config.translationConcurrency);
        setAutoRejectUntranslated(prefs.config.autoRejectUntranslatedTerms);
        setDefaultExport(prefs.config.defaultExportMode);
        setTranslateModelKey(prefs.config.preferredTranslationModelKey ?? '');
        setEnableLlmLog(prefs.config.enableLlmInteractionLog ?? false);

        // 提取所有启用且有 chat 能力的模型
        const models: typeof availableChatModels = [];
        for (const p of llmPayload.providers) {
          if (!p.enabled) continue;
          for (const m of p.models) {
            if (!m.enabled || !m.modelId) continue;
            if (m.resolvedCapabilities.includes('chat')) {
              models.push({
                providerLabel: p.label,
                providerId: p.id,
                modelId: m.modelId,
                modelLabel: m.label || m.modelId,
              });
            }
          }
        }
        setAvailableChatModels(models);
      },
      () => {},
    );
  }

  async function handleSave() {
    setBusy(true);
    try {
      const { updateTranslationPreferences } = await import('../services/api');
      await updateTranslationPreferences({
        sourceLang,
        targetLang,
        translationConcurrency: concurrency,
        preferredTranslationModelKey: translateModelKey || null,
        enableLlmInteractionLog: enableLlmLog,
        autoRejectUntranslatedTerms: autoRejectUntranslated,
        defaultExportMode: defaultExport,
      });
      onNotice({ tone: 'success', title: '已保存', message: '全局翻译默认值已更新。' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      onNotice({ tone: 'error', title: '保存失败', message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel preferences-panel">
      <div className="preferences-grid">
        <label>
          <span>源语言</span>
          <LanguagePicker value={sourceLang} onChange={setSourceLang} placeholder="ja" />
        </label>
        <label>
          <span>目标语言</span>
          <LanguagePicker value={targetLang} onChange={setTargetLang} placeholder="zh-CN" />
        </label>
        <label>
          <span>每批段落数</span>
          <input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value) || 1)} title="一次 LLM 请求中打包翻译的段落数量。越大越省 API 调用，但单次请求变长。" />
        </label>
      </div>

      {/* 可用模型提示 */}
      <div className="card" style={{ marginTop: '0.75rem' }}>
        <p className="label">默认翻译模型</p>
        {availableChatModels.length === 0 ? (
          <p className="panel-note" style={{ color: 'var(--danger)' }}>
            ⚠️ 尚未配置可用的翻译模型。请先在「大模型服务提供商」中启用至少一个带有 chat 能力的模型。
          </p>
        ) : (
          <>
            <label style={{ marginTop: '0.35rem', display: 'block' }}>
              <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>指定全局默认翻译模型（留空则自动选择第一个可用的 chat 模型）</span>
              <select
                value={translateModelKey}
                onChange={(e) => setTranslateModelKey(e.target.value)}
                style={{ width: '100%', marginTop: '0.25rem', minHeight: '44px' }}
              >
                <option value="">自动选择</option>
                {availableChatModels.map((m) => (
                  <option key={`${m.providerId}:${m.modelId}`} value={`${m.providerId}:${m.modelId}`}>
                    {m.providerLabel} / {m.modelLabel}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <label className="checkbox-field" style={{ marginTop: '0.75rem' }}>
        <input type="checkbox" checked={autoRejectUntranslated} onChange={(e) => setAutoRejectUntranslated(e.target.checked)} />
        <span>术语缺译时阻断正文翻译流程</span>
      </label>

      <label className="checkbox-field" style={{ marginTop: '0.5rem' }}>
        <input type="checkbox" checked={enableLlmLog} onChange={(e) => setEnableLlmLog(e.target.checked)} />
        <span>保存 LLM 交互日志（存储于 .data/llm-logs/，按日滚动保留 7 天）</span>
      </label>

      <div style={{ marginTop: '0.75rem' }}>
        <span className="label">默认导出模式</span>
        <div className="chip-row" style={{ marginTop: '0.25rem' }}>
          {(['original', 'translated', 'bilingual'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`preset-chip${defaultExport === mode ? ' active' : ''}`}
              onClick={() => setDefaultExport(mode)}
            >
              {mode === 'original' ? '原文' : mode === 'translated' ? '纯译文' : '双语对照'}
            </button>
          ))}
        </div>
      </div>

      <div className="action-row" style={{ marginTop: '1rem' }}>
        <button type="button" className="primary-button" disabled={busy} onClick={handleSave}>
          {busy ? '保存中…' : '保存翻译默认值'}
        </button>
      </div>

      <p className="panel-note" style={{ marginTop: '0.75rem' }}>
        提示：翻译模型位置在「大模型服务提供商」中统一管理。启用至少一个 chat 模型后，翻译即可正常工作。
      </p>
    </div>
  );
}