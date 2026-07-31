import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const panelPath = path.join(process.cwd(), 'src', 'web', 'components', 'refined-translation-task-panel.tsx');
const workspacePath = path.join(process.cwd(), 'src', 'web', 'components', 'refined-translation-workspace.tsx');

test('active refined task panel owns the operation-log auto-scroll switch', () => {
  const panel = fs.readFileSync(panelPath, 'utf8');
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  assert.match(workspace, /<RefinedTranslationTaskPanel/);
  assert.match(panel, /label="新日志自动滚到底部"/);
  assert.match(panel, /viewportRef=\{logViewportRef\}/);
  assert.match(panel, /if \(!autoScrollLogs \|\| activeTab !== 'log'\) return/);
});

test('thinking configuration keeps save failures inside the configuration modal', () => {
  const panel = fs.readFileSync(panelPath, 'utf8');
  assert.match(panel, /const \[configError, setConfigError\]/);
  assert.match(panel, /try \{[\s\S]*await props\.onUpdateTask[\s\S]*\} catch \(error\) \{ setConfigError/);
  assert.match(panel, /配置未保存/);
  assert.match(panel, /const enabled = event\.currentTarget\.checked; setConfigThinking/);
  assert.doesNotMatch(panel, /setConfigThinking\(\(current\) => \(\{ \.\.\.current, \[key\]: event\.currentTarget\.checked \}\)\)/);
});

test('glossary translation confirmation exposes the advance action in the active task panel', () => {
  const panel = fs.readFileSync(panelPath, 'utf8');
  assert.match(panel, /const manualStage = task\.stage === 'glossary_setup' \|\| task\.stage === 'glossary_translation';/);
  assert.match(panel, /task\.stage === 'glossary_translation' \? '确认术语，开始自动流程' : '确认并进入下一步'/);
});

test('workspace has no duplicate, unmounted legacy task panel', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  assert.doesNotMatch(workspace, /function TaskPanel\(/);
  assert.doesNotMatch(workspace, /function TranslationEditor\(/);
});

test('metadata card can switch between source and translated values', () => {
  const panel = fs.readFileSync(panelPath, 'utf8');
  assert.match(panel, /const \[metadataView, setMetadataView\] = useState<'source' \| 'translated'>\('source'\);/);
  assert.match(panel, /data=\{\[\{ value: 'source', label: '原文' \}, \{ value: 'translated', label: '译文' \}\]\}/);
  assert.match(panel, /元数据译文尚未生成/);
});
