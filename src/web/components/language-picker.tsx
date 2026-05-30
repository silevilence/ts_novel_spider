import { useMemo } from 'react';
import { Autocomplete, type AutocompleteProps } from '@mantine/core';
import { IconLanguage } from '@tabler/icons-react';

interface LanguagePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

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

export function LanguagePicker({ value, onChange, placeholder, id }: LanguagePickerProps) {
  const data = useMemo(() =>
    LANGUAGE_OPTIONS.map((opt) => ({
      value: opt.code,
      label: `${opt.code} — ${opt.aliases.join(' / ')}`,
    })),
    [],
  );

  return (
    <Autocomplete
      id={id}
      leftSection={<IconLanguage size={16} />}
      placeholder={placeholder ?? 'ja'}
      value={value}
      onChange={(v) => onChange(v)}
      data={data}
      limit={8}
    />
  );
}
