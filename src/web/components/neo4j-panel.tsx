import { startTransition, useEffect, useEffectEvent, useState } from 'react';

import {
  fetchNeo4jPreferences,
  updateNeo4jPreferences,
  validateNeo4jPreferences,
  type UpdateNeo4jInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import type { ControlNeo4jPayload } from '../../server/routes/control-center';

interface Neo4jPanelProps {
  onNotice?: (notice: NoticeInput) => void;
}

interface Neo4jDraft extends UpdateNeo4jInput {}

export function Neo4jPanel({ onNotice }: Neo4jPanelProps) {
  const [state, setState] = useState<ControlNeo4jPayload | null>(null);
  const [draft, setDraft] = useState<Neo4jDraft>(createEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hydrateState = useEffectEvent((payload: ControlNeo4jPayload) => {
    startTransition(() => {
      setState(payload);
      setDraft({
        enabled: payload.config.enabled,
        uri: payload.config.uri,
        username: payload.config.username,
        password: payload.config.password,
        database: payload.config.database,
      });
      setErrorMessage(null);
    });
  });

  useEffect(() => {
    let active = true;

    void fetchNeo4jPreferences()
      .then((payload) => {
        if (!active) {
          return;
        }

        hydrateState(payload);
      })
      .catch((error) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load Neo4j preferences.');
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
      const payload = await updateNeo4jPreferences({
        enabled: draft.enabled,
        uri: draft.uri.trim(),
        username: draft.username.trim(),
        password: draft.password.trim(),
        database: draft.database.trim(),
      });
      hydrateState(payload);
      onNotice?.({
        tone: 'success',
        title: 'Neo4j 配置已保存',
        message: payload.config.enabled ? '图数据库连接信息已更新。' : '图数据库连接已关闭。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save Neo4j preferences.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: 'Neo4j 配置保存失败', message });
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);

    try {
      const payload = await validateNeo4jPreferences();
      startTransition(() => {
        setState(payload);
        setErrorMessage(null);
      });
      onNotice?.({
        tone: payload.validation?.ok ? 'success' : 'error',
        title: 'Neo4j 连通性测试完成',
        message: payload.validation?.message ?? '图数据库探测已结束。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Neo4j validation failed.';
      setErrorMessage(message);
      onNotice?.({ tone: 'error', title: 'Neo4j 连通性测试失败', message });
    } finally {
      setValidating(false);
    }
  }

  const validation = state?.validation ?? null;
  const isDirty = state
    ? JSON.stringify(draft) !==
      JSON.stringify({
        enabled: state.config.enabled,
        uri: state.config.uri,
        username: state.config.username,
        password: state.config.password,
        database: state.config.database,
      })
    : false;

  return (
    <section className="panel neo4j-panel">
      <div className="panel-heading split align-start">
        <div>
          <p className="eyebrow">图数据库</p>
          <h2>配置 Neo4j 连接</h2>
          <p className="panel-note">
            用于后续的实体关系图谱和检索增强功能。保存后可以直接测试当前地址、账号和数据库是否可用。
          </p>
        </div>
        <div className="badge-row">
          <span className={`status-badge ${draft.enabled ? 'state-running' : 'state-completed'}`}>
            {draft.enabled ? '已启用' : '未启用'}
          </span>
          <span className={`status-badge ${validation?.ok ? 'ok' : 'state-failed'}`}>
            {validation ? (validation.ok ? '最近测试成功' : '最近测试失败') : '尚未测试'}
          </span>
        </div>
      </div>

      <div className="provider-summary">
        <article className="card">
          <h3>连接地址</h3>
          <p>{state?.config.uri || '尚未填写'}</p>
        </article>
        <article className="card">
          <h3>默认数据库</h3>
          <p>{state?.config.database || '使用服务器默认数据库'}</p>
        </article>
        <article className="card">
          <h3>最近探测</h3>
          <p>{validation?.checkedAt ?? '等待首次测试'}</p>
        </article>
      </div>

      <div className="neo4j-grid">
        <label className="checkbox-field proxy-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>启用 Neo4j</span>
        </label>
        <label>
          <span>连接 URI</span>
          <input
            value={draft.uri}
            onChange={(event) => setDraft((current) => ({ ...current, uri: event.target.value }))}
            placeholder="neo4j://127.0.0.1:7687"
          />
        </label>
        <label>
          <span>用户名</span>
          <input
            value={draft.username}
            onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            placeholder="neo4j"
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={draft.password}
            onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            placeholder="输入密码"
          />
        </label>
        <label className="span-full">
          <span>数据库名</span>
          <input
            value={draft.database}
            onChange={(event) => setDraft((current) => ({ ...current, database: event.target.value }))}
            placeholder="留空时使用服务器默认数据库"
          />
        </label>
      </div>

      <div className="card model-validation-card">
        <div className="split align-start">
          <div>
            <h3>连通性状态</h3>
            <p className="panel-note">
              {validation
                ? `${validation.message} ${validation.serverAgent ? `${validation.serverAgent} · ` : ''}${validation.latencyMs} ms`
                : '先保存配置，再测试图数据库是否可连通。'}
            </p>
          </div>
          <div className="badge-row">
            <span className={`status-badge ${state?.config.isConfigured ? 'state-completed' : 'state-failed'}`}>
              {state?.config.isConfigured ? '连接信息完整' : '连接信息未填完'}
            </span>
          </div>
        </div>
      </div>

      <div className="action-row wrap">
        <button type="button" className="secondary-button" onClick={handleSave} disabled={loading || saving || validating}>
          {saving ? '保存中...' : '保存 Neo4j 配置'}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleValidate}
          disabled={loading || saving || validating || state === null || isDirty}
        >
          {validating ? '测试中...' : '测试连接'}
        </button>
      </div>

      {isDirty ? <p className="panel-note">你有未保存的修改，先保存后才能测试连接。</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}

function createEmptyDraft(): Neo4jDraft {
  return {
    enabled: false,
    uri: '',
    username: '',
    password: '',
    database: '',
  };
}