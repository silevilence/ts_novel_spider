import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentsRoot = fileURLToPath(new URL('.', import.meta.url));

test('OpdsDashboard renders page title with OPDS wording', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /OPDS 书源服务/);
  assert.match(source, /OPDS 书源/);
});

test('OpdsDashboard has enable switch bound to config.enabled', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /checked=\{config\?\.enabled/);
  assert.match(source, /model\.updateConfig\(\{ enabled:/);
});

test('OpdsDashboard includes CronEditor for scan cycle', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /import.*CronEditor.*from.*'\.\/cron-editor'/);
  assert.match(source, /<CronEditor/);
});

test('OpdsDashboard has manage shelf modal with novel list', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /管理上架书单/);
  assert.match(source, /modalSelections/);
  assert.match(source, /model\.updateNovels/);
});

test('OpdsDashboard renders statistics cards', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /上架书籍/);
  assert.match(source, /版本分布/);
  assert.match(source, /最近扫描/);
  assert.match(source, /stats\.visibleCount/);
  assert.match(source, /stats\.translatedCount/);
});

test('OpdsDashboard renders audit log table', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /扫描审计日志/);
  assert.match(source, /暂无审计记录/);
  assert.match(source, /<Table/);
  assert.match(source, /model\.runs\.map/);
});

test('OpdsDashboard shows loading state', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /加载中/);
});

test('OpdsDashboard uses warmPaperDark theme styling', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'opds-dashboard.tsx'), 'utf8');
  assert.match(source, /rgba\(31,\s*21,\s*16,\s*0\.78\)/);
  assert.match(source, /rgba\(168,\s*133,\s*96/);
});
