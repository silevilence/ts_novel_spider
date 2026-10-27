import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement, type HTMLInputElement } from 'happy-dom';
import type { RefinedTerm } from '../services/api';

test('term translation requires explicit save, retains draft on failure and disables writes while running', async () => {
  const window = new Window({ url: 'http://localhost' });
  const globals = { window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { TermTranslationEditor } = require('./refined-term-translation-editor') as typeof import('./refined-term-translation-editor');
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host as unknown as HTMLElement);
  const term: RefinedTerm = { id: 't1', sourceTerm: '旅人', targetTerm: '', entityType: null, priority: 1, suggestion: null, status: 'pending' };
  const saves: string[] = []; let fail = true; let disabled = false;
  const render = () => createElement(MantineProvider, null, createElement(TermTranslationEditor, { term, disabled, onSave: async (value: string) => { saves.push(value); if (fail) throw new Error('连接失败，请重试'); term.targetTerm = value; } }));
  try {
    await act(async () => root.render(render()));
    const input = host.querySelector<HTMLInputElement>('input')!;
    const button = host.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, '  旅者  ');
      input.dispatchEvent(new window.Event('input', { bubbles: true })); input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    });
    assert.deepEqual(saves, []); assert.equal(button.disabled, false);
    await act(async () => button.click());
    assert.deepEqual(saves, ['旅者']); assert.match(host.querySelector('[role="alert"]')!.textContent, /连接失败/); assert.equal(input.value, '  旅者  ');
    fail = false;
    await act(async () => button.click()); await act(async () => root.render(render()));
    assert.equal(term.targetTerm, '旅者'); assert.equal(term.status, 'pending'); assert.equal(button.disabled, true); assert.equal(host.querySelector('[role="alert"]'), null);
    disabled = true; await act(async () => root.render(render())); assert.equal(input.disabled, true); assert.equal(button.disabled, true);
  } finally { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
