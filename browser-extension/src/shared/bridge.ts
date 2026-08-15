/** 扩展本地保存的浏览器桥接设置。 */
export interface BridgeSettings {
  serverUrl: string;
  pairingKey: string;
  pairingId: string;
  developerMode: boolean;
}

/** 浏览器任务在扩展 UI 中可见的稳定状态。 */
export type BridgeTaskState = 'idle' | 'queued' | 'running' | 'paused' | 'waiting_user' | 'completed' | 'failed' | 'aborted';
export type BridgeCapturePhase = 'metadata' | 'catalog' | 'chapter';
export type BridgeTaskControl = 'pause' | 'continue' | 'abort';

/** 服务端请求扩展加载并序列化页面的消息。 */
export interface CaptureRequest {
  type: 'capture_request';
  requestId: string;
  taskId: string | null;
  url: string;
  phase: BridgeCapturePhase;
}

/** 后台脚本与弹窗共享的只读运行状态。 */
export interface BridgeRuntimeState {
  connected: boolean;
  taskId: string | null;
  taskState: BridgeTaskState;
  message: string;
  currentUrl: string;
  currentPhase: BridgeCapturePhase | null;
  catalogUrl: string;
  currentTabId: number | null;
  pendingRequestId: string | null;
}

/** 服务端发往扩展的 WebSocket 消息。 */
export type ServerMessage = CaptureRequest | {
  type: 'task_state';
  taskId: string;
  state: Exclude<BridgeTaskState, 'idle'>;
  message?: string;
} | {
  type: 'hello';
  pairingId: string;
};

/** 扩展发往服务端的 WebSocket 消息。 */
export type ClientMessage = {
  type: 'heartbeat';
} | {
  type: 'capture_result';
  requestId: string;
  url: string;
  html: string;
} | {
  type: 'capture_signal';
  requestId: string;
  signal: 'challenge' | 'rate_limited' | 'permission_required' | 'parse_error';
  message: string;
} | {
  type: 'task_control';
  taskId: string;
  action: BridgeTaskControl;
};

/** 弹窗发往后台脚本的内部消息。 */
export type RuntimeMessage =
  | { type: 'get_state' }
  | { type: 'reconnect' }
  | { type: 'task_control'; action: BridgeTaskControl }
  | { type: 'capture_pending' }
  | { type: 'open_catalog' }
  | { type: 'developer_export_html' }
  | { type: 'developer_read_cookies' };

export interface BridgeProgressDescription {
  title: string;
  nextStep: string;
  saveLabel: string;
}

export const DEFAULT_SETTINGS: BridgeSettings = {
  serverUrl: 'http://127.0.0.1:3000',
  pairingKey: '',
  pairingId: '',
  developerMode: false,
};

/** 从扩展本地存储读取并校验桥接设置。 */
export async function loadSettings(): Promise<BridgeSettings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    serverUrl: typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULT_SETTINGS.serverUrl,
    pairingKey: typeof stored.pairingKey === 'string' ? stored.pairingKey : '',
    pairingId: typeof stored.pairingId === 'string' ? stored.pairingId : '',
    developerMode: stored.developerMode === true,
  };
}

/** 将页面 URL 转换为 Chromium 可请求的最小来源权限模式。 */
export function originPattern(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/*`;
}

/** 将 HTTP 服务地址转换为浏览器桥接 WebSocket 地址。 */
export function websocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/browser/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** 将新的页面请求归并到弹窗运行状态，并防止沿用上一本书的目录地址。 */
export function applyCaptureRequestState(
  state: BridgeRuntimeState,
  request: CaptureRequest,
): BridgeRuntimeState {
  return {
    ...state,
    taskId: request.taskId,
    taskState: 'running',
    currentUrl: request.url,
    currentPhase: request.phase,
    catalogUrl: request.phase === 'catalog' ? request.url : request.phase === 'metadata' ? '' : state.catalogUrl,
    pendingRequestId: request.requestId,
    message: '正在打开目标页面',
  };
}

/** 生成用户可执行的当前阶段说明，覆盖没有 taskId 的浏览器预览。 */
export function describeBridgeProgress(state: BridgeRuntimeState): BridgeProgressDescription {
  const prefix = state.taskId ? '任务' : '预览';
  if (state.currentPhase === 'metadata') {
    return {
      title: `${prefix} · 作品信息`,
      nextStep: `${state.message || '正在读取作品信息'}。完成当前页后，扩展将自动打开目录页。`,
      saveLabel: '保存作品信息',
    };
  }
  if (state.currentPhase === 'catalog') {
    return {
      title: `${prefix} · 目录`,
      nextStep: `${state.message || '正在读取目录'}。保存目录后，预览将返回控制台；采集任务会继续打开章节。`,
      saveLabel: '保存目录',
    };
  }
  if (state.currentPhase === 'chapter') {
    return {
      title: `${prefix} · 章节`,
      nextStep: `${state.message || '正在读取章节'}。确认正文无误后保存，扩展将自动打开下一章。`,
      saveLabel: '保存当前章节',
    };
  }
  return {
    title: state.taskId ? `${prefix} · ${state.taskState}` : '暂无浏览器采集',
    nextStep: state.message || '请从 Web 采集工作台发起浏览器预览或采集任务。',
    saveLabel: '保存当前页面',
  };
}

/** 校验来自服务端的 JSON 是否符合扩展可处理的消息契约。 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'hello') return typeof value.pairingId === 'string';
  if (value.type === 'task_state') {
    return typeof value.taskId === 'string' && isBridgeTaskState(value.state) && value.state !== 'idle'
      && (value.message === undefined || typeof value.message === 'string');
  }
  return value.type === 'capture_request'
    && typeof value.requestId === 'string'
    && (typeof value.taskId === 'string' || value.taskId === null)
    && typeof value.url === 'string'
    && (value.phase === 'metadata' || value.phase === 'catalog' || value.phase === 'chapter');
}

/** 校验弹窗发来的扩展内部操作消息。 */
export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'task_control') return value.action === 'pause' || value.action === 'continue' || value.action === 'abort';
  return value.type === 'get_state' || value.type === 'reconnect' || value.type === 'capture_pending'
    || value.type === 'open_catalog' || value.type === 'developer_export_html' || value.type === 'developer_read_cookies';
}

function isBridgeTaskState(value: unknown): value is BridgeTaskState {
  return value === 'idle' || value === 'queued' || value === 'running' || value === 'paused'
    || value === 'waiting_user' || value === 'completed' || value === 'failed' || value === 'aborted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
