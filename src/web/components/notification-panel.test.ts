import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLInputElement, type HTMLButtonElement } from 'happy-dom';
import type { NotificationConfigInput } from '../../server/contracts/notification';

test('notification form preserves/manual-selects UMO, rejects stale candidates and saves without sending', async () => {
  const window = new Window({ url: 'http://localhost' });
  const puts: NotificationConfigInput[] = [];
  const queries: Array<(response: Response) => void> = [];
  let tests = 0;
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      assert.ok(url.startsWith('/api/control/'), 'browser contacts only local backend');
      if (url.endsWith('/targets')) return new Promise<Response>((resolve) => queries.push(resolve));
      if (url.endsWith('/records')) return Response.json({ records: [] });
      if (url.endsWith('/test')) { tests++; return Response.json({ id: 'test', status: 'accepted', result: { message: '接口已接受，请确认接收' } }); }
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)) as NotificationConfigInput);
      return Response.json({ enabled: false, errorEnabled: false, channel: 'astrbot', baseUrl: 'http://first:6185', target: { umo: 'qq:GroupMessage:manual' }, keyConfigured: true });
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { NotificationPanel } = require('./notification-panel') as typeof import('./notification-panel');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  const input = (label: string) => {
    const element = [...window.document.querySelectorAll('label')].find((item) => item.textContent === label)!;
    return window.document.getElementById(element.getAttribute('for')!) as HTMLInputElement;
  };
  async function type(label: string, value: string) {
    await act(async () => {
      const field = input(label);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }
  try {
    await act(async () => root.render(createElement(MantineProvider, null, createElement(NotificationPanel, { onNotice: () => {} }))));
    assert.equal(input('目标 UMO').value, 'qq:GroupMessage:manual');
    assert.equal(window.document.querySelector('input[type=password]'), null);
    await act(async () => button('保存通知设置').click());
    assert.equal(puts[0]?.keyAction, 'keep'); assert.equal(tests, 0);

    await act(async () => button('刷新已知 UMO').click());
    await type('AstrBot 服务地址', 'http://second:6185');
    await act(async () => queries[0]!(Response.json({ targets: [{ umo: 'old:GroupMessage:1', label: 'OLD' }], message: 'STALE RESPONSE' })));
    assert.ok(!window.document.body.textContent.includes('STALE RESPONSE'));
    assert.equal(input('目标 UMO').value, 'qq:GroupMessage:manual');

    await act(async () => button('刷新已知 UMO').click());
    await act(async () => queries[1]!(Response.json({ targets: [{ umo: 'qq:GroupMessage:known', label: 'qq:GroupMessage:known · 读书群' }], message: '仅已知会话' })));
    await type('目标 UMO', '读书群');
    await act(async () => input('目标 UMO').focus());
    const option = [...window.document.querySelectorAll('[role=option]')].find((item) => item.textContent?.includes('读书群'));
    assert.ok(option, 'searchable known UMO option is shown');
    await act(async () => { option.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(input('目标 UMO').value, 'qq:GroupMessage:known');

    await type('目标 UMO', 'qq:GroupMessage:outside');
    await act(async () => button('刷新已知 UMO').click());
    await act(async () => queries[2]!(Response.json({ message: '缺少 data scope，仍可手写' }, { status: 400 })));
    assert.match(window.document.body.textContent, /缺少 data scope/);
    assert.equal(input('目标 UMO').value, 'qq:GroupMessage:outside');
    await act(async () => button('发送测试通知').click());
    assert.equal(tests, 1); assert.equal(puts.length, 1);
    assert.match(window.document.body.textContent, /接口已接受，请确认接收/);

    await act(async () => button('刷新已知 UMO').click());
    await act(async () => input('API Key 操作').click());
    const replace = [...window.document.querySelectorAll('[role=option]')].find((item) => item.textContent === '更换密钥')!;
    await act(async () => replace.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await type('新 API Key', 'replacement-key');
    await act(async () => queries[3]!(Response.json({ targets: [], message: 'STALE CREDENTIALS' })));
    assert.ok(!window.document.body.textContent.includes('STALE CREDENTIALS'));
    await act(async () => button('保存通知设置').click());
    assert.equal(puts[1]?.keyAction, 'replace'); assert.equal(puts[1]?.apiKey, 'replacement-key');
    assert.equal(window.document.querySelector('input[type=password]'), null);
    assert.equal(tests, 1);
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
