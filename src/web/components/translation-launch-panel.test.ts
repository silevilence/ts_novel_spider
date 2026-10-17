import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { TranslationLaunchPanel } from './translation-launch-panel';
import type { LibraryModel } from '../services/library-model';

for (const [status, translatedChapters, failedChapters, totalUnits, expectedPending] of [
  ['failed', 0, 36, 36, 0],
  ['completed', 38, 0, 38, 0],
  ['running', 20, 1, 38, 17],
] as const) {
  test(`translation panel counts metadata and volumes consistently when ${status}`, () => {
    const model = {
      location: { sourceId: 'manual', novelId: 'test' },
      detail: { novel: { sourceId: 'manual', metadata: { novelId: 'test' }, stats: { downloaded: 35 } }, knowledgeGraph: { entities: [] } },
      translationBuild: { status, stage: status, translatedChapters, failedChapters, totalUnits, progressPercent: 100, startedAt: null },
      translationTerms: [],
      pendingTermCount: 0,
    } as unknown as LibraryModel;
    const markup = renderToStaticMarkup(createElement(MantineProvider, {}, createElement(TranslationLaunchPanel, { model, onNotify: () => {} })));
    const text = markup.replace(/<[^>]+>/g, '');
    assert.ok(text.includes(`翻译单元 ${translatedChapters + failedChapters}/${totalUnits}`));
    assert.ok(text.includes(`待译 ${expectedPending}`));
    assert.doesNotMatch(text, /待译 -|章节 36\/35/);
  });
}
