import { startTransition, useEffect, useEffectEvent, useState } from 'react';

import {
  fetchNetworkProxy,
  updateNetworkProxy,
  validateNetworkProxy,
  type UpdateNetworkProxyInput,
} from '../services/api';
import type { ControlNetworkProxyPayload } from '../../server/routes/control-center';

interface ProxyDraft {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: string;
  username: string;
  password: string;
  bypassHosts: string;
  targetUrl: string;
}

const DEFAULT_TARGET_URL = 'https://ncode.syosetu.com/';

export function NetworkProxyPanel() {
  const [state, setState] = useState<ControlNetworkProxyPayload | null>(null);
  const [draft, setDraft] = useState<ProxyDraft>(() => createEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hydrateState = useEffectEvent((payload: ControlNetworkProxyPayload) => {
    startTransition(() => {
      setState(payload);
      setDraft(createDraftFromPayload(payload));
      setErrorMessage(null);
    });
  });

  useEffect(() => {
    let active = true;

    void fetchNetworkProxy()
      .then((payload) => {
        if (!active) {
          return;
        }

        hydrateState(payload);
      })
      .catch((error) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load proxy config.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);

    try {
      const payload = await updateNetworkProxy(toUpdateInput(draft));
      hydrateState(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save proxy config.');
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);

    try {
      const payload = await validateNetworkProxy(draft.targetUrl.trim());
      startTransition(() => {
        setState(payload);
        setErrorMessage(null);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Proxy validation failed.');
    } finally {
      setValidating(false);
    }
  }

  const isDirty = state ? isDraftDirty(draft, state) : false;
  const validation = state?.validation ?? null;
  const proxySummary = formatProxySummary(state?.config ?? null);

  return (
    <section className="panel proxy-panel">
      <div className="panel-heading split align-start">
        <div>
          <p className="eyebrow">网络代理策略</p>
          <h2>代理路由调度与全局下发</h2>
          <p className="panel-note">
            为真实站点抓取请求配置统一代理出口。保存后，Syosetu 与 Syosetu18 的预览和任务抓取都会复用这份配置。
          </p>
        </div>
        <div className="badge-row">
          <span className={`status-badge ${draft.enabled ? 'state-running' : 'state-completed'}`}>
            {draft.enabled ? '代理已启用' : '当前直连'}
          </span>
          <span className={`status-badge ${validation?.ok ? 'ok' : 'state-failed'}`}>
            {validation ? (validation.ok ? '最近校验成功' : '最近校验失败') : '尚未校验'}
          </span>
        </div>
      </div>

      <div className="proxy-summary">
        <article className="card">
          <h3>当前出口</h3>
          <p>{proxySummary}</p>
        </article>
        <article className="card">
          <h3>绕过主机</h3>
          <p>{state?.config.bypassHosts.length ?? 0} 条规则</p>
        </article>
        <article className="card">
          <h3>最近探测</h3>
          <p>{validation?.checkedAt ?? '等待首次校验'}</p>
        </article>
      </div>

      <div className="proxy-grid">
        <label className="checkbox-field proxy-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>启用代理出站</span>
        </label>
        <label>
          <span>协议</span>
          <select
            value={draft.protocol}
            onChange={(event) =>
              setDraft((current) => ({ ...current, protocol: event.target.value as 'http' | 'https' }))
            }
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </label>
        <label>
          <span>主机</span>
          <input
            value={draft.host}
            onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
            placeholder="127.0.0.1"
          />
        </label>
        <label>
          <span>端口</span>
          <input
            type="number"
            min={1}
            value={draft.port}
            onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
            placeholder="7890"
          />
        </label>
        <label>
          <span>用户名</span>
          <input
            value={draft.username}
            onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            placeholder="可选"
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={draft.password}
            onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            placeholder="可选"
          />
        </label>
        <label className="proxy-span-full">
          <span>绕过主机列表</span>
          <textarea
            value={draft.bypassHosts}
            onChange={(event) => setDraft((current) => ({ ...current, bypassHosts: event.target.value }))}
            placeholder="localhost\n127.0.0.1\ninternal.example"
            rows={4}
          />
        </label>
        <label className="proxy-span-full">
          <span>校验目标地址</span>
          <input
            value={draft.targetUrl}
            onChange={(event) => setDraft((current) => ({ ...current, targetUrl: event.target.value }))}
            placeholder={DEFAULT_TARGET_URL}
          />
        </label>
      </div>

      <div className="card proxy-validation-card">
        <div className="split align-start">
          <div>
            <h3>链路状态</h3>
            <p className="panel-note">
              {validation
                ? `${validation.message} ${validation.statusCode ? `HTTP ${validation.statusCode} · ` : ''}${validation.latencyMs} ms`
                : '保存配置后可对目标地址发起探测，请先保存再校验。'}
            </p>
          </div>
          <div className="badge-row">
            <span className={`status-badge ${validation?.usingProxy ? 'state-running' : 'state-completed'}`}>
              {validation?.usingProxy ? '经代理探测' : '直连探测'}
            </span>
          </div>
        </div>
      </div>

      <div className="action-row wrap">
        <button type="button" className="secondary-button" onClick={handleSave} disabled={loading || saving || validating}>
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleValidate}
          disabled={loading || saving || validating || state === null || isDirty}
        >
          {validating ? '校验中...' : '校验链路'}
        </button>
      </div>

      {isDirty ? <p className="panel-note">表单存在未保存变更，校验按钮会在保存后恢复可用。</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}

function createEmptyDraft(): ProxyDraft {
  return {
    enabled: false,
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
    bypassHosts: '',
    targetUrl: DEFAULT_TARGET_URL,
  };
}

function createDraftFromPayload(payload: ControlNetworkProxyPayload): ProxyDraft {
  return {
    enabled: payload.config.enabled,
    protocol: payload.config.protocol,
    host: payload.config.host,
    port: payload.config.port ? String(payload.config.port) : '',
    username: payload.config.username,
    password: payload.config.password,
    bypassHosts: payload.config.bypassHosts.join('\n'),
    targetUrl: payload.validation?.targetUrl ?? DEFAULT_TARGET_URL,
  };
}

function toUpdateInput(draft: ProxyDraft): UpdateNetworkProxyInput {
  const trimmedPort = draft.port.trim();

  return {
    enabled: draft.enabled,
    protocol: draft.protocol,
    host: draft.host.trim(),
    port: trimmedPort.length > 0 ? Number(trimmedPort) : null,
    username: draft.username.trim(),
    password: draft.password.trim(),
    bypassHosts: splitBypassHosts(draft.bypassHosts),
  };
}

function splitBypassHosts(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isDraftDirty(draft: ProxyDraft, payload: ControlNetworkProxyPayload): boolean {
  const left = JSON.stringify(toUpdateInput(draft));
  const right = JSON.stringify({
    enabled: payload.config.enabled,
    protocol: payload.config.protocol,
    host: payload.config.host,
    port: payload.config.port,
    username: payload.config.username,
    password: payload.config.password,
    bypassHosts: payload.config.bypassHosts,
  } satisfies UpdateNetworkProxyInput);

  return left !== right;
}

function formatProxySummary(config: ControlNetworkProxyPayload['config'] | null): string {
  if (!config || !config.enabled || !config.isConfigured || config.port === null) {
    return '未启用代理，当前所有请求将直接出站。';
  }

  const credentials = config.username.length > 0 ? `${config.username}@` : '';
  return `${config.protocol}://${credentials}${config.host}:${config.port}`;
}