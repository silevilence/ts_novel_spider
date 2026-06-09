import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

test('graph workspace defines base node and edge styles', () => {
  const stylesPath = path.join(webRoot, 'styles.css');
  const css = fs.readFileSync(stylesPath, 'utf8');

  assert.match(css, /\.graph-node\s*\{/);
  assert.match(css, /\.graph-node\s+strong\s*\{/);
  assert.match(css, /\.graph-node\s+span\s*\{/);
  assert.match(css, /\.graph-edge\s*\{/);
  assert.match(css, /\.graph-edge-label\s*\{/);
});

test('graph toolbar controls and list cards use the warm graph visual system', () => {
  const stylesPath = path.join(webRoot, 'styles.css');
  const css = fs.readFileSync(stylesPath, 'utf8');

  assert.match(css, /\.graph-toolbar-row\s+\.graph-search-field\s+input\s*\{/);
  assert.match(css, /\.graph-toolbar-row\s+\.ghost-button\s*\{/);
  assert.match(css, /\.intelligence-list-item\s*\{[\s\S]*rgba\(36, 25, 18/);
  assert.match(css, /\.intelligence-inline-button\s*\{/);
});

test('graph node hover preserves node anchoring instead of replacing its transform', () => {
  const stylesPath = path.join(webRoot, 'styles.css');
  const css = fs.readFileSync(stylesPath, 'utf8');

  assert.match(css, /button\.graph-node:hover:not\(:disabled\)\s*\{/);
  assert.match(css, /button\.graph-node:hover:not\(:disabled\)\s*\{[\s\S]*transform:\s*translate\(-50%,\s*-50%\)/);
});

test('global form field styles do not override Mantine pills input internals', () => {
  const stylesPath = path.join(webRoot, 'styles.css');
  const css = fs.readFileSync(stylesPath, 'utf8');

  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.mantine-Input-input\):not\(\.mantine-PillsInputField-field\)/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.mantine-Input-input\):not\(\.mantine-PillsInputField-field\):focus/);
});