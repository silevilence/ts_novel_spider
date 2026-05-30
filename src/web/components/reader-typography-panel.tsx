import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Text,
} from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';

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
    <Stack gap="md">
      {draft.loading ? <Text size="sm" c="dimmed">正在加载阅读器排版配置…</Text> : null}
      {draft.errorMessage && !draft.saving ? <Text size="sm" c="red">{draft.errorMessage}</Text> : null}

      {/* 字体族 */}
      <FontFamilyPicker
        preset={draft.fontFamilyPreset}
        fontFamilyCustom={draft.fontFamilyCustom}
        onPresetChange={(preset) => setField('fontFamilyPreset', preset)}
        onCustomChange={(value) => setField('fontFamilyCustom', value)}
      />

      {/* 字号 */}
      <div>
        <Text size="sm" fw={600} mb="xs">字号</Text>
        <SegmentedControl
          data={[
            { value: 'small', label: '小 (0.95rem)' },
            { value: 'medium', label: '中 (1.03rem)' },
            { value: 'large', label: '大 (1.16rem)' },
          ]}
          value={draft.fontSizePreset}
          onChange={(v) => applyFontSizePreset(v as TypographyDraft['fontSizePreset'])}
          mb="xs"
          fullWidth
        />
        <NumberInput
          label="精确值 (rem)"
          min={0.7} max={2.2} step={0.01}
          value={draft.fontSize}
          onChange={(v) => { if (typeof v === 'number' && isFinite(v)) setField('fontSize', Math.max(0.7, Math.min(2.2, v))); }}
        />
      </div>

      {/* 行高 */}
      <div>
        <Text size="sm" fw={600}>行高：{draft.lineHeight.toFixed(2)}</Text>
        <Slider min={1.2} max={3} step={0.05} value={draft.lineHeight} onChange={(v) => setField('lineHeight', v)} />
      </div>

      {/* 段间距 */}
      <div>
        <Text size="sm" fw={600}>段间距：{draft.paragraphSpacing.toFixed(2)} rem</Text>
        <Slider min={0} max={3.5} step={0.05} value={draft.paragraphSpacing} onChange={(v) => setField('paragraphSpacing', v)} />
      </div>

      {/* 多语种排版沙箱 */}
      <div>
        <Text size="sm" fw={600} mb="xs">多语种排版预览（实时）</Text>
        <div style={{
          fontSize: `${draft.fontSize}rem`, lineHeight: draft.lineHeight, fontFamily: resolvedFontFamily,
          background: 'rgba(31,21,16,0.6)', borderRadius: 12, padding: '1rem', border: '1px solid rgba(168,133,96,0.15)',
        }}>
          {SAMPLE_MIXED_TEXT.split('\n\n').map((paragraph, index) => (
            <p key={index} style={{ marginBottom: `${draft.paragraphSpacing}rem` }}>{paragraph}</p>
          ))}
        </div>
      </div>

      <Group>
        <Button color="brand" onClick={handleSave} loading={draft.saving} disabled={draft.loading}
          leftSection={<IconDeviceFloppy size={16} />}>
          保存排版
        </Button>
      </Group>
    </Stack>
  );
}
