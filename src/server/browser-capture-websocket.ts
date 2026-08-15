import type { IncomingMessage, Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  BrowserCaptureService,
  type BrowserCaptureWireMessage,
} from './core/browser-capture';

const BROWSER_PROTOCOL = 'tns-browser-v1';

export function attachBrowserCaptureWebSocket(server: Server, capture: BrowserCaptureService): WebSocketServer {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024 * 1024,
    handleProtocols: (protocols) => protocols.has(BROWSER_PROTOCOL) ? BROWSER_PROTOCOL : false,
  });

  server.on('upgrade', (request, socket, head) => {
    let pathname = '';
    try { pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname; } catch { pathname = ''; }
    if (pathname !== '/api/browser/ws') return;

    const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const key = protocols.find((protocol) => protocol !== BROWSER_PROTOCOL) ?? '';
    if (!protocols.includes(BROWSER_PROTOCOL) || !capture.authenticateKey(key)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request, key);
    });
  });

  webSocketServer.on('connection', (webSocket: WebSocket, _request: IncomingMessage, key: string) => {
    let connectionId = '';
    try {
      connectionId = capture.connectPeer(key, {
        send: (message) => {
          if (webSocket.readyState === webSocket.OPEN) webSocket.send(JSON.stringify(message));
        },
        close: (code, reason) => webSocket.close(code, reason),
      }).id;
    } catch {
      webSocket.close(4003, 'Pairing rejected');
      return;
    }

    webSocket.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString()) as BrowserCaptureWireMessage;
        capture.receivePeerMessage(connectionId, message);
      } catch {
        webSocket.close(4002, 'Invalid bridge message');
      }
    });
    webSocket.on('close', () => capture.disconnectPeer(connectionId));
    webSocket.on('error', () => capture.disconnectPeer(connectionId));
  });

  return webSocketServer;
}

export { BROWSER_PROTOCOL };
