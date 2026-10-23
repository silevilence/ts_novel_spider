import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLElement as TestHTMLElement, type HTMLButtonElement } from 'happy-dom';

test('correction selection does not write until explicit confirmation and navigation clears the dialog', async () => {
  const window = new Window({ url: 'http://localhost' });
  const writes: Array<{ url: string; body: unknown }> = [];
  const correction = { id: 'preview', oldTerm: '艾莉丝', newTerm: '爱丽丝', createdAt: '2026-10-23', targets: [
    { id: 'target', chapterId: 'a', title: '第一章', paragraphIndex: 1, sourceText: 'アリス', before: '艾莉丝来了', suggestion: '爱丽丝来了', classification: 'replace', reason: '原文命中' },
  ] };
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        writes.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json({ correction: { ...correction, targets: correction.targets.map((target) => ({ ...target, applied: true })) } });
      }
      return Response.json({ changes: [], corrections: [correction] });
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { TermCorrectionModal } = require('./term-correction-modal') as typeof import('./term-correction-modal');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = (novelId: string) => createElement(MantineProvider, null, createElement(TermCorrectionModal, { sourceId: 'test', novelId, chapters: [{ id: 'a', title: '第一章' }] }));
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  try {
    await act(async () => root.render(render('n')));
    await act(async () => button('矫正已有译文').click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await act(async () => window.document.querySelector<TestHTMLElement>('input[placeholder="查看修改前后文本或撤销"]')!.click());
    await act(async () => [...window.document.querySelectorAll<TestHTMLElement>('[role="option"]')].find((option) => option.textContent?.includes('艾莉丝 → 爱丽丝'))!.click());
    await act(async () => button('选择全部可应用建议').click());
    assert.equal(writes.length, 0);
    assert.match(window.document.body.textContent, /艾莉丝来了/);
    assert.match(window.document.body.textContent, /爱丽丝来了/);
    await act(async () => window.document.querySelector<TestHTMLElement>('input[placeholder="全书（含书名、简介和卷标题）"]')!.click());
    await act(async () => [...window.document.querySelectorAll<TestHTMLElement>('[role="option"]')].find((option) => option.textContent === '第一章')!.click());
    assert.equal(Boolean(button('确认应用选中修正')), false, 'changing scope must invalidate the old preview and selection');
    await act(async () => window.document.querySelector<TestHTMLElement>('input[placeholder="查看修改前后文本或撤销"]')!.click());
    await act(async () => [...window.document.querySelectorAll<TestHTMLElement>('[role="option"]')].find((option) => option.textContent?.includes('艾莉丝 → 爱丽丝'))!.click());
    await act(async () => button('选择全部可应用建议').click());
    await act(async () => button('确认应用选中修正').click());
    assert.equal(writes.length, 1);
    assert.match(writes[0]!.url, /term-corrections\/preview\/apply$/);
    assert.deepEqual(writes[0]!.body, { targetIds: ['target'], undo: false });
    await act(async () => root.render(render('other')));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
