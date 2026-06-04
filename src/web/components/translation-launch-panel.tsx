import { useState, useEffect } from 'react';
import { Anchor, Badge, Button, Group, Paper, Progress, ScrollArea, Select, Stack, Text, Title } from '@mantine/core';
import type { LibraryModel, TranslationBuildState } from '../services/library-model';
import { fetchLlmProvidersPreferences, fetchTranslationPreferences, buildLibraryExportDownloadUrl, type LibraryExportFormat, type TranslationExportMode } from '../services/api';
import { TranslationGlossaryModal } from './translation-glossary-modal';

interface TranslationLaunchPanelProps {
  model: LibraryModel;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export function TranslationLaunchPanel({ model, onNotify }: TranslationLaunchPanelProps) {
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ key: string; label: string }>>([]);
  const [glossaryOpened, setGlossaryOpened] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchLlmProvidersPreferences(),
      fetchTranslationPreferences(),
    ]).then(([p, transPrefs]) => {
      const models: Array<{ key: string; label: string }> = [];
      for (const provider of p.providers) {
        if (!provider.enabled) continue;
        for (const m of provider.models) {
          if (!m.enabled || !m.modelId || !m.resolvedCapabilities.includes('chat')) continue;
          models.push({ key: `${provider.id}:${m.modelId}`, label: `${provider.label} / ${m.modelId}` });
        }
      }
      setAvailableModels(models);
      const preferred = transPrefs.config.preferredTranslationModelKey;
      if (preferred && models.some((m) => m.key === preferred)) {
        setSelectedModel(preferred);
      } else if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0]!.key);
      }
    }, () => {});
  }, []);

  // 轮询翻译构建状态（运行时每3秒更新，驱动进度条）
  useEffect(() => {
    if (!model.detail?.novel || !(model.translationBuild?.status === 'running' || model.translationBuild?.status === 'queued')) return;
    const timer = setInterval(() => {
      model.syncTranslationBuild?.().catch(() => {});
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
    <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>翻译</Text>
            <Title order={3}>{isRunning ? '翻译中' : isDone ? (build?.status === 'completed' ? '翻译完成' : '翻译失败') : '翻译任务'}</Title>
            <Text size="xs" c="dimmed">{build ? build.message : '使用 AI 将已下载章节翻译为目标语言。'}</Text>
          </div>
          {build ? (
            <Group gap="xs">
              <Badge variant="light" color="green" size="sm">已译 {build.translatedChapters}</Badge>
              {build.failedChapters > 0 ? <Badge variant="light" color="red" size="sm">失败 {build.failedChapters}</Badge> : null}
            </Group>
          ) : null}
        </Group>

        {/* 章节进度条 */}
        {build && detail ? (
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">章节 {build.translatedChapters + build.failedChapters}/{detail.stats.downloaded}</Text>
              <Text size="xs" c="dimmed">{build.progressPercent}%</Text>
            </Group>
            <Progress value={build.progressPercent} size="sm" color="orange" striped={isRunning} animated={isRunning} />

            {isRunning ? (
              <>
                <Text size="xs" c="dimmed">当前：{build.message || '准备中…'}</Text>
                {/* 段落级实时进度 */}
                {build.currentChapterParagraphs > 0 ? (
                  <Stack gap={2} mb={4}>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">段落 {build.currentChapterTranslatedParagraphs}/{build.currentChapterParagraphs}</Text>
                      <Text size="xs" c="dimmed">{Math.round((build.currentChapterTranslatedParagraphs / build.currentChapterParagraphs) * 100)}%</Text>
                    </Group>
                    <Progress value={Math.round((build.currentChapterTranslatedParagraphs / build.currentChapterParagraphs) * 100)} size="xs" color="orange.3" />
                  </Stack>
                ) : (
                  <Progress value={30} size="xs" color="orange.3" animated style={{ opacity: 0.5 }} />
                )}
                {build.startedAt ? (
                  <SpeedEstimate totalParagraphs={build.totalTranslatedParagraphs} startedAt={build.startedAt} totalEstimate={build.totalParagraphEstimate || 0} />
                ) : null}
              </>
            ) : null}
          </Stack>
        ) : null}

        {/* 操作区 */}
        <Group gap="xs" wrap="wrap">
          {availableModels.length > 0 ? (
            <Select
              data={availableModels.map((m) => ({ value: m.key, label: m.label }))}
              value={selectedModel}
              onChange={(v) => v && setSelectedModel(v)}
              disabled={isRunning}
              searchable
              style={{ flex: 1, minWidth: 200 }}
            />
          ) : (
            <Text size="xs" c="dimmed" style={{ flex: 1 }}>未配置可用翻译模型</Text>
          )}

          {isRunning ? (
            <Button variant="outline" color="red" size="compact-sm"
              onClick={() => { void model.cancelTranslation?.(); }}
              loading={model.translationBusy}>
              暂停
            </Button>
          ) : null}

          {!isRunning ? (
            <>
              <Button color="brand" size="compact-sm"
                onClick={() => void model.startTranslation(selectedModel)}
                loading={model.translationBusy}
                disabled={!detail || detail.stats.downloaded === 0}>
                {isPaused ? '继续翻译' : isDone && build?.status === 'completed' ? '继续完善' : '发起翻译'}
              </Button>
              {(isPaused || isDone) ? (
                <Button variant="subtle" size="compact-sm"
                  onClick={() => { void model.startTranslation(selectedModel, true); }}
                  disabled={model.translationBusy || !detail || detail.stats.downloaded === 0}>
                  从头开始
                </Button>
              ) : null}
            </>
          ) : (
            <Text size="sm" c="dimmed" style={{ minWidth: 100, textAlign: 'center' }}>翻译中…</Text>
          )}

          {langs ? (
            <Anchor
              href={buildLibraryExportDownloadUrl(detail?.sourceId ?? '', detail?.metadata.novelId ?? '', 'epub', model.translationViewMode, langs.sourceLang, langs.targetLang)}
              target="_blank" rel="noopener noreferrer" size="sm">
              导出译文
            </Anchor>
          ) : null}
        </Group>

        {/* 术语管理入口 */}
        <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }}
          onClick={() => setGlossaryOpened(true)}>
          管理术语表
        </Button>

        <TranslationGlossaryModal
          opened={glossaryOpened}
          onClose={() => setGlossaryOpened(false)}
          model={model}
          onNotify={onNotify}
        />

        {/* 翻译状态摘要 */}
        {build ? (
          <Paper p="xs" radius="md" style={{ background: 'rgba(12,8,6,0.8)' }}>
            <Group gap="sm" wrap="wrap">
              <Text size="xs" fw={600} c="dimmed">
                {build.status === 'running' ? '翻译中' : build.status === 'completed' ? '已完成' : build.status === 'failed' ? '已失败' : build.status}
              </Text>
              <Badge variant="light" color="green" size="xs">已译 {build.translatedChapters}</Badge>
              {build.failedChapters > 0 ? <Badge variant="light" color="red" size="xs">失败 {build.failedChapters}</Badge> : null}
              {detail ? <Badge variant="light" color="gray" size="xs">待译 {detail.stats.downloaded - build.translatedChapters - build.failedChapters}</Badge> : null}
              {build.startedAt ? <Text size="xs" c="dimmed">{new Date(build.startedAt).toLocaleTimeString('zh-CN')} 起</Text> : null}
            </Group>
          </Paper>
        ) : null}
      </Stack>
    </Paper>
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
