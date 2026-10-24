import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { SchedulingRunDetails } from './scheduling-dashboard';
import type { SchedulingRun } from '../services/api';

const run: SchedulingRun = {
  id: 'run', startedAt: '2026-10-24T01:00:00Z', completedAt: '2026-10-24T01:00:08Z',
  status: 'completed', totalChecked: 2, newChaptersFound: 1, skipped: 0, errored: 0, summaries: [],
  results: [
    { sourceId: 'test', novelId: 'unchanged', title: '没有更新的书', result: 'up_to_date', message: '已是最新', checkedAt: '2026-10-24T01:00:00Z', chapters: [] },
    { sourceId: 'test', novelId: 'updated', title: '本轮更新的书名', result: 'new_chapters', message: '发现 2 章，下载成功 1 章，失败 1 章', checkedAt: '2026-10-24T01:00:08Z', chapters: [
      { id: 'c1', title: '新章节标题', downloaded: true }, { id: 'c2', title: '下载失败的章节', downloaded: false },
    ] },
  ],
};
function render(value: SchedulingRun) {
  return renderToStaticMarkup(createElement(MantineProvider, null, createElement(SchedulingRunDetails, { run: value })));
}
test('history shows updated titles, chapters and partial failures without AI summaries', () => {
  const html = render(run);
  assert.match(html, /本轮更新的书名/); assert.match(html, /新章节标题/);
  assert.match(html, /已下载/); assert.match(html, /下载失败的章节/); assert.match(html, /未下载成功/);
  assert.ok(html.indexOf('本轮更新的书名') < html.indexOf('没有更新的书'));
});
test('legacy and in-progress histories distinguish missing evidence from no updates', () => {
  assert.match(render({ ...run, results: null }), /旧版运行记录未保存逐书明细/);
  assert.match(render({ ...run, results: [], status: 'running' }), /正在检查/);
  assert.match(render({ ...run, results: [] }), /本轮没有作品检查明细/);
});
