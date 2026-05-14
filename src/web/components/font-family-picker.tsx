import { useState } from 'react';

export interface FontFamilyPickerProps {
  preset: 'sans' | 'serif' | 'monospace' | 'custom';
  fontFamilyCustom: string;
  onPresetChange: (preset: 'sans' | 'serif' | 'monospace' | 'custom') => void;
  onCustomChange: (value: string) => void;
  disabled?: boolean;
}

const PRESET_LABELS: Record<FontFamilyPickerProps['preset'], string> = {
  sans: '无衬线',
  serif: '衬线',
  monospace: '等宽',
  custom: '自定义',
};

/** 常用中英文字体建议，用户可点击快速添加 */
const SUGGESTED_FONTS = [
  // 中文无衬线
  'Noto Sans CJK SC',
  'Source Han Sans SC',
  'PingFang SC',
  'Microsoft YaHei',
  'Noto Sans TC',
  // 中文衬线
  'Noto Serif CJK SC',
  'Source Han Serif SC',
  'Songti SC',
  'SimSun',
  // 中文等宽
  'Noto Sans Mono CJK SC',
  'Source Han Mono SC',
  // 日文
  'Noto Sans JP',
  'Hiragino Sans',
  'Yu Gothic',
  'Noto Serif JP',
  // 英文
  'Inter',
  'Roboto',
  'Lato',
  'Georgia',
  'Merriweather',
  'Fira Code',
  'JetBrains Mono',
  'Consolas',
  'Courier New',
  'Arial',
  'Helvetica',
  'Times New Roman',
];

function parseFontChain(raw: string): string[] {
  return raw
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter((name) => name.length > 0);
}

function chainToString(chain: string[]): string {
  return chain.map((name) => (/[,\s]/.test(name) ? `"${name}"` : name)).join(', ');
}

export function FontFamilyPicker({
  preset,
  fontFamilyCustom,
  onPresetChange,
  onCustomChange,
  disabled,
}: FontFamilyPickerProps) {
  const [customInput, setCustomInput] = useState('');

  const chain = parseFontChain(fontFamilyCustom);

  function addFont(name: string) {
    const trimmed = name.trim().replace(/^["']|["']$/g, '');
    if (!trimmed) { return; }

    const existing = new Set(chain.map((entry) => entry.toLowerCase()));
    if (existing.has(trimmed.toLowerCase())) { return; }

    const next = [...chain, trimmed];
    onCustomChange(next.join(', '));
  }

  function removeFont(index: number) {
    const next = chain.filter((_, idx) => idx !== index);
    onCustomChange(next.join(', '));
  }

  function handleManualAdd() {
    const trimmed = customInput.trim();
    if (!trimmed) { return; }

    const names = trimmed.split(',').map((name) => name.trim().replace(/^["']|["']$/g, '')).filter((name) => name.length > 0);
    let changed = false;
    let next = [...chain];

    for (const name of names) {
      const existing = new Set(next.map((entry) => entry.toLowerCase()));
      if (existing.has(name.toLowerCase())) { continue; }

      next = [...next, name];
      changed = true;
    }

    if (changed) {
      onCustomChange(next.join(', '));
    }

    setCustomInput('');
  }

  return (
    <fieldset className="reader-typography-group font-family-picker">
      <legend className="label">字体族</legend>
      <div className="reader-typography-options">
        {(Object.entries(PRESET_LABELS) as Array<[FontFamilyPickerProps['preset'], string]>).map(([value, label]) => (
          <label key={value} className="checkbox-field">
            <input
              type="radio"
              name="fontFamilyPreset"
              value={value}
              checked={preset === value}
              onChange={() => onPresetChange(value)}
              disabled={disabled}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {preset === 'custom' ? (
        <div className="font-chain-builder">
          {/* 已选字体链 */}
          <div className="font-chain-tags">
            {chain.length === 0 ? (
              <p className="panel-note font-chain-placeholder">尚未添加字体，请在下方输入或点击推荐字体。</p>
            ) : (
              chain.map((name, index) => (
                <span key={`${name}-${index}`} className="font-chain-tag">
                  <span className="font-chain-index">{index + 1}</span>
                  {name}
                  <button
                    type="button"
                    className="font-chain-remove"
                    onClick={() => removeFont(index)}
                    disabled={disabled}
                    aria-label={`移除 ${name}`}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          {/* 手动输入 */}
          <div className="font-chain-input-row">
            <input
              type="text"
              className="full-width-input"
              placeholder='输入字体名后回车，如 "Noto Serif CJK SC"'
              value={customInput}
              onChange={(event) => setCustomInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleManualAdd();
                }
              }}
              disabled={disabled}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={handleManualAdd}
              disabled={disabled || customInput.trim().length === 0}
            >
              添加
            </button>
          </div>

          {/* 推荐字体 */}
          <div className="font-chain-suggestions">
            <p className="panel-note">点击快速添加：</p>
            <div className="font-suggestion-chips">
              {SUGGESTED_FONTS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="preset-chip font-suggestion-chip"
                  onClick={() => addFont(name)}
                  disabled={disabled || chain.some((entry) => entry.toLowerCase() === name.toLowerCase())}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
