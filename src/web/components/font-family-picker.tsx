import { useState } from 'react';
import { Badge, Button, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';

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
    <Stack gap="xs">
      <Text size="sm" fw={600}>字体族</Text>
      <SegmentedControl
        data={Object.entries(PRESET_LABELS).map(([v, l]) => ({ value: v, label: l }))}
        value={preset}
        onChange={(v) => onPresetChange(v as FontFamilyPickerProps['preset'])}
        disabled={disabled ?? false}
        fullWidth
      />

      {preset === 'custom' ? (
        <Stack gap="xs">
          <Group gap={4} wrap="wrap">
            {chain.length === 0 ? (
              <Text size="xs" c="dimmed">尚未添加字体，请在下方输入或点击推荐字体。</Text>
            ) : (
              chain.map((name, index) => (
                <Badge key={`${name}-${index}`} variant="light" size="lg"
                  rightSection={
                    <IconX size={12} style={{ cursor: 'pointer' }} onClick={() => removeFont(index)} />
                  }>
                  {index + 1}. {name}
                </Badge>
              ))
            )}
          </Group>

          <Group>
            <TextInput
              placeholder="输入字体名后回车"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualAdd(); } }}
              disabled={disabled ?? false}
              style={{ flex: 1 }}
            />
            <Button variant="light" size="compact-sm" onClick={handleManualAdd}
              disabled={(disabled ?? false) || customInput.trim().length === 0}
              leftSection={<IconPlus size={14} />}>添加</Button>
          </Group>

          <Text size="xs" c="dimmed">点击快速添加：</Text>
          <Group gap={4} wrap="wrap">
            {SUGGESTED_FONTS.map((name) => (
              <Badge key={name} variant="outline" size="sm"
                style={{ cursor: 'pointer' }}
                opacity={chain.some((e) => e.toLowerCase() === name.toLowerCase()) ? 0.4 : 1}
                onClick={() => { if (!(disabled ?? false) && !chain.some((e) => e.toLowerCase() === name.toLowerCase())) addFont(name); }}>
                {name}
              </Badge>
            ))}
          </Group>
        </Stack>
      ) : null}
    </Stack>
  );
}
