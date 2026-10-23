import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

test('translation status discovers external starts from idle and ignores responses from a previous book', async () => {
  const window = new Window({ url: 'http://localhost' });
  let running = false;
  let hold = false;
  const pending: Array<() => void> = [];
  const globals = {
    window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) => {
      const response = Response.json(url.endsWith('/terms') ? { terms: running ? [{ id: 'new-term' }] : [] } : { translation: running ? { status: 'running' } : null });
      if (hold) await new Promise<void>((resolve) => pending.push(resolve));
      return response;
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { useLibraryTranslationStatus } = require('./use-library-translation-status') as typeof import('./use-library-translation-status');
  function View({ book }: { book: string | null }) {
    const state = useLibraryTranslationStatus('test', book);
    return createElement('p', null, `${state.build?.status ?? 'idle'}:${state.terms.length}`);
  }
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () => root.render(createElement(View, { book: 'a' })));
    assert.equal(host.textContent, 'idle:0');
    running = true;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2150)); });
    assert.equal(host.textContent, 'running:1');
    hold = true;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2150)); });
    assert.equal(pending.length, 2);
    await act(async () => root.render(createElement(View, { book: null })));
    await act(async () => { pending.forEach((resolve) => resolve()); });
    assert.equal(host.textContent, 'idle:0');
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
