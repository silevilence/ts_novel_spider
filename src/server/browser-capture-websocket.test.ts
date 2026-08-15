import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import WebSocket from 'ws';

import { attachBrowserCaptureWebSocket, BROWSER_PROTOCOL } from './browser-capture-websocket';
import { BrowserCaptureService } from './core/browser-capture';
import { SqliteNovelRepository } from './core/novel-repository';

test('authenticated websocket carries capture request and rendered DOM on one channel', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-capture-ws-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  const capture = new BrowserCaptureService({ store: repository });
  const pairing = capture.exchangePairingToken(capture.createPairingToken().token, 'ws test');
  const server = http.createServer((_request, response) => response.end());
  const webSocketServer = attachBrowserCaptureWebSocket(server, capture);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/browser/ws`, [BROWSER_PROTOCOL, pairing.key]);
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    client.on('message', (data) => {
      const message = JSON.parse(data.toString()) as { type: string; requestId?: string; url?: string };
      if (message.type === 'capture_request' && message.requestId && message.url) {
        client.send(JSON.stringify({
          type: 'capture_result', requestId: message.requestId, url: message.url,
          html: '<html><body>from websocket</body></html>',
        }));
      }
    });

    const html = await capture.fetchHtml(
      { url: 'https://example.test/one' },
      { taskId: 'task-ws', sourceId: 'example', novelId: 'one', phase: 'chapter' },
    );
    assert.match(html, /from websocket/);
    client.close();
  } finally {
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
