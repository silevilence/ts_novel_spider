import { useState } from 'react';

import type { LibraryModel } from '../services/library-model';
import { buildLibraryExportDownloadUrl, type LibraryExportFormat, type TranslationExportMode } from '../services/api';

interface TranslationProfilePanelProps {
  model: LibraryModel;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

const TRANSLATION_MODE_OPTIONS: Array<{ mode: TranslationExportMode; label: string; summary: string }> = [
  { mode: 'original', label: '原文', summary: '仅显示原语言内容' },
  { mode: 'translated', label: '纯译文', summary: '仅显示翻译后的内容' },
  { mode: 'bilingual', label: '双语对照', summary: '段落交替显示原文与译文' },
];

export function TranslationProfilePanel({ model, onNotify }: TranslationProfilePanelProps) {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const langs = model.translationLanguages;

  return (
    <div className="panel translation-panel">
      <div className="translation-status-bar">
        <span className="label">翻译模式</span>
        <div className="chip-row">
          {TRANSLATION_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              className={`preset-chip${model.translationViewMode === opt.mode ? ' active' : ''}`}
              title={opt.summary}
              onClick={() => model.setTranslationViewMode(opt.mode)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {langs ? (
        <p className="panel-note">
          当前语言对：{langLabel(langs.sourceLang)} → {langLabel(langs.targetLang)}
          。在「系统偏好 → 翻译默认值」中可以修改全局语言对和模型配置。
        </p>
      ) : (
        <p className="panel-note">尚未设置翻译语言对，请在系统偏好中先配置翻译默认值。</p>
      )}

      <div className="action-row">
        <button type="button" className="ghost-button" onClick={() => setIsConfigOpen((v) => !v)}>
          {isConfigOpen ? '收起配置' : '翻译配置'}
        </button>
        <button type="button" className="ghost-button" onClick={() => setIsExportOpen((v) => !v)}>
          {isExportOpen ? '收起导出' : '导出译文'}
        </button>
      </div>

      {isConfigOpen ? (
        <div className="card fold-content" style={{ marginTop: '0.75rem' }}>
          <h3>翻译配置摘要</h3>
          <p className="panel-note">
            当前翻译流水线依赖「系统偏好」中的全局翻译默认值和已配置的 LLM 模型。
            如需修改语言对、翻译模型、审校阈值等参数，请前往「系统偏好 → 翻译默认值」。
            翻译配置一旦有产物将自动锁定，需先清除翻译数据才能修改。
          </p>
        </div>
      ) : null}

      {isExportOpen ? (
        <div className="card fold-content" style={{ marginTop: '0.75rem' }}>
          <h3>导出译文文件</h3>
          <p className="panel-note">
            选择导出格式，下载包含翻译内容的文件。如果当前书籍还没有翻译数据，导出会回落为原文。
          </p>
          <div className="export-option-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
            {(['markdown', 'epub', 'txt'] as LibraryExportFormat[]).map((fmt) => {
              if (!model.detail?.novel) return null;

              const baseUrl = buildLibraryExportDownloadUrl(
                model.detail.novel.sourceId,
                model.detail.novel.metadata.novelId,
                fmt,
                model.translationViewMode,
                langs?.sourceLang,
                langs?.targetLang,
              );

              return (
                <a
                  key={fmt}
                  href={baseUrl}
                  className="ghost-button"
                  style={{ textAlign: 'left' }}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onNotify({
                    tone: 'info',
                    title: '导出已开始',
                    message: `${fmt.toUpperCase()} 文件下载中。`,
                  })}
                >
                  <strong>{fmt.toUpperCase()}</strong>
                  <span style={{ opacity: 0.55, marginLeft: '0.5rem' }}>
                    — {model.translationViewMode === 'bilingual' ? '双语对照' : model.translationViewMode === 'translated' ? '纯译文' : '原文'}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function langLabel(code: string): string {
  const map: Record<string, string> = {
    ja: '日文',
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    en: '英文',
    ko: '韩文',
  };
  return map[code] ?? code;
}
