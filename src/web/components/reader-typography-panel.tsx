import { useEffect, useState } from 'react';

import {
  fetchReaderTypographyPreferences,
  updateReaderTypographyPreferences,
  type UpdateReaderTypographyInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import { FontFamilyPicker } from './font-family-picker';

interface ReaderTypographyPanelProps {
  onNotice: (notice: NoticeInput) => void;
}

interface TypographyDraft {
  fontSize: number;
  fontSizePreset: 'small' | 'medium' | 'large';
  lineHeight: number;
  paragraphSpacing: number;
  fontFamilyPreset: 'sans' | 'serif' | 'monospace' | 'custom';
  fontFamilyCustom: string;
  loading: boolean;
  saving: boolean;
  errorMessage: string | null;
  loaded: boolean;
}

const SAMPLE_MIXED_TEXT = `「夜は冷え込んでいた。The night air was crisp and cold.」

街灯の光が濡れた歩道に反射して、まるで水面のように揺らめいている。

燈光在濕潤的人行道上反射，搖曳如湖面的倒影。

「Wait—what was that sound?」

彼女はふと立ち止まり、振り返った。

她停住脚步，回头望去——巷弄深处，只有一片安静的墨色。

*“Sometimes silence speaks louder than words.”*

夜風が梢を揺らす音だけが、かすかに聞こえていた。`;
async function validateFontChain(fontFamilyCustom: string): Promise<string | null> {
  const names = fontFamilyCustom
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter((name) => name.length > 0);

  if (names.length === 0) {
    return null;
  }

  const failed: string[] = [];

  for (const name of names) {
    try {
      const font = new FontFace('__validate', `local("${name}")`);
      await font.load();
    } catch {
      failed.push(name);
    }
  }

  return failed.length > 0
    ? `以下字体在当前系统中未找到：${failed.join('、')}`
    : null;
}
export function ReaderTypographyPanel({ onNotice }: ReaderTypographyPanelProps) {
  const [draft, setDraft] = useState<TypographyDraft>({
    fontSize: 1.03,
    fontSizePreset: 'medium',
    lineHeight: 1.9,
    paragraphSpacing: 1,
    fontFamilyPreset: 'sans',
    fontFamilyCustom: '',
    loading: true,
    saving: false,
    errorMessage: null,
    loaded: false,
  });

  useEffect(() => {
    void fetchReaderTypographyPreferences()
      .then((payload) => {
        setDraft((prev) => ({
          ...prev,
          fontSize: payload.config.fontSize,
          fontSizePreset: payload.config.fontSizePreset,
          lineHeight: payload.config.lineHeight,
          paragraphSpacing: payload.config.paragraphSpacing,
          fontFamilyPreset: payload.config.fontFamilyPreset,
          fontFamilyCustom: payload.config.fontFamilyCustom,
          loading: false,
          loaded: true,
        }));
      })
      .catch((error) => {
        setDraft((prev) => ({
          ...prev,
          loading: false,
          errorMessage: error instanceof Error ? error.message : 'Failed to load reader typography preferences.',
        }));
      });
  }, []);

  function setField<K extends keyof TypographyDraft>(key: K, value: TypographyDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function applyFontSizePreset(preset: TypographyDraft['fontSizePreset']) {
    const sizes: Record<TypographyDraft['fontSizePreset'], number> = {
      small: 0.95,
      medium: 1.03,
      large: 1.16,
    };
    setDraft((prev) => ({
      ...prev,
      fontSize: sizes[preset],
      fontSizePreset: preset,
    }));
  }

  async function handleSave() {
    setDraft((prev) => ({ ...prev, saving: true, errorMessage: null }));

    if (draft.fontFamilyPreset === 'custom') {
      const fontError = await validateFontChain(draft.fontFamilyCustom);
      if (fontError) {
        setDraft((prev) => ({ ...prev, saving: false, errorMessage: fontError }));
        return;
      }
    }

    const input: UpdateReaderTypographyInput = {
      fontSize: draft.fontSize,
      fontSizePreset: draft.fontSizePreset,
      lineHeight: draft.lineHeight,
      paragraphSpacing: draft.paragraphSpacing,
      fontFamilyPreset: draft.fontFamilyPreset,
      fontFamilyCustom: draft.fontFamilyCustom.trim(),
    };

    try {
      await updateReaderTypographyPreferences(input);
      setDraft((prev) => ({ ...prev, saving: false, loaded: true }));
      onNotice?.({ tone: 'success', title: '排版已保存', message: '全局阅读器排版已保存，后续打开书籍时自动生效。' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存阅读器排版失败。';
      setDraft((prev) => ({ ...prev, saving: false, errorMessage: message }));
      onNotice?.({ tone: 'error', title: '保存失败', message });
    }
  }

  const resolvedFontFamily = (() => {
    switch (draft.fontFamilyPreset) {
      case 'serif':
        return '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", Georgia, serif';
      case 'monospace':
        return '"Noto Sans Mono CJK SC", "Source Han Mono SC", "Courier New", monospace';
      case 'custom':
        return draft.fontFamilyCustom || '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      case 'sans':
      default:
        return '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    }
  })();

  return (
    <div className="reader-typography-panel">
      {draft.loading ? (
        <p className="panel-note">正在加载阅读器排版配置…</p>
      ) : null}

      {draft.errorMessage && !draft.saving ? (
        <div className="notice-banner warn">
          <p>{draft.errorMessage}</p>
        </div>
      ) : null}

      <div className="reader-typography-grid">
        {/* 字体族预设 + 自定义选择器 */}
        <FontFamilyPicker
          preset={draft.fontFamilyPreset}
          fontFamilyCustom={draft.fontFamilyCustom}
          onPresetChange={(preset) => setField('fontFamilyPreset', preset)}
          onCustomChange={(value) => setField('fontFamilyCustom', value)}
        />

        {/* 字号 */}
        <fieldset className="reader-typography-group">
          <legend className="label">字号</legend>
          <div className="reader-typography-preset-row">
            {(Object.entries({ small: '小 (0.95rem)', medium: '中 (1.03rem)', large: '大 (1.16rem)' }) as Array<[TypographyDraft['fontSizePreset'], string]>).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                className={`preset-chip ${draft.fontSizePreset === preset ? 'active' : ''}`}
                onClick={() => applyFontSizePreset(preset)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="reader-typography-number">
            <span>精确值 (rem)</span>
            <input
              type="number"
              min={0.7}
              max={2.2}
              step={0.01}
              value={draft.fontSize}
              onChange={(event) => {
                const raw = Number(event.target.value);
                if (Number.isFinite(raw)) {
                  setField('fontSize', Math.max(0.7, Math.min(2.2, raw)));
                }
              }}
            />
          </label>
        </fieldset>

        {/* 行高 */}
        <fieldset className="reader-typography-group">
          <legend className="label">行高</legend>
          <div className="reader-typography-range">
            <input
              type="range"
              min={1.2}
              max={3}
              step={0.05}
              value={draft.lineHeight}
              onChange={(event) => setField('lineHeight', Number(event.target.value))}
            />
            <span className="range-value">{draft.lineHeight.toFixed(2)}</span>
          </div>
        </fieldset>

        {/* 段间距 */}
        <fieldset className="reader-typography-group">
          <legend className="label">段间距 (rem)</legend>
          <div className="reader-typography-range">
            <input
              type="range"
              min={0}
              max={3.5}
              step={0.05}
              value={draft.paragraphSpacing}
              onChange={(event) => setField('paragraphSpacing', Number(event.target.value))}
            />
            <span className="range-value">{draft.paragraphSpacing.toFixed(2)}</span>
          </div>
        </fieldset>
      </div>

      {/* 多语种排版沙箱 */}
      <fieldset className="reader-typography-group reader-typography-sandbox">
        <legend className="label">多语种排版预览 (实时)</legend>
        <div
          className="reader-typography-preview"
          style={{
            fontSize: `${draft.fontSize}rem`,
            lineHeight: draft.lineHeight,
            fontFamily: resolvedFontFamily,
          }}
        >
          {SAMPLE_MIXED_TEXT.split('\n\n').map((paragraph, index) => (
            <p key={index} style={{ marginBottom: `${draft.paragraphSpacing}rem` }}>
              {paragraph}
            </p>
          ))}
        </div>
      </fieldset>

      <div className="action-row wrap reader-typography-actions">
        <button
          type="button"
          className="primary-button"
          onClick={handleSave}
          disabled={draft.saving || draft.loading}
        >
          {draft.saving ? '保存中…' : '保存全局排版'}
        </button>
      </div>
    </div>
  );
}
