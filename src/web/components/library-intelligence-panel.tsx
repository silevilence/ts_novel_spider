import { useEffect, useState } from 'react';

import type { AppLocation } from '../services/app-routes';
import {
  askLibraryAssistant,
  buildLibraryKnowledgeGraph,
  deleteLibraryKnowledgeGraph,
  fetchLlmProvidersPreferences,
  fetchNeo4jPreferences,
  updateLibraryKnowledgeGraphProfile,
  type UpdateKnowledgeGraphProfileInput,
} from '../services/api';
import type { NoticeInput } from '../services/control-center-model';
import type { ControlLlmProvidersPayload, ControlNeo4jPayload } from '../../server/routes/control-center';
import type { LibraryNovelDetailPayload } from '../../server/routes/library';

interface LibraryIntelligencePanelProps {
  detailPayload: LibraryNovelDetailPayload;
  location: AppLocation;
  onRefresh: () => Promise<void>;
  onNotify: (notice: NoticeInput) => void;
}

interface AssistantMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: 'llm' | 'local';
  sources?: Array<{ type: string; label: string; excerpt: string; chapterId: string | null }>;
  trace?: {
    usedEmbedding: boolean;
    usedRerank: boolean;
    graphHits: Array<{
      source: 'local' | 'neo4j';
      label: string;
      excerpt: string;
      score: number;
      chapterIds: string[];
      entityNames: string[];
      relationSummaries: string[];
    }>;
    chunkHits: Array<{
      chunkId: string;
      label: string;
      chapterId: string | null;
      excerpt: string;
      keywordScore: number;
      semanticScore: number;
      rerankScore: number | null;
      finalScore: number;
      selected: boolean;
    }>;
  };
}

interface GraphDraftState {
  chatModelKey: string;
  embeddingModelKey: string;
  rerankModelKey: string;
  neo4jOverrideEnabled: boolean;
  neo4jUri: string;
  neo4jUsername: string;
  neo4jPassword: string;
  neo4jDatabase: string;
}

interface GraphModelOption {
  key: string;
  label: string;
}

export function LibraryIntelligencePanel({
  detailPayload,
  location,
  onRefresh,
  onNotify,
}: LibraryIntelligencePanelProps) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessageItem[]>([]);
  const [llmPreferences, setLlmPreferences] = useState<ControlLlmProvidersPayload | null>(null);
  const [neo4jPreferences, setNeo4jPreferences] = useState<ControlNeo4jPayload | null>(null);
  const [graphDraft, setGraphDraft] = useState(() => createDraft(detailPayload));
  const [graphSaving, setGraphSaving] = useState(false);
  const [graphBuilding, setGraphBuilding] = useState(false);
  const [graphDeleting, setGraphDeleting] = useState(false);

  const detail = detailPayload.novel;
  const knowledgeGraph = detailPayload.knowledgeGraph;
  const build = knowledgeGraph.build;
  const graphModelOptions = llmPreferences ? {
    chat: buildGraphModelOptions(llmPreferences, 'chat'),
    embedding: buildGraphModelOptions(llmPreferences, 'embedding'),
    rerank: buildGraphModelOptions(llmPreferences, 'rerank'),
  } : {
    chat: [] as GraphModelOption[],
    embedding: [] as GraphModelOption[],
    rerank: [] as GraphModelOption[],
  };
  const currentChapterTitle = location.chapterId
    ? detail.chapters.find((chapter) => chapter.id === location.chapterId)?.title ?? null
    : null;

  useEffect(() => {
    setGraphDraft(createDraft(detailPayload));
  }, [detailPayload.knowledgeGraph.profile.updatedAt, detailPayload.knowledgeGraph.profile.lockedAt, detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    setAssistantMessages([]);
    setAssistantInput('');
    setAssistantOpen(false);
  }, [detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    void Promise.all([fetchLlmProvidersPreferences(), fetchNeo4jPreferences()])
      .then(([llmPayload, neo4jPayload]) => {
        setLlmPreferences(llmPayload);
        setNeo4jPreferences(neo4jPayload);
      })
      .catch(() => {
      });
  }, [detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    if (build.status !== 'queued' && build.status !== 'running') {
      return;
    }

    const pollId = window.setInterval(() => {
      void onRefresh();
    }, 2500);

    return () => {
      window.clearInterval(pollId);
    };
  }, [build.status, onRefresh]);

  async function handleSaveGraphProfile() {
    setGraphSaving(true);

    try {
      await updateLibraryKnowledgeGraphProfile(detail.sourceId, detail.metadata.novelId, buildGraphProfileInput(graphDraft));
      onNotify({
        tone: 'success',
        title: '图谱配置已保存',
        message: '这本书后续构图和检索会优先采用你刚才保存的专属配置。',
      });
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '图谱配置保存失败',
        message: error instanceof Error ? error.message : 'Graph profile update failed.',
      });
    } finally {
      setGraphSaving(false);
    }
  }

  async function handleBuildGraph() {
    setGraphBuilding(true);

    try {
      await buildLibraryKnowledgeGraph(detail.sourceId, detail.metadata.novelId);
      onNotify({
        tone: 'info',
        title: '图谱构建已启动',
        message: '后台正在分析章节内容，面板会自动刷新进度。',
      });
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '图谱构建启动失败',
        message: error instanceof Error ? error.message : 'Knowledge graph build failed.',
      });
    } finally {
      setGraphBuilding(false);
    }
  }

  async function handleAssistantSubmit() {
    const prompt = assistantInput.trim();
    if (prompt.length === 0 || assistantBusy) {
      return;
    }

    setAssistantBusy(true);
    setAssistantInput('');
    setAssistantMessages((current) => [...current, {
      id: cryptoRandomId(),
      role: 'user',
      content: prompt,
    }]);

    try {
      const payload = await askLibraryAssistant(
        detail.sourceId,
        detail.metadata.novelId,
        prompt,
        location.view === 'reader' ? location.chapterId ?? undefined : undefined,
      );

      setAssistantMessages((current) => [...current, {
        id: cryptoRandomId(),
        role: 'assistant',
        content: payload.reply.message,
        mode: payload.reply.mode,
        sources: payload.reply.sources,
        trace: payload.reply.trace,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assistant chat failed.';
      setAssistantMessages((current) => [...current, {
        id: cryptoRandomId(),
        role: 'assistant',
        content: `请求失败：${message}`,
        mode: 'local',
      }]);
      onNotify({
        tone: 'error',
        title: 'AI 伴读请求失败',
        message,
      });
    } finally {
      setAssistantBusy(false);
    }
  }

  async function handleDeleteGraph() {
    if (graphDeleting || build.status === 'queued' || build.status === 'running') {
      return;
    }

    const confirmed = window.confirm('这会清空本地图谱数据，并尝试删除 Neo4j 里的对应子图。确认继续吗？');
    if (!confirmed) {
      return;
    }

    setGraphDeleting(true);

    try {
      await deleteLibraryKnowledgeGraph(detail.sourceId, detail.metadata.novelId);
      onNotify({
        tone: 'success',
        title: '图谱已清空',
        message: '本地结果已经清掉；如果当前书曾同步到 Neo4j，也会一并清理。',
      });
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '图谱清空失败',
        message: error instanceof Error ? error.message : 'Knowledge graph clear failed.',
      });
    } finally {
      setGraphDeleting(false);
    }
  }

  return (
    <>
      {location.view === 'detail' ? (
        <section className="panel intelligence-panel">
          <div className="panel-heading split align-start">
            <div>
              <p className="eyebrow">知识图谱</p>
              <h2>实体关系图谱</h2>
              <p className="panel-note">
                这本书可以挂自己的模型链路和 Neo4j 目标。图谱一旦构建完成，配置会自动锁定，避免后续结果和当前图谱不一致。
              </p>
            </div>
            <div className="badge-row intelligence-status-row">
              <span className={`status-badge state-${build.status}`}>{formatGraphStatus(build.status)}</span>
              <span className="status-badge state-downloaded">阶段 {formatGraphStage(build.stage)}</span>
              {knowledgeGraph.profile.configLocked ? <span className="status-badge ok">配置已锁定</span> : null}
            </div>
          </div>

          <div className="route-summary-strip intelligence-summary-strip">
            <article className="summary-tile">
              <span className="label">实体</span>
              <strong>{build.entityCount}</strong>
            </article>
            <article className="summary-tile">
              <span className="label">关系</span>
              <strong>{build.relationCount}</strong>
            </article>
            <article className="summary-tile">
              <span className="label">Neo4j</span>
              <strong>{knowledgeGraph.profile.neo4j.source === 'novel' ? '本书专用' : knowledgeGraph.profile.neo4j.source === 'global' ? '沿用全局' : '未启用'}</strong>
            </article>
          </div>

          <div className="card intelligence-build-card">
            <div className="panel-heading compact-heading">
              <div>
                <p className="label">当前状态</p>
                <strong>{build.message}</strong>
              </div>
              <span className="panel-note">进度 {build.progressPercent}%</span>
            </div>
            <p className="panel-note">
              {build.errorMessage
                ? build.errorMessage
                : build.lastBuiltAt
                  ? `最近完成于 ${new Date(build.lastBuiltAt).toLocaleString('zh-CN')}`
                  : '还没有生成过图谱。'}
            </p>
            <div className="badge-row intelligence-build-meta">
              {build.startedAt ? <span className="status-badge state-indexed">开始于 {new Date(build.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> : null}
              {build.updatedAt ? <span className="status-badge state-idle">最近更新 {new Date(build.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> : null}
              {build.errorMessage ? <span className="status-badge danger">已记录失败原因</span> : null}
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${build.progressPercent}%` }} />
            </div>
            <div className="intelligence-log-panel">
              <div className="assistant-trace-heading split">
                <span className="label">构建日志</span>
                <span className="panel-note">自动刷新最近步骤和失败原因</span>
              </div>
              {knowledgeGraph.buildLogs.length === 0 ? (
                <p className="panel-note">还没有构建日志。启动生成后，这里会显示每个阶段的进展。</p>
              ) : (
                <div className="intelligence-log-list">
                  {knowledgeGraph.buildLogs.slice(-10).map((log) => (
                    <article key={log.id} className={`intelligence-log-item ${log.level}`}>
                      <div className="intelligence-log-head">
                        <span className={`status-badge ${log.level === 'error' ? 'danger' : log.level === 'warn' ? 'state-queued' : 'state-indexed'}`}>
                          {formatBuildLogLevel(log.level)}
                        </span>
                        <span className="panel-note">{formatGraphStage(log.stage)} · {new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      </div>
                      <p>{log.message}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="intelligence-grid">
            <section className="card intelligence-config-card">
              <div className="panel-heading split align-start compact-heading">
                <div>
                  <p className="label">单书配置</p>
                  <h3>模型与图库路由</h3>
                </div>
                <span className="panel-note">空着就沿用全局默认</span>
              </div>

              <div className="intelligence-config-grid">
                <label>
                  <span>对话模型</span>
                  <select
                    value={graphDraft.chatModelKey}
                    onChange={(event) => setGraphDraft((current) => ({ ...current, chatModelKey: event.target.value }))}
                    disabled={knowledgeGraph.profile.configLocked}
                  >
                    <option value="">沿用全局默认</option>
                    {graphModelOptions.chat.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>向量模型</span>
                  <select
                    value={graphDraft.embeddingModelKey}
                    onChange={(event) => setGraphDraft((current) => ({ ...current, embeddingModelKey: event.target.value }))}
                    disabled={knowledgeGraph.profile.configLocked}
                  >
                    <option value="">沿用全局默认</option>
                    {graphModelOptions.embedding.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>重排序模型</span>
                  <select
                    value={graphDraft.rerankModelKey}
                    onChange={(event) => setGraphDraft((current) => ({ ...current, rerankModelKey: event.target.value }))}
                    disabled={knowledgeGraph.profile.configLocked}
                  >
                    <option value="">沿用全局默认</option>
                    {graphModelOptions.rerank.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={graphDraft.neo4jOverrideEnabled}
                  onChange={(event) => setGraphDraft((current) => ({ ...current, neo4jOverrideEnabled: event.target.checked }))}
                  disabled={knowledgeGraph.profile.configLocked}
                />
                <span>给这本书单独指定 Neo4j 连接</span>
              </label>

              {graphDraft.neo4jOverrideEnabled ? (
                <div className="neo4j-grid intelligence-config-grid">
                  <label>
                    <span>Neo4j 地址</span>
                    <input
                      value={graphDraft.neo4jUri}
                      onChange={(event) => setGraphDraft((current) => ({ ...current, neo4jUri: event.target.value }))}
                      placeholder={neo4jPreferences?.config.uri || 'neo4j://127.0.0.1:7687'}
                      disabled={knowledgeGraph.profile.configLocked}
                    />
                  </label>
                  <label>
                    <span>用户名</span>
                    <input
                      value={graphDraft.neo4jUsername}
                      onChange={(event) => setGraphDraft((current) => ({ ...current, neo4jUsername: event.target.value }))}
                      placeholder={neo4jPreferences?.config.username || 'neo4j'}
                      disabled={knowledgeGraph.profile.configLocked}
                    />
                  </label>
                  <label>
                    <span>密码</span>
                    <input
                      type="password"
                      value={graphDraft.neo4jPassword}
                      onChange={(event) => setGraphDraft((current) => ({ ...current, neo4jPassword: event.target.value }))}
                      placeholder="可留空沿用当前值"
                      disabled={knowledgeGraph.profile.configLocked}
                    />
                  </label>
                  <label>
                    <span>数据库</span>
                    <input
                      value={graphDraft.neo4jDatabase}
                      onChange={(event) => setGraphDraft((current) => ({ ...current, neo4jDatabase: event.target.value }))}
                      placeholder={neo4jPreferences?.config.database || 'neo4j'}
                      disabled={knowledgeGraph.profile.configLocked}
                    />
                  </label>
                </div>
              ) : null}

              <div className="action-row wrap">
                <button type="button" className="ghost-button" onClick={() => void handleSaveGraphProfile()} disabled={graphSaving || knowledgeGraph.profile.configLocked}>
                  {graphSaving ? '保存中...' : knowledgeGraph.profile.configLocked ? '配置已锁定' : '保存单书配置'}
                </button>
                <button type="button" className="primary-button" onClick={() => void handleBuildGraph()} disabled={graphBuilding || build.status === 'queued' || build.status === 'running'}>
                  {graphBuilding || build.status === 'queued' || build.status === 'running' ? '构建中...' : build.lastBuiltAt ? '重新生成图谱' : '开始生成图谱'}
                </button>
                <button type="button" className="ghost-button danger" onClick={() => void handleDeleteGraph()} disabled={graphDeleting || build.status === 'queued' || build.status === 'running'}>
                  {graphDeleting ? '清空中...' : '清空图谱'}
                </button>
              </div>
            </section>

            <section className="card intelligence-list-card">
              <div className="panel-heading compact-heading">
                <div>
                  <p className="label">图谱实体</p>
                  <h3>高频实体</h3>
                </div>
              </div>
              {knowledgeGraph.entities.length === 0 ? (
                <p className="panel-note">当前还没有实体，先生成一次图谱。</p>
              ) : (
                <div className="intelligence-list">
                  {knowledgeGraph.entities.slice(0, 8).map((entity) => (
                    <article key={entity.id} className="intelligence-list-item">
                      <div>
                        <strong>{entity.name}</strong>
                        <p>{entity.summary}</p>
                      </div>
                      <span className="status-badge state-indexed">{entity.mentionCount} 次</span>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="card intelligence-list-card">
              <div className="panel-heading compact-heading">
                <div>
                  <p className="label">图谱关系</p>
                  <h3>主要关系</h3>
                </div>
              </div>
              {knowledgeGraph.relations.length === 0 ? (
                <p className="panel-note">当前还没有关系，生成后会按证据强度排序展示。</p>
              ) : (
                <div className="intelligence-list">
                  {knowledgeGraph.relations.slice(0, 8).map((relation) => (
                    <article key={relation.id} className="intelligence-list-item">
                      <div>
                        <strong>{relation.summary}</strong>
                        <p>{relation.evidence[0] ?? '暂无证据摘要。'}</p>
                      </div>
                      <span className="status-badge ok">权重 {relation.weight}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="assistant-fab"
        onClick={() => setAssistantOpen(true)}
        aria-label="打开 AI 伴读面板"
      >
        伴读
      </button>

      {assistantOpen ? (
        <div className="reader-directory-overlay assistant-overlay" role="presentation" onClick={() => setAssistantOpen(false)}>
          <aside className="assistant-drawer" role="dialog" aria-modal="true" aria-label="AI 伴读面板" onClick={(event) => event.stopPropagation()}>
            <div className="reader-directory-drawer-header assistant-header">
              <div>
                <p className="eyebrow">AI 伴读</p>
                <h2>阅读助手</h2>
                <p className="panel-note">
                  {location.view === 'reader'
                    ? `当前章节 ${currentChapterTitle ?? location.chapterId ?? '未命名章节'} 会自动带入上下文。`
                    : '当前会自动带入书籍元数据、图谱摘要和相关章节线索。'}
                </p>
              </div>
              <button type="button" className="ghost-button reader-directory-close" onClick={() => setAssistantOpen(false)}>
                关闭
              </button>
            </div>

            <div className="assistant-thread">
              {assistantMessages.length === 0 ? (
                <div className="empty-state compact assistant-empty-state">
                  <p>试着问人物关系、当前剧情、某个角色最近做了什么，或者让它帮你总结当前章节。</p>
                </div>
              ) : (
                assistantMessages.map((message) => (
                  <article key={message.id} className={`assistant-message ${message.role}`}>
                    <p className="label">{message.role === 'user' ? '你' : message.mode === 'llm' ? 'AI' : '本地整理'}</p>
                    <strong>{message.content}</strong>
                    {message.sources && message.sources.length > 0 ? (
                      <div className="assistant-source-list">
                        {message.sources.slice(0, 3).map((source, index) => (
                          <div key={`${message.id}-${source.label}-${index}`} className="assistant-source-item">
                            <span className="status-badge state-indexed">{source.type}</span>
                            <p>{source.label}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {message.trace ? (
                      <div className="assistant-trace">
                        <div className="assistant-trace-meta">
                          <span className={`status-badge ${message.trace.usedEmbedding ? 'ok' : 'state-idle'}`}>
                            {message.trace.usedEmbedding ? '已走向量召回' : '未走向量召回'}
                          </span>
                          <span className={`status-badge ${message.trace.usedRerank ? 'ok' : 'state-idle'}`}>
                            {message.trace.usedRerank ? '已重排' : '未重排'}
                          </span>
                        </div>

                        {message.trace.graphHits.length > 0 ? (
                          <section className="assistant-trace-section">
                            <div className="assistant-trace-heading split">
                              <span className="label">命中子图</span>
                              <span className="panel-note">图谱与 Neo4j 结果</span>
                            </div>
                            <div className="assistant-trace-list">
                              {message.trace.graphHits.slice(0, 4).map((hit, index) => (
                                <article key={`${message.id}-graph-${index}`} className={`assistant-trace-item ${hit.source}`}>
                                  <div className="assistant-trace-item-head">
                                    <span className={`status-badge ${hit.source === 'neo4j' ? 'ok' : 'state-indexed'}`}>
                                      {hit.source === 'neo4j' ? 'Neo4j' : '本地'}
                                    </span>
                                    <span className="assistant-trace-score">得分 {hit.score.toFixed(2)}</span>
                                  </div>
                                  <strong>{hit.label}</strong>
                                  <p>{hit.excerpt}</p>
                                </article>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        {message.trace.chunkHits.length > 0 ? (
                          <section className="assistant-trace-section">
                            <div className="assistant-trace-heading split">
                              <span className="label">片段候选</span>
                              <span className="panel-note">最终被送进回答的片段会高亮</span>
                            </div>
                            <div className="assistant-trace-list">
                              {message.trace.chunkHits.slice(0, 5).map((hit) => (
                                <article key={hit.chunkId} className={`assistant-trace-item chunk-hit${hit.selected ? ' selected' : ''}`}>
                                  <div className="assistant-trace-item-head">
                                    <span className={`status-badge ${hit.selected ? 'ok' : 'state-idle'}`}>
                                      {hit.selected ? '已采用' : '候选'}
                                    </span>
                                    <span className="assistant-trace-score">最终 {hit.finalScore.toFixed(2)}</span>
                                  </div>
                                  <strong>{hit.label}</strong>
                                  <p>{hit.excerpt}</p>
                                  <div className="assistant-score-grid">
                                    <span>关键词 {hit.keywordScore.toFixed(2)}</span>
                                    <span>向量 {hit.semanticScore.toFixed(2)}</span>
                                    <span>重排 {hit.rerankScore === null ? '未用' : hit.rerankScore.toFixed(2)}</span>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </section>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <div className="assistant-composer">
              <textarea
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                placeholder="例如：艾琳和莱昂现在更像同伴还是盟友？"
              />
              <div className="action-row wrap compact-actions">
                <button type="button" className="ghost-button" onClick={() => setAssistantMessages([])} disabled={assistantBusy || assistantMessages.length === 0}>
                  清空对话
                </button>
                <button type="button" className="primary-button" onClick={() => void handleAssistantSubmit()} disabled={assistantBusy || assistantInput.trim().length === 0}>
                  {assistantBusy ? '发送中...' : '发送问题'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function createDraft(detailPayload: LibraryNovelDetailPayload): GraphDraftState {
  const profile = detailPayload.knowledgeGraph.profile;
  return {
    chatModelKey: profile.chatModel ? `${profile.chatModel.providerId}::${profile.chatModel.modelId}` : '',
    embeddingModelKey: profile.embeddingModel ? `${profile.embeddingModel.providerId}::${profile.embeddingModel.modelId}` : '',
    rerankModelKey: profile.rerankModel ? `${profile.rerankModel.providerId}::${profile.rerankModel.modelId}` : '',
    neo4jOverrideEnabled: profile.neo4j.source === 'novel',
    neo4jUri: profile.neo4j.source === 'novel' ? profile.neo4j.uri : '',
    neo4jUsername: profile.neo4j.source === 'novel' ? profile.neo4j.username : '',
    neo4jPassword: '',
    neo4jDatabase: profile.neo4j.source === 'novel' ? profile.neo4j.database : '',
  };
}

function buildGraphModelOptions(
  payload: ControlLlmProvidersPayload,
  capability: 'chat' | 'embedding' | 'rerank',
): GraphModelOption[] {
  return payload.providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.enabled && model.resolvedCapabilities.includes(capability))
      .map((model) => ({
        key: `${provider.id}::${model.id}`,
        label: `${provider.label} / ${model.label}`,
      })),
  );
}

function buildGraphProfileInput(draft: GraphDraftState): UpdateKnowledgeGraphProfileInput {
  return {
    chatModel: parseRouteKey(draft.chatModelKey),
    embeddingModel: parseRouteKey(draft.embeddingModelKey),
    rerankModel: parseRouteKey(draft.rerankModelKey),
    neo4j: draft.neo4jOverrideEnabled
      ? {
          enabled: true,
          uri: draft.neo4jUri,
          username: draft.neo4jUsername,
          password: draft.neo4jPassword,
          database: draft.neo4jDatabase,
        }
      : {
          enabled: false,
        },
  };
}

function parseRouteKey(key: string): { providerId?: string; modelId?: string } | null {
  if (!key) {
    return null;
  }

  const [providerId, modelId] = key.split('::');
  return {
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

function formatGraphStatus(status: string): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '构建中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '未开始';
  }
}

function formatGraphStage(stage: string): string {
  switch (stage) {
    case 'extracting':
      return '抽取实体';
    case 'relating':
      return '归并关系';
    case 'syncing':
      return '同步 Neo4j';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return '待启动';
  }
}

function formatBuildLogLevel(level: 'info' | 'warn' | 'error'): string {
  switch (level) {
    case 'warn':
      return '警告';
    case 'error':
      return '错误';
    default:
      return '进度';
  }
}

function cryptoRandomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}