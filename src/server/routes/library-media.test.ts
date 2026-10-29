import assert from 'node:assert/strict';
import test from 'node:test';

import { NetworkProxyService, type ProxyAwareRequestInit } from '../core/network-proxy';
import { closeServer, createLibraryServer, waitForServerListening } from './library-test-helpers';

test('image cache failure is logged and returns network diagnostics to the reader', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.map(String).join(' ')));
  const { app, cleanup } = createLibraryServer({
    networkProxy: new NetworkProxyService(),
    assetFetchImpl: async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
      });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const chapter = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1`);
    const payload = await chapter.json() as { chapter: { mediaAssets: Array<{ id: string }> } };
    const response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/chapters/chapter-1/media/${payload.chapter.mediaAssets[0]!.id}/cache`, { method: 'POST' });
    assert.equal(response.status, 502);
    const { message } = await response.json() as { message: string };
    assert.equal(logs.length, 1, 'a failed image request must produce a server log');
    for (const value of [message, logs.join('\n')]) {
      assert.match(value, /UND_ERR_CONNECT_TIMEOUT/);
      assert.match(value, /cdn\.example\.com/);
      assert.match(value, /chapter-1/);
      assert.match(value, /直连/);
    }
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('image cache uses the shared proxy settings and respects changes and bypass hosts', async () => {
  const proxy = new NetworkProxyService({ initialConfig: { enabled: true, host: '127.0.0.1', port: 7890 } });
  const requests: Array<ProxyAwareRequestInit | undefined> = [];
  const { app, repository, cleanup } = createLibraryServer({
    networkProxy: proxy,
    assetFetchImpl: async (_url, init) => {
      requests.push(init);
      return new Response('image', { headers: { 'content-type': 'image/png' } });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.ok(requests[0]?.dispatcher, 'image download must use the configured proxy');
    const headers = new Headers(requests[0]?.headers);
    assert.ok(headers.get('User-Agent'));
    assert.ok(headers.get('Accept-Language'));
    assert.ok(headers.get('Accept'));
    assert.ok(requests[0]?.signal);
    // A cached file must not trigger another network request.
    await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, { method: 'POST' });
    assert.equal(requests.length, 1);
    for (const [index, enabled, bypassHosts] of [
      [1, true, ['example.com']],
      [2, false, []],
      [3, true, []],
    ] as const) {
      proxy.updateConfig({ enabled, host: '127.0.0.1', port: 7890, bypassHosts: [...bypassHosts] });
      repository.saveChapterContent('syosetu', 'n1000lib', {
        chapterId: 'chapter-1', index: 1, title: '第一章', url: 'https://example.com/1',
        content: `![image](https://cdn.example.com/image-${index}.png)`,
      });
      const next = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, { method: 'POST' });
      assert.equal(next.status, 200);
      assert.equal(Boolean(requests[index]?.dispatcher), index === 3);
    }
  } finally {
    await closeServer(server);
    cleanup();
    proxy.close();
  }
});

test('batch image cache reports HTTP errors without leaking URL or proxy credentials', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.map(String).join(' ')));
  const proxy = new NetworkProxyService({
    initialConfig: { enabled: true, host: '127.0.0.1', port: 7890, username: 'proxy-user', password: 'proxy-secret' },
  });
  const { app, repository, cleanup } = createLibraryServer({
    networkProxy: proxy,
    assetFetchImpl: async () => new Response('denied', { status: 403, statusText: 'Forbidden' }),
  });
  repository.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'chapter-1', index: 1, title: '第一章', url: 'https://example.com/1',
    content: '![image](https://image-user:image-secret@cdn.example.com/picture.png?signature=private-token)',
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/api/library/novels/syosetu/n1000lib/media/cache`, { method: 'POST' });
    assert.equal(response.status, 502);
    const { message } = await response.json() as { message: string };
    assert.equal(logs.length, 1);
    for (const value of [message, logs.join('\n')]) {
      assert.match(value, /HTTP 403 Forbidden/);
      assert.match(value, /代理/);
      assert.match(value, /cdn\.example\.com\/picture\.png/);
      assert.doesNotMatch(value, /image-user|image-secret|private-token|proxy-user|proxy-secret/);
    }
  } finally {
    await closeServer(server);
    cleanup();
    proxy.close();
  }
});
