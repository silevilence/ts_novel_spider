import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement } from 'happy-dom';

test('chapter actions submit only their chapter and discard the dialog on chapter navigation', async () => {
  const window = new Window({ url: 'http://localhost' });
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json({ translation: { chapterIds: ['c1'], translationModels: [], termExtractionModel: null, message: '完成', progressPercent: 100 } });
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { ChapterProcessingActions } = require('./chapter-processing-actions') as typeof import('./chapter-processing-actions');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = (chapterId: string) => createElement(MantineProvider, null, createElement(ChapterProcessingActions, { sourceId: 'manual', novelId: 'n', chapterId, title: chapterId }));
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  try {
    await act(async () => root.render(render('c1')));
    await act(async () => button('本章术语与翻译').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await act(async () => button('开始处理本章').click());
    assert.deepEqual(requests[0]?.body, { chapterIds: ['c1'] });
    assert.match(requests[0]!.url, /translate\/start$/);
    assert.equal(button('本书任务进行中').disabled, true);
    await act(async () => root.render(render('c2')));
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    await act(async () => button('本章术语与翻译').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    assert.match(window.document.body.textContent, /最近一次翻译运行不包含本章/);
    assert.equal(window.document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'), '0');
    assert.equal(requests.length, 1);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
