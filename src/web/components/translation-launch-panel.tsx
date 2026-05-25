import { useState, useEffect } from 'react';

import type { LibraryModel, TranslationBuildState } from '../services/library-model';
import { fetchLlmProvidersPreferences, buildLibraryExportDownloadUrl, type LibraryExportFormat, type TranslationExportMode } from '../services/api';

interface TranslationLaunchPanelProps {
  model: LibraryModel;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export function TranslationLaunchPanel({ model, onNotify }: TranslationLaunchPanelProps) {
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ key: string; label: string }>>([]);
  const [logs, setLogs] = useState<Array<{ time: string; msg: string }>>([]);

  useEffect(() => {
    fetchLlmProvidersPreferences().then((p) => {
      const models: Array<{ key: string; label: string }> = [];
      for (const provider of p.providers) {
        if (!provider.enabled) continue;
        for (const m of provider.models) {
          if (!m.enabled || !m.modelId || !m.resolvedCapabilities.includes('chat')) continue;
          models.push({ key: `${provider.id}:${m.modelId}`, label: `${provider.label} / ${m.modelId}` });
        }
      }
      setAvailableModels(models);
      if (models.length > 0 && !selectedModel) setSelectedModel(models[0]!.key);
    }, () => {});
  }, []);

  // 轮询翻译构建状态（运行时每3秒更新，驱动进度条和日志）
  useEffect(() => {
    if (!model.detail?.novel || !(model.translationBuild?.status === 'running' || model.translationBuild?.status === 'queued')) return;
    const timer = setInterval(() => {
      model.syncTranslationBuild?.().then((p) => {
        if (!p) return;
        const msg = `已译 ${p.translation.translatedChapters} 章 / 失败 ${p.translation.failedChapters} 章`;
        setLogs((prev) => {
          if (prev.length > 0 && prev[prev.length - 1]!.msg === msg) return prev;
          return [...prev.slice(-50), { time: new Date().toLocaleTimeString('zh-CN'), msg }];
        });
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [model.translationBuild?.status, model.detail?.novel]);

  const build = model.translationBuild;
  const isRunning = build?.status === 'running' || build?.status === 'queued';
  const isPaused = build?.status === 'paused';
  const isDone = build?.status === 'completed' || build?.status === 'failed';
  const detail = model.detail?.novel;
  const langs = model.translationLanguages;

  return (
    <section className="panel translation-launch-panel">
      <div className="panel-heading split align-start">
        <div>
          <p className="eyebrow">翻译</p>
          <h2>{isRunning ? '翻译中' : isDone ? (build?.status === 'completed' ? '翻译完成' : '翻译失败') : '翻译任务'}</h2>
          <p className="panel-note">
            {build ? build.message : '使用 AI 将已下载章节翻译为目标语言。'}
          </p>
        </div>
        <div className="badge-row">
          {build ? (
            <>
              <span className="status-badge ok">已译 {build.translatedChapters}</span>
              {build.failedChapters > 0 ? <span className="status-badge state-failed">失败 {build.failedChapters}</span> : null}
            </>
          ) : null}
        </div>
      </div>

      {/* 双进度条 */}
      {build && detail ? (
        <div style={{ margin: '0.35rem 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.2rem' }}>
            <span className="label">章节 {build.translatedChapters + build.failedChapters}/{detail.stats.downloaded}</span>
            <span className="label">{build.progressPercent}%</span>
          </div>
          <div className="progress-track" style={{ margin: '0 0 0.5rem', height: '6px' }}>
            <div className="progress-fill" style={{ width: `${build.progressPercent}%`, background: 'linear-gradient(90deg, #ff8c42, #7fd0ff)' }} />
          </div>
          {isRunning ? (
            <>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.15rem' }}>
                当前：{build.message || '准备中…'}
              </div>
              {/* 段落级实时进度 */}
              {build.currentChapterParagraphs > 0 ? (
                <div style={{ marginBottom: '0.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: '0.1rem' }}>
                    <span className="label">段落 {build.currentChapterTranslatedParagraphs}/{build.currentChapterParagraphs}</span>
                    <span className="label">{build.currentChapterParagraphs > 0 ? Math.round((build.currentChapterTranslatedParagraphs / build.currentChapterParagraphs) * 100) : 0}%</span>
                  </div>
                  <div className="progress-track" style={{ margin: '0', height: '3px', background: 'rgba(255,140,66,0.2)' }}>
                    <div className="progress-fill" style={{ width: `${build.currentChapterParagraphs > 0 ? Math.round((build.currentChapterTranslatedParagraphs / build.currentChapterParagraphs) * 100) : 0}%`, background: 'var(--accent)', transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              ) : (
                <div className="progress-track" style={{ margin: '0', height: '3px', background: 'rgba(255,140,66,0.2)' }}>
                  <div className="progress-fill" style={{ width: '30%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
              )}
              {/* 速率与时间估算 */}
              {build.startedAt ? (
                <SpeedEstimate
                  totalParagraphs={build.totalTranslatedParagraphs}
                  startedAt={build.startedAt}
                  totalEstimate={build.totalParagraphEstimate || 0}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {/* 操作区 */}
      <div className="action-row wrap" style={{ marginTop: '0.5rem' }}>
        {availableModels.length > 0 ? (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{ flex: 1, minWidth: '200px', minHeight: '44px' }}
            disabled={isRunning}
          >
            {availableModels.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        ) : (
          <span className="panel-note" style={{ flex: 1 }}>未配置可用翻译模型</span>
        )}

        {isRunning ? (
          <button type="button" className="ghost-button danger"
            onClick={() => { void model.cancelTranslation?.(); }}
            disabled={model.translationBusy}>
            {model.translationBusy ? '暂停中…' : '暂停'}
          </button>
        ) : null}

        {!isRunning ? (
          <>
            <button type="button" className="primary-button"
              onClick={() => void model.startTranslation(selectedModel)}
              disabled={model.translationBusy || !detail || detail.stats.downloaded === 0}>
              {model.translationBusy ? '启动中…' : isPaused ? '继续翻译' : isDone && build?.status === 'completed' ? '继续完善' : '发起翻译'}
            </button>
            {(isPaused || isDone) ? (
              <button type="button" className="ghost-button subtle"
                onClick={() => { void model.startTranslation(selectedModel, true); }}
                disabled={model.translationBusy || !detail || detail.stats.downloaded === 0}>
                从头开始
              </button>
            ) : null}
          </>
        ) : (
          <span className="ghost-button" style={{ cursor: 'default', textAlign: 'center', minWidth: '100px' }}>翻译中…</span>
        )}

        {langs ? (
          <a
            href={buildLibraryExportDownloadUrl(detail?.sourceId ?? '', detail?.metadata.novelId ?? '', 'epub', model.translationViewMode, langs.sourceLang, langs.targetLang)}
            className="secondary-link"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            导出译文
          </a>
        ) : null}
      </div>

      {/* 术语管理入口 */}
      <div className="action-row" style={{ marginTop: '0.5rem' }}>
        <button type="button" className="ghost-button subtle"
          onClick={() => onNotify({ tone: 'info', title: '术语表', message: '术语管理功能即将上线。当前可先配置全局语言对和模型。' })}>
          管理术语表
        </button>
      </div>

      {/* 翻译日志区 */}
      {build ? (
        <div className="card" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(4,12,22,0.9)' }}>
          <p className="label" style={{ marginBottom: '0.35rem' }}>翻译日志 {isRunning ? <span style={{ color: 'var(--warn)', marginLeft: '0.5rem' }}>● 实时</span> : null}</p>
          <div className="log-list" style={{ maxHeight: '190px' }}>
            <div className="log-item level-info" style={{ padding: '0.45rem 0.6rem' }}>
              <strong>{build.status === 'running' ? '翻译中' : build.status === 'completed' ? '已完成' : build.status === 'failed' ? '已失败' : build.status}</strong>
              <p className="panel-note">已译 {build.translatedChapters} / 失败 {build.failedChapters}｜{build.startedAt ? new Date(build.startedAt).toLocaleTimeString('zh-CN') : '-'} 起</p>
            </div>
            {logs.map((l, i) => (
              <div key={i} className="log-item level-info" style={{ fontSize: '0.82rem', padding: '0.35rem 0.6rem' }}>
                <span style={{ opacity: 0.45, marginRight: '0.5rem' }}>{l.time}</span>
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** 翻译速率估算组件：段/秒、已用时、预计剩余（基于段落总数估算） */
function SpeedEstimate({ totalParagraphs, startedAt, totalEstimate }: { totalParagraphs: number; startedAt: string; totalEstimate: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = now - new Date(startedAt).getTime();
  const elapsedSec = Math.max(elapsedMs / 1000, 0.5);
  const speed = totalParagraphs > 0 ? totalParagraphs / elapsedSec : 0;

  const formatDuration = (ms: number): string => {
    if (ms <= 0) return '0秒';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}时${m}分${s}秒`;
    if (m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
  };

  // 根据段落总数估算剩余时间
  let etaText: string | null = null;
  if (totalEstimate > 0 && totalParagraphs > 0 && speed > 0) {
    const remaining = totalEstimate - totalParagraphs;
    if (remaining > 0) {
      etaText = formatDuration((remaining / speed) * 1000);
    }
  }

  return (
    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      {totalParagraphs > 0 && speed > 0 ? (
        <span>速率：{speed >= 1 ? speed.toFixed(1) : speed.toFixed(2)} 段/秒</span>
      ) : (
        <span>速率：准备中…</span>
      )}
      <span>已用时：{formatDuration(elapsedMs)}</span>
      {etaText ? <span>预计剩余：{etaText}</span> : null}
    </div>
  );
}
