import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLButtonElement, type HTMLInputElement } from 'happy-dom';
import type { NotificationConfig } from '../../server/contracts/notification';
import type { SchedulingConfig, SchedulingNovelEntry } from '../services/api';

test('book notification status reflects configuration, unsaved preferences and refreshed global state', async () => {
  const window = new Window({ url: 'http://localhost/scheduling' });
  let notifications: NotificationConfig = { enabled: false, errorEnabled: false, channel: 'astrbot', baseUrl: '', target: { umo: '' }, keyConfigured: false };
  const scheduling: SchedulingConfig = { enabled: false, mode: 'interval', intervalHours: 6, cronExpression: '', weeklyDays: [], weeklyTime: '09:00', summaryModel: null, updatedAt: null };
  let novel: SchedulingNovelEntry = { sourceId: 'syosetu', novelId: 'n1', title: '测试书', enabled: true, notifyOnUpdate: false, autoTranslate: false, autoSummarize: false, summarizeModel: null, lastCheckedAt: null, lastCheckResult: null, lastCheckMessage: null, hasSummary: false };
  let failNotifications = false;
  let notificationWrites = 0;
  let pendingNotification: ((response: Response) => void) | null = null;
  let delayNotification = false;
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.endsWith('/preferences/notifications')) {
        if (init?.method === 'PUT') notificationWrites++;
        if (delayNotification) return new Promise<Response>((resolve) => { pendingNotification = resolve; });
        return failNotifications ? Response.json({ message: 'offline' }, { status: 503 }) : Response.json(notifications);
      }
      if (url === '/api/control/scheduling') {
        if (init?.method === 'PUT') Object.assign(scheduling, JSON.parse(String(init.body)) as Partial<SchedulingConfig>);
        return Response.json(scheduling);
      }
      if (url === '/api/library/scheduling/novels') {
        if (init?.method === 'PUT') {
          const entry = (JSON.parse(String(init.body)) as { novels: SchedulingNovelEntry[] }).novels[0]!;
          assert.equal('autoTranslate' in entry, false, 'book saves cannot restore a stale legacy translation switch');
          novel = { ...novel, ...entry };
        }
        return Response.json({ novels: [novel] });
      }
      if (url.startsWith('/api/control/scheduling/runs')) return Response.json({ runs: [] });
      if (url.endsWith('/llm-providers')) return Response.json({ providers: [{ id: 'provider', label: '提供商', enabled: true, models: [{ enabled: true, modelId: 'summary:latest', label: '长名称总结模型', resolvedCapabilities: ['chat'] }] }] });
      throw new Error(`Unexpected local request: ${url}`);
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement, act } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { MantineProvider } = require('@mantine/core') as typeof import('@mantine/core');
  const { SchedulingDashboard } = require('./scheduling-dashboard') as typeof import('./scheduling-dashboard');
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const button = (label: string) => [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  const text = () => window.document.body.textContent;
  const row = () => window.document.querySelector('tbody tr')!.textContent;
  const toggle = () => window.document.querySelector<HTMLInputElement>('input[aria-label="测试书 更新时通知"]')!;
  try {
    await act(async () => root.render(createElement(MantineProvider, null, createElement(SchedulingDashboard, { onNotify: () => {} }))));
    assert.match(text(), /全局通知尚未配置完整/);
    const link = window.document.querySelector('a[href="/settings#notifications"]');
    assert.equal(link?.getAttribute('target'), '_blank', 'settings keeps the book draft open');
    await act(async () => toggle().click());
    assert.match(row(), /有未保存的修改/);
    await act(async () => button('保存书单设置').click());
    assert.equal(novel.notifyOnUpdate, true);
    assert.match(row(), /全局通知尚未配置完整/);
    assert.equal(notificationWrites, 0, 'saving a book does not enable global notifications');

    notifications = { ...notifications, baseUrl: 'http://local-test:6185', target: { umo: 'qq:GroupMessage:test' }, keyConfigured: true };
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    assert.match(row(), /全局消息通知已关闭/);
    notifications.enabled = true;
    await act(async () => button('刷新通知状态').click());
    assert.match(row(), /等待开启定时更新总开关/);
    assert.match(text(), /接收目标：qq:GroupMessage:test/);
    const schedulingToggle = window.document.querySelector<HTMLInputElement>('input[role=switch]')!;
    await act(async () => schedulingToggle.click());
    assert.match(row(), /已启用，下载有新章节时通知/);

    await act(async () => toggle().click());
    failNotifications = true;
    await act(async () => button('刷新通知状态').click());
    assert.match(text(), /无法确认全局通知状态/);
    assert.equal(toggle().checked, false, 'failed refresh preserves unsaved book preference');
    assert.match(row(), /有未保存的修改/);
    failNotifications = false;
    delayNotification = true;
    await act(async () => button('刷新通知状态').click());
    assert.match(text(), /正在读取全局通知状态/);
    delayNotification = false;
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    assert.match(text(), /全局通知已启用/);
    await act(async () => pendingNotification!(Response.json({ ...notifications, enabled: false })));
    assert.match(text(), /全局通知已启用/, 'late response from an older refresh is ignored');
    assert.equal(toggle().checked, false);
    await act(async () => window.document.querySelector<HTMLInputElement>('input[aria-label="测试书 自动总结"]')!.click());
    const modelSelect = window.document.querySelector<HTMLInputElement>('input[aria-label="测试书 单书总结模型"]')!;
    await act(async () => modelSelect.click());
    const list = window.document.getElementById(modelSelect.getAttribute('aria-controls')!)!;
    const option = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes('长名称总结模型'))!;
    assert.ok(option, 'the summary model is selectable by its full name');
    await act(async () => option.click());
    await act(async () => button('保存书单设置').click());
    assert.deepEqual(novel.summarizeModel, { providerId: 'provider', modelId: 'summary:latest' });
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
