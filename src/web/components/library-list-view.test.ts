import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement } from 'happy-dom';
import type { LibraryModel } from '../services/library-model';

test('library trash confirms before mutation, hides unavailable imported details and exposes retryable errors', async () => {
  const window = new Window({ url: 'http://localhost' });
  const book = { sourceId: 'manual', origin: 'imported', ebook: { id: 'import', format: 'epub' }, metadata: { novelId: 'book', title: '验收书', author: '', description: '', tags: [] }, aliases: [], downloadedChapters: 2, indexedChapters: 0, failedChapters: 0, bookmarkCount: 0, readingProgress: null };
  const requests: string[] = [];
  let trashed = false;
  let failRestore = true;
  let failList = false;
  let openedBook = false;
  let refreshes = 0;
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        requests.push(url);
        if (url.endsWith('/restore')) {
          if (failRestore) return Response.json({ message: '测试恢复失败' }, { status: 422 });
          trashed = false;
        } else trashed = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/trash')) {
        if (failList) return Response.json({ message: '测试读取失败' }, { status: 500 });
        return Response.json({ novels: trashed ? [book] : [] });
      }
      return Response.json({ imports: [] });
    },
  };
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { LibraryListView } = require('./library-list-view') as typeof import('./library-list-view');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const model = { novels: [book], libraryOverview: { totalNovels: 1, downloadedChapters: 2, pendingChapters: 0 }, searchQuery: '', refresh: async () => { refreshes++; }, openNovel: () => { openedBook = true; } } as unknown as LibraryModel;
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  const openConfirm = async () => {
    await act(async () => window.document.querySelector<HTMLButtonElement>('[aria-label="管理《验收书》"]')!.click());
    await act(async () => button('移入回收站').click());
  };
  try {
    await act(async () => root.render(createElement(MantineProvider, null, createElement(LibraryListView, { model, onOpenControl: () => {}, onNotify: () => {} }))));
    await openConfirm();
    assert.equal(requests.length, 0);
    await act(async () => button('取消').click());
    assert.equal(requests.length, 0);
    await openConfirm();
    await act(async () => button('确认移入').click());
    assert.deepEqual(requests, ['/api/library/novels/manual/book/trash']);
    await act(async () => button('回收站').click());
    assert.match(window.document.body.textContent, /恢复后可阅读和导出/);
    assert.equal(button('查看'), undefined);
    await act(async () => button('恢复').click());
    assert.match(window.document.body.textContent, /测试恢复失败/);
    assert(button('恢复'));
    failRestore = false;
    await act(async () => button('恢复').click());
    assert.match(window.document.body.textContent, /回收站为空/);
    assert.equal(refreshes, 2);
    assert.equal(openedBook, false);
    failList = true;
    await act(async () => button('刷新回收站').click());
    assert.match(window.document.body.textContent, /测试读取失败/);
    assert.doesNotMatch(window.document.body.textContent, /回收站为空/);
    failList = false;
    await act(async () => button('刷新回收站').click());
    assert.match(window.document.body.textContent, /回收站为空/);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
