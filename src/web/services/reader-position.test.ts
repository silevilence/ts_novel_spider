import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReaderPosition, positionAtViewport, readerFingerprint } from './reader-position';

test('reader positions identify content and reject stale/corrupt positions', () => {
  const fingerprint = readerFingerprint('原文');
  const raw = JSON.stringify({ fingerprint, block: 2, fraction: 0.4 });
  assert.equal(parseReaderPosition(raw, fingerprint)?.block, 2);
  assert.equal(parseReaderPosition(raw, readerFingerprint('原文变化')), null);
  assert.equal(parseReaderPosition('{bad', fingerprint), null);
  for (const block of [-1, 1.5, '1']) assert.equal(parseReaderPosition(JSON.stringify({ fingerprint, block, fraction: 0.5 }), fingerprint), null);
});
test('reader anchor stores block-relative position rather than a fixed pixel offset', () => {
  assert.deepEqual(positionAtViewport([{ top: -400, height: 200 }, { top: -200, height: 700 }], 'v1'), { fingerprint: 'v1', block: 1, fraction: 0.4 });
  assert.deepEqual(positionAtViewport([], 'v1'), { fingerprint: 'v1', block: 0, fraction: 0 });
});

test('reader hook restores saved blocks after remount and follows reflow', async () => {
  const { Window } = await import('happy-dom');
  const win = new Window({ url: 'http://localhost' });
  let y = 0;
  let blockHeight = 100;
  let resize: (() => void) | undefined;
  const values = { window: win, document: win.document, localStorage: win.localStorage, HTMLElement: win.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} },
  };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  Object.defineProperty(win, 'scrollY', { get: () => y });
  win.scrollTo = ((options: { top: number }) => { y = options.top; }) as typeof win.scrollTo;
  const rect = (index: number) => ({ top: 200 + index * blockHeight - y, height: blockHeight });
  const { createElement, useRef, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useReaderPosition } = await import('./reader-position');
  function Reader({ content }: { content: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const notice = useReaderPosition(ref, 'book:chapter:original', content);
    return createElement('div', { ref: (element: HTMLDivElement | null) => {
      ref.current = element;
      if (element) Array.from(element.children).forEach((child, index) => { child.getBoundingClientRect = () => rect(index) as DOMRect; });
    } }, ...Array.from({ length: 10 }, (_, i) => createElement('p', { key: i }, String(i))), createElement('span', { hidden: true }, notice));
  }
  const host = win.document.createElement('div'); win.document.body.append(host);
  let root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () => root.render(createElement(Reader, { content: 'original' })));
    y = 650; win.dispatchEvent(new win.Event('scroll'));
    await act(async () => { await new Promise(resolve => win.requestAnimationFrame(resolve)); });
    await act(async () => root.unmount());
    y = 0; root = createRoot(host as unknown as HTMLElement);
    await act(async () => root.render(createElement(Reader, { content: 'original' })));
    assert.equal(y, 650);
    blockHeight = 200;
    await act(async () => resize?.());
    assert.equal(y, 1180);
    await act(async () => root.render(createElement(Reader, { content: 'changed' })));
    assert.equal(y, 120);
    assert.match(host.textContent, /已回到本章开头/);
  } finally {
    await act(async () => root.unmount()); await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
