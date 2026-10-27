import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement } from 'happy-dom';
import { agentConfigSchema, newAgentState } from '../../server/contracts/refined-agent';
import type { RefinedTaskDetail } from '../services/api';

test('Agent controls send task-scoped actions, show confirmed progress and keep execution config disabled in flight', async () => {
  let releaseCompletion!: () => void; const completionGate = new Promise<void>((resolve) => { releaseCompletion = resolve; });
  const window = new Window({ url: 'http://localhost' }); const requests: Array<{ url: string; body: unknown }> = [];
  const globals = { window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => { if (url.endsWith('/completion')) await completionGate; if (init?.method === 'POST') requests.push({ url, body: JSON.parse(String(init.body)) as unknown }); return Response.json(url.endsWith('/completion') ? { issues: ['第 1 章缺少当前审核证据。'] } : { agent: {} }); },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { RefinedAgentPanel } = require('./refined-agent-panel') as typeof import('./refined-agent-panel');
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host as unknown as HTMLElement);
  const agent = newAgentState(agentConfigSchema.parse({ initialCommand: '译完并审核', controller: { providerId: 'p', modelId: 'm' } }), 's');
  const detail = { task: { id: 'task-1' }, agent, chapters: [{ chapterId: 'c1', title: '第一章' }], progress: { total: 4, translated: 2, skipped: 0 } } as RefinedTaskDetail;
  const render = () => createElement(MantineProvider, null, createElement(RefinedAgentPanel, { detail, models: [], refresh: async () => {}, onNotify: () => {} }));
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  try {
    await act(async () => root.render(render()));
    assert.match(window.document.body.textContent, /正在检查/); assert.doesNotMatch(window.document.body.textContent, /检查通过/);
    await act(async () => { releaseCompletion(); });
    assert.match(window.document.body.textContent, /已保存译文 2 \/ 4 段/); assert.match(window.document.body.textContent, /第 1 章缺少当前审核证据/);
    assert.equal(button('发送指令').disabled, true);
    await act(async () => button('开始执行').click()); assert.equal(requests[0]?.url, '/api/refined-translations/tasks/task-1/agent/start');
    detail.agent = { ...agent, status: 'running', reason: '正在翻译第一章', plan: '全部完成（这只是计划）' };
    await act(async () => root.render(render())); assert.equal(button('执行配置').disabled, true); assert.match(window.document.body.textContent, /已保存译文 2 \/ 4 段/);
    await act(async () => button('暂停').click()); assert.equal(requests[1]?.url, '/api/refined-translations/tasks/task-1/agent/pause');
    detail.agent = { ...agent, status: 'pausing' }; await act(async () => root.render(render())); assert.equal(button('暂停').disabled, true);
    assert.ok(window.document.querySelector('[role="status"]'));
  } finally { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
