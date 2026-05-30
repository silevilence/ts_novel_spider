import { useState } from 'react';
import { Badge, Button, Group, Paper, SegmentedControl, Stack, Text } from '@mantine/core';

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
    <Stack gap="md">
      <Text size="sm" fw={600}>翻译模式</Text>
      <SegmentedControl
        data={TRANSLATION_MODE_OPTIONS.map((o) => ({ value: o.mode, label: o.label }))}
        value={model.translationViewMode}
        onChange={(v) => model.setTranslationViewMode(v as TranslationExportMode)}
      />

      {langs ? (
        <Text size="xs" c="dimmed">
          当前语言对：{langLabel(langs.sourceLang)} → {langLabel(langs.targetLang)}
          。在「全局设置 → 翻译默认值」中可以修改全局语言对和模型配置。
        </Text>
      ) : (
        <Text size="xs" c="dimmed">尚未设置翻译语言对，请在全局设置中先配置翻译默认值。</Text>
      )}

      <Group>
        <Button variant="subtle" size="compact-sm" onClick={() => setIsConfigOpen((v) => !v)}>
          {isConfigOpen ? '收起配置' : '翻译配置'}
        </Button>
        <Button variant="subtle" size="compact-sm" onClick={() => setIsExportOpen((v) => !v)}>
          {isExportOpen ? '收起导出' : '导出译文'}
        </Button>
      </Group>

      {isConfigOpen ? (
        <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.6)' }}>
          <Text size="sm" fw={600} mb="xs">翻译配置摘要</Text>
          <Text size="xs" c="dimmed">
            当前翻译流水线依赖「全局设置」中的翻译默认值和已配置的 LLM 模型。
            如需修改语言对、翻译模型等参数，请前往「全局设置 → 翻译默认值」。
          </Text>
        </Paper>
      ) : null}

      {isExportOpen ? (
        <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.6)' }}>
          <Text size="sm" fw={600} mb="xs">导出译文文件</Text>
          <Text size="xs" c="dimmed" mb="sm">
            选择导出格式下载包含翻译内容的文件。如果当前书籍还没有翻译数据，导出会回落为原文。
          </Text>
          <Stack gap="xs">
            {(['markdown', 'epub', 'txt'] as LibraryExportFormat[]).map((fmt) => {
              if (!model.detail?.novel) return null;
              const baseUrl = buildLibraryExportDownloadUrl(
                model.detail.novel.sourceId, model.detail.novel.metadata.novelId,
                fmt, model.translationViewMode, langs?.sourceLang, langs?.targetLang,
              );
              return (
                <Button
                  key={fmt}
                  variant="light"
                  size="compact-sm"
                  component="a"
                  href={baseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onNotify({ tone: 'info', title: '导出已开始', message: `${fmt.toUpperCase()} 文件下载中。` })}
                >
                  {fmt.toUpperCase()} — {model.translationViewMode === 'bilingual' ? '双语对照' : model.translationViewMode === 'translated' ? '纯译文' : '原文'}
                </Button>
              );
            })}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
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
