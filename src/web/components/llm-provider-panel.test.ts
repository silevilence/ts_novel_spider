import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentsRoot = fileURLToPath(new URL('.', import.meta.url));

test('model edit modal uses a switch-driven layout with wrapped capability controls', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'llm-provider-panel.tsx'), 'utf8');

  assert.match(source, /\bSwitch\b/);
  assert.match(source, /当前识别能力/);
  assert.match(source, /wrap="wrap"/);
  assert.doesNotMatch(source, /参与默认调度[\s\S]*Checkbox/);
});

test('model validation reports success or failure back to the user and keeps a visible row status', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'llm-provider-panel.tsx'), 'utf8');

  assert.match(source, /连通性测试通过/);
  assert.match(source, /连通性测试失败/);
  assert.match(source, /验证通过|测试通过/);
  assert.match(source, /验证失败|测试失败/);
});