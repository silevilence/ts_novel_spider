import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement as TestButton } from 'happy-dom';
import type { LibraryModel } from '../services/library-model';

test('translation details leave no orphan portal when changing books and can close and reopen', async () => {
  const window = new Window({ url: 'http://localhost' });
  const globals = {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) => new Response(JSON.stringify(url.endsWith('/units') ? { scope: 'current', units: Array.from({ length: 1015 }, (_, index) => ({
      id: `c${index}`, kind: 'chapter', index, title: `章节 ${index}`, status: 'pending', errorMessage: null,
    })) } : { providers: [], config: {} })),
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { TranslationLaunchPanel } = require('./translation-launch-panel') as typeof import('./translation-launch-panel');
  const model = {
    location: { sourceId: 'manual', novelId: 'test' },
    detail: { novel: { sourceId: 'manual', metadata: { novelId: 'test' }, stats: { downloaded: 1013 } }, knowledgeGraph: { entities: [] } },
    translationBuild: { status: 'completed', stage: 'completed', translatedChapters: 0, failedChapters: 0, totalUnits: 1015, progressPercent: 0, startedAt: null },
    translationTerms: [], pendingTermCount: 0,
  } as unknown as LibraryModel;
  function Harness() {
    return createElement(MantineProvider, {},
      createElement(TranslationLaunchPanel, { model, onNotify: () => {} }));
  }
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const settle = async () => {
    for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  };
  try {
    await act(async () => { root.render(createElement(Harness)); });
    const openButton = Array.from(window.document.querySelectorAll<TestButton>('button')).find((button) => button.textContent === '查看翻译明细')!;
    await act(async () => { openButton.click(); });
    await settle();
    assert.ok(window.document.querySelector('[role="dialog"]'));
    assert.match(window.document.body.textContent, /共 1015 个翻译单元/);
    // Changing books must remove the old portal before mounting the next book's modals.
    model.location.novelId = 'next';
    model.detail!.novel.metadata.novelId = 'next';
    await act(async () => { root.render(createElement(Harness)); });
    await settle();
    await act(async () => { openButton.click(); });
    await settle();
    await act(async () => { window.document.querySelector<TestButton>('.mantine-Modal-close')!.click(); });
    await settle();
    assert.equal(!!window.document.querySelector('[role="dialog"]'), false, 'close button must dismiss the modal');
    await act(async () => { openButton.click(); });
    await settle();
    assert.ok(window.document.querySelector('[role="dialog"]'));
    await act(async () => { window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await settle();
    assert.equal(!!window.document.querySelector('[role="dialog"]'), false, 'Escape must dismiss the modal');
  } finally {
    await act(async () => { root.unmount(); });
    await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
