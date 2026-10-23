import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLInputElement, type HTMLButtonElement } from 'happy-dom';

test('processing settings default to manual confirmation and save without enabling remote scheduling', async () => {
  const window = new Window({ url: 'http://localhost' });
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json(url.endsWith('/terms') ? { terms: [] } : { settings: { extractTerms: false, translate: false, candidatePolicy: 'manual' }, jobs: [{ id: 'job', status: 'running', stage: 'translation', chapterHashes: { c1: 'hash' }, chapterTitles: ['第一章'], message: '正在翻译本轮章节', progress: { percent: 50, message: '当前单元段落 1/2' } }] });
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { LibraryProcessingPanel } = require('./library-processing-panel') as typeof import('./library-processing-panel');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = (chapterId: string) => createElement(MantineProvider, null, createElement(LibraryProcessingPanel, { sourceId: 'manual', novelId: chapterId }));
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  try {
    await act(async () => root.render(render('c1')));
    await act(async () => button('更新后处理与进度').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    assert.match(window.document.body.textContent, /目标：第一章/);
    assert.match(window.document.body.textContent, /进行中/);
    assert.match(window.document.body.textContent, /当前单元段落 1\/2/);
    assert.equal(window.document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'), '50');
    await act(async () => window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await act(async () => button('保存后处理设置').click());
    assert.deepEqual(requests[0]?.body, { extractTerms: true, translate: false, candidatePolicy: 'manual' });
    assert.match(requests[0]!.url, /processing$/);
    await act(async () => root.render(render('c2')));
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(requests.length, 1);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
