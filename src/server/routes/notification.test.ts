import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createServerApp } from '../app';
import { ControlCenterService } from '../core/control-center';
import { SqliteNovelRepository } from '../core/novel-repository';
import { SystemPreferencesService } from '../core/system-preferences';

test('notification routes hide keys, validate, query without im scope, and only send on explicit test', async () => {
  const repo = new SqliteNovelRepository(':memory:'); const prefs = new SystemPreferencesService(); let posts = 0; let scopeFailure = true;
  const service = new ControlCenterService({ repository: repo, systemPreferences: prefs, spiders: [], notificationFetchImpl: async (input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer abk_route-test');
    if (String(input).endsWith('/active-umos')) return scopeFailure ? Response.json({}, { status: 403 }) : Response.json({ status: 'ok', data: { umos: ['qq:GroupMessage:123'] } });
    if (String(input).endsWith('/openapi.json')) return Response.json({ info: { version: 'fixture-1' }, paths: { '/api/v1/im/messages': { post: {} } } });
    posts++; return Response.json({ status: 'ok', data: null });
  } });
  const server = http.createServer(createServerApp({ controlCenter: service }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const config = { enabled: false, errorEnabled: true, channel: 'astrbot', baseUrl: 'http://localhost:6185', target: { umo: 'qq:GroupMessage:123' }, keyAction: 'replace', apiKey: 'abk_route-test' };
  const request = (url: string, body: unknown, method = 'POST') => fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(`${base}/control/preferences/notifications`)).json()).enabled, false);
    const saved = await request('/control/preferences/notifications', config, 'PUT');
    assert.equal(saved.status, 200); assert.ok(!(await saved.text()).includes('abk_route-test')); assert.equal(posts, 0);
    const input = { ...config, keyAction: 'keep', apiKey: '' };
    const rejected = await request('/control/notifications/targets', input);
    assert.equal(rejected.status, 400); assert.match(await rejected.text(), /data scope/);
    const result = await request('/control/notifications/test', input);
    assert.equal(result.status, 200); const record = await result.json(); assert.equal(record.status, 'accepted'); assert.equal(posts, 1);
    scopeFailure = false;
    const targets = await request('/control/notifications/targets', input);
    assert.equal((await targets.json()).targets[0].umo, config.target.umo);
    for (const invalid of [{ ...input, enabled: 'true' }, { ...input, target: { umo: 'invalid' } }, { ...input, baseUrl: 'http://user:password@localhost' }, { ...input, enabled: true, keyAction: 'clear' }]) {
      assert.equal((await request('/control/preferences/notifications', invalid, 'PUT')).status, 400);
    }
    const records = await (await fetch(`${base}/control/notifications/records`)).text();
    assert.ok(!records.includes('abk_route-test')); assert.match(records, /fixture-1/);
    assert.equal((await request('/control/preferences/notifications', { ...input, keyAction: 'clear' }, 'PUT')).status, 200);
    assert.equal(prefs.getNotification().keyConfigured, false);
    assert.equal(posts, 1);

    repo.saveMetadata('syosetu', { novelId: 'n1', title: 'test', author: 'author', description: '', tags: [], chapterCount: 0, infoPageUrl: '' });
    const novelUrl = '/library/novels/syosetu/n1/scheduling';
    const novel = await request(novelUrl, { enabled: true, notifyOnUpdate: true }, 'PUT');
    assert.equal((await novel.json()).notifyOnUpdate, true);
    await request(novelUrl, { enabled: false }, 'PUT');
    assert.equal((await (await fetch(`${base}${novelUrl}`)).json()).notifyOnUpdate, true);
    assert.equal((await request(novelUrl, { enabled: true, notifyOnUpdate: 'yes' }, 'PUT')).status, 400);
    await request('/library/scheduling/novels', { novels: [{ sourceId: 'syosetu', novelId: 'n1', enabled: true, notifyOnUpdate: false }] }, 'PUT');
    assert.equal(repo.getScheduledNovel('syosetu', 'n1')?.notifyOnUpdate, false);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); service.close(); repo.close(); }
});
