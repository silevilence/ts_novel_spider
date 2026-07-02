import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentsRoot = fileURLToPath(new URL('.', import.meta.url));

test('SchedulingDashboard renders page title and description', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'scheduling-dashboard.tsx'), 'utf8');
  assert.match(source, /定时更新管理/);
  assert.match(source, /自动检查书库中的作品更新/);
});

test('SchedulingDashboard includes scheduling mode controls and CronEditor', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'scheduling-dashboard.tsx'), 'utf8');
  assert.match(source, /import.*CronEditor.*from.*'\.\/cron-editor'/);
  assert.match(source, /固定间隔/);
  assert.match(source, /Cron 表达式/);
  assert.match(source, /每周定时/);
  assert.match(source, /<CronEditor/);
});

test('SchedulingDashboard includes summary model controls and novel list actions', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'scheduling-dashboard.tsx'), 'utf8');
  assert.match(source, /默认更新总结模型/);
  assert.match(source, /自动总结/);
  assert.match(source, /保存书单设置/);
  assert.match(source, /model\.updateNovels/);
});

test('SchedulingDashboard renders run history board with summary details', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'scheduling-dashboard.tsx'), 'utf8');
  assert.match(source, /运行记录/);
  assert.match(source, /暂无运行记录/);
  assert.match(source, /model\.runs\.map/);
  assert.match(source, /loadMoreRuns/);
});