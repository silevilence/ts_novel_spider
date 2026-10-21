import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import type { ControlCenterModel } from './control-center-model';

test('pasting changes target without fetching and stale previews cannot restore old selections', async () => {
  const window = new Window({ url: 'http://localhost' });
  const pending: Array<(response: Response) => void> = [];
  let previewRequests = 0;
  const globals = { window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) => {
      if (url.includes('/preview')) { previewRequests++; return new Promise<Response>((resolve) => pending.push(resolve)); }
      return new Response(JSON.stringify(url.includes('/sources') ? { sources: ['syosetu', 'syosetu18', 'kakuyomu'].map((sourceId) => ({ sourceId, label: sourceId, defaultNovelId: sourceId === 'kakuyomu' ? '123' : 'n123ab', transports: ['direct', 'browser'] })) } : url.includes('/tasks') ? { tasks: [] } : {}));
    } };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { act, createElement } = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { useControlCenterModel } = require('./control-center-model') as typeof import('./control-center-model');
  let model!: ControlCenterModel;
  function Harness() { model = useControlCenterModel(() => {}); return null; }
  const root = createRoot(window.document.createElement('div') as unknown as HTMLElement);
  const response = (title: string) => new Response(JSON.stringify({ metadata: { title, chapterCount: 1 }, chapters: [{ id: title, status: 'indexed' }], activeTask: null }));
  try {
    await act(async () => { root.render(createElement(Harness)); });
    await act(async () => { model.setCaptureKind('browser'); model.setNovelId('https://kakuyomu.jp/works/123/episodes/456'); });
    assert.equal(model.selectedSourceId, 'kakuyomu'); assert.equal(model.novelId, '123'); assert.equal(model.captureKind, 'browser');
    assert.equal(previewRequests, 0);
    let first!: Promise<void>;
    await act(async () => { first = model.handlePreviewSubmit(); });
    await act(async () => { pending.shift()!(response('first')); await first; });
    assert.deepEqual(model.selectedChapterIds, ['first']);
    let stale!: Promise<void>;
    await act(async () => { stale = model.handlePreviewSubmit(); });
    await act(async () => { model.setNovelId('https://novel18.syosetu.com/N567CD/'); });
    assert.equal(model.preview, null); assert.deepEqual(model.selectedChapterIds, []);
    let latest!: Promise<void>;
    await act(async () => { latest = model.handlePreviewSubmit(); });
    await act(async () => { pending.shift()!(response('stale')); await stale; });
    assert.equal(model.preview, null); assert.equal(model.previewBusy, true);
    await act(async () => { pending.shift()!(response('latest')); await latest; });
    assert.equal((model as ControlCenterModel).preview?.metadata.title, 'latest');
    await act(async () => { model.setNovelId('https://evil.test/n123ab'); });
    assert.equal(model.selectedSourceId, 'syosetu18'); assert.ok(model.targetError);
    await act(async () => { await model.handlePreviewSubmit(); await model.handleCreateTask(); });
    assert.equal(previewRequests, 3);
    await act(async () => { model.setNovelId('N999EF'); });
    assert.equal(model.selectedSourceId, 'syosetu18'); assert.equal(model.novelId, 'n999ef');
  } finally {
    await act(async () => { root.unmount(); });
    await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

