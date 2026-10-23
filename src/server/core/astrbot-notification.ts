import type { KnownNotificationTargets, NotificationResult } from '../contracts/notification';
import type { StoredNotificationConfig } from './system-preferences';
import type { NotificationChannel } from './notification-channel';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 只使用实例声明的消息路径；POST 后绝不尝试另一路径。 */
export class AstrBotNotificationChannel implements NotificationChannel {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async #request(config: StoredNotificationConfig, path: string, signal: AbortSignal, body?: object): Promise<Response> {
    return this.fetchImpl(`${config.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async send(config: StoredNotificationConfig, text: string, signal: AbortSignal): Promise<NotificationResult> {
    if (!config.baseUrl || !config.apiKey || !config.target.umo) return failure('configuration', '请配置服务地址、API Key 和目标 UMO');
    let response: Response;
    try { response = await this.#request(config, '/api/v1/openapi.json', signal); }
    catch { return failure('unavailable', '无法读取实例接口定义；未发送消息', true); }
    if (!response.ok) return httpFailure(response.status, false);
    let spec: unknown;
    try { spec = await response.json(); } catch { return failure('configuration', '实例接口定义不是有效 JSON；未发送消息'); }
    const paths = record(spec) && record(spec.paths) ? spec.paths : {};
    const path = ['/api/v1/im/messages', '/api/v1/im/message'].find((candidate) => {
      const operation = paths[candidate];
      return record(operation) && record(operation.post);
    });
    if (!path) return failure('configuration', '实例未声明支持的消息接口；未发送消息');
    const apiVersion = record(spec) && record(spec.info) && typeof spec.info.version === 'string' ? spec.info.version : '未声明';
    const details = { path, apiVersion };
    try {
      response = await this.#request(config, path, signal, { umo: config.target.umo, message: text });
      if (!response.ok) return { ...httpFailure(response.status, true), ...details };
      const result: unknown = await response.json();
      if (!record(result) || typeof result.status !== 'string') return { ...uncertain('消息接口响应无法识别，投递结果不确定；未重发'), ...details };
      if (result.status !== 'ok') return { ...failure('rejected', 'AstrBot 返回业务失败，请检查目标与平台状态'), ...details };
      return { status: 'accepted', category: 'accepted', retryable: false, message: 'AstrBot 已接受发送请求；请在接收端确认实际到达', ...details };
    } catch {
      return { ...uncertain('消息请求中断或响应无法解析，投递结果不确定；未重发'), ...details };
    }
  }

  /** 已知会话只是候选，不能推断收件目标是否可达。 */
  async listTargets(config: StoredNotificationConfig): Promise<KnownNotificationTargets> {
    if (!config.baseUrl || !config.apiKey) throw new Error('查询已知 UMO 需要服务地址和 API Key；仍可手写目标');
    let response: Response;
    try { response = await this.#request(config, '/api/v1/sessions/active-umos', AbortSignal.timeout(10_000)); }
    catch { throw new Error('UMO 查询超时或接口不可用；仍可手写目标'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('无法查询 UMO：请检查 API Key 和 data scope；仅有 im scope 时仍可手写发送');
      throw new Error(`UMO 接口不可用或版本不支持（HTTP ${response.status}）；仍可手写目标`);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('UMO 接口响应无效；仍可手写目标'); }
    if (!record(body) || body.status !== 'ok' || !record(body.data) || !Array.isArray(body.data.umos)) throw new Error('UMO 接口返回失败或未知格式；仍可手写目标');
    const infos = Array.isArray(body.data.umo_infos) ? body.data.umo_infos.filter(record) : [];
    const targets = [...new Set(body.data.umos.filter((umo): umo is string => typeof umo === 'string'))].map((umo) => {
      const info = infos.find((item) => item.umo === umo);
      const labels = info ? [info.display_name, info.name, info.alias, info.platform].filter((value): value is string => typeof value === 'string' && Boolean(value)) : [];
      return { umo, label: labels.length ? `${umo} · ${[...new Set(labels)].join(' / ')}` : umo };
    });
    return { targets, message: targets.length ? '仅列出已知会话，不代表所有目标或当前可达状态；也可手写 UMO' : '暂无已知会话；可以手写 UMO' };
  }
}

function failure(category: NotificationResult['category'], message: string, retryable = false): NotificationResult {
  return { status: 'failed', category, message, retryable };
}
function uncertain(message: string): NotificationResult { return { status: 'unknown', category: 'unavailable', message, retryable: false }; }
function httpFailure(status: number, sending: boolean): NotificationResult {
  if (status === 401 || status === 403) return failure('authentication', `鉴权失败（HTTP ${status}），发送需要 im scope`);
  if (status === 408) return sending
    ? { status: 'unknown', category: 'timeout', message: '消息接口超时（HTTP 408），投递结果不确定；未重发', retryable: false }
    : failure('unavailable', '读取实例接口定义超时（HTTP 408）；未发送消息', true);
  if (status === 429) return failure('unavailable', '接口限流（HTTP 429）', true);
  if (status >= 500 && sending) return uncertain(`消息接口异常（HTTP ${status}），投递结果不确定；未重发`);
  return failure(status >= 500 ? 'unavailable' : 'configuration', `接口不可用或参数错误（HTTP ${status}）`, status >= 500 && !sending);
}
