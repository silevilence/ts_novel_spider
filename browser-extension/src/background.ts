import {
  applyCaptureRequestState,
  loadSettings,
  isRuntimeMessage,
  isServerMessage,
  originPattern,
  websocketUrl,
  type CaptureRequest,
  type BridgeRuntimeState,
  type ClientMessage,
  type RuntimeMessage,
  type ServerMessage,
} from './shared/bridge';

const state: BridgeRuntimeState = {
  connected: false,
  taskId: null,
  taskState: 'idle',
  message: '',
  currentUrl: '',
  currentPhase: null,
  catalogUrl: '',
  currentTabId: null,
  pendingRequestId: null,
};

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pendingRequest: CaptureRequest | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void connect();
});
chrome.runtime.onStartup.addListener(() => void connect());
chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === 'local') void connect(true);
});
chrome.alarms.create('bridge-heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'bridge-heartbeat') return;
  if (socket?.readyState === WebSocket.OPEN) send({ type: 'heartbeat' });
  else void connect();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handleRuntimeMessage(message).then(sendResponse, (error: unknown) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

async function connect(force = false): Promise<void> {
  const settings = await loadSettings();
  if (!settings.pairingKey) {
    closeSocket();
    updateState({ connected: false, message: '尚未配对' });
    return;
  }
  if (!force && (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING)) return;
  closeSocket();

  const nextSocket = new WebSocket(websocketUrl(settings.serverUrl), ['tns-browser-v1', settings.pairingKey]);
  socket = nextSocket;
  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return;
    updateState({ connected: true, message: '已连接本地服务' });
  });
  nextSocket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!isServerMessage(parsed)) return;
      const message: ServerMessage = parsed;
      void handleServerMessage(message).catch((error: unknown) => {
        if (message.type !== 'capture_request') return;
        send({
          type: 'capture_signal', requestId: message.requestId, signal: 'parse_error',
          message: error instanceof Error ? error.message : String(error),
        });
        updateState({ taskState: 'waiting_user', message: '页面读取失败，请人工检查后继续。' });
      });
    } catch { /* ignore invalid server payload */ }
  });
  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return;
    socket = null;
    updateState({ connected: false, message: '连接已断开，正在重连' });
    scheduleReconnect();
  });
  nextSocket.addEventListener('error', () => nextSocket.close());
}

async function handleServerMessage(message: ServerMessage): Promise<void> {
  if (message.type === 'hello') return;
  if (message.type === 'task_state') {
    updateState({ taskId: message.taskId, taskState: message.state, message: message.message ?? '' });
    return;
  }
  pendingRequest = message;
  updateState(applyCaptureRequestState(state, message));
  await openAndCapture(message);
}

async function openAndCapture(request: CaptureRequest): Promise<void> {
  const pattern = originPattern(request.url);
  const allowed = await chrome.permissions.contains({ origins: [pattern] });
  const tab = state.currentTabId
    ? await updateOrCreateTab(state.currentTabId, request.url)
    : await chrome.tabs.create({ url: request.url, active: true });
  if (typeof tab.id !== 'number') throw new Error('浏览器未返回采集标签页 ID。');
  updateState({ currentTabId: tab.id, currentUrl: request.url });
  await waitForTabComplete(tab.id);

  if (!allowed) {
    send({
      type: 'capture_signal', requestId: request.requestId, signal: 'permission_required',
      message: `请在扩展弹窗授权访问 ${new URL(request.url).origin}，然后继续。`,
    });
    updateState({ taskState: 'waiting_user', message: '等待站点访问授权' });
    return;
  }

  await captureCurrentPending();
}

async function captureCurrentPending(): Promise<void> {
  const request = pendingRequest;
  const tabId = state.currentTabId;
  if (!request || tabId === null) throw new Error('当前没有待保存的采集页面。');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      html: document.documentElement.outerHTML,
      title: document.title,
      text: document.body?.innerText.slice(0, 8000) ?? '',
      url: location.href,
    }),
  });
  if (!result?.result) throw new Error('无法读取当前页面。');
  const signal = detectAccessSignal(result.result.title, result.result.text);
  if (signal) {
    send({ type: 'capture_signal', requestId: request.requestId, ...signal });
    updateState({ taskState: 'waiting_user', message: signal.message });
    return;
  }

  send({
    type: 'capture_result', requestId: request.requestId,
    url: result.result.url, html: result.result.html,
  });
  pendingRequest = null;
  updateState({ pendingRequestId: null, message: '页面已保存并回传服务端' });
}

async function handleRuntimeMessage(message: unknown): Promise<unknown> {
  if (!isRuntimeMessage(message)) return { ok: false };
  const input: RuntimeMessage = message;
  if (input.type === 'get_state') return { ok: true, state };
  if (input.type === 'reconnect') { await connect(true); return { ok: true }; }
  if (input.type === 'task_control') {
    if (!state.taskId) throw new Error('当前没有浏览器采集任务。');
    send({ type: 'task_control', taskId: state.taskId, action: input.action });
    return { ok: true };
  }
  if (input.type === 'capture_pending') { await captureCurrentPending(); return { ok: true }; }
  if (input.type === 'open_catalog') {
    if (!state.catalogUrl) throw new Error('当前任务尚未加载目录页。');
    await chrome.tabs.create({ url: state.catalogUrl, active: true });
    return { ok: true };
  }
  if (input.type === 'developer_export_html' || input.type === 'developer_read_cookies') {
    const settings = await loadSettings();
    if (!settings.developerMode) throw new Error('请先在扩展设置页启用开发数据导出。');
    return input.type === 'developer_export_html' ? developerExportHtml() : developerReadCookies();
  }
  return { ok: false };
}

async function developerExportHtml(): Promise<{ ok: true; fileName: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number' || !tab.url) throw new Error('没有可导出的当前页面。');
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML });
  const html = result?.result;
  if (typeof html !== 'string') throw new Error('无法读取当前页面 HTML。');
  const host = new URL(tab.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const fileName = `ts-novel-spider-fixtures/${host}-${Date.now()}.html`;
  await chrome.downloads.download({ url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`, filename: fileName, saveAs: true });
  return { ok: true, fileName };
}

async function developerReadCookies(): Promise<{ ok: true; cookies: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error('没有可读取 Cookie 的当前页面。');
  const cookies = await chrome.cookies.getAll({ url: tab.url });
  return { ok: true, cookies: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') };
}

function detectAccessSignal(title: string, text: string): { signal: 'challenge' | 'rate_limited'; message: string } | null {
  const sample = `${title}\n${text}`.toLocaleLowerCase();
  if (/cloudflare|checking your browser|verify you are human|attention required|访问验证|人間であること/.test(sample)) {
    return { signal: 'challenge', message: '检测到访问验证，请在标签页完成验证后点击继续。' };
  }
  if (/too many requests|rate limit|temporarily unavailable|アクセスが集中|请求过于频繁/.test(sample)) {
    return { signal: 'rate_limited', message: '站点正在限流，请稍后点击继续重试。' };
  }
  return null;
}

function send(message: ClientMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('浏览器桥接未连接。');
  socket.send(JSON.stringify(message));
}

function updateState(patch: Partial<BridgeRuntimeState>): void {
  Object.assign(state, patch);
  void chrome.runtime.sendMessage({ type: 'state_changed', state }).catch(() => undefined);
}

async function updateOrCreateTab(tabId: number, url: string): Promise<chrome.tabs.Tab> {
  try {
    const updated = await chrome.tabs.update(tabId, { url, active: true });
    if (updated) return updated;
    return chrome.tabs.create({ url, active: true });
  }
  catch { return chrome.tabs.create({ url, active: true }); }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('页面加载超时。')); }, 90_000);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') { cleanup(); resolve(); }
    };
    const cleanup = () => { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') { cleanup(); resolve(); } });
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, 2000) as unknown as number;
}

function closeSocket(): void {
  if (socket) { const current = socket; socket = null; current.close(); }
}

void connect();
