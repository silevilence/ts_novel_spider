import assert from 'node:assert/strict';
import test from 'node:test';
import { AstrBotNotificationChannel } from './astrbot-notification';
import type { StoredNotificationConfig } from './system-preferences';

const config: StoredNotificationConfig = { enabled: true, errorEnabled: true, channel: 'astrbot', baseUrl: 'http://localhost:6185', apiKey: 'abk_test-secret', target: { umo: 'qq:GroupMessage:123' } };
const json = (value: unknown, status = 200) => Response.json(value, { status });

for (const path of ['/api/v1/im/messages', '/api/v1/im/message']) {
  test(`AstrBot uses instance path ${path}, bearer auth and plain text`, async () => {
    const requests: string[] = [];
    const channel = new AstrBotNotificationChannel(async (input, init) => {
      const url = String(input); requests.push(url);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer abk_test-secret');
      assert.equal(init?.redirect, 'error');
      if (url.endsWith('/openapi.json')) return json({ info: { version: 'test-version' }, paths: { [path]: { post: {} } } });
      assert.ok(url.endsWith(path));
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { umo: config.target.umo, message: '正文' });
      return json({ status: 'ok', data: null });
    });
    const result = await channel.send(config, '正文', new AbortController().signal);
    assert.equal(result.status, 'accepted'); assert.equal(result.apiVersion, 'test-version'); assert.equal(requests.length, 2);
  });
}

test('AstrBot never switches message paths after POST and distinguishes HTTP/business/uncertain outcomes', async () => {
  const scenarios = [
    { response: () => json({ status: 'error', message: config.apiKey }), expected: 'failed', retry: false },
    { response: () => json({}, 401), expected: 'failed', retry: false },
    { response: () => json({}, 403), expected: 'failed', retry: false },
    { response: () => json({}, 400), expected: 'failed', retry: false },
    { response: () => json({}, 404), expected: 'failed', retry: false },
    { response: () => json({}, 408), expected: 'unknown', retry: false },
    { response: () => json({}, 429), expected: 'failed', retry: true },
    { response: () => json({}, 500), expected: 'unknown', retry: false },
    { response: () => json({ code: 0 }), expected: 'unknown', retry: false },
    { response: () => new Response('invalid-json'), expected: 'unknown', retry: false },
    { response: () => { throw new Error(config.apiKey); }, expected: 'unknown', retry: false },
  ];
  for (const scenario of scenarios) {
    let posts = 0;
    const channel = new AstrBotNotificationChannel(async (_input, init) => {
      if (init?.method !== 'POST') return json({ paths: { '/api/v1/im/messages': { post: {} }, '/api/v1/im/message': { post: {} } } });
      posts++; return scenario.response();
    });
    const result = await channel.send(config, '正文', new AbortController().signal);
    assert.equal(posts, 1); assert.equal(result.status, scenario.expected); assert.equal(result.retryable, scenario.retry);
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
  }
});

test('unknown OpenAPI, missing configuration or failed discovery do not POST', async () => {
  for (const response of [() => json({ paths: {} }), () => json({}, 404), () => json({}, 503), () => new Response('html')]) {
    const channel = new AstrBotNotificationChannel(async (_input, init) => { assert.equal(init?.method, 'GET'); return response(); });
    assert.equal((await channel.send(config, 'text', new AbortController().signal)).status, 'failed');
  }
  const channel = new AstrBotNotificationChannel(async () => { throw new Error('unexpected request'); });
  assert.equal((await channel.send({ ...config, apiKey: '' }, 'text', new AbortController().signal)).category, 'configuration');
});

test('known UMO query reads actual data.umos and optional information, empty/permission/unsupported remain explicit', async () => {
  const channel = new AstrBotNotificationChannel(async (input, init) => {
    assert.ok(String(input).endsWith('/api/v1/sessions/active-umos'));
    assert.equal(init?.method, 'GET');
    return json({ status: 'ok', data: { umos: ['qq:GroupMessage:123', 'qq:GroupMessage:123'], umo_infos: [{ umo: 'qq:GroupMessage:123', platform: 'qq', display_name: '读书群' }] } });
  });
  assert.deepEqual((await channel.listTargets(config)).targets, [{ umo: config.target.umo, label: `${config.target.umo} · 读书群 / qq` }]);
  const empty = new AstrBotNotificationChannel(async () => json({ status: 'ok', data: { umos: [] } }));
  assert.equal((await empty.listTargets(config)).targets.length, 0);
  for (const status of [403, 404, 500]) {
    const failed = new AstrBotNotificationChannel(async () => json({}, status));
    await assert.rejects(failed.listTargets(config), /手写/);
  }
});
