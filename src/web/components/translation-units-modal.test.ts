import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { TranslationUnitList } from './translation-units-modal';
import type { TranslationUnitStatus } from '../services/api';

function render(units: TranslationUnitStatus[]) {
  return renderToStaticMarkup(createElement(MantineProvider, {}, createElement(TranslationUnitList, { sourceId: 'manual', novelId: 'n', units })));
}

test('unit list distinguishes metadata and volumes from chapter links and explains failures', () => {
  const markup = render([
    { id: '__novel_meta__', kind: 'meta', index: 0, title: '书名', status: 'translated', errorMessage: null },
    { id: '__volume_1__', kind: 'volume', index: 1, title: '第一卷', status: 'pending', errorMessage: null },
    { id: 'chapter/a', kind: 'chapter', index: 2, title: '第二章', status: 'failed', errorMessage: '[empty_response] 段落 2：回复为空' },
  ]);
  assert.match(markup, /书名与简介/);
  assert.match(markup, /卷标题/);
  assert.match(markup, /href="\/library\/manual\/n\/read\/chapter%2Fa"/);
  assert.doesNotMatch(markup, /href="[^"]*__(novel_meta|volume)/);
  assert.match(markup, /\[empty_response\] 段落 2：回复为空/);
});

test('unit list provides an empty state and paginates long chapter lists', () => {
  assert.match(render([]), /此状态下暂无翻译单元/);
  const markup = render(Array.from({ length: 51 }, (_, index) => ({
    id: `c${index}`, kind: 'chapter', index: index + 1, title: `章节${index}`, status: 'pending', errorMessage: null,
  })));
  assert.match(markup, /共 51 个翻译单元/);
  assert.match(markup, /翻译明细分页/);
  assert.match(markup, /章节49/);
  assert.doesNotMatch(markup, /章节50/);
});
