import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement } from 'happy-dom';
import { APP_ROUTES } from '../services/app-routes';

test('compact navigation exposes all destinations through a labelled drawer and identifies the active page', async () => {
  const window = new Window({ url: 'http://localhost' });
  const globals = { window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { AppShell } = require('./app-shell') as typeof import('./app-shell');
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host as unknown as HTMLElement);
  const navigated: string[] = [];
  try {
    await act(async () => root.render(createElement(MantineProvider, { env: 'test' }, createElement(AppShell, { routes: APP_ROUTES, activeRoute: APP_ROUTES[2]!, onNavigate: (path) => navigated.push(path), health: null, errorMessage: null, sourceCount: 0, currentTask: null, getSourceLabel: (id) => id, children: createElement('p', null, '工作区') }))));
    const nav = window.document.querySelector('nav[aria-label="快捷导航"]')!;
    assert.equal(nav.querySelector('[aria-current="page"]')?.textContent, '精翻工作区');
    const more = nav.querySelector<HTMLButtonElement>('[aria-label="更多导航"]')!;
    await act(async () => more.click());
    const drawer = window.document.querySelector('nav[aria-label="全部导航"]')!;
    assert.ok(drawer);
    for (const route of APP_ROUTES) assert.ok([...drawer.querySelectorAll('button')].some((button) => button.textContent === route.label));
    const settings = [...drawer.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '全局设置')!;
    await act(async () => settings.click());
    assert.deepEqual(navigated, ['/settings']);
    assert.equal(more.getAttribute('aria-expanded'), 'false');
  } finally { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
