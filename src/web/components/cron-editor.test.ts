import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentsRoot = fileURLToPath(new URL('.', import.meta.url));

test('CronEditor uses native Mantine v7 components (no third-party cron dependency)', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'cron-editor.tsx'), 'utf8');

  assert.match(source, /import.*MultiSelect.*from ['"]@mantine\/core['"]/);
  assert.match(source, /import.*Select.*from ['"]@mantine\/core['"]/);
  assert.doesNotMatch(source, /react-js-cron/);
});

test('CronEditor covers all standard cron periods', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'cron-editor.tsx'), 'utf8');

  assert.match(source, /'minute'/);
  assert.match(source, /'hour'/);
  assert.match(source, /'day'/);
  assert.match(source, /'week'/);
  assert.match(source, /'month'/);
  assert.match(source, /'year'/);
});

test('CronEditor provides options for all five cron fields', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'cron-editor.tsx'), 'utf8');

  assert.match(source, /MINUTE_OPTIONS/);
  assert.match(source, /HOUR_OPTIONS/);
  assert.match(source, /MONTH_DAY_OPTIONS/);
  assert.match(source, /MONTH_OPTIONS/);
  assert.match(source, /WEEK_DAY_OPTIONS/);
});

test('CronEditor uses native Mantine v7 props (no withinPortal, no react-js-cron)', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'cron-editor.tsx'), 'utf8');

  // Mantine v7 MultiSelect doesn't have withinPortal as a direct prop — dropdowns
  // are handled through Combobox composition instead
  assert.doesNotMatch(source, /withinPortal/);
  assert.doesNotMatch(source, /react-js-cron/);
});

test('CronEditor applies warm themed styles to cron field selectors', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'cron-editor.tsx'), 'utf8');

  assert.match(source, /const cronFieldStyles = \{/);
  assert.match(source, /pill:\s*\{/);
  assert.match(source, /dropdown:\s*\{/);
  assert.match(source, /inputField:\s*\{/);
  assert.match(source, /input:\s*\{[\s\S]*display:\s*'flex'/);
  assert.match(source, /input:\s*\{[\s\S]*alignItems:\s*'center'/);
  assert.match(source, /input:\s*\{[\s\S]*paddingTop:\s*0/);
  assert.match(source, /input:\s*\{[\s\S]*paddingBottom:\s*0/);
  assert.match(source, /inputField:\s*\{[\s\S]*background:\s*'transparent'/);
  assert.match(source, /inputField:\s*\{[\s\S]*border:\s*'none'/);
  assert.match(source, /inputField:\s*\{[\s\S]*alignSelf:\s*'center'/);
  assert.match(source, /inputField:\s*\{[\s\S]*lineHeight:\s*'1\.6em'/);
  assert.doesNotMatch(source, /'&::placeholder'/);
  assert.doesNotMatch(source, /'&:focus, &:focus-within'/);
  assert.doesNotMatch(source, /'&\[data-combobox-selected\]'/);
  assert.doesNotMatch(source, /'&\[data-combobox-hovered\]'/);

  const styleUsages = source.match(/styles=\{cronFieldStyles\}/g) ?? [];
  assert.ok(styleUsages.length >= 4, 'expected shared themed styles on cron selectors');
});
