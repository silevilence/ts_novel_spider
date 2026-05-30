import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Badge, Button, Group, Paper, Progress, ScrollArea, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import type { AppLocation } from '../services/app-routes';
import {
  askLibraryAssistant,
  buildLibraryKnowledgeGraph,
  deleteLibraryKnowledgeGraph,
  fetchLlmProvidersPreferences,
  fetchNeo4jPreferences,
  pauseLibraryKnowledgeGraph,
  resumeLibraryKnowledgeGraph,
  syncLibraryKnowledgeGraphToNeo4j,
  updateLibraryKnowledgeGraphProfile,
  type LibraryKnowledgeGraphBuildMode,
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
  extractionModelEntries: Array<{ key: string; maxConcurrency: number }>;
  embeddingModelKey: string;
  rerankModelKey: string;
  extractionConcurrency: number;
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

interface GraphPreviewDialogState {
  title: string;
  subtitle: string;
  body: string[];
}

type GraphEntity = LibraryNovelDetailPayload['knowledgeGraph']['entities'][number];
type GraphRelation = LibraryNovelDetailPayload['knowledgeGraph']['relations'][number];

interface GraphExplorerNode {
  entity: GraphEntity;
  x: number;
  y: number;
  size: number;
  matched: boolean;
  focused: boolean;
}

interface GraphExplorerEdge {
  relation: GraphRelation;
  fromNode: GraphExplorerNode;
  toNode: GraphExplorerNode;
  matched: boolean;
  primary: boolean;
}

interface GraphExplorerState {
  nodes: GraphExplorerNode[];
  edges: GraphExplorerEdge[];
  focusEntity: GraphEntity | null;
  focusRelations: GraphRelation[];
  spotlightEntities: GraphEntity[];
  spotlightRelations: GraphRelation[];
  spotlightChapters: string[];
  emptyMessage: string;
  summaryMessage: string;
}

interface GraphViewportState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

type GraphDragState =
  | {
      kind: 'pan';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      originOffsetX: number;
      originOffsetY: number;
    }
  | {
      kind: 'node';
      pointerId: number;
      nodeId: string;
      startClientX: number;
      startClientY: number;
      originNodeX: number;
      originNodeY: number;
    };

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
  const [graphPausing, setGraphPausing] = useState(false);
  const [graphResuming, setGraphResuming] = useState(false);
  const [graphSyncing, setGraphSyncing] = useState(false);
  const [graphDeleting, setGraphDeleting] = useState(false);
  const [graphProgressExpanded, setGraphProgressExpanded] = useState(() => shouldExpandBuildProgress(detailPayload.knowledgeGraph.build.status));
  const [configExpanded, setConfigExpanded] = useState(false);
  const [graphBrowserExpanded, setGraphBrowserExpanded] = useState(true);
  const [graphPreview, setGraphPreview] = useState<GraphPreviewDialogState | null>(null);
  const [graphSearchInput, setGraphSearchInput] = useState('');
  const deferredGraphSearchInput = useDeferredValue(graphSearchInput);
  const [graphFocusEntityId, setGraphFocusEntityId] = useState<string | null>(null);

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
  const buildModelLabels = llmPreferences ? buildLlmModelLabelMap(llmPreferences) : new Map<string, string>();
  const currentChapterTitle = location.chapterId
    ? detail.chapters.find((chapter) => chapter.id === location.chapterId)?.title ?? null
    : null;
  const graphExplorer = buildGraphExplorerState(knowledgeGraph, deferredGraphSearchInput, graphFocusEntityId);

  useEffect(() => {
    setGraphDraft(createDraft(detailPayload));
  }, [detailPayload.knowledgeGraph.profile.updatedAt, detailPayload.knowledgeGraph.profile.lockedAt, detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    setAssistantMessages([]);
    setAssistantInput('');
    setAssistantOpen(false);
  }, [detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    setGraphPreview(null);
  }, [detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    setGraphSearchInput('');
    setGraphFocusEntityId(null);
  }, [detail.sourceId, detail.metadata.novelId]);

  useEffect(() => {
    if (graphFocusEntityId && !knowledgeGraph.entities.some((entity) => entity.id === graphFocusEntityId)) {
      setGraphFocusEntityId(null);
    }
  }, [graphFocusEntityId, knowledgeGraph.entities]);

  useEffect(() => {
    setGraphProgressExpanded(shouldExpandBuildProgress(build.status));
  }, [build.status]);

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

  async function handleBuildGraph(mode: LibraryKnowledgeGraphBuildMode) {
    setGraphBuilding(true);

    try {
      await buildLibraryKnowledgeGraph(detail.sourceId, detail.metadata.novelId, mode);
      onNotify({
        tone: 'info',
        title: formatBuildActionTitle(mode),
        message: formatBuildActionMessage(mode),
      });
      setGraphProgressExpanded(true);
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: formatBuildActionFailureTitle(mode),
        message: error instanceof Error ? error.message : 'Knowledge graph build failed.',
      });
    } finally {
      setGraphBuilding(false);
    }
  }

  async function handlePauseGraph() {
    if (graphPausing || (build.status !== 'queued' && build.status !== 'running')) {
      return;
    }

    setGraphPausing(true);

    try {
      await pauseLibraryKnowledgeGraph(detail.sourceId, detail.metadata.novelId);
      onNotify({
        tone: 'info',
        title: '已请求暂停图谱构建',
        message: '系统会先收尾当前片段，随后停在可继续的位置。',
      });
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '暂停图谱失败',
        message: error instanceof Error ? error.message : 'Knowledge graph pause failed.',
      });
    } finally {
      setGraphPausing(false);
    }
  }

  async function handleResumeGraph() {
    if (graphResuming || build.status !== 'paused') {
      return;
    }

    setGraphResuming(true);

    try {
      await resumeLibraryKnowledgeGraph(detail.sourceId, detail.metadata.novelId);
      onNotify({
        tone: 'info',
        title: '图谱构建已继续',
        message: '剩余片段会按你当前保存的配置继续处理。',
      });
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: '继续图谱失败',
        message: error instanceof Error ? error.message : 'Knowledge graph resume failed.',
      });
    } finally {
      setGraphResuming(false);
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

  async function handleSyncToNeo4j() {
    if (graphSyncing || buildRunning) {
      return;
    }

    setGraphSyncing(true);

    try {
      const result = await syncLibraryKnowledgeGraphToNeo4j(detail.sourceId, detail.metadata.novelId);
      onNotify({
        tone: 'success',
        title: '已同步到 Neo4j',
        message: result.message,
      });
      await onRefresh();
    } catch (error) {
      onNotify({
        tone: 'error',
        title: 'Neo4j 同步失败',
        message: error instanceof Error ? error.message : 'Neo4j sync failed.',
      });
    } finally {
      setGraphSyncing(false);
    }
  }

  function handlePreviewEntity(entity: GraphEntity) {
    setGraphPreview(buildEntityPreview(entity));
  }

  function handlePreviewRelation(relation: GraphRelation) {
    setGraphPreview(buildRelationPreview(relation));
  }

  const buildBusy = graphBuilding || graphPausing || graphResuming || graphSyncing;
  const buildRunning = build.status === 'queued' || build.status === 'running';
  const buildStartDisabled = buildBusy || buildRunning || build.status === 'paused';
  const graphNamespace = `${knowledgeGraph.namespace}:${knowledgeGraph.entities.length}:${knowledgeGraph.relations.length}:${build.updatedAt ?? 'idle'}`;
  const topEntities = sortEntitiesForGraph(knowledgeGraph.entities).slice(0, 5);
  const topRelations = sortRelationsForGraph(knowledgeGraph.relations, new Set<string>(), graphFocusEntityId).slice(0, 5);
  const focusEntity = graphExplorer.focusEntity;

  return (
    <>
      {location.view === 'detail' ? (
        <section className="panel intelligence-panel">
          <section className={`card ${graphProgressExpanded ? 'intelligence-hero-expanded' : 'intelligence-hero'}`}>
            <div className="panel-heading split align-start">
              <div>
                <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>知识图谱</Text>
                <Title order={3}>实体关系图谱</Title>
                <p className="panel-note">
                  支持增量更新、关系重建和全量重跑。下方关系图可拖拽、缩放、联动检索，也能放大到弹窗里单独操作。
                </p>
              </div>
              <div className="badge-row intelligence-status-row wrap compact-actions">
                <Badge variant="light" color={build.status === 'completed' ? 'green' : build.status === 'failed' ? 'red' : build.status === 'running' ? 'blue' : 'gray'} size="sm">{formatGraphStatus(build.status)}</Badge>
                <Badge variant="light" color="gray" size="sm">阶段 {formatGraphStage(build.stage)}</Badge>
                {knowledgeGraph.profile.configLocked ? <Badge variant="light" color="green" size="sm">配置已锁定</Badge> : null}
                <Badge variant="light" color="gray" size="sm">实体 {knowledgeGraph.entities.length}</Badge>
                <Badge variant="light" color="gray" size="sm">关系 {knowledgeGraph.relations.length}</Badge>
              </div>
            </div>

            <div className="intelligence-progress-overview">
              {graphProgressExpanded ? (
              <>
              <div className="intelligence-progress-summary-grid">
                <article className="summary-tile">
                  <span className="label">进度</span>
                  <strong>{build.progressPercent}%</strong>
                  <p>{build.message || '等待任务启动'}</p>
                </article>
                <article className="summary-tile">
                  <span className="label">最近更新</span>
                  <strong>{build.updatedAt ? new Date(build.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '未开始'}</strong>
                  <p>{build.startedAt ? `开始于 ${new Date(build.startedAt).toLocaleString('zh-CN')}` : '还没有生成记录。'}</p>
                </article>
                <article className="summary-tile">
                  <span className="label">当前阶段</span>
                  <strong>{formatGraphStage(build.stage)}</strong>
                  <p>{build.lastBuiltAt ? `最近完成于 ${new Date(build.lastBuiltAt).toLocaleString('zh-CN')}` : '等待首次构建。'}</p>
                </article>
                <article className="summary-tile">
                  <span className="label">Neo4j</span>
                  <strong>
                    {knowledgeGraph.profile.neo4j.source === 'novel'
                      ? '本书专用'
                      : knowledgeGraph.profile.neo4j.source === 'global'
                        ? '沿用全局'
                        : '未启用'}
                  </strong>
                  <p>
                    {knowledgeGraph.profile.neo4j.source === 'novel'
                      ? knowledgeGraph.profile.neo4j.uri
                      : knowledgeGraph.profile.neo4j.source === 'global'
                        ? '使用系统里的 Neo4j 配置。'
                        : '当前未单独指定图库连接。'}
                  </p>
                </article>
              </div>

              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${build.progressPercent}%` }} />
              </div>
              </>
              ) : null}

              <div className="action-row wrap compact-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setGraphProgressExpanded((current) => !current)}
                >
                  {graphProgressExpanded ? '收起进度详情' : '展开进度详情'}
                </button>
                {buildRunning ? (
                  <button type="button" className="ghost-button" onClick={() => void handlePauseGraph()} disabled={graphPausing}>
                    {graphPausing ? '暂停中...' : '暂停构建'}
                  </button>
                ) : null}
                {build.status === 'paused' ? (
                  <button type="button" className="primary-button" onClick={() => void handleResumeGraph()} disabled={graphResuming}>
                    {graphResuming ? '继续中...' : '继续构建'}
                  </button>
                ) : null}
              </div>

              {graphProgressExpanded ? (
                <div className="intelligence-progress-drawer">
                  {build.modelStats.length > 0 ? (
                    <div className="intelligence-log-panel">
                      <div className="assistant-trace-heading split">
                        <span className="label">抽取模型表现</span>
                        <span className="panel-note">看每个模型当前跑得快不快、稳不稳。</span>
                      </div>
                      <div className="intelligence-model-grid">
                        {build.modelStats.map((stat) => (
                          <article key={`${stat.providerId}::${stat.modelId}`} className="intelligence-model-card">
                            <div className="intelligence-log-head">
                              <strong>{formatBuildModelLabel(buildModelLabels, stat.providerId, stat.modelId)}</strong>
                              <div className="badge-row wrap compact-actions">
                                <span className={`status-badge ${stat.circuitState === 'open' ? 'danger' : stat.circuitState === 'half-open' ? 'state-queued' : 'ok'}`}>
                                  {formatGraphCircuitState(stat.circuitState)}
                                </span>
                                <span className="status-badge state-idle">{formatModelSource(stat.source)}</span>
                              </div>
                            </div>
                            <div className="assistant-score-grid intelligence-model-metrics">
                              <span>吞吐 {formatThroughputPerMinute(stat.throughputPerMinute)}</span>
                              <span>失败率 {formatFailureRate(stat.failureRate)}</span>
                              <span>进行中 {stat.inFlightCount}</span>
                            </div>
                            <div className="assistant-score-grid intelligence-model-metrics">
                              <span>成功 {stat.llmSuccessCount}</span>
                              <span>失败 {stat.failureCount}</span>
                              <span>接盘 {stat.handoffInCount}</span>
                              <span>转派 {stat.handoffOutCount}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="intelligence-log-panel">
                    <div className="assistant-trace-heading split">
                      <span className="label">构建日志</span>
                      <span className="panel-note">自动刷新最近步骤和失败原因</span>
                    </div>
                    {knowledgeGraph.buildLogs.length === 0 ? (
                      <p className="panel-note">还没有构建日志。启动生成后，这里会显示每个阶段的进展。</p>
                    ) : (
                      <div className="intelligence-log-list intelligence-build-log-list">
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
                    {build.errorMessage ? <p className="panel-note">失败原因：{build.errorMessage}</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <div className="intelligence-grid">
            <section className="card intelligence-graph-card">
              <div className="panel-heading compact-heading split align-start">
                <div>
                  <p className="label">图谱浏览</p>
                  <h3>关系图与检索</h3>
                  <p className="panel-note">按人物、地点、别名、关系证据或章节线索搜索。点节点可聚焦，双击可展开详情。</p>
                </div>
                <div className="badge-row wrap compact-actions graph-stat-row">
                  <span className="status-badge state-indexed">实体 {knowledgeGraph.entities.length}</span>
                  <span className="status-badge ok">关系 {knowledgeGraph.relations.length}</span>
                  <span className="status-badge state-idle">当前可见 {graphExplorer.nodes.length}/{graphExplorer.edges.length}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setGraphBrowserExpanded((current) => !current)}
                  >
                    {graphBrowserExpanded ? '收起' : '展开'}
                  </button>
                </div>
              </div>

              {graphBrowserExpanded ? (
              <>
              <div className="graph-build-actions">
                <article className="graph-action-tile">
                  <p className="label">增量更新</p>
                  <strong className="graph-action-title">只补新增或已改章节</strong>
                  <p className="graph-action-note">优先复用现有结构缓存，不用把整本书重新抽一遍。</p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleBuildGraph('incremental')}
                    disabled={buildStartDisabled}
                  >
                    {graphBuilding || buildRunning
                      ? '处理中...'
                      : build.status === 'paused'
                        ? '请先继续当前任务'
                        : build.lastBuiltAt
                          ? '开始增量更新'
                          : '开始生成图谱'}
                  </button>
                </article>
                <article className="graph-action-tile">
                  <p className="label">关系重建</p>
                  <strong className="graph-action-title">重算实体与关系</strong>
                  <p className="graph-action-note">直接基于已缓存的结构结果归并，不重新跑章节结构抽取。</p>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleBuildGraph('rebuild')}
                    disabled={buildStartDisabled}
                  >
                    重算实体与关系
                  </button>
                </article>
                <article className="graph-action-tile">
                  <p className="label">全量重跑</p>
                  <strong className="graph-action-title">从头重新提取</strong>
                  <p className="graph-action-note">清掉旧缓存和旧结构，重新跑完整抽取链路，适合大改配置后使用。</p>
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={() => void handleBuildGraph('full')}
                    disabled={buildStartDisabled}
                  >
                    全量重做
                  </button>
                </article>
                {knowledgeGraph.entities.length > 0 ? (
                <article className="graph-action-tile">
                  <p className="label">Neo4j 同步</p>
                  <strong className="graph-action-title">推送到远端图数据库</strong>
                  <p className="graph-action-note">将本地已生成的图谱同步到 Neo4j（需先在偏好中配置连接信息）。</p>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleSyncToNeo4j()}
                    disabled={buildBusy || buildRunning}
                  >
                    {graphSyncing ? '同步中...' : '手动同步到 Neo4j'}
                  </button>
                </article>
                ) : null}
              </div>

              <p className="panel-note graph-status-copy">
                {build.status === 'paused'
                  ? '当前任务已经暂停。若想继续当前构建，请先点击“继续构建”；若想换模式，先清空当前图谱。'
                  : build.message || graphExplorer.summaryMessage}
              </p>

              <KnowledgeGraphWorkspace
                namespace={graphNamespace}
                graphExplorer={graphExplorer}
                totalEntityCount={knowledgeGraph.entities.length}
                totalRelationCount={knowledgeGraph.relations.length}
                topEntities={topEntities}
                topRelations={topRelations}
                searchInput={graphSearchInput}
                onSearchInputChange={setGraphSearchInput}
                onClearSearch={() => setGraphSearchInput('')}
                onClearFocus={() => setGraphFocusEntityId(null)}
                onFocusEntityIdChange={setGraphFocusEntityId}
                onPreviewEntity={handlePreviewEntity}
                onPreviewRelation={handlePreviewRelation}
                onPreviewAllEntities={() => setGraphPreview(buildEntityListPreview(knowledgeGraph.entities))}
                onPreviewAllRelations={() => setGraphPreview(buildRelationListPreview(knowledgeGraph.relations))}
              />
              </>
              ) : null}
            </section>

            <section className={`card intelligence-config-card intelligence-config-span${configExpanded ? '' : ' fold-card'}`}>
              <button
                type="button"
                className="panel-heading compact-heading split fold-header"
                onClick={() => setConfigExpanded((current) => !current)}
                aria-expanded={configExpanded}
              >
                <div>
                  <p className="label">单书配置</p>
                  <h3>模型与图库路由</h3>
                </div>
                <span className="panel-note">
                  {knowledgeGraph.profile.configLocked
                    ? '已锁定'
                    : graphDraft.chatModelKey
                      ? `对话 ${buildModelLabels.get(graphDraft.chatModelKey) ?? '自定义'}`
                      : '沿用全局默认'}
                  {' · '}
                  {knowledgeGraph.profile.neo4j.source === 'novel'
                    ? 'Neo4j 本书专用'
                    : knowledgeGraph.profile.neo4j.source === 'global'
                      ? 'Neo4j 沿用全局'
                      : 'Neo4j 未启用'}
                </span>
              </button>
              {configExpanded ? (
                <div className="fold-content">
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
                <label>
                  <span>全局抽取并发</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    step={1}
                    value={graphDraft.extractionConcurrency}
                    onChange={(event) => setGraphDraft((current) => ({
                      ...current,
                      extractionConcurrency: normalizeDraftExtractionConcurrency(Number(event.target.value)),
                    }))}
                    disabled={knowledgeGraph.profile.configLocked}
                  />
                </label>
              </div>
              <p className="panel-note">默认 2，表示这本书一次最多并行处理多少个片段。</p>

              <div className="intelligence-log-panel">
                <div className="assistant-trace-heading split">
                  <span className="label">抽取模型池</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setGraphDraft((current) => ({
                      ...current,
                      extractionModelEntries: [
                        ...current.extractionModelEntries,
                        {
                          key: current.chatModelKey || graphModelOptions.chat[0]?.key || '',
                          maxConcurrency: 1,
                        },
                      ],
                    }))}
                    disabled={knowledgeGraph.profile.configLocked || graphModelOptions.chat.length === 0}
                  >
                    添加抽取模型
                  </button>
                </div>
                <p className="panel-note">这里的模型池只用于章节片段抽取；如果不配置，就沿用上面的对话模型或全局默认聊天模型做单模型抽取。</p>
                {graphDraft.extractionModelEntries.length === 0 ? (
                  <p className="panel-note">当前未单独配置抽取模型池，会回退到单模型抽取。</p>
                ) : (
                  <div className="intelligence-log-list">
                    {graphDraft.extractionModelEntries.map((entry, index) => (
                      <div key={`${entry.key || 'empty'}-${index}`} className="intelligence-config-grid">
                        <label>
                          <span>抽取模型 {index + 1}</span>
                          <select
                            value={entry.key}
                            onChange={(event) => setGraphDraft((current) => ({
                              ...current,
                              extractionModelEntries: current.extractionModelEntries.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, key: event.target.value } : item
                              )),
                            }))}
                            disabled={knowledgeGraph.profile.configLocked}
                          >
                            <option value="">请选择模型</option>
                            {graphModelOptions.chat.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>单模型并发</span>
                          <input
                            type="number"
                            min={1}
                            max={12}
                            step={1}
                            value={entry.maxConcurrency}
                            onChange={(event) => setGraphDraft((current) => ({
                              ...current,
                              extractionModelEntries: current.extractionModelEntries.map((item, itemIndex) => (
                                itemIndex === index
                                  ? { ...item, maxConcurrency: normalizeDraftExtractionConcurrency(Number(event.target.value)) }
                                  : item
                              )),
                            }))}
                            disabled={knowledgeGraph.profile.configLocked}
                          />
                        </label>
                        <div className="action-row wrap compact-actions">
                          <button
                            type="button"
                            className="ghost-button danger"
                            onClick={() => setGraphDraft((current) => ({
                              ...current,
                              extractionModelEntries: current.extractionModelEntries.filter((_, itemIndex) => itemIndex !== index),
                            }))}
                            disabled={knowledgeGraph.profile.configLocked}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                {build.status === 'paused' ? (
                  <button type="button" className="primary-button" onClick={() => void handleResumeGraph()} disabled={graphResuming}>
                    {graphResuming ? '继续中...' : '继续构建'}
                  </button>
                ) : null}
                <button type="button" className="ghost-button danger" onClick={() => void handleDeleteGraph()} disabled={graphDeleting || buildRunning}>
                  {graphDeleting ? '清空中...' : '清空图谱'}
                </button>
              </div>
                </div>
              ) : null}
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

      {graphPreview ? (
        <div className="reader-directory-overlay graph-preview-overlay" role="presentation" onClick={() => setGraphPreview(null)}>
          <div className="graph-preview-dialog" role="dialog" aria-modal="true" aria-label={graphPreview.title} onClick={(event) => event.stopPropagation()}>
            <div className="reader-directory-drawer-header graph-preview-header">
              <div>
                <p className="eyebrow">图谱详情</p>
                <h3>{graphPreview.title}</h3>
                <p className="panel-note">{graphPreview.subtitle}</p>
              </div>
              <button type="button" className="ghost-button reader-directory-close" onClick={() => setGraphPreview(null)}>
                关闭
              </button>
            </div>
            <div className="graph-preview-body">
              {graphPreview.body.map((paragraph, index) => (
                <p key={`${graphPreview.title}-${index}`}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface KnowledgeGraphWorkspaceProps {
  namespace: string;
  graphExplorer: GraphExplorerState;
  totalEntityCount: number;
  totalRelationCount: number;
  topEntities: GraphEntity[];
  topRelations: GraphRelation[];
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onClearSearch: () => void;
  onClearFocus: () => void;
  onFocusEntityIdChange: (entityId: string | null) => void;
  onPreviewEntity: (entity: GraphEntity) => void;
  onPreviewRelation: (relation: GraphRelation) => void;
  onPreviewAllEntities: () => void;
  onPreviewAllRelations: () => void;
}

const GRAPH_WORLD_WIDTH = 1440;
const GRAPH_WORLD_HEIGHT = 920;
const GRAPH_MIN_ZOOM = 0.45;
const GRAPH_MAX_ZOOM = 2.4;

function KnowledgeGraphWorkspace({
  namespace,
  graphExplorer,
  totalEntityCount,
  totalRelationCount,
  topEntities,
  topRelations,
  searchInput,
  onSearchInputChange,
  onClearSearch,
  onClearFocus,
  onFocusEntityIdChange,
  onPreviewEntity,
  onPreviewRelation,
  onPreviewAllEntities,
  onPreviewAllRelations,
}: KnowledgeGraphWorkspaceProps) {
  const inlineCanvasRef = useRef<HTMLDivElement | null>(null);
  const modalCanvasRef = useRef<HTMLDivElement | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'inspect' | 'entities' | 'relations'>('inspect');
  const [searchFocused, setSearchFocused] = useState(false);
  const [viewport, setViewport] = useState<GraphViewportState>({ zoom: 0.72, offsetX: 82, offsetY: 56 });
  const [dragState, setDragState] = useState<GraphDragState | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => createGraphNodePositionMap(graphExplorer.nodes));
  const touchStateRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null);

  useEffect(() => {
    setNodePositions(createGraphNodePositionMap(graphExplorer.nodes));
    setViewport({ zoom: 0.72, offsetX: 82, offsetY: 56 });
    setFullscreenOpen(false);
  }, [namespace]);

  useEffect(() => {
    setNodePositions((current) => mergeGraphNodePositionMap(current, graphExplorer.nodes));
  }, [graphExplorer.nodes]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (inlineCanvasRef.current) {
        setViewport(fitGraphViewport(graphExplorer.nodes, createGraphNodePositionMap(graphExplorer.nodes), inlineCanvasRef.current));
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [namespace, searchInput, graphExplorer.focusEntity?.id, graphExplorer.nodes]);

  useEffect(() => {
    if (!fullscreenOpen) {
      return;
    }

    const bodyStyle = document.body.style;
    const htmlStyle = document.documentElement.style;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverscrollBehavior = bodyStyle.overscrollBehavior;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousHtmlOverscrollBehavior = htmlStyle.overscrollBehavior;

    bodyStyle.overflow = 'hidden';
    bodyStyle.overscrollBehavior = 'none';
    htmlStyle.overflow = 'hidden';
    htmlStyle.overscrollBehavior = 'none';

    const frameId = window.requestAnimationFrame(() => {
      if (modalCanvasRef.current) {
        setViewport(fitGraphViewport(graphExplorer.nodes, nodePositions, modalCanvasRef.current));
      }

      const modalDialog = modalCanvasRef.current?.closest('.graph-modal-dialog');
      if (modalDialog instanceof HTMLElement) {
        modalDialog.scrollTop = 0;
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overscrollBehavior = previousBodyOverscrollBehavior;
      htmlStyle.overflow = previousHtmlOverflow;
      htmlStyle.overscrollBehavior = previousHtmlOverscrollBehavior;
    };
  }, [fullscreenOpen, graphExplorer.nodes, nodePositions]);

  useEffect(() => {
    const containers = [inlineCanvasRef.current, fullscreenOpen ? modalCanvasRef.current : null]
      .filter((container): container is HTMLDivElement => container !== null);

    if (containers.length === 0) {
      return;
    }

    function handleNativeWheel(event: WheelEvent) {
      const container = event.currentTarget;
      if (!(container instanceof HTMLDivElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = container.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;

      setViewport((current) => {
        const nextZoom = clampGraphZoom(current.zoom * (event.deltaY < 0 ? 1.12 : 0.9));
        return zoomGraphViewport(current, nextZoom, anchorX, anchorY);
      });
    }

    containers.forEach((container) => {
      container.addEventListener('wheel', handleNativeWheel, { passive: false });
    });

    return () => {
      containers.forEach((container) => {
        container.removeEventListener('wheel', handleNativeWheel);
      });
    };
  }, [fullscreenOpen]);

  useEffect(() => {
    const containers = [inlineCanvasRef.current, fullscreenOpen ? modalCanvasRef.current : null]
      .filter((container): container is HTMLDivElement => container !== null);

    if (containers.length === 0) {
      return;
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      const t0 = event.touches[0]!;
      const t1 = event.touches[1]!;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      touchStateRef.current = {
        initialDistance: Math.sqrt(dx * dx + dy * dy),
        initialZoom: viewport.zoom,
      };
    }

    function handleTouchMove(event: TouchEvent) {
      if (event.touches.length !== 2 || !touchStateRef.current) {
        return;
      }

      event.preventDefault();
      const t0 = event.touches[0]!;
      const t1 = event.touches[1]!;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      const ratio = currentDistance / touchStateRef.current.initialDistance;
      const nextZoom = clampGraphZoom(touchStateRef.current.initialZoom * ratio);

      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      setViewport((current) => zoomGraphViewport(current, nextZoom, midX, midY));
    }

    function handleTouchEnd() {
      touchStateRef.current = null;
    }

    containers.forEach((container) => {
      container.addEventListener('touchstart', handleTouchStart, { passive: false });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd);
      container.addEventListener('touchcancel', handleTouchEnd);
    });

    return () => {
      containers.forEach((container) => {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
        container.removeEventListener('touchcancel', handleTouchEnd);
      });
    };
  }, [fullscreenOpen, viewport.zoom]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const activeDragState = dragState;

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== activeDragState.pointerId) {
        return;
      }

      if (activeDragState.kind === 'pan') {
        setViewport((current) => ({
          ...current,
          offsetX: activeDragState.originOffsetX + (event.clientX - activeDragState.startClientX),
          offsetY: activeDragState.originOffsetY + (event.clientY - activeDragState.startClientY),
        }));
        return;
      }

      setNodePositions((current) => ({
        ...current,
        [activeDragState.nodeId]: {
          x: activeDragState.originNodeX + (event.clientX - activeDragState.startClientX) / viewport.zoom,
          y: activeDragState.originNodeY + (event.clientY - activeDragState.startClientY) / viewport.zoom,
        },
      }));
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerId === activeDragState.pointerId) {
        setDragState(null);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, viewport.zoom]);

  const renderedNodes = graphExplorer.nodes.map((node) => {
    const position = nodePositions[node.entity.id] ?? createGraphNodePositionMap([node])[node.entity.id] ?? { x: GRAPH_WORLD_WIDTH / 2, y: GRAPH_WORLD_HEIGHT / 2 };
    return {
      ...node,
      canvasX: position.x,
      canvasY: position.y,
    };
  });

  const renderedNodeById = new Map(renderedNodes.map((node) => [node.entity.id, node] as const));
  const renderedEdges = graphExplorer.edges.flatMap((edge) => {
    const fromNode = renderedNodeById.get(edge.fromNode.entity.id);
    const toNode = renderedNodeById.get(edge.toNode.entity.id);
    return fromNode && toNode
      ? [{
          ...edge,
          fromNode,
          toNode,
        }]
      : [];
  });
  const focusEntity = graphExplorer.focusEntity;

  const searchSuggestions = computeSearchSuggestions(
    graphExplorer.nodes.map((node) => node.entity),
    searchInput,
  );

  function beginCanvasPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    setDragState({
      kind: 'pan',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originOffsetX: viewport.offsetX,
      originOffsetY: viewport.offsetY,
    });
  }

  function beginNodeDrag(event: React.PointerEvent<HTMLButtonElement>, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    const currentPosition = nodePositions[nodeId];
    if (!currentPosition) {
      return;
    }

    setDragState({
      kind: 'node',
      pointerId: event.pointerId,
      nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originNodeX: currentPosition.x,
      originNodeY: currentPosition.y,
    });
  }

  function zoomByStep(multiplier: number, container: HTMLDivElement | null) {
    if (!container) {
      return;
    }

    setViewport((current) => {
      const nextZoom = clampGraphZoom(current.zoom * multiplier);
      return zoomGraphViewport(current, nextZoom, container.clientWidth / 2, container.clientHeight / 2);
    });
  }

  function fitView(container: HTMLDivElement | null) {
    if (!container) {
      return;
    }

    setViewport(fitGraphViewport(graphExplorer.nodes, nodePositions, container));
  }

  function resetView(container: HTMLDivElement | null) {
    const nextPositions = createGraphNodePositionMap(graphExplorer.nodes);
    setNodePositions(nextPositions);
    if (!container) {
      setViewport({ zoom: 0.72, offsetX: 82, offsetY: 56 });
      return;
    }

    setViewport(fitGraphViewport(graphExplorer.nodes, nextPositions, container));
  }

  function renderGraphCanvasElement(containerRef: React.RefObject<HTMLDivElement | null>, enlarged = false) {
    return (
      <div
        ref={containerRef}
        className={`graph-browser-canvas interactive${dragState?.kind === 'pan' ? ' panning' : ''}${enlarged ? ' enlarged' : ''}`}
        role="img"
        aria-label={enlarged ? '知识图谱放大操作区' : '知识图谱浏览区域'}
        tabIndex={0}
        onKeyDown={(event) => {
          const step = 60;
          switch (event.key) {
            case 'ArrowUp':
              event.preventDefault();
              setViewport((current) => ({ ...current, offsetY: current.offsetY + step }));
              break;
            case 'ArrowDown':
              event.preventDefault();
              setViewport((current) => ({ ...current, offsetY: current.offsetY - step }));
              break;
            case 'ArrowLeft':
              event.preventDefault();
              setViewport((current) => ({ ...current, offsetX: current.offsetX + step }));
              break;
            case 'ArrowRight':
              event.preventDefault();
              setViewport((current) => ({ ...current, offsetX: current.offsetX - step }));
              break;
            case '+':
            case '=':
              event.preventDefault();
              setViewport((current) => {
                const nextZoom = clampGraphZoom(current.zoom * 1.15);
                return zoomGraphViewport(current, nextZoom, (containerRef.current?.clientWidth ?? 400) / 2, (containerRef.current?.clientHeight ?? 300) / 2);
              });
              break;
            case '-':
              event.preventDefault();
              setViewport((current) => {
                const nextZoom = clampGraphZoom(current.zoom * 0.87);
                return zoomGraphViewport(current, nextZoom, (containerRef.current?.clientWidth ?? 400) / 2, (containerRef.current?.clientHeight ?? 300) / 2);
              });
              break;
            case 'f':
              event.preventDefault();
              fitView(containerRef.current);
              break;
          }
        }}
        onPointerDown={beginCanvasPan}
      >
        {renderedNodes.length === 0 ? (
          <div className="empty-state compact graph-browser-empty">
            <p>{graphExplorer.emptyMessage}</p>
          </div>
        ) : (
          <div
            className="graph-scene"
            style={{
              width: `${GRAPH_WORLD_WIDTH}px`,
              height: `${GRAPH_WORLD_HEIGHT}px`,
              transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.zoom})`,
            }}
          >
            <svg className="graph-browser-svg" viewBox={`0 0 ${GRAPH_WORLD_WIDTH} ${GRAPH_WORLD_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker
                  id="graph-arrow-default"
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="6"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,4 L0,8 Z" fill="rgba(158,177,196,0.28)" />
                </marker>
                <marker
                  id="graph-arrow-primary"
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="6"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,4 L0,8 Z" fill="rgba(127,208,255,0.56)" />
                </marker>
                <marker
                  id="graph-arrow-matched"
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="6"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,4 L0,8 Z" fill="rgba(255,209,102,0.7)" />
                </marker>
                <marker
                  id="graph-arrow-hover"
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="6"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,4 L0,8 Z" fill="rgba(255,140,66,0.82)" />
                </marker>
              </defs>
              {renderedEdges.map((edge) => {
                const midX = (edge.fromNode.canvasX + edge.toNode.canvasX) / 2;
                const midY = (edge.fromNode.canvasY + edge.toNode.canvasY) / 2;
                const arrowId = edge.matched ? 'graph-arrow-matched' : edge.primary ? 'graph-arrow-primary' : 'graph-arrow-default';
                const label = edge.relation.summary.length > 10
                  ? edge.relation.summary.slice(0, 10) + '…'
                  : edge.relation.summary;
                return (
                  <g key={edge.relation.id}
                    className="graph-edge-group"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreviewRelation(edge.relation);
                    }}
                  >
                    <line
                      className="graph-edge-hit"
                      x1={edge.fromNode.canvasX}
                      y1={edge.fromNode.canvasY}
                      x2={edge.toNode.canvasX}
                      y2={edge.toNode.canvasY}
                    />
                    <line
                      className={`graph-edge${edge.primary ? ' primary' : ''}${edge.matched ? ' matched' : ''}`}
                      x1={edge.fromNode.canvasX}
                      y1={edge.fromNode.canvasY}
                      x2={edge.toNode.canvasX}
                      y2={edge.toNode.canvasY}
                      markerEnd={`url(#${arrowId})`}
                    />
                    <text
                      className={`graph-edge-label${edge.matched ? ' matched' : ''}${edge.primary ? ' primary' : ''}`}
                      x={midX}
                      y={midY}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {renderedNodes.map((node) => (
              <button
                key={node.entity.id}
                type="button"
                className={`graph-node${node.focused ? ' focused' : ''}${node.matched ? ' matched' : ''}`}
                style={{
                  left: `${node.canvasX}px`,
                  top: `${node.canvasY}px`,
                  width: `${buildGraphNodeWidth(node)}px`,
                  minHeight: `${node.size}px`,
                }}
                onPointerDown={(event) => beginNodeDrag(event, node.entity.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  onFocusEntityIdChange(node.focused ? null : node.entity.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onPreviewEntity(node.entity);
                }}
              >
                <strong>{node.entity.name}</strong>
                <span>{formatGraphEntityType(node.entity.entityType)} · {node.entity.mentionCount} 次</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderCanvas(containerRef: React.RefObject<HTMLDivElement | null>, enlarged = false) {
    const canvasElement = renderGraphCanvasElement(containerRef, enlarged);

    if (enlarged) {
      return (
        <div className="graph-browser-stage enlarged">
          <div className="graph-canvas-shell enlarged">
            <div className="graph-floating-toolbar">
              <div className="graph-toolbar graph-toolbar-floating">
                <label className="graph-search-field graph-search-field-floating">
                  <span>搜索图谱</span>
                  <input
                    value={searchInput}
                    onChange={(event) => onSearchInputChange(event.target.value)}
                    placeholder="试试角色名、别名、关系摘要、证据内容或章节关键词"
                  />
                </label>
                <div className="action-row wrap compact-actions graph-toolbar-actions">
                  <button type="button" className="ghost-button" onClick={onClearSearch} disabled={searchInput.trim().length === 0}>
                    清空搜索
                  </button>
                  <button type="button" className="ghost-button" onClick={onClearFocus} disabled={!graphExplorer.focusEntity}>
                    取消聚焦
                  </button>
                </div>
                <div className="graph-result-strip graph-result-strip-floating">
                  <article className="graph-result-stat">
                    <span className="label">实体</span>
                    <strong>{graphExplorer.nodes.length}/{totalEntityCount}</strong>
                  </article>
                  <article className="graph-result-stat">
                    <span className="label">关系</span>
                    <strong>{graphExplorer.edges.length}/{totalRelationCount}</strong>
                  </article>
                  <article className="graph-result-stat">
                    <span className="label">章节</span>
                    <strong>{graphExplorer.spotlightChapters.length}</strong>
                  </article>
                </div>
              </div>
            </div>

            <div className="graph-control-rail graph-control-rail-left" aria-hidden="true">
              <span className="graph-control-caption">交互</span>
              <span className="graph-control-pill">拖拽节点</span>
              <span className="graph-control-pill">空白拖动画布</span>
              <span className="graph-control-pill">滚轮缩放</span>
            </div>

            {canvasElement}

            <div className="graph-control-rail graph-control-rail-right">
              <button type="button" className="graph-control-button" onClick={() => zoomByStep(1.15, containerRef.current)}>放大 +</button>
              <button type="button" className="graph-control-button" onClick={() => zoomByStep(0.87, containerRef.current)}>缩小 -</button>
              <button type="button" className="graph-control-button" onClick={() => fitView(containerRef.current)}>适配</button>
              <button type="button" className="graph-control-button" onClick={() => resetView(containerRef.current)}>重置</button>
            </div>

            <div className="graph-floating-summary">
              <div className="assistant-trace-heading split">
                <span className="label">{focusEntity ? '当前焦点' : '浏览提示'}</span>
                <span className="panel-note">放大模式下保留最关键的检索和聚焦信息。</span>
              </div>

              {focusEntity ? (
                <>
                  <div className="graph-floating-summary-copy">
                    <strong>{focusEntity.name}</strong>
                    <p>{focusEntity.summary}</p>
                  </div>
                  <div className="assistant-score-grid">
                    <span>{formatGraphEntityType(focusEntity.entityType)}</span>
                    <span>出现 {focusEntity.mentionCount} 次</span>
                    {focusEntity.firstChapterId ? <span>首次 {focusEntity.firstChapterId}</span> : null}
                    {focusEntity.lastChapterId ? <span>最近 {focusEntity.lastChapterId}</span> : null}
                  </div>
                  {focusEntity.aliases.length > 0 ? (
                    <div className="graph-chip-list graph-chip-list-compact">
                      {focusEntity.aliases.slice(0, 6).map((alias) => (
                        <span key={`${focusEntity.id}-${alias}`} className="graph-chip static">{alias}</span>
                      ))}
                    </div>
                  ) : null}
                  {graphExplorer.spotlightRelations.length > 0 ? (
                    <div className="graph-chip-list relation-list graph-chip-list-compact">
                      {graphExplorer.spotlightRelations.slice(0, 4).map((relation) => (
                        <button
                          key={relation.id}
                          type="button"
                          className="graph-chip relation"
                          onClick={() => onPreviewRelation(relation)}
                        >
                          {relation.summary}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="panel-note">{graphExplorer.summaryMessage}</p>
                  <div className="graph-chip-list graph-chip-list-compact">
                    {graphExplorer.spotlightEntities.slice(0, 6).map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        className="graph-chip"
                        onClick={() => onFocusEntityIdChange(entity.id)}
                      >
                        {entity.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`graph-browser-stage${enlarged ? ' enlarged' : ''}`}>
        <div className="graph-toolbar-row">
          <label className="graph-search-field">
            <span>搜索图谱</span>
            <div className="graph-search-wrapper">
            <input
              value={searchInput}
              onChange={(event) => onSearchInputChange(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => { setTimeout(() => setSearchFocused(false), 180); }}
              placeholder="试试角色名、别名、关系摘要、证据内容或章节关键词"
            />
            {searchFocused && searchSuggestions.length > 0 ? (
              <div className="graph-search-suggestions">
                {searchSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="graph-search-suggestion-item"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onSearchInputChange(suggestion);
                      setSearchFocused(false);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            </div>
          </label>

          <div className="graph-result-strip">
            <article className="graph-result-stat">
              <span className="label">实体</span>
              <strong>{graphExplorer.nodes.length}/{totalEntityCount}</strong>
            </article>
            <article className="graph-result-stat">
              <span className="label">关系</span>
              <strong>{graphExplorer.edges.length}/{totalRelationCount}</strong>
            </article>
            <article className="graph-result-stat">
              <span className="label">章节</span>
              <strong>{graphExplorer.spotlightChapters.length}</strong>
            </article>
          </div>

          <div className="action-row wrap compact-actions graph-toolbar-actions">
            <button type="button" className="ghost-button" onClick={onClearSearch} disabled={searchInput.trim().length === 0}>
              清空搜索
            </button>
            <button type="button" className="ghost-button" onClick={onClearFocus} disabled={!graphExplorer.focusEntity}>
              取消聚焦
            </button>
            <button type="button" className="ghost-button" onClick={() => setFullscreenOpen(true)}>
              放大查看
            </button>
            <button type="button" className="ghost-button" onClick={() => zoomByStep(1.15, containerRef.current)}>放大 +</button>
            <button type="button" className="ghost-button" onClick={() => zoomByStep(0.87, containerRef.current)}>缩小 -</button>
            <button type="button" className="ghost-button" onClick={() => fitView(containerRef.current)}>适配</button>
            <button type="button" className="ghost-button" onClick={() => resetView(containerRef.current)}>重置</button>
          </div>
        </div>

        <div className={`graph-canvas-shell${enlarged ? ' enlarged' : ''}`}>
          <div className="graph-control-rail graph-control-rail-left" aria-hidden="true">
            <span className="graph-control-caption">交互</span>
            <span className="graph-control-pill">拖拽节点</span>
            <span className="graph-control-pill">空白拖动画布</span>
            <span className="graph-control-pill">滚轮缩放</span>
            <span className="graph-control-caption" style={{ marginTop: '0.35rem' }}>图例</span>
            <span className="graph-control-pill node-legend"><span className="node-legend-dot sm" /> 提及少</span>
            <span className="graph-control-pill node-legend"><span className="node-legend-dot lg" /> 提及多</span>
          </div>

          {canvasElement}
        </div>

        <div className="graph-inspector-footer">



          <div className="graph-inspector-tabs">
            <button
              type="button"
              className={`graph-inspector-tab${inspectorTab === 'inspect' ? ' active' : ''}`}
              onClick={() => setInspectorTab('inspect')}
            >
              当前检视
            </button>
            <button
              type="button"
              className={`graph-inspector-tab${inspectorTab === 'entities' ? ' active' : ''}`}
              onClick={() => setInspectorTab('entities')}
            >
              高频实体
            </button>
            <button
              type="button"
              className={`graph-inspector-tab${inspectorTab === 'relations' ? ' active' : ''}`}
              onClick={() => setInspectorTab('relations')}
            >
              主要关系
            </button>
          </div>

          {inspectorTab === 'inspect' ? (
            <>
              <section className="graph-inspector-card">
            <p className="label">{focusEntity ? '当前焦点' : searchInput.trim().length > 0 ? '搜索命中' : '浏览提示'}</p>
            {focusEntity ? (
              <>
                <h4>{focusEntity.name}</h4>
                <p className="panel-note">{focusEntity.summary}</p>
                <div className="assistant-score-grid">
                  <span>{formatGraphEntityType(focusEntity.entityType)}</span>
                  <span>出现 {focusEntity.mentionCount} 次</span>
                  {focusEntity.firstChapterId ? <span>首次 {focusEntity.firstChapterId}</span> : null}
                  {focusEntity.lastChapterId ? <span>最近 {focusEntity.lastChapterId}</span> : null}
                </div>
                {focusEntity.aliases.length > 0 ? (
                  <div className="graph-chip-list">
                    {focusEntity.aliases.map((alias) => (
                      <span key={`${focusEntity.id}-${alias}`} className="graph-chip static">{alias}</span>
                    ))}
                  </div>
                ) : null}
                <div className="action-row wrap compact-actions">
                  <button type="button" className="ghost-button" onClick={() => onPreviewEntity(focusEntity)}>
                    查看详情
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="panel-note">{graphExplorer.summaryMessage}</p>
                {graphExplorer.spotlightEntities.length > 0 ? (
                  <div className="graph-chip-list">
                    {graphExplorer.spotlightEntities.map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        className="graph-chip"
                        onClick={() => onFocusEntityIdChange(entity.id)}
                      >
                        {entity.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="graph-inspector-card">
            <div className="assistant-trace-heading split">
              <span className="label">关系结果</span>
              <span className="panel-note">点击查看证据</span>
            </div>
            {graphExplorer.spotlightRelations.length === 0 ? (
              <p className="panel-note">还没有可展示的关系，先生成图谱或换个关键词试试。</p>
            ) : (
              <div className="graph-chip-list relation-list">
                {graphExplorer.spotlightRelations.map((relation) => (
                  <button
                    key={relation.id}
                    type="button"
                    className="graph-chip relation"
                    onClick={() => onPreviewRelation(relation)}
                  >
                    {relation.summary}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="graph-inspector-card">
            <div className="assistant-trace-heading split">
              <span className="label">章节联动</span>
              <span className="panel-note">展示当前命中的章节范围</span>
            </div>
            {graphExplorer.spotlightChapters.length === 0 ? (
              <p className="panel-note">当前没有关联章节。搜索关系、别名或人物后，这里会同步收窄。</p>
            ) : (
              <div className="graph-chip-list">
                {graphExplorer.spotlightChapters.map((chapterId) => (
                  <span key={chapterId} className="graph-chip static">{chapterId}</span>
                ))}
              </div>
            )}
          </section>
            </>
          ) : inspectorTab === 'entities' ? (
            <section className="graph-inspector-card">
              <div className="assistant-trace-heading split">
                <span className="label">高频实体</span>
                {totalEntityCount > 5 ? (
                  <button type="button" className="ghost-button" onClick={onPreviewAllEntities}>
                    查看更多
                  </button>
                ) : null}
              </div>
              {topEntities.length === 0 ? (
                <p className="panel-note">当前还没有实体，先生成一次图谱。</p>
              ) : (
                <div className="intelligence-list">
                  {topEntities.map((entity) => (
                    <article key={entity.id} className="intelligence-list-item">
                      <div className="intelligence-list-copy">
                        <strong>{entity.name}</strong>
                        <p className="intelligence-preview-text">{entity.summary}</p>
                        <div className="action-row wrap compact-actions">
                          <button type="button" className="ghost-button intelligence-inline-button" onClick={() => onFocusEntityIdChange(entity.id)}>
                            在图中查看
                          </button>
                          {entity.summary && entity.summary.length > 90 ? (
                            <button type="button" className="ghost-button intelligence-inline-button" onClick={() => onPreviewEntity(entity)}>
                              浮窗查看
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <span className="status-badge state-indexed">{entity.mentionCount} 次</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="graph-inspector-card">
              <div className="assistant-trace-heading split">
                <span className="label">主要关系</span>
                {totalRelationCount > 5 ? (
                  <button type="button" className="ghost-button" onClick={onPreviewAllRelations}>
                    查看更多
                  </button>
                ) : null}
              </div>
              {topRelations.length === 0 ? (
                <p className="panel-note">当前还没有关系，生成后会按证据强度排序展示。</p>
              ) : (
                <div className="intelligence-list">
                  {topRelations.map((relation) => (
                    <article key={relation.id} className="intelligence-list-item">
                      <div className="intelligence-list-copy">
                        <strong className="intelligence-preview-text">{relation.summary}</strong>
                        <p className="intelligence-preview-text">{relation.evidence[0] ?? '暂无证据摘要。'}</p>
                        <div className="action-row wrap compact-actions">
                          <button type="button" className="ghost-button intelligence-inline-button" onClick={() => onPreviewRelation(relation)}>
                            查看证据
                          </button>
                        </div>
                      </div>
                      <span className="status-badge ok">权重 {relation.weight}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {renderCanvas(inlineCanvasRef)}
      {fullscreenOpen ? (
        <div className="reader-directory-overlay graph-preview-overlay graph-modal-overlay" role="presentation" onClick={() => setFullscreenOpen(false)}>
          <div className="graph-modal-dialog" role="dialog" aria-modal="true" aria-label="知识图谱放大查看" onClick={(event) => event.stopPropagation()}>
            <div className="reader-directory-drawer-header graph-preview-header">
              <div>
                <p className="eyebrow">图谱放大查看</p>
                <h3>关系图操作区</h3>
                <p className="panel-note">这里保留拖拽、缩放和联动检索，适合长时间浏览和调整节点位置。</p>
              </div>
              <button type="button" className="ghost-button reader-directory-close" onClick={() => setFullscreenOpen(false)}>
                关闭
              </button>
            </div>
            {renderCanvas(modalCanvasRef, true)}
          </div>
        </div>
      ) : null}
    </>
  );
}

function createGraphNodePositionMap(nodes: GraphExplorerNode[]): Record<string, { x: number; y: number }> {
  return Object.fromEntries(nodes.map((node) => [
    node.entity.id,
    {
      x: (node.x / 100) * GRAPH_WORLD_WIDTH,
      y: (node.y / 100) * GRAPH_WORLD_HEIGHT,
    },
  ]));
}

function mergeGraphNodePositionMap(
  current: Record<string, { x: number; y: number }>,
  nodes: GraphExplorerNode[],
): Record<string, { x: number; y: number }> {
  const next = createGraphNodePositionMap(nodes);
  for (const node of nodes) {
    const existingPosition = current[node.entity.id];
    if (existingPosition) {
      next[node.entity.id] = existingPosition;
    }
  }

  return next;
}

function fitGraphViewport(
  nodes: GraphExplorerNode[],
  nodePositions: Record<string, { x: number; y: number }>,
  container: HTMLDivElement,
): GraphViewportState {
  if (nodes.length === 0) {
    return { zoom: 0.72, offsetX: 82, offsetY: 56 };
  }

  const bounds = computeGraphBounds(nodes, nodePositions);
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  const availableWidth = Math.max(width - 120, 180);
  const availableHeight = Math.max(height - 120, 180);
  const zoom = clampGraphZoom(Math.min(availableWidth / bounds.width, availableHeight / bounds.height, 1.35));

  return {
    zoom,
    offsetX: (width - bounds.width * zoom) / 2 - bounds.minX * zoom,
    offsetY: (height - bounds.height * zoom) / 2 - bounds.minY * zoom,
  };
}

function computeGraphBounds(
  nodes: GraphExplorerNode[],
  nodePositions: Record<string, { x: number; y: number }>,
): { minX: number; minY: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const position = nodePositions[node.entity.id] ?? { x: GRAPH_WORLD_WIDTH / 2, y: GRAPH_WORLD_HEIGHT / 2 };
    const halfWidth = buildGraphNodeWidth(node) / 2;
    const halfHeight = node.size / 2;
    minX = Math.min(minX, position.x - halfWidth);
    minY = Math.min(minY, position.y - halfHeight);
    maxX = Math.max(maxX, position.x + halfWidth);
    maxY = Math.max(maxY, position.y + halfHeight);
  }

  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 220),
    height: Math.max(maxY - minY, 220),
  };
}

function clampGraphZoom(value: number): number {
  return Math.max(GRAPH_MIN_ZOOM, Math.min(GRAPH_MAX_ZOOM, value));
}

function zoomGraphViewport(
  viewport: GraphViewportState,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
): GraphViewportState {
  const normalizedZoom = clampGraphZoom(nextZoom);
  const worldX = (anchorX - viewport.offsetX) / viewport.zoom;
  const worldY = (anchorY - viewport.offsetY) / viewport.zoom;
  return {
    zoom: normalizedZoom,
    offsetX: anchorX - worldX * normalizedZoom,
    offsetY: anchorY - worldY * normalizedZoom,
  };
}

function buildEntityPreview(entity: GraphEntity): GraphPreviewDialogState {
  return {
    title: entity.name,
    subtitle: `实体摘要 · 出现 ${entity.mentionCount} 次`,
    body: [
      entity.summary,
      `类型：${formatGraphEntityType(entity.entityType)}`,
      entity.aliases.length > 0 ? `别名：${entity.aliases.join('、')}` : '',
      entity.mentionChapterIds.length > 0 ? `章节：${entity.mentionChapterIds.join('、')}` : '',
    ].filter(Boolean),
  };
}

function buildRelationPreview(relation: GraphRelation): GraphPreviewDialogState {
  return {
    title: relation.summary,
    subtitle: `关系证据 · 权重 ${relation.weight}`,
    body: [
      relation.summary,
      relation.chapterIds.length > 0 ? `涉及章节：${relation.chapterIds.join('、')}` : '',
      ...relation.evidence,
    ].filter(Boolean),
  };
}

function formatBuildActionTitle(mode: LibraryKnowledgeGraphBuildMode): string {
  switch (mode) {
    case 'rebuild':
      return '关系重建已启动';
    case 'full':
      return '全量重建已启动';
    default:
      return '增量更新已启动';
  }
}

function formatBuildActionFailureTitle(mode: LibraryKnowledgeGraphBuildMode): string {
  switch (mode) {
    case 'rebuild':
      return '关系重建启动失败';
    case 'full':
      return '全量重建启动失败';
    default:
      return '增量更新启动失败';
  }
}

function formatBuildActionMessage(mode: LibraryKnowledgeGraphBuildMode): string {
  switch (mode) {
    case 'rebuild':
      return '后台会直接复用已有结构缓存，重新归并实体和关系。';
    case 'full':
      return '后台会清掉旧缓存并重新跑完整抽取链路，面板会自动刷新进度。';
    default:
      return '后台会优先复用未变章节的缓存，只补本次新增或变化内容。';
  }
}

function buildGraphExplorerState(
  knowledgeGraph: LibraryNovelDetailPayload['knowledgeGraph'],
  rawQuery: string,
  focusEntityId: string | null,
): GraphExplorerState {
  const entities = knowledgeGraph.entities;
  const relations = knowledgeGraph.relations;

  if (entities.length === 0) {
    return {
      nodes: [],
      edges: [],
      focusEntity: null,
      focusRelations: [],
      spotlightEntities: [],
      spotlightRelations: [],
      spotlightChapters: [],
      emptyMessage: '当前还没有可浏览的图谱。先生成一次图谱，关系图就会出现在这里。',
      summaryMessage: '当前还没有图谱数据。',
    };
  }

  const normalizedQuery = rawQuery.trim().toLowerCase();
  const queryTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const matchedEntityIds = new Set(
    queryTokens.length === 0
      ? []
      : entities
          .filter((entity) => matchesGraphSearchTokens([
            entity.name,
            entity.summary,
            entity.aliases.join(' '),
            entity.mentionChapterIds.join(' '),
          ], queryTokens))
          .map((entity) => entity.id),
  );
  const matchedRelationIds = new Set(
    queryTokens.length === 0
      ? []
      : relations
          .filter((relation) => matchesGraphSearchTokens([
            relation.summary,
            relation.evidence.join(' '),
            relation.chapterIds.join(' '),
            entityById.get(relation.fromEntityId)?.name ?? '',
            entityById.get(relation.toEntityId)?.name ?? '',
          ], queryTokens))
          .map((relation) => relation.id),
  );

  const visibleEntityCap = queryTokens.length > 0 ? 16 : 12;
  const visibleRelationCap = queryTokens.length > 0 ? 24 : 18;
  const focusEntity = focusEntityId ? entityById.get(focusEntityId) ?? null : null;
  const seedEntityIds = new Set<string>();

  if (focusEntity) {
    seedEntityIds.add(focusEntity.id);
  }

  for (const entityId of matchedEntityIds) {
    seedEntityIds.add(entityId);
  }

  for (const relation of relations) {
    if (!matchedRelationIds.has(relation.id)) {
      continue;
    }

    seedEntityIds.add(relation.fromEntityId);
    seedEntityIds.add(relation.toEntityId);
  }

  if (seedEntityIds.size === 0) {
    for (const entity of sortEntitiesForGraph(entities)) {
      seedEntityIds.add(entity.id);
      if (seedEntityIds.size >= visibleEntityCap) {
        break;
      }
    }
  }

  for (const relation of sortRelationsForGraph(relations, matchedRelationIds, focusEntity?.id ?? null)) {
    if (!seedEntityIds.has(relation.fromEntityId) && !seedEntityIds.has(relation.toEntityId)) {
      continue;
    }

    seedEntityIds.add(relation.fromEntityId);
    seedEntityIds.add(relation.toEntityId);
    if (seedEntityIds.size >= visibleEntityCap) {
      break;
    }
  }

  if (seedEntityIds.size < visibleEntityCap) {
    for (const entity of sortEntitiesForGraph(entities)) {
      seedEntityIds.add(entity.id);
      if (seedEntityIds.size >= visibleEntityCap) {
        break;
      }
    }
  }

  const visibleEntities = sortEntitiesForGraph(entities.filter((entity) => seedEntityIds.has(entity.id))).slice(0, visibleEntityCap);
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleRelations = sortRelationsForGraph(
    relations.filter((relation) => visibleEntityIds.has(relation.fromEntityId) && visibleEntityIds.has(relation.toEntityId)),
    matchedRelationIds,
    focusEntity?.id ?? null,
  ).slice(0, visibleRelationCap);
  const layout = buildGraphLayout(visibleEntities, visibleRelations, focusEntity?.id ?? null);
  const maxMentionCount = Math.max(...visibleEntities.map((entity) => entity.mentionCount), 1);
  const nodes = visibleEntities.map((entity) => {
    const position = layout.get(entity.id) ?? { x: 50, y: 50 };
    return {
      entity,
      x: position.x,
      y: position.y,
      size: computeGraphNodeSize(entity, maxMentionCount, entity.id === focusEntity?.id),
      matched: matchedEntityIds.has(entity.id),
      focused: entity.id === focusEntity?.id,
    } satisfies GraphExplorerNode;
  });
  const nodeById = new Map(nodes.map((node) => [node.entity.id, node] as const));
  const edges = visibleRelations.flatMap((relation) => {
    const fromNode = nodeById.get(relation.fromEntityId);
    const toNode = nodeById.get(relation.toEntityId);
    if (!fromNode || !toNode) {
      return [];
    }

    return [{
      relation,
      fromNode,
      toNode,
      matched: matchedRelationIds.has(relation.id),
      primary: relation.fromEntityId === focusEntity?.id || relation.toEntityId === focusEntity?.id,
    } satisfies GraphExplorerEdge];
  });

  const focusRelations = focusEntity
    ? visibleRelations.filter((relation) => relation.fromEntityId === focusEntity.id || relation.toEntityId === focusEntity.id)
    : [];
  const spotlightEntities = focusEntity
    ? sortEntitiesForGraph(
        visibleEntities.filter((entity) => entity.id !== focusEntity.id).filter((entity) => (
          focusRelations.some((relation) => relation.fromEntityId === entity.id || relation.toEntityId === entity.id)
        )),
      ).slice(0, 6)
    : sortEntitiesForGraph(visibleEntities.filter((entity) => matchedEntityIds.has(entity.id) || queryTokens.length === 0)).slice(0, 6);
  const spotlightRelations = (focusEntity ? focusRelations : visibleRelations).slice(0, 8);
  const spotlightChapters = Array.from(new Set(
    focusEntity
      ? [
          ...focusEntity.mentionChapterIds,
          ...focusRelations.flatMap((relation) => relation.chapterIds),
        ]
      : [
          ...spotlightEntities.flatMap((entity) => entity.mentionChapterIds),
          ...spotlightRelations.flatMap((relation) => relation.chapterIds),
        ],
  )).slice(0, 10);
  const summaryMessage = queryTokens.length > 0
    ? matchedEntityIds.size > 0 || matchedRelationIds.size > 0
      ? `已命中 ${matchedEntityIds.size} 个实体、${matchedRelationIds.size} 条关系，并自动带出相邻节点。`
      : `没有精确命中「${rawQuery.trim()}」，已展示所有可见节点。`
    : focusEntity
      ? `当前聚焦 ${focusEntity.name}，右侧显示它附近最重要的关系。`
      : '默认展示当前最重要的实体和关系；搜索后会自动收敛到相关子图。';

  return {
    nodes,
    edges,
    focusEntity,
    focusRelations,
    spotlightEntities,
    spotlightRelations,
    spotlightChapters,
    emptyMessage: queryTokens.length > 0 ? '没有找到匹配项，换个角色名、别名或关系关键词再试。' : '当前没有可显示的节点。',
    summaryMessage,
  };
}

function sortEntitiesForGraph(entities: GraphEntity[]): GraphEntity[] {
  return [...entities].sort((left, right) => {
    const prominenceDelta = right.prominence - left.prominence;
    if (prominenceDelta !== 0) {
      return prominenceDelta;
    }

    const mentionDelta = right.mentionCount - left.mentionCount;
    if (mentionDelta !== 0) {
      return mentionDelta;
    }

    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

function sortRelationsForGraph(
  relations: GraphRelation[],
  matchedRelationIds: Set<string>,
  focusEntityId: string | null,
): GraphRelation[] {
  return [...relations].sort((left, right) => {
    const leftPriority = (matchedRelationIds.has(left.id) ? 4 : 0) + (left.fromEntityId === focusEntityId || left.toEntityId === focusEntityId ? 2 : 0);
    const rightPriority = (matchedRelationIds.has(right.id) ? 4 : 0) + (right.fromEntityId === focusEntityId || right.toEntityId === focusEntityId ? 2 : 0);
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }

    const weightDelta = right.weight - left.weight;
    if (weightDelta !== 0) {
      return weightDelta;
    }

    return left.summary.localeCompare(right.summary, 'zh-CN');
  });
}

function matchesGraphSearchTokens(values: string[], tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }

  const haystack = values.join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function buildGraphLayout(
  entities: GraphEntity[],
  relations: GraphRelation[],
  focusEntityId: string | null,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (entities.length === 0) {
    return positions;
  }

  const centerEntityId = focusEntityId && entities.some((entity) => entity.id === focusEntityId)
    ? focusEntityId
    : entities[0]?.id ?? null;

  if (!centerEntityId) {
    return positions;
  }

  positions.set(centerEntityId, { x: 50, y: 50 });
  const others = entities
    .filter((entity) => entity.id !== centerEntityId)
    .sort((left, right) => {
      const leftWeight = strongestRelationWeight(relations, centerEntityId, left.id);
      const rightWeight = strongestRelationWeight(relations, centerEntityId, right.id);
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }

      return right.prominence - left.prominence;
    });

  const ringConfigs = [
    { capacity: 5, radiusX: 17, radiusY: 15, angleOffset: -Math.PI / 2 },
    { capacity: 7, radiusX: 29, radiusY: 25, angleOffset: -Math.PI / 2 + Math.PI / 7 },
    { capacity: 10, radiusX: 39, radiusY: 33, angleOffset: -Math.PI / 2 + Math.PI / 11 },
  ];

  let cursor = 0;
  for (const ring of ringConfigs) {
    const slice = others.slice(cursor, cursor + ring.capacity);
    slice.forEach((entity, index) => {
      positions.set(entity.id, placeOnEllipse(index, slice.length, ring.radiusX, ring.radiusY, ring.angleOffset));
    });
    cursor += slice.length;
    if (cursor >= others.length) {
      break;
    }
  }

  return resolveLayoutOverlaps(positions);
}

function resolveLayoutOverlaps(
  positions: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const entries: Array<[string, { x: number; y: number }]> = [];
  for (const entry of positions.entries()) {
    entries.push(entry);
  }

  const nudged = new Map(positions);

  for (let i = 0; i < entries.length; i += 1) {
    const [idA, posA] = entries[i]!;
    for (let j = i + 1; j < entries.length; j += 1) {
      const [idB, posB] = entries[j]!;
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 4 && distance > 0) {
        const nx = dx / distance;
        const ny = dy / distance;
        const spread = (4 - distance) / 2 + 1;
        nudged.set(idA, { x: posA.x - nx * spread, y: posA.y - ny * spread });
        nudged.set(idB, { x: posB.x + nx * spread, y: posB.y + ny * spread });
      }
    }
  }

  return nudged;
}

function strongestRelationWeight(relations: GraphRelation[], sourceEntityId: string, targetEntityId: string): number {
  let best = 0;
  for (const relation of relations) {
    const touchesPair = (
      (relation.fromEntityId === sourceEntityId && relation.toEntityId === targetEntityId)
      || (relation.fromEntityId === targetEntityId && relation.toEntityId === sourceEntityId)
    );
    if (touchesPair) {
      best = Math.max(best, relation.weight);
    }
  }

  return best;
}

function placeOnEllipse(index: number, total: number, radiusX: number, radiusY: number, angleOffset = -Math.PI / 2): { x: number; y: number } {
  if (total <= 0) {
    return { x: 50, y: 50 };
  }

  const angle = angleOffset + ((Math.PI * 2) / total) * index;
  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 50 + Math.sin(angle) * radiusY,
  };
}

function computeGraphNodeSize(entity: GraphEntity, maxMentionCount: number, focused: boolean): number {
  if (focused) {
    return 88;
  }

  const ratio = maxMentionCount <= 0 ? 0 : entity.mentionCount / maxMentionCount;
  return Math.round(52 + ratio * 20);
}

function buildGraphNodeWidth(node: GraphExplorerNode): number {
  let charWidth = 0;
  for (const char of node.entity.name) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0x3040 && codePoint <= 0x309f) ||
      (codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af)
    ) {
      charWidth += 19;
    } else if ((codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a) || (codePoint >= 0x30 && codePoint <= 0x39)) {
      charWidth += 9;
    } else {
      charWidth += 11;
    }
  }
  const nameWidth = Math.max(charWidth + 28, 112);
  return Math.min(Math.max(nameWidth, node.size + 24), 260);
}

function createDraft(detailPayload: LibraryNovelDetailPayload): GraphDraftState {
  const profile = detailPayload.knowledgeGraph.profile;
  return {
    chatModelKey: profile.chatModel ? `${profile.chatModel.providerId}::${profile.chatModel.modelId}` : '',
    extractionModelEntries: profile.extractionModels.map((model) => ({
      key: `${model.providerId}::${model.modelId}`,
      maxConcurrency: normalizeDraftExtractionConcurrency(model.maxConcurrency),
    })),
    embeddingModelKey: profile.embeddingModel ? `${profile.embeddingModel.providerId}::${profile.embeddingModel.modelId}` : '',
    rerankModelKey: profile.rerankModel ? `${profile.rerankModel.providerId}::${profile.rerankModel.modelId}` : '',
    extractionConcurrency: normalizeDraftExtractionConcurrency(profile.extractionConcurrency),
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
    extractionModels: draft.extractionModelEntries.flatMap((entry) => {
      const route = parseRouteKey(entry.key);
      return route?.providerId && route.modelId
        ? [{ ...route, maxConcurrency: normalizeDraftExtractionConcurrency(entry.maxConcurrency) }]
        : [];
    }),
    embeddingModel: parseRouteKey(draft.embeddingModelKey),
    rerankModel: parseRouteKey(draft.rerankModelKey),
    extractionConcurrency: normalizeDraftExtractionConcurrency(draft.extractionConcurrency),
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

function normalizeDraftExtractionConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 2;
  }

  return Math.max(1, Math.min(12, Math.trunc(value)));
}

function shouldExpandBuildProgress(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'paused' || status === 'failed';
}

function shouldUseGraphPreview(...values: Array<string | undefined>): boolean {
  const text = values.filter(Boolean).join(' ');
  return text.length > 90 || /\n/.test(text);
}

function buildEntityListPreview(
  entities: LibraryNovelDetailPayload['knowledgeGraph']['entities'],
): GraphPreviewDialogState {
  return {
    title: '全部实体',
    subtitle: `共 ${entities.length} 个实体，按当前权重排序展示。`,
    body: entities.map((entity, index) => [
      `${index + 1}. ${entity.name}`,
      `出现 ${entity.mentionCount} 次`,
      entity.summary,
      entity.aliases.length > 0 ? `别名：${entity.aliases.join('、')}` : '',
    ].filter(Boolean).join('\n')),
  };
}

function buildRelationListPreview(
  relations: LibraryNovelDetailPayload['knowledgeGraph']['relations'],
): GraphPreviewDialogState {
  return {
    title: '全部关系',
    subtitle: `共 ${relations.length} 条关系，按当前权重排序展示。`,
    body: relations.map((relation, index) => [
      `${index + 1}. ${relation.summary}`,
      `权重 ${relation.weight}`,
      ...relation.evidence.slice(0, 3).map((evidence, evidenceIndex) => `证据 ${evidenceIndex + 1}：${evidence}`),
    ].filter(Boolean).join('\n')),
  };
}

function formatGraphEntityType(entityType: GraphEntity['entityType']): string {
  switch (entityType) {
    case 'character':
      return '角色';
    case 'location':
      return '地点';
    case 'organization':
      return '组织';
    case 'concept':
      return '概念';
    case 'author':
      return '作者';
    default:
      return '实体';
  }
}

function formatGraphStatus(status: string): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '构建中';
    case 'paused':
      return '已暂停';
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

function buildLlmModelLabelMap(payload: ControlLlmProvidersPayload): Map<string, string> {
  return new Map(
    payload.providers.flatMap((provider) =>
      provider.models.map((model) => [
        `${provider.id}::${model.id}`,
        `${model.label} · ${provider.label}`,
      ] as const),
    ),
  );
}

function formatBuildModelLabel(labels: Map<string, string>, providerId: string, modelId: string): string {
  return labels.get(`${providerId}::${modelId}`) ?? '未命名模型';
}

function formatGraphCircuitState(state: 'closed' | 'open' | 'half-open'): string {
  switch (state) {
    case 'open':
      return '冷却中';
    case 'half-open':
      return '试探恢复';
    default:
      return '正常';
  }
}

function formatModelSource(source: 'novel' | 'global'): string {
  return source === 'novel' ? '单书配置' : '全局默认';
}

function formatThroughputPerMinute(value: number): string {
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} 次/分钟`;
}

function formatFailureRate(value: number): string {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function cryptoRandomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function computeSearchSuggestions(
  entities: GraphEntity[],
  rawInput: string,
): string[] {
  const query = rawInput.trim().toLowerCase();
  const seen = new Set<string>();
  const names: Array<{ text: string; score: number }> = [];

  for (const entity of entities) {
    addSuggestion(names, seen, entity.name, query);
    for (const alias of entity.aliases) {
      addSuggestion(names, seen, alias, query);
    }
  }

  names.sort((a, b) => b.score - a.score);
  return names.slice(0, 8).map((entry) => entry.text);
}

function addSuggestion(
  names: Array<{ text: string; score: number }>,
  seen: Set<string>,
  text: string,
  query: string,
): void {
  const normalized = text.toLowerCase();
  if (normalized.length === 0 || seen.has(normalized)) {
    return;
  }

  if (query.length === 0) {
    return;
  }

  const index = normalized.indexOf(query);
  if (index < 0) {
    return;
  }

  seen.add(normalized);
  names.push({ text, score: index === 0 ? 3 : 1 });
}