import crypto from 'node:crypto';

export type BrowserCaptureSignal = 'challenge' | 'rate_limited' | 'permission_required' | 'parse_error';
export type BrowserCaptureControl = 'pause' | 'continue' | 'abort';
export type BrowserCapturePhase = 'task' | 'metadata' | 'catalog' | 'chapter';
export type BrowserCaptureTaskState = 'queued' | 'running' | 'paused' | 'waiting_user' | 'completed' | 'failed' | 'aborted';

/** 持久化的浏览器扩展配对记录。 */
export interface BrowserCapturePairing {
  id: string;
  name: string;
  keyHash: string;
  createdAt: string;
  lastConnectedAt: string | null;
  revokedAt: string | null;
}

/** 一次浏览器采集页面或任务范围的审计记录。 */
export interface BrowserCaptureAudit {
  id: string;
  taskId: string | null;
  sourceId: string;
  novelId: string;
  phase: BrowserCapturePhase;
  targetUrl: string;
  origin: string;
  status: 'succeeded' | 'failed' | 'aborted';
  failureReason: string | null;
  startedAt: string;
  completedAt: string;
  chapterIds: string[];
}

/** 浏览器采集服务所需的持久化端口。 */
export interface BrowserCaptureStore {
  /** 保存长期配对记录；密钥必须只以哈希形式传入。 */
  savePairing(pairing: BrowserCapturePairing): void;
  /** 按密钥哈希查询尚未撤销的配对。 */
  findActivePairingByKeyHash(keyHash: string): BrowserCapturePairing | null;
  /** 列出全部配对记录，包含已撤销记录。 */
  listPairings(): BrowserCapturePairing[];
  /** 撤销指定配对并返回是否实际发生变更。 */
  revokePairing(pairingId: string, revokedAt: string): boolean;
  /** 更新配对最近连接时间。 */
  touchPairing(pairingId: string, connectedAt: string): void;
  /** 保存页面级或任务级采集审计。 */
  saveAudit(audit: BrowserCaptureAudit): void;
  /** 按时间倒序列出最近的采集审计。 */
  listAudits(limit?: number): BrowserCaptureAudit[];
}

/** 交由真实浏览器加载的 HTML 请求。 */
export interface BrowserHtmlRequest {
  url: string;
  headers?: Record<string, string>;
}

/** 将浏览器请求绑定到来源、小说、阶段和可选任务。 */
export interface BrowserCaptureContext {
  taskId: string | null;
  sourceId: string;
  novelId: string;
  phase: BrowserCapturePhase;
}

/** 服务端与扩展之间共享的 WebSocket 消息契约。 */
export type BrowserCaptureWireMessage =
  | {
      type: 'heartbeat';
    }
  | {
      type: 'capture_request';
      requestId: string;
      taskId: string | null;
      url: string;
      phase: BrowserCapturePhase;
    }
  | {
      type: 'capture_result';
      requestId: string;
      url: string;
      html: string;
    }
  | {
      type: 'capture_signal';
      requestId: string;
      signal: BrowserCaptureSignal;
      message: string;
    }
  | {
      type: 'task_control';
      taskId: string;
      action: BrowserCaptureControl;
    }
  | {
      type: 'task_state';
      taskId: string;
      state: BrowserCaptureTaskState;
      message?: string;
    }
  | {
      type: 'hello';
      pairingId: string;
    };

/** 已认证浏览器连接的最小传输端口。 */
export interface BrowserCapturePeer {
  /** 向扩展发送一条类型化协议消息。 */
  send(message: BrowserCaptureWireMessage): void;
  /** 关闭扩展连接。 */
  close(code?: number, reason?: string): void;
}

/** 浏览器任务状态变化事件。 */
export interface BrowserTransportStateEvent {
  taskId: string;
  state: 'running' | 'paused' | 'waiting_user' | 'aborted' | 'failed';
  signal?: BrowserCaptureSignal;
  message?: string;
}

/** 浏览器采集服务构造参数。 */
export interface BrowserCaptureServiceOptions {
  store: BrowserCaptureStore;
  now?: () => number;
  pairingTokenTtlMs?: number;
  requestTimeoutMs?: number;
}

interface PairingTokenRecord {
  digest: string;
  expiresAt: number;
}

interface ConnectedPeer {
  id: string;
  pairingId: string;
  peer: BrowserCapturePeer;
}

interface PendingCapture {
  requestId: string;
  request: BrowserHtmlRequest;
  context: BrowserCaptureContext;
  startedAt: string;
  resolve: (html: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
  deferredHtml: string | null;
  lastSignal: { signal: BrowserCaptureSignal; message: string } | null;
}

interface UserWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface BrowserTaskScope {
  taskId: string;
  sourceId: string;
  novelId: string;
  chapterIds: string[];
  startedAt: string;
}

/** 携带稳定错误码的浏览器传输异常。 */
export class BrowserTransportError extends Error {
  constructor(
    readonly code: 'transport_unavailable' | 'transport_disconnected' | 'capture_timeout' | 'capture_aborted' | BrowserCaptureSignal,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserTransportError';
  }
}

/** 管理浏览器配对、连接、串行页面请求、人工等待和采集审计。 */
export class BrowserCaptureService {
  readonly #store: BrowserCaptureStore;
  readonly #now: () => number;
  readonly #pairingTokenTtlMs: number;
  readonly #requestTimeoutMs: number;
  readonly #tokens = new Map<string, PairingTokenRecord>();
  readonly #connections = new Map<string, ConnectedPeer>();
  readonly #pending = new Map<string, PendingCapture>();
  readonly #transportListeners = new Set<(event: BrowserTransportStateEvent) => void>();
  readonly #pausedTasks = new Set<string>();
  readonly #userWaiters = new Map<string, Set<UserWaiter>>();
  readonly #taskScopes = new Map<string, BrowserTaskScope>();
  readonly #tasksThatUsedConnection = new Set<string>();
  #activeConnectionId: string | null = null;
  #queueTail: Promise<void> = Promise.resolve();

  constructor(options: BrowserCaptureServiceOptions) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#pairingTokenTtlMs = options.pairingTokenTtlMs ?? 5 * 60_000;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  }

  /** 创建短时、一次性的配对令牌。 */
  createPairingToken(): { token: string; expiresAt: string } {
    this.pruneExpiredTokens();
    const token = randomSecret(24);
    const expiresAt = this.#now() + this.#pairingTokenTtlMs;
    this.#tokens.set(hashSecret(token), { digest: hashSecret(token), expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 消费一次性令牌并换取仅展示一次的长期密钥。 */
  exchangePairingToken(token: string, name: string): { key: string; pairing: BrowserCapturePairing } {
    this.pruneExpiredTokens();
    const digest = hashSecret(token);
    const record = this.#tokens.get(digest);
    if (!record || record.expiresAt < this.#now()) {
      throw new Error('Pairing token is invalid or expired.');
    }
    this.#tokens.delete(digest);

    const key = randomSecret(32);
    const pairing: BrowserCapturePairing = {
      id: crypto.randomUUID(),
      name: name.trim() || 'Browser extension',
      keyHash: hashSecret(key),
      createdAt: this.nowIso(),
      lastConnectedAt: null,
      revokedAt: null,
    };
    this.#store.savePairing(pairing);
    return { key, pairing: publicPairing(pairing) };
  }

  /** 校验长期密钥并返回脱敏的配对信息。 */
  authenticateKey(key: string): BrowserCapturePairing | null {
    if (!key) return null;
    const pairing = this.#store.findActivePairingByKeyHash(hashSecret(key));
    return pairing ? publicPairing(pairing) : null;
  }

  /** 列出脱敏的浏览器配对记录。 */
  listPairings(): BrowserCapturePairing[] {
    return this.#store.listPairings().map(publicPairing);
  }

  /** 撤销配对并断开它仍在使用的连接。 */
  revokePairing(pairingId: string): boolean {
    const revoked = this.#store.revokePairing(pairingId, this.nowIso());
    if (!revoked) return false;
    for (const connection of this.#connections.values()) {
      if (connection.pairingId === pairingId) {
        connection.peer.close(4003, 'Pairing revoked');
        this.disconnectPeer(connection.id);
      }
    }
    return true;
  }

  /** 查询最近的浏览器采集审计。 */
  listAudits(limit = 100): BrowserCaptureAudit[] {
    return this.#store.listAudits(limit);
  }

  /** 返回当前桥接连接及在途请求概况。 */
  getStatus(): { connected: boolean; pairingId: string | null; pendingRequests: number } {
    const connection = this.activeConnection();
    return {
      connected: connection !== null,
      pairingId: connection?.pairingId ?? null,
      pendingRequests: this.#pending.size,
    };
  }

  /** 认证并登记一个扩展 WebSocket 对等端。 */
  connectPeer(key: string, peer: BrowserCapturePeer): { id: string; pairingId: string } {
    const pairing = this.authenticateKey(key);
    if (!pairing) throw new BrowserTransportError('transport_unavailable', 'Browser pairing key is invalid or revoked.');
    const connection: ConnectedPeer = { id: crypto.randomUUID(), pairingId: pairing.id, peer };
    this.#connections.set(connection.id, connection);
    this.#activeConnectionId = connection.id;
    this.#store.touchPairing(pairing.id, this.nowIso());
    peer.send({ type: 'hello', pairingId: pairing.id });
    return { id: connection.id, pairingId: pairing.id };
  }

  /** 移除对等端；活动连接断开时立即终止受影响任务。 */
  disconnectPeer(connectionId: string): void {
    if (!this.#connections.delete(connectionId)) return;
    if (this.#activeConnectionId === connectionId) {
      this.#activeConnectionId = [...this.#connections.keys()].at(-1) ?? null;
      for (const capture of [...this.#pending.values()]) {
        this.failCapture(capture, new BrowserTransportError(
          'transport_disconnected',
          'Browser transport disconnected while capture was running.',
        ));
      }
      const disconnectedError = new BrowserTransportError(
        'transport_disconnected',
        'Browser transport disconnected while the task was running.',
      );
      for (const taskId of this.#tasksThatUsedConnection) {
        for (const waiter of this.#userWaiters.get(taskId) ?? []) waiter.reject(disconnectedError);
        this.#userWaiters.delete(taskId);
        this.emitTransportState({ taskId, state: 'failed', message: disconnectedError.message });
      }
    }
  }

  /** 处理已认证扩展发来的结果、信号和控制消息。 */
  receivePeerMessage(connectionId: string, message: BrowserCaptureWireMessage): void {
    if (!this.#connections.has(connectionId)) return;
    if (message.type === 'task_control') {
      this.controlTask(message.taskId, message.action);
      return;
    }
    if (message.type !== 'capture_result' && message.type !== 'capture_signal') return;
    const capture = this.#pending.get(message.requestId);
    if (!capture) return;

    if (message.type === 'capture_result') {
      if (!message.html.trim()) {
        if (capture.context.taskId) {
          this.clearCaptureTimeout(capture);
          this.emitTransportState({
            taskId: capture.context.taskId,
            state: 'waiting_user',
            signal: 'parse_error',
            message: 'Browser returned an empty document. Please inspect the page and continue to retry.',
          });
        } else {
          this.failCapture(capture, new BrowserTransportError('parse_error', 'Browser returned an empty document.'));
        }
        return;
      }
      if (capture.context.taskId && this.#pausedTasks.has(capture.context.taskId)) {
        this.clearCaptureTimeout(capture);
        capture.deferredHtml = message.html;
        return;
      }
      this.completeCapture(capture, message.html);
      return;
    }

    if (message.signal === 'challenge' || message.signal === 'rate_limited' || message.signal === 'permission_required' || message.signal === 'parse_error') {
      if (capture.context.taskId) {
        this.clearCaptureTimeout(capture);
        this.emitTransportState({
          taskId: capture.context.taskId,
          state: 'waiting_user',
          signal: message.signal,
          message: message.message,
        });
      } else {
        capture.lastSignal = { signal: message.signal, message: message.message };
      }
      return;
    }

    this.failCapture(capture, new BrowserTransportError(message.signal, message.message));
  }

  /** 将一次 HTML 请求加入全局串行浏览器队列。 */
  async fetchHtml(request: BrowserHtmlRequest, context: BrowserCaptureContext): Promise<string> {
    return this.enqueue(() => this.dispatchCapture(request, context));
  }

  /** 对活动浏览器任务执行暂停、继续或中止。 */
  controlTask(taskId: string, action: BrowserCaptureControl): void {
    if (action === 'pause') {
      this.#pausedTasks.add(taskId);
      this.emitTransportState({ taskId, state: 'paused' });
      return;
    }
    if (action === 'abort') {
      this.#pausedTasks.delete(taskId);
      this.emitTransportState({ taskId, state: 'aborted' });
      for (const capture of [...this.#pending.values()].filter((entry) => entry.context.taskId === taskId)) {
        this.failCapture(capture, new BrowserTransportError('capture_aborted', 'Browser capture task was aborted.'), 'aborted');
      }
      for (const waiter of this.#userWaiters.get(taskId) ?? []) {
        waiter.reject(new BrowserTransportError('capture_aborted', 'Browser capture task was aborted.'));
      }
      this.#userWaiters.delete(taskId);
      return;
    }

    this.#pausedTasks.delete(taskId);
    this.emitTransportState({ taskId, state: 'running' });
    for (const capture of this.#pending.values()) {
      if (capture.context.taskId !== taskId) continue;
      if (capture.deferredHtml !== null) this.completeCapture(capture, capture.deferredHtml);
      else this.sendCapture(capture);
    }
    for (const waiter of this.#userWaiters.get(taskId) ?? []) waiter.resolve();
    this.#userWaiters.delete(taskId);
  }

  /** 在解析异常后等待用户显式继续或中止。 */
  waitForUser(taskId: string, signal: BrowserCaptureSignal, message: string): Promise<void> {
    this.emitTransportState({ taskId, state: 'waiting_user', signal, message });
    return new Promise<void>((resolve, reject) => {
      const waiters = this.#userWaiters.get(taskId) ?? new Set<UserWaiter>();
      waiters.add({ resolve, reject });
      this.#userWaiters.set(taskId, waiters);
    });
  }

  /** 登记任务范围，供最终审计记录使用。 */
  registerTaskScope(taskId: string, sourceId: string, novelId: string, chapterIds: string[]): void {
    this.#taskScopes.set(taskId, {
      taskId,
      sourceId,
      novelId,
      chapterIds: [...chapterIds],
      startedAt: this.nowIso(),
    });
  }

  /** 完成并持久化任务范围审计。 */
  completeTaskAudit(
    taskId: string,
    status: BrowserCaptureAudit['status'],
    failureReason: string | null,
  ): void {
    const scope = this.#taskScopes.get(taskId);
    if (!scope) return;
    this.#store.saveAudit({
      id: crypto.randomUUID(),
      taskId,
      sourceId: scope.sourceId,
      novelId: scope.novelId,
      phase: 'task',
      targetUrl: '',
      origin: '',
      status,
      failureReason,
      startedAt: scope.startedAt,
      completedAt: this.nowIso(),
      chapterIds: [...scope.chapterIds],
    });
    this.#taskScopes.delete(taskId);
    this.#tasksThatUsedConnection.delete(taskId);
    this.#pausedTasks.delete(taskId);
  }

  /** 将服务端任务状态同步给当前扩展。 */
  broadcastTaskState(taskId: string, state: BrowserCaptureTaskState, message?: string): void {
    const connection = this.activeConnection();
    if (!connection) return;
    connection.peer.send({ type: 'task_state', taskId, state, ...(message ? { message } : {}) });
  }

  /** 订阅浏览器传输状态变化。 */
  onTransportState(listener: (event: BrowserTransportStateEvent) => void): () => void {
    this.#transportListeners.add(listener);
    return () => this.#transportListeners.delete(listener);
  }

  private async dispatchCapture(request: BrowserHtmlRequest, context: BrowserCaptureContext): Promise<string> {
    if (!this.activeConnection()) {
      const disconnected = context.taskId ? this.#tasksThatUsedConnection.has(context.taskId) : false;
      throw new BrowserTransportError(
        disconnected ? 'transport_disconnected' : 'transport_unavailable',
        disconnected ? 'Browser transport disconnected while the task was running.' : 'No paired browser extension is connected.',
      );
    }
    if (context.taskId && this.#pausedTasks.has(context.taskId)) {
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = this.onTransportState((event) => {
          if (event.taskId !== context.taskId) return;
          if (event.state === 'running') { unsubscribe(); resolve(); }
          if (event.state === 'aborted') { unsubscribe(); reject(new BrowserTransportError('capture_aborted', 'Browser capture task was aborted.')); }
          if (event.state === 'failed') { unsubscribe(); reject(new BrowserTransportError('transport_disconnected', event.message ?? 'Browser transport disconnected.')); }
        });
      });
    }

    return new Promise<string>((resolve, reject) => {
      const capture: PendingCapture = {
        requestId: crypto.randomUUID(),
        request,
        context,
        startedAt: this.nowIso(),
        resolve,
        reject,
        timeout: null,
        deferredHtml: null,
        lastSignal: null,
      };
      if (context.taskId) this.#tasksThatUsedConnection.add(context.taskId);
      this.#pending.set(capture.requestId, capture);
      this.sendCapture(capture);
    });
  }

  private sendCapture(capture: PendingCapture): void {
    const connection = this.activeConnection();
    if (!connection) {
      this.failCapture(capture, new BrowserTransportError('transport_disconnected', 'Browser transport is disconnected.'));
      return;
    }
    this.armCaptureTimeout(capture);
    connection.peer.send({
      type: 'capture_request',
      requestId: capture.requestId,
      taskId: capture.context.taskId,
      url: capture.request.url,
      phase: capture.context.phase,
    });
  }

  private completeCapture(capture: PendingCapture, html: string): void {
    this.clearCaptureTimeout(capture);
    this.#pending.delete(capture.requestId);
    this.#store.saveAudit(this.buildAudit(capture, 'succeeded', null));
    capture.resolve(html);
  }

  private failCapture(
    capture: PendingCapture,
    error: Error,
    status: BrowserCaptureAudit['status'] = 'failed',
  ): void {
    this.clearCaptureTimeout(capture);
    this.#pending.delete(capture.requestId);
    this.#store.saveAudit(this.buildAudit(capture, status, error.message));
    capture.reject(error);
  }

  private buildAudit(
    capture: PendingCapture,
    status: BrowserCaptureAudit['status'],
    failureReason: string | null,
  ): BrowserCaptureAudit {
    let origin = '';
    try { origin = new URL(capture.request.url).origin; } catch { origin = capture.request.url; }
    return {
      id: crypto.randomUUID(),
      taskId: capture.context.taskId,
      sourceId: capture.context.sourceId,
      novelId: capture.context.novelId,
      phase: capture.context.phase,
      targetUrl: capture.request.url,
      origin,
      status,
      failureReason,
      startedAt: capture.startedAt,
      completedAt: this.nowIso(),
      chapterIds: capture.context.taskId
        ? [...(this.#taskScopes.get(capture.context.taskId)?.chapterIds ?? [])]
        : [],
    };
  }

  private armCaptureTimeout(capture: PendingCapture): void {
    this.clearCaptureTimeout(capture);
    capture.timeout = setTimeout(() => {
      const error = capture.lastSignal
        ? new BrowserTransportError(capture.lastSignal.signal, capture.lastSignal.message)
        : new BrowserTransportError('capture_timeout', 'Browser page capture timed out.');
      this.failCapture(capture, error);
    }, this.#requestTimeoutMs);
  }

  private clearCaptureTimeout(capture: PendingCapture): void {
    if (capture.timeout) clearTimeout(capture.timeout);
    capture.timeout = null;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queueTail.then(operation, operation);
    this.#queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private activeConnection(): ConnectedPeer | null {
    return this.#activeConnectionId ? this.#connections.get(this.#activeConnectionId) ?? null : null;
  }

  private emitTransportState(event: BrowserTransportStateEvent): void {
    for (const listener of this.#transportListeners) listener(event);
    this.broadcastTaskState(event.taskId, event.state, event.message);
  }

  private pruneExpiredTokens(): void {
    for (const [digest, record] of this.#tokens) {
      if (record.expiresAt < this.#now()) this.#tokens.delete(digest);
    }
  }

  private nowIso(): string {
    return new Date(this.#now()).toISOString();
  }
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function randomSecret(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function publicPairing(pairing: BrowserCapturePairing): BrowserCapturePairing {
  return { ...pairing, keyHash: '' };
}
