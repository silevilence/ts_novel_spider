import { useState, useRef, useMemo } from 'react';

interface LanguagePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

/** 常用语言及别名，用于输入时自动联想 */
const LANGUAGE_OPTIONS: Array<{ code: string; aliases: string[] }> = [
  { code: 'ja', aliases: ['日语', '日文', '日本語', 'japanese'] },
  { code: 'zh-CN', aliases: ['中文', '简体中文', '简体', '汉语', 'chinese simplified'] },
  { code: 'zh-TW', aliases: ['繁体中文', '繁体', '正体', 'chinese traditional'] },
  { code: 'en', aliases: ['英语', '英文', 'english'] },
  { code: 'ko', aliases: ['韩语', '韩文', '朝鲜语', 'korean'] },
  { code: 'fr', aliases: ['法语', '法文', 'french'] },
  { code: 'de', aliases: ['德语', '德文', 'german'] },
  { code: 'es', aliases: ['西班牙语', '西语', 'spanish'] },
  { code: 'pt', aliases: ['葡萄牙语', '葡语', 'portuguese'] },
  { code: 'ru', aliases: ['俄语', '俄文', 'russian'] },
  { code: 'ar', aliases: ['阿拉伯语', '阿语', 'arabic'] },
  { code: 'th', aliases: ['泰语', '泰文', 'thai'] },
  { code: 'vi', aliases: ['越南语', '越语', 'vietnamese'] },
  { code: 'id', aliases: ['印尼语', '印度尼西亚语', 'indonesian'] },
];

/**
 * 语言选择器：支持直接输入语言代码或名称，输入时弹出匹配项。
 */
export function LanguagePicker({ value, onChange, placeholder, id }: LanguagePickerProps) {
  const [inputValue, setInputValue] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const normalized = inputValue.trim().toLowerCase();

  const suggestions = useMemo(() => {
    if (!normalized) return LANGUAGE_OPTIONS;
    return LANGUAGE_OPTIONS.filter(
      (opt) =>
        opt.code.toLowerCase().includes(normalized) ||
        opt.aliases.some((alias) => alias.includes(normalized)),
    );
  }, [normalized]);

  function handleSelect(code: string) {
    setInputValue(code);
    onChange(code);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function handleInputChange(next: string) {
    setInputValue(next);
    setShowSuggestions(true);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  function handleBlur() {
    // 延迟关闭，让点击选项先生效
    setTimeout(() => setShowSuggestions(false), 150);
  }

  return (
    <div className="language-picker" style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        id={id}
        value={inputValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setShowSuggestions(true)}
        onBlur={handleBlur}
        placeholder={placeholder ?? 'ja'}
      />
      {showSuggestions && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0]!.code === inputValue) ? (
        <ul className="language-picker-suggestions" role="listbox">
          {suggestions.map((opt) => (
            <li key={opt.code} role="option" aria-selected={opt.code === inputValue}>
              <button
                type="button"
                className={`ghost-button language-picker-option${opt.code === inputValue ? ' active' : ''}`}
                onClick={() => handleSelect(opt.code)}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span className="language-code">{opt.code}</span>
                <span className="language-label">{opt.aliases.join(' / ')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
