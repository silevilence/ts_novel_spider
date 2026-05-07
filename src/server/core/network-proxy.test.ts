import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProxyAwareHtmlFetcher,
  NetworkProxyService,
  type ProxyAwareRequestInit,
} from './network-proxy';

test('NetworkProxyService resolves proxy URLs and bypass hosts correctly', () => {
  const service = new NetworkProxyService({
    initialConfig: {
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      bypassHosts: ['ncode.syosetu.com', 'localhost'],
    },
  });

  assert.equal(service.resolveProxyUrl('https://example.com/novel'), 'http://127.0.0.1:7890');
  assert.equal(service.resolveProxyUrl('https://ncode.syosetu.com/n9669bk/'), null);
  assert.equal(service.resolveProxyUrl('https://sub.localhost/path'), null);
  assert.equal(service.getConfig().isConfigured, true);
});

test('createProxyAwareHtmlFetcher adds a dispatcher for proxied requests', async () => {
  let capturedInit: ProxyAwareRequestInit | undefined;

  const service = new NetworkProxyService({
    initialConfig: {
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    },
  });
  const fetchHtml = createProxyAwareHtmlFetcher({
    proxyService: service,
    fetchImpl: async (_url, init) => {
      capturedInit = init;
      return new Response('<html>ok</html>', { status: 200 });
    },
  });

  const html = await fetchHtml({
    url: 'https://example.com/catalog',
    headers: {
      Accept: 'text/html',
    },
  });

  assert.equal(html, '<html>ok</html>');
  assert.ok(capturedInit?.dispatcher);
});

test('NetworkProxyService stores failed validation results', async () => {
  const service = new NetworkProxyService({
    initialConfig: {
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    },
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:7890');
    },
  });

  const result = await service.validate('https://example.com/health');

  assert.equal(result.ok, false);
  assert.equal(result.usingProxy, true);
  assert.match(result.message, /ECONNREFUSED/);
  assert.deepEqual(service.getLastValidation(), result);
});

test('NetworkProxyService restores persisted config after restart', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-proxy-'));
  const storageFilePath = path.join(tempDirectory, 'network-proxy.json');

  try {
    const firstService = new NetworkProxyService({ storageFilePath });

    const savedConfig = firstService.updateConfig({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 8888,
      username: 'tester',
      password: 'secret',
      bypassHosts: ['localhost', 'ncode.syosetu.com'],
    });

    firstService.close();

    const secondService = new NetworkProxyService({ storageFilePath });

    assert.deepEqual(secondService.getConfig(), savedConfig);
    secondService.close();
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('createProxyAwareHtmlFetcher retries transient fetch failures and returns html', async () => {
  let attempts = 0;

  const service = new NetworkProxyService({
    initialConfig: {
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    },
  });
  const fetchHtml = createProxyAwareHtmlFetcher({
    proxyService: service,
    fetchImpl: async () => {
      attempts += 1;

      if (attempts < 3) {
        const error = new TypeError('fetch failed') as TypeError & {
          cause?: { code: string; message: string };
        };
        error.cause = {
          code: 'ECONNRESET',
          message: 'Client network socket disconnected before secure TLS connection was established',
        };
        throw error;
      }

      return new Response('<html>ok</html>', { status: 200 });
    },
  });

  const html = await fetchHtml({
    url: 'https://example.com/catalog',
    headers: {
      Accept: 'text/html',
    },
  });

  assert.equal(html, '<html>ok</html>');
  assert.equal(attempts, 3);
});

test('createProxyAwareHtmlFetcher surfaces root cause after retry exhaustion', async () => {
  const service = new NetworkProxyService({
    initialConfig: {
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    },
  });
  const fetchHtml = createProxyAwareHtmlFetcher({
    proxyService: service,
    fetchImpl: async () => {
      const error = new TypeError('fetch failed') as TypeError & {
        cause?: { code: string; message: string };
      };
      error.cause = {
        code: 'ECONNRESET',
        message: 'Client network socket disconnected before secure TLS connection was established',
      };
      throw error;
    },
  });

  await assert.rejects(
    () =>
      fetchHtml({
        url: 'https://example.com/catalog',
        headers: {
          Accept: 'text/html',
        },
      }),
    /Failed to fetch https:\/\/example.com\/catalog: ECONNRESET: Client network socket disconnected before secure TLS connection was established/,
  );
});