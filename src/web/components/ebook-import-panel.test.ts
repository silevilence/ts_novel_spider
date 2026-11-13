import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement } from 'happy-dom';

test('import preview requires confirmation, preserves fields and retries only the failed file', async () => {
  const window = new Window({ url: 'http://localhost' });
  const requests: Array<{ url: string; body: unknown }> = [];
  let imported = 0;
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { requests.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ novelId: 'novel', sourceId: 'manual' }); }
      return Response.json({ imports: [
        { id: 'ready', fileName: '书.txt', format: 'txt', status: 'ready', sameTitleCount: 1, preview: { title: '原名', author: '作者', description: '简介', tags: ['标签'], chapterCount: 2, excerpt: '正文片段', encoding: 'utf-8', warnings: [] } },
        { id: 'failed', fileName: '坏.epub', format: 'epub', status: 'failed', error: '损坏', preview: null },
      ] });
    },
  };
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { EbookImportPanel } = require('./ebook-import-panel') as typeof import('./ebook-import-panel');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  try {
    await act(async () => root.render(createElement(MantineProvider, null, createElement(EbookImportPanel, { opened: true, onClose: () => {}, onOpenBook: () => {}, onImported: () => { imported++; } }))));
    assert.equal(requests.length, 0);
    assert.match(window.document.body.textContent, /同名/);
    await act(async () => button('重试解析').click());
    assert.equal(requests[0]?.url, '/api/library/ebooks/failed/retry');
    await act(async () => button('预览并确认').click());
    assert.match(window.document.body.textContent, /正文片段/);
    await act(async () => button('确认入库').click());
    assert.deepEqual(requests[1], { url: '/api/library/ebooks/ready/confirm', body: { title: '原名', author: '作者', description: '简介', tags: ['标签'] } });
    assert.equal(imported, 1);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
