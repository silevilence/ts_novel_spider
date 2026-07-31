import crypto from 'node:crypto';

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import type { GeneratedLibraryExport, LibraryExportFormat, LibraryExportTranslationMode, LocalExportEngine, TranslatedParagraph } from './export-engine';
import type { RefinedTranslationModelConfig, RefinedTranslationReviewResolution, RefinedTranslationSegmentStatus, RefinedTranslationStage, RefinedTranslationTaskStatus, RefinedTranslationTermStatus, SqliteNovelRepository, StoredRefinedTranslationReviewRow, StoredRefinedTranslationTaskRow } from './novel-repository';
import type { SystemPreferencesService } from './system-preferences';
import type { StoredChapterRecord, StoredNovelSnapshot } from './spider';
import { createRefinedTranslationTools } from './refined-translation-tools';
import { splitChapterParagraphs } from './translation/nodes/segment-node';
import { generateRefinedTranslationText, runRefinedTranslationToolAgent } from './translation/nodes/translate-node';
import { resolveTranslationModel } from './translation-pipeline';

export const REFINED_TRANSLATION_STAGES: Array<{ id: RefinedTranslationStage; label: string; automatic: boolean }> = [
  { id: 'glossary_setup', label: '术语表建立', automatic: false },
  { id: 'glossary_translation', label: '术语翻译确认', automatic: false },
  { id: 'translating', label: '正文初翻', automatic: true },
  { id: 'checking', label: '遗漏检查', automatic: true },
  { id: 'reviewing', label: '审核校对', automatic: true },
  { id: 'revising', label: '审核修订', automatic: true },
  { id: 'completed', label: '完成', automatic: false },
];

const DEFAULT_MAX_REVIEW_ROUNDS = 5;
const GRAPH_ENTITY_PRIORITY_SCALE = 10;
const TRANSLATION_CONTEXT_SEGMENTS = 3;
const GLOSSARY_EXTRACTION_SOURCE_LIMIT = 18_000;

type RefinedTextGenerator = (preferences: SystemPreferencesService, route: { providerId: string; modelId: string; thinkingEnabled?: boolean }, system: string, prompt: string) => Promise<string>;
type RefinedToolAgentRunner = (preferences: SystemPreferencesService, route: { providerId: string; modelId: string; thinkingEnabled?: boolean }, system: string, prompt: string, tools: import('ai').ToolSet, firstToolName?: string) => Promise<{ text: string; toolCallCount: number; toolCalls: Array<{ toolName: string; input: unknown }> }>;
type WorkflowDecision = 'pause' | 'retranslate' | 'review' | 'revise' | 'next_chapter' | 'complete' | 'needs_attention';
export type RefinedChapterAgentMode = 'read' | 'edit_review' | 'edit_skip_review';
export interface RefinedChapterAgentEdit { paragraphIndex: number; translatedText: string; }

interface RefinedWorkflowStateValue {
  taskId: string;
  stage: RefinedTranslationStage;
  chapterId: string | null;
  decision: WorkflowDecision;
}

/** 任务状态图的状态完全由任务专属 SQLite checkpoint 镜像，服务重启后可重新执行。 */
const RefinedWorkflowState = Annotation.Root({
  taskId: Annotation<string>({ reducer: (_previous, next) => next, default: () => '' }),
  stage: Annotation<RefinedTranslationStage>({ reducer: (_previous, next) => next, default: () => 'glossary_setup' }),
  chapterId: Annotation<string | null>({ reducer: (_previous, next) => next, default: () => null }),
  decision: Annotation<WorkflowDecision>({ reducer: (_previous, next) => next, default: () => 'pause' }),
});

export interface RefinedTranslationTaskDetail {
  task: StoredRefinedTranslationTaskRow;
  chapters: ReturnType<SqliteNovelRepository['listRefinedTranslationChapters']>;
  progress: { total: number; translated: number; pending: number; failed: number; skipped: number; reviewedChapters: number; currentRound: number };
  stepProgress: { glossary: { total: number; confirmed: number; excluded: number }; chapters: { total: number; reviewed: number; needsAttention: number } };
  logs: ReturnType<SqliteNovelRepository['listRefinedTranslationLogs']>;
  checkpoints: ReturnType<SqliteNovelRepository['listRefinedTranslationCheckpoints']>;
  transitions: ReturnType<SqliteNovelRepository['listRefinedTranslationTransitions']>;
  workflow: typeof REFINED_TRANSLATION_STAGES;
}

export interface RefinedTranslationStreamEvent {
  type: 'task_updated' | 'log' | 'segment_updated' | 'review_updated';
  taskId: string;
  chapterId?: string;
  paragraphIndex?: number;
}

export class RefinedTranslationService {
  readonly #listeners = new Map<string, Set<(event: RefinedTranslationStreamEvent) => void>>();
  readonly #repository: SqliteNovelRepository;
  readonly #preferences: SystemPreferencesService;
  readonly #exportEngine: LocalExportEngine;
  readonly #generateText: RefinedTextGenerator;
  readonly #runToolAgent: RefinedToolAgentRunner | null;
  readonly #abortControllers = new Map<string, AbortController>();

  constructor(repository: SqliteNovelRepository, preferences: SystemPreferencesService, exportEngine: LocalExportEngine, generateText: RefinedTextGenerator = generateRefinedTranslationText, toolAgentRunner?: RefinedToolAgentRunner) {
    this.#repository = repository;
    this.#preferences = preferences;
    this.#exportEngine = exportEngine;
    this.#generateText = generateText;
    this.#runToolAgent = toolAgentRunner ?? (generateText === generateRefinedTranslationText ? async (runnerPreferences, route, system, prompt, tools, firstToolName) => {
      const result = await runRefinedTranslationToolAgent(runnerPreferences, route, system, prompt, tools, firstToolName);
      return { ...result, toolCalls: result.toolCalls };
    } : null);
  }

  recoverInterruptedTasks(): void {
    const resumedTaskIds = new Set<string>();
    for (const task of this.#repository.listResumableRefinedTranslationTasks()) {
      resumedTaskIds.add(task.id);
      this.#log(task.id, 'info', '服务重启后从最近 checkpoint 恢复任务。');
      void this.#run(task.id);
    }
    // Older versions could mark a task as needing attention while the workflow still
    // had later chapters to process. Repair that persisted mismatch on startup so the
    // user is not asked to intervene before the automatic pass reaches the final chapter.
    for (const task of this.#repository.listRefinedTranslationTasks()) {
      if (resumedTaskIds.has(task.id) || task.status !== 'needs_attention' || task.stage === 'completed') continue;
      this.#resumeRemainingAutomaticWork(task.id, '服务重启时检测到旧状态错配');
    }
  }

  createTask(sourceId: string, novelId: string, input: { name?: string | undefined; sourceLang?: string | undefined; targetLang?: string | undefined; modelConfig?: Partial<RefinedTranslationModelConfig> | undefined }): StoredRefinedTranslationTaskRow {
    const snapshot = this.#repository.getSnapshot(sourceId, novelId);
    if (!snapshot) throw new Error(`Library novel ${sourceId}/${novelId} was not found.`);
    const chapters = snapshot.chapters.filter((chapter) => chapter.status === 'downloaded' && chapter.content?.trim()).map((chapter) => ({ id: chapter.id, index: chapter.index, title: chapter.title, volumeTitle: chapter.volumeTitle ?? null, content: chapter.content!, paragraphs: splitChapterParagraphs(chapter.content!) }));
    if (!chapters.length) throw new Error('请先至少采集一章正文，再创建精翻任务。');
    const preferences = this.#preferences.getTranslationState().config;
    const modelConfig: RefinedTranslationModelConfig = {
      termExtractionModel: toRoute(preferences.termExtractionModel), termTranslationModel: null,
      translationModels: preferences.translationModels.flatMap((route) => { const item = toRoute(route); return item ? [item] : []; }),
      omissionModel: null, reviewModel: null, concurrency: preferences.translationConcurrency, maxReviewRounds: DEFAULT_MAX_REVIEW_ROUNDS, ...input.modelConfig,
    };
    const termMap = new Map<string, { sourceTerm: string; targetTerm: string | null; entityType: string | null; priority: number; suggestion: string | null }>();
    for (const term of this.#repository.listTranslationTerms(sourceId, novelId)) termMap.set(term.sourceTerm, { sourceTerm: term.sourceTerm, targetTerm: term.targetTerm, entityType: term.entityType, priority: term.priority, suggestion: null });
    for (const entity of this.#repository.listKnowledgeGraphEntities(sourceId, novelId)) if (!termMap.has(entity.name)) termMap.set(entity.name, { sourceTerm: entity.name, targetTerm: null, entityType: entity.entityType, priority: Math.round(entity.prominence * GRAPH_ENTITY_PRIORITY_SCALE), suggestion: '来自知识图谱实体，建议人工确认。' });
    const today = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short' }).format(new Date());
    const task = this.#repository.createRefinedTranslationTask({ id: crypto.randomUUID(), sourceId, novelId, name: input.name?.trim() || `${snapshot.metadata.title} 精翻任务 ${today}`, novelTitle: snapshot.metadata.title, author: snapshot.metadata.author, sourceMetadata: { title: snapshot.metadata.title, author: snapshot.metadata.author, description: snapshot.metadata.description, tags: [...snapshot.metadata.tags], infoPageUrl: snapshot.metadata.infoPageUrl }, sourceLang: input.sourceLang ?? preferences.sourceLang, targetLang: input.targetLang ?? preferences.targetLang, modelConfig, chapters, terms: [...termMap.values()] });
    this.#checkpoint(task.id, 'glossary_setup', { event: 'created', chapters: chapters.length, terms: termMap.size });
    this.#repository.appendRefinedTranslationTransition({ taskId: task.id, fromStage: null, toStage: 'glossary_setup', condition: '创建精翻任务并保存原文快照', chapterId: null, reviewRound: null });
    this.#emit(task.id, { type: 'task_updated', taskId: task.id });
    return task;
  }

  listTasks(recycleBin = false) {
    return this.#repository.listRefinedTranslationTasks(recycleBin)
      .filter((task) => recycleBin ? task.deletedAt !== null : task.deletedAt === null)
      .map((task) => {
        const segments = this.#repository.listRefinedTranslationChapters(task.id)
          .flatMap((chapter) => this.#repository.listRefinedTranslationSegments(task.id, chapter.chapterId));
        const completed = segments.filter((segment) => segment.status === 'translated' || segment.status === 'skipped').length;
        return { ...task, progress: { total: segments.length, completed, failed: segments.filter((segment) => segment.status === 'failed').length } };
      });
  }

  updateTaskConfiguration(taskId: string, input: { name?: string | undefined; sourceLang?: string | undefined; targetLang?: string | undefined; modelConfig?: RefinedTranslationModelConfig | undefined }): StoredRefinedTranslationTaskRow | null {
    if (!this.#editable(taskId)) return null;
    const updated = this.#repository.updateRefinedTranslationTask(taskId, input);
    if (updated) this.#touch(taskId, '任务配置已更新；尚未发起的模型调用将使用新配置，进行中的单次调用保持原配置。');
    return updated;
  }

  getTaskDetail(taskId: string): RefinedTranslationTaskDetail | null {
    this.#resumeRemainingAutomaticWork(taskId, '读取任务状态时发现仍有未完成章节');
    const task = this.#repository.getRefinedTranslationTask(taskId); if (!task) return null;
    const chapters = this.#repository.listRefinedTranslationChapters(taskId);
    const all = chapters.flatMap((chapter) => this.#repository.listRefinedTranslationSegments(taskId, chapter.chapterId));
    const terms = this.listTerms(taskId);
    const activeCheckpoint = this.#repository.getRefinedTranslationCheckpoint(taskId, task.stage)?.state;
    const activeChapterId = typeof activeCheckpoint?.chapterId === 'string' ? activeCheckpoint.chapterId : null;
    const activeChapter = activeChapterId ? chapters.find((chapter) => chapter.chapterId === activeChapterId) ?? null : null;
    return {
      task,
      chapters,
      progress: { total: all.length, translated: all.filter((item) => item.status === 'translated').length, pending: all.filter((item) => item.status === 'pending').length, failed: all.filter((item) => item.status === 'failed').length, skipped: all.filter((item) => item.status === 'skipped').length, reviewedChapters: chapters.filter((chapter) => chapter.status === 'reviewed').length, currentRound: activeChapter?.reviewRound ?? 0 },
      stepProgress: { glossary: { total: terms.length, confirmed: terms.filter((term) => term.status === 'confirmed').length, excluded: terms.filter((term) => term.status === 'excluded').length }, chapters: { total: chapters.length, reviewed: chapters.filter((chapter) => chapter.status === 'reviewed').length, needsAttention: chapters.filter((chapter) => chapter.status === 'needs_attention' || chapter.status === 'failed').length } },
      logs: this.#repository.listRefinedTranslationLogs(taskId),
      checkpoints: this.#repository.listRefinedTranslationCheckpoints(taskId),
      transitions: this.#repository.listRefinedTranslationTransitions(taskId),
      workflow: REFINED_TRANSLATION_STAGES,
    };
  }

  getChapter(taskId: string, chapterId: string) { const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId); return chapter ? { chapter, segments: this.#repository.listRefinedTranslationSegments(taskId, chapterId), reviews: this.#repository.listRefinedTranslationReviews(taskId, chapterId) } : null; }
  readOriginalChapter(taskId: string, chapterId: string) { const chapter = this.getChapter(taskId, chapterId); const task = this.#repository.getRefinedTranslationTask(taskId); return chapter ? { metadata: task?.sourceMetadata ?? null, chapter: chapter.chapter, title: chapter.chapter.title, paragraphs: chapter.segments.map(({ paragraphIndex, sourceText }) => ({ paragraphIndex, sourceText })) } : null; }
  readOriginalChapters(taskId: string, chapterIds?: string[]) { const wanted = chapterIds?.length ? new Set(chapterIds) : null; return this.#repository.listRefinedTranslationChapters(taskId).filter((chapter) => !wanted || wanted.has(chapter.chapterId)).flatMap((chapter) => { const result = this.readOriginalChapter(taskId, chapter.chapterId); return result ? [result] : []; }); }
  readCurrentTranslation(taskId: string, chapterId: string) { return this.getChapter(taskId, chapterId); }
  readCurrentTranslations(taskId: string, chapterIds?: string[]) { const wanted = chapterIds?.length ? new Set(chapterIds) : null; return this.#repository.listRefinedTranslationChapters(taskId).filter((chapter) => !wanted || wanted.has(chapter.chapterId)).flatMap((chapter) => { const result = this.getChapter(taskId, chapter.chapterId); return result ? [result] : []; }); }
  readChapterTranslation(taskId: string, chapterId: string) { return this.getChapter(taskId, chapterId); }
  readUntranslatedSegments(taskId: string, chapterId?: string) { const chapters = chapterId ? [this.#repository.getRefinedTranslationChapter(taskId, chapterId)].filter((item): item is NonNullable<typeof item> => item !== null) : this.#repository.listRefinedTranslationChapters(taskId); return chapters.flatMap((chapter) => this.#repository.listRefinedTranslationSegments(taskId, chapter.chapterId).filter((segment) => segment.status === 'pending' || segment.status === 'failed')); }
  readContextChapters(taskId: string, chapterId: string) { const chapters = this.#repository.listRefinedTranslationChapters(taskId); const index = chapters.findIndex((chapter) => chapter.chapterId === chapterId); return [chapters[index - 1], chapters[index + 1]].filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter)).map((chapter) => this.getChapter(taskId, chapter.chapterId)!); }
  listTerms(taskId: string) { return this.#repository.listRefinedTranslationTerms(taskId); }
  createTerm(taskId: string, input: { sourceTerm: string; targetTerm?: string | null; entityType?: string | null; priority?: number; suggestion?: string | null; status?: RefinedTranslationTermStatus }) { if (!this.#editable(taskId)) return null; if (!input.sourceTerm.trim()) throw new Error('源术语不能为空。'); const term = this.#repository.createRefinedTranslationTerm(taskId, input); this.#touch(taskId, `已新增术语“${term.sourceTerm}”。`); return term; }
  updateTerm(taskId: string, termId: string, input: { targetTerm?: string | null; entityType?: string | null; priority?: number; suggestion?: string | null; status?: RefinedTranslationTermStatus }) { if (!this.#editable(taskId)) return null; const term = this.#repository.updateRefinedTranslationTerm(taskId, termId, input); if (term) this.#touch(taskId, '已更新术语表。'); return term; }
  deleteTerm(taskId: string, termId: string) { if (!this.#editable(taskId)) return false; const ok = this.#repository.deleteRefinedTranslationTerm(taskId, termId); if (ok) this.#touch(taskId, '已删除术语。'); return ok; }
  deleteTerms(taskId: string, termIds: string[]) {
    if (!this.#editable(taskId)) return [];
    const deletedIds = this.#repository.deleteRefinedTranslationTerms(taskId, termIds);
    if (deletedIds.length) this.#touch(taskId, `已批量删除 ${deletedIds.length} 条术语。`);
    return deletedIds;
  }
  bulkUpdateTerms(taskId: string, termIds: string[], status: Extract<RefinedTranslationTermStatus, 'confirmed' | 'excluded'>) { if (!this.#editable(taskId)) return []; return termIds.flatMap((termId) => { const term = this.#repository.updateRefinedTranslationTerm(taskId, termId, { status }); return term ? [term] : []; }); }
  writeSegment(taskId: string, chapterId: string, paragraphIndex: number, input: { translatedText: string | null; status?: RefinedTranslationSegmentStatus }) {
    if (!this.#editable(taskId)) return null;
    const status = input.status ?? (input.translatedText?.trim() ? 'translated' : 'pending');
    const segment = this.#repository.updateRefinedTranslationSegment(taskId, chapterId, paragraphIndex, input.translatedText, status);
    if (segment) { this.#checkpoint(taskId, this.#repository.getRefinedTranslationTask(taskId)?.stage ?? 'translating', { chapterId, paragraphIndex, segmentStatus: segment.status }); this.#touch(taskId, `已保存第 ${paragraphIndex + 1} 段译文。`); this.#emit(taskId, { type: 'segment_updated', taskId, chapterId, paragraphIndex }); }
    return segment;
  }
  writeSegments(taskId: string, updates: Array<{ chapterId: string; paragraphIndex: number; translatedText: string; status?: RefinedTranslationSegmentStatus }>) {
    return updates.flatMap((update) => { const saved = this.writeSegment(taskId, update.chapterId, update.paragraphIndex, { translatedText: update.translatedText, ...(update.status ? { status: update.status } : {}) }); return saved ? [saved] : []; });
  }
  updateChapterTitle(taskId: string, chapterId: string, translatedTitle: string | null) {
    if (!this.#editable(taskId)) return null;
    const chapter = this.#repository.updateRefinedTranslationChapterTitle(taskId, chapterId, translatedTitle);
    if (chapter) this.#touch(taskId, `已保存第 ${chapter.chapterIndex} 章标题译文。`);
    return chapter;
  }
  readGlossary(taskId: string) { return this.listTerms(taskId); }
  async extractGlossaryCandidates(taskId: string) {
    if (!this.#editable(taskId)) throw new Error('回收站任务仅可查看与导出。');
    const task = this.#repository.getRefinedTranslationTask(taskId);
    if (!task) throw new Error('精翻任务不存在。');
    const route = task.modelConfig.termExtractionModel ?? this.#resolveRoute(task, 'translationModels');
    if (!route) throw new Error('未配置术语提取模型；请先在任务配置中选择模型。');
    const source = this.#repository.listRefinedTranslationChapters(taskId)
      .map((chapter) => `【第 ${chapter.chapterIndex} 章 ${chapter.title}】\n${chapter.sourceContent}`)
      .join('\n\n')
      .slice(0, GLOSSARY_EXTRACTION_SOURCE_LIMIT);
    if (!source.trim()) throw new Error('任务中没有可用于提取术语的原文快照。');
    // Extraction is one bounded prompt over a local snapshot. A tool agent may repeatedly
    // read all chapters and spend up to eight tool steps, which turns a short glossary pass
    // into minutes of work before any candidate is added.
    const response = await this.#generateText(
      this.#preferences,
      route,
      `从${task.sourceLang}小说原文中提取需要保持一致的术语候选。只返回 JSON：{"terms":[{"sourceTerm":"...","entityType":"character|location|organization|item|concept|other","priority":0-10,"suggestion":"简短说明"}]}。不要翻译术语，也不要输出 JSON 之外的内容。`,
      source,
    );
    const candidates = parseGlossaryCandidates(response);
    const existing = new Map(this.listTerms(taskId).map((term) => [term.sourceTerm, term]));
    let added = 0;
    for (const candidate of candidates) {
      const known = existing.get(candidate.sourceTerm);
      if (known) {
        this.#repository.updateRefinedTranslationTerm(taskId, known.id, { entityType: candidate.entityType ?? known.entityType, priority: candidate.priority, suggestion: candidate.suggestion ?? known.suggestion });
        continue;
      }
      const term = this.#repository.createRefinedTranslationTerm(taskId, { ...candidate, status: 'pending' });
      existing.set(term.sourceTerm, term);
      added += 1;
    }
    this.#checkpoint(taskId, 'glossary_setup', { event: 'ai_term_extraction', candidates: candidates.length, added });
    this.#touch(taskId, added ? `术语 AI 已提取 ${added} 条新候选，请人工确认。` : '术语 AI 未发现新的候选术语。');
    return this.listTerms(taskId);
  }
  updateGlossaryTerm(taskId: string, termId: string, input: Parameters<RefinedTranslationService['updateTerm']>[2]) { return this.updateTerm(taskId, termId, input); }
  async suggestGlossaryRevision(taskId: string, termId: string, feedback: string): Promise<string> { const task = this.#repository.getRefinedTranslationTask(taskId); const term = this.listTerms(taskId).find((item) => item.id === termId); if (!task || !term) throw new Error('术语或任务不存在。'); const route = task.modelConfig.termTranslationModel ?? this.#resolveRoute(task, 'translationModels'); if (!route) throw new Error('未配置可用的术语翻译模型。'); return this.#generateText(this.#preferences, route, `根据用户意见修改术语译法。只输出建议译文。用户意见：${feedback}`, `原术语：${term.sourceTerm}\n当前译文：${term.targetTerm ?? '（空）'}`); }
  async suggestSegmentRevision(taskId: string, chapterId: string, paragraphIndex: number, feedback: string): Promise<string> { const task = this.#repository.getRefinedTranslationTask(taskId); const segment = this.#repository.listRefinedTranslationSegments(taskId, chapterId).find((item) => item.paragraphIndex === paragraphIndex); if (!task || !segment) throw new Error('段落或任务不存在。'); const route = this.#resolveSegmentRoute(task, paragraphIndex); if (!route) throw new Error('未配置可用的正文初翻模型。'); return this.#generateText(this.#preferences, route, `根据用户意见修改文学译文。只输出修改后的译文。用户意见：${feedback}`, `原文：${segment.sourceText}\n当前译文：${segment.translatedText ?? '（空）'}`); }
  async chatAboutChapter(taskId: string, chapterId: string, input: { message: string; mode: RefinedChapterAgentMode; paragraphIndices?: number[]; history?: Array<{ role: 'user' | 'assistant'; content: string }> }) {
    const task = this.#repository.getRefinedTranslationTask(taskId);
    const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId);
    if (!task || !chapter) throw new Error('任务或章节不存在。');
    if (input.mode !== 'read' && (!this.#editable(taskId) || task.status === 'running')) throw new Error(task.status === 'running' ? '任务正在自动处理；请先暂停后再允许 Agent 编辑。' : '回收站任务仅支持只读问答。');
    const route = this.#resolveRoute(task, 'translationModels') ?? this.#resolveRoute(task, 'reviewModel');
    if (!route) throw new Error('未配置可用的章节 Agent 模型。');
    const selected = new Set((input.paragraphIndices ?? []).filter((index) => Number.isInteger(index) && index >= 0));
    const rows = this.#repository.listRefinedTranslationSegments(taskId, chapterId);
    const visibleRows = selected.size ? rows.filter((row) => selected.has(row.paragraphIndex)) : rows;
    const material = `章节标题：${chapter.title}\n当前标题译文：${chapter.translatedTitle ?? '（未译）'}\n\n${visibleRows.map((row) => `段落 #${row.paragraphIndex + 1}（paragraphIndex=${row.paragraphIndex}）\n原文：${row.sourceText}\n当前译文：${row.translatedText ?? '（未译）'}`).join('\n\n')}`;
    const history = (input.history ?? []).slice(-8).map((item) => `${item.role === 'user' ? '用户' : 'Agent'}：${item.content}`).join('\n');
    const locator = `当前工具定位信息：task_id=${taskId}，chapter_id=${chapterId}，章节序号=${chapter.chapterIndex}。工具已经绑定到此任务和章节，不需要也不能自行传 task_id。`;
    const editInstruction = input.mode === 'read'
      ? '你处于只读模式：必须先按需调用 read_original_chapter、read_current_translation、read_glossary 读取任务物料；不能调用写入工具。随后直接以自然语言回答用户问题。'
      : '你处于编辑模式：必须先读取当前译文和术语表。每个确有必要的段落修改都必须调用 write_translation_segment。该工具会生成待用户批准的修改请求，调用后不要自行声称已经写入；不要修改未提供的段落。';
    const toolResult = await this.#tryRunToolAgent(taskId, route,
      `你是精翻工作区的章节 Agent。${editInstruction}\n${locator}`,
      `章节：${chapter.title}\n用户问题：${input.message}\n${history ? `历史对话：\n${history}\n` : ''}当前选中段落索引：${[...selected].join(', ') || '全部'}。`,
      createRefinedTranslationTools(this, { taskId, chapterIds: [chapterId], writable: input.mode !== 'read', requireWriteApproval: input.mode !== 'read' }),
    );
    const response = toolResult?.text || await this.#generateText(this.#preferences, route, `你是精翻工作区的章节 Agent。${input.mode === 'read' ? '你处于只读模式：不能提出或执行任何写入。直接以自然语言回答用户问题。' : '你处于编辑模式。仅返回 JSON：{"reply":"给用户的简短说明","edits":[{"paragraphIndex":0,"translatedText":"修改后的完整译文"}]}。只提交确有必要的段落修改；不要修改未提供的段落。'}\n${locator}`, `章节：${chapter.title}\n用户问题：${input.message}\n${history ? `历史对话：\n${history}\n` : ''}可用段落：\n${material}`);
    if (input.mode === 'read') return { reply: response.trim(), mode: input.mode, appliedParagraphIndices: [] as number[], proposedEdits: [] as RefinedChapterAgentEdit[] };
    const toolEdits = toolResult?.toolCalls.flatMap((call) => {
      if (call.toolName !== 'write_translation_segment' || !call.input || typeof call.input !== 'object') return [];
      const value = call.input as { chapterId?: unknown; paragraphIndex?: unknown; translatedText?: unknown };
      return value.chapterId === chapterId && typeof value.paragraphIndex === 'number' && typeof value.translatedText === 'string' ? [{ paragraphIndex: value.paragraphIndex, translatedText: value.translatedText.trim() }] : [];
    }) ?? [];
    if (toolEdits.length) return { reply: response.trim() || '已生成待确认的章节修改请求。', mode: input.mode, appliedParagraphIndices: [] as number[], proposedEdits: toolEdits };
    const parsed = parseChapterAgentResponse(response);
    const proposedEdits = parsed.edits.filter((edit) => rows.some((row) => row.paragraphIndex === edit.paragraphIndex) && edit.translatedText.trim()).map((edit) => ({ paragraphIndex: edit.paragraphIndex, translatedText: edit.translatedText.trim() }));
    return { reply: parsed.reply || '已生成修改提案，请确认后再写入任务。', mode: input.mode, appliedParagraphIndices: [] as number[], proposedEdits };
  }
  async applyChapterAgentEdits(taskId: string, chapterId: string, input: { mode: Exclude<RefinedChapterAgentMode, 'read'>; edits: RefinedChapterAgentEdit[] }) {
    const task = this.#repository.getRefinedTranslationTask(taskId);
    const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId);
    if (!task || !chapter || !this.#editable(taskId)) throw new Error('任务或章节不可编辑。');
    if (task.status === 'running') throw new Error('任务正在自动处理；请先暂停后再确认修改。');
    const rows = this.#repository.listRefinedTranslationSegments(taskId, chapterId);
    const appliedParagraphIndices: number[] = [];
    for (const edit of input.edits) {
      if (!rows.some((row) => row.paragraphIndex === edit.paragraphIndex) || !edit.translatedText.trim()) continue;
      this.writeSegment(taskId, chapterId, edit.paragraphIndex, { translatedText: edit.translatedText.trim(), status: 'translated' });
      appliedParagraphIndices.push(edit.paragraphIndex);
    }
    if (appliedParagraphIndices.length && input.mode === 'edit_review') {
      const nextReviewRound = task.status === 'needs_attention' ? 0 : chapter.reviewRound;
      this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: nextReviewRound, reviewScore: null, status: 'translated' });
      this.#repository.updateRefinedTranslationTask(taskId, { stage: 'checking', status: 'running' });
      this.#checkpoint(taskId, 'checking', { event: 'agent_edit_requires_review', chapterId, paragraphIndices: appliedParagraphIndices, transitionCondition: '用户确认章节 Agent 修改，重新执行遗漏检查与审核' });
      this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: task.stage, toStage: 'checking', condition: '用户确认章节 Agent 修改，重新执行遗漏检查与审核', chapterId, reviewRound: nextReviewRound });
      this.#touch(taskId, `章节 Agent 已修改 ${appliedParagraphIndices.length} 段，正在重新检查并审核。`);
      void this.#run(taskId);
    } else if (appliedParagraphIndices.length) {
      this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: chapter.reviewRound, reviewScore: chapter.reviewScore, status: 'reviewed' });
      if (task.status === 'needs_attention') {
        const allReviewed = this.#repository.listRefinedTranslationChapters(taskId).every((item) => item.status === 'reviewed');
        this.#repository.updateRefinedTranslationTask(taskId, allReviewed ? { stage: 'completed', status: 'completed' } : { stage: 'translating', status: 'paused' });
      }
      this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: task.stage, toStage: task.status === 'needs_attention' ? 'translating' : task.stage, condition: '用户确认章节 Agent 修改并跳过审核', chapterId, reviewRound: chapter.reviewRound });
      this.#touch(taskId, `章节 Agent 已直接应用 ${appliedParagraphIndices.length} 段修改（已跳过审核）。`);
    }
    return { appliedParagraphIndices };
  }
  listReviews(taskId: string, chapterId?: string) { return this.#repository.listRefinedTranslationReviews(taskId, chapterId); }
  readReviewIssues(taskId: string, chapterId?: string) { return this.listReviews(taskId, chapterId); }
  writeReview(taskId: string, input: Omit<StoredRefinedTranslationReviewRow, 'id' | 'taskId' | 'createdAt'>) { if (!this.#editable(taskId)) throw new Error('回收站任务仅可查看与导出。'); const review = this.#repository.createRefinedTranslationReview({ ...input, taskId }); this.#touch(taskId, `已写入第 ${input.reviewRound} 轮审核意见。`); this.#emit(taskId, { type: 'review_updated', taskId, chapterId: input.chapterId }); return review; }
  markSegmentIssue(taskId: string, input: Omit<StoredRefinedTranslationReviewRow, 'id' | 'taskId' | 'createdAt' | 'paragraphIndices'> & { paragraphIndex: number }) { return this.writeReview(taskId, { ...input, paragraphIndices: [input.paragraphIndex] }); }
  resolveReview(taskId: string, reviewId: string, resolution: RefinedTranslationReviewResolution, resolutionNote: string | null = null) {
    if (!this.#editable(taskId)) return false;
    const review = this.#repository.listRefinedTranslationReviews(taskId).find((item) => item.id === reviewId);
    const ok = this.#repository.updateRefinedTranslationReview(taskId, reviewId, resolution, resolutionNote);
    if (!ok) return false;
    this.#touch(taskId, resolution === 'rejected' || resolution === 'ignored' ? '已拒绝审核意见。' : resolution === 'accepted' || resolution === 'resolved' ? '已接受审核意见。' : resolution === 'partially_accepted' ? '已部分接受审核意见。' : '已重新打开审核意见。');
    if (review && resolution !== 'open') this.#restartManualReviewIfReady(taskId, review.chapterId);
    return true;
  }

  retryFailedSegments(taskId: string, chapterId?: string, paragraphIndex?: number): StoredRefinedTranslationTaskRow | null {
    if (!this.#editable(taskId)) return null;
    const taskBeforeRetry = this.#repository.getRefinedTranslationTask(taskId);
    const chapters = chapterId ? [this.#repository.getRefinedTranslationChapter(taskId, chapterId)].filter((item): item is NonNullable<typeof item> => item !== null) : this.#repository.listRefinedTranslationChapters(taskId);
    let firstRetriedChapterId: string | null = null;
    let firstReviewRevisionChapterId: string | null = null;
    let hasFailedSegments = false;
    for (const chapter of chapters) {
      let retried = false;
      const openReviews = this.#repository.listRefinedTranslationReviews(taskId, chapter.chapterId).filter((review) => !review.resolved);
      if (openReviews.length) firstReviewRevisionChapterId ??= chapter.chapterId;
      for (const segment of this.#repository.listRefinedTranslationSegments(taskId, chapter.chapterId)) {
        const explicitlyRequested = paragraphIndex === undefined || segment.paragraphIndex === paragraphIndex;
        if (!explicitlyRequested || segment.status !== 'failed') continue;
        this.#repository.updateRefinedTranslationSegment(taskId, chapter.chapterId, segment.paragraphIndex, segment.translatedText, 'pending');
        retried = true;
        hasFailedSegments = true;
      }
      if (retried || openReviews.length || chapter.status === 'needs_attention') {
        this.#repository.updateRefinedTranslationChapterReview(taskId, chapter.chapterId, { reviewRound: chapter.reviewRound, reviewScore: chapter.reviewScore, status: 'pending' });
        firstRetriedChapterId ??= chapter.chapterId;
      }
    }
    const stage: RefinedTranslationStage = firstReviewRevisionChapterId && !hasFailedSegments ? 'revising' : 'translating';
    const targetChapterId = stage === 'revising' ? firstReviewRevisionChapterId : firstRetriedChapterId;
    const updated = this.#repository.updateRefinedTranslationTask(taskId, { stage, status: 'running' });
    this.#checkpoint(taskId, stage, { event: 'retry_failed', chapterId: targetChapterId });
    this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: taskBeforeRetry?.stage ?? null, toStage: stage, condition: stage === 'revising' ? '用户要求 Agent 按开放审核意见逐段修订' : '用户重试失败段落', chapterId: targetChapterId, reviewRound: targetChapterId ? this.#repository.getRefinedTranslationChapter(taskId, targetChapterId)?.reviewRound ?? null : null });
    this.#touch(taskId, targetChapterId ? stage === 'revising' ? '审核修订 Agent 已入队，将只处理审核意见关联段落。' : '失败段落已重新入队，将先补译后重新审核。' : '没有找到可重试的段落。'); void this.#run(taskId); return updated;
  }

  advance(taskId: string): StoredRefinedTranslationTaskRow | null {
    const task = this.#repository.getRefinedTranslationTask(taskId); if (!task || task.deletedAt) return null;
    if (task.stage === 'glossary_translation') {
      const pendingTerms = this.listTerms(taskId).filter((term) => term.status === 'pending');
      if (pendingTerms.length) throw new Error(`请先确认或排除全部术语译法（仍有 ${pendingTerms.length} 条待确认）。`);
    }
    const next: Partial<Record<RefinedTranslationStage, RefinedTranslationStage>> = { glossary_setup: 'glossary_translation', glossary_translation: 'translating' };
    const stage = next[task.stage];
    if (!stage) return task;
    const updated = this.#repository.updateRefinedTranslationTask(taskId, { stage, status: 'running' });
    this.#checkpoint(taskId, task.stage, { event: 'advanced', stage });
    this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: task.stage, toStage: stage, condition: '用户确认当前人工步骤', chapterId: null, reviewRound: null });
    this.#touch(taskId, `已进入${REFINED_TRANSLATION_STAGES.find((item) => item.id === stage)?.label ?? stage}。`);
    void this.#run(taskId);
    return updated;
  }

  pause(taskId: string) { this.#abortControllers.get(taskId)?.abort(); const task = this.#repository.updateRefinedTranslationTask(taskId, { status: 'paused' }); if (task) this.#touch(taskId, '任务已暂停。'); return task; }
  resume(taskId: string) { const task = this.#repository.getRefinedTranslationTask(taskId); if (!task || task.deletedAt) return null; const updated = this.#repository.updateRefinedTranslationTask(taskId, { status: 'running' }); if (updated) { this.#touch(taskId, '任务已恢复。'); void this.#run(taskId); } return updated; }
  markDeleted(taskId: string) { this.#abortControllers.get(taskId)?.abort(); const task = this.#repository.markRefinedTranslationTaskDeleted(taskId); if (task) this.#emit(taskId, { type: 'task_updated', taskId }); return task; }
  restore(taskId: string) { const task = this.#repository.restoreRefinedTranslationTask(taskId); if (task) this.#emit(taskId, { type: 'task_updated', taskId }); return task; }
  getPurgeStatus(taskId: string) { return this.#repository.getRefinedTranslationPurgeStatus(taskId); }
  purge(taskId: string) { const status = this.getPurgeStatus(taskId); if (!status) return false; if (!status.canPurge) throw new Error(`任务仍在回收站保留期内，${status.remainingDays} 天后才能永久删除。`); return this.#repository.purgeRefinedTranslationTask(taskId); }

  async exportTask(taskId: string, format: LibraryExportFormat, mode: LibraryExportTranslationMode, includeIncomplete: boolean): Promise<GeneratedLibraryExport | null> {
    const task = this.#repository.getRefinedTranslationTask(taskId); if (!task) return null;
    const allChapters = this.#repository.listRefinedTranslationChapters(taskId);
    const chapters = includeIncomplete ? allChapters : allChapters.filter((chapter) => chapter.status === 'reviewed' || chapter.status === 'translated');
    if (!chapters.length) throw new Error('没有可导出的已完成章节。');
    const records: StoredChapterRecord[] = chapters.map((chapter) => ({ id: chapter.chapterId, index: chapter.chapterIndex, title: chapter.title, ...(chapter.volumeTitle ? { volumeTitle: chapter.volumeTitle } : {}), url: `refined://${taskId}/${chapter.chapterId}`, content: chapter.sourceContent, status: 'downloaded', errorMessage: null, downloadedAt: task.createdAt, updatedAt: chapter.updatedAt }));
    const snapshot: StoredNovelSnapshot = { sourceId: `refined-${taskId}`, metadata: { novelId: taskId, title: task.sourceMetadata.title, author: task.sourceMetadata.author, description: task.sourceMetadata.description, tags: task.sourceMetadata.tags, chapterCount: records.length, infoPageUrl: task.sourceMetadata.infoPageUrl }, chapters: records, updatedAt: task.updatedAt };
    const translatedParagraphsByChapterId = new Map<string, TranslatedParagraph[]>();
    for (const chapter of chapters) {
      const segments = this.#repository.listRefinedTranslationSegments(taskId, chapter.chapterId).filter((item) => includeIncomplete || item.status === 'translated' || item.status === 'skipped');
      translatedParagraphsByChapterId.set(chapter.chapterId, segments.map((item) => ({ paragraphIndex: item.paragraphIndex, sourceText: item.sourceText, translatedText: item.translatedText, confidence: null })));
    }
    const descriptionSource = task.sourceMetadata.description;
    const translatedDescriptionParagraphs = task.translatedMetadata.description && descriptionSource ? [{ paragraphIndex: 0, sourceText: descriptionSource, translatedText: task.translatedMetadata.description, confidence: null }] : [];
    return this.#exportEngine.generate(snapshot, format, { mode, translatedParagraphsByChapterId, translatedNovelTitle: task.translatedMetadata.title, translatedAuthor: task.translatedMetadata.author, translatedTags: task.translatedMetadata.tags, translatedDescriptionParagraphs, translatedChapterTitles: new Map(chapters.flatMap((chapter) => chapter.translatedTitle?.trim() ? [[chapter.chapterId, chapter.translatedTitle] as const] : [])) });
  }

  subscribe(taskId: string, listener: (event: RefinedTranslationStreamEvent) => void): () => void { const listeners = this.#listeners.get(taskId) ?? new Set(); listeners.add(listener); this.#listeners.set(taskId, listeners); return () => { listeners.delete(listener); if (!listeners.size) this.#listeners.delete(taskId); }; }

  async #run(taskId: string): Promise<void> {
    if (this.#abortControllers.has(taskId)) return;
    const task = this.#repository.getRefinedTranslationTask(taskId);
    if (!task || task.deletedAt || task.status !== 'running') return;
    const controller = new AbortController(); this.#abortControllers.set(taskId, controller);
    try {
      const checkpoint = this.#repository.getRefinedTranslationCheckpoint(taskId, task.stage)?.state;
      const chapterId = typeof checkpoint?.chapterId === 'string' ? checkpoint.chapterId : this.#findNextChapter(taskId)?.chapterId ?? null;
      await this.#createWorkflow(controller.signal).invoke({ taskId, stage: task.stage, chapterId, decision: 'pause' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '精翻执行失败。';
      const checkpoint = this.#repository.getRefinedTranslationCheckpoint(taskId, task.stage)?.state;
      const chapterId = typeof checkpoint?.chapterId === 'string' ? checkpoint.chapterId : null;
      if (chapterId) {
        const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId);
        if (chapter && chapter.status !== 'reviewed') this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: chapter.reviewRound, reviewScore: chapter.reviewScore, status: 'needs_attention' });
      }
      this.#repository.updateRefinedTranslationTask(taskId, { status: 'needs_attention' });
      this.#log(taskId, 'error', message);
      this.#resumeRemainingAutomaticWork(taskId, '当前章节发生未捕获错误，已隔离并继续后续章节');
    } finally {
      this.#abortControllers.delete(taskId);
      const after = this.#repository.getRefinedTranslationTask(taskId);
      if (after && !after.deletedAt && after.status === 'running') void this.#run(taskId);
    }
  }

  #createWorkflow(signal: AbortSignal) {
    return new StateGraph(RefinedWorkflowState)
      .addNode('glossary_setup', async (state: RefinedWorkflowStateValue) => this.#runGlossarySetup(state, signal))
      .addNode('glossary_translation', async (state: RefinedWorkflowStateValue) => this.#runGlossaryTranslation(state, signal))
      .addNode('translating', async (state: RefinedWorkflowStateValue) => this.#runTranslating(state, signal))
      .addNode('checking', async (state: RefinedWorkflowStateValue) => this.#runChecking(state, signal))
      .addNode('reviewing', async (state: RefinedWorkflowStateValue) => this.#runReviewing(state, signal))
      .addNode('revising', async (state: RefinedWorkflowStateValue) => this.#runRevising(state, signal))
      .addNode('completed', async (state: RefinedWorkflowStateValue) => this.#runCompleted(state))
      .addNode('needs_attention', async (state: RefinedWorkflowStateValue) => this.#runNeedsAttention(state))
      .addConditionalEdges(START, (state: RefinedWorkflowStateValue) => state.stage, { glossary_setup: 'glossary_setup', glossary_translation: 'glossary_translation', translating: 'translating', checking: 'checking', reviewing: 'reviewing', revising: 'revising', completed: 'completed' })
      .addEdge('glossary_setup', END)
      .addConditionalEdges('glossary_translation', (state: RefinedWorkflowStateValue) => state.stage, { glossary_translation: END, translating: 'translating' })
      .addEdge('translating', 'checking')
      .addConditionalEdges('checking', (state: RefinedWorkflowStateValue) => state.decision, { retranslate: 'translating', review: 'reviewing', next_chapter: 'translating', complete: 'completed', needs_attention: 'needs_attention' })
      .addConditionalEdges('reviewing', (state: RefinedWorkflowStateValue) => state.decision, { revise: 'revising', next_chapter: 'translating', complete: 'completed', needs_attention: 'needs_attention' })
      .addConditionalEdges('revising', (state: RefinedWorkflowStateValue) => state.decision, { review: 'checking', needs_attention: 'needs_attention' })
      .addEdge('completed', END)
      .addEdge('needs_attention', END)
      .compile();
  }

  async #runGlossarySetup(state: RefinedWorkflowStateValue, signal: AbortSignal): Promise<Partial<RefinedWorkflowStateValue>> {
    if (!signal.aborted) await this.#suggestGlossary(state.taskId, signal);
    return { stage: 'glossary_setup', decision: 'pause' };
  }
  async #runGlossaryTranslation(state: RefinedWorkflowStateValue, signal: AbortSignal): Promise<Partial<RefinedWorkflowStateValue>> {
    if (!signal.aborted) await this.#translateGlossary(state.taskId, signal);
    if (signal.aborted) return { stage: 'glossary_translation', decision: 'pause' };
    this.#repository.updateRefinedTranslationTask(state.taskId, { stage: 'glossary_translation', status: 'paused' });
    this.#checkpoint(state.taskId, 'glossary_translation', { output: 'initial translations generated', transitionCondition: '术语初译已生成，等待人工确认术语译法' });
    this.#touch(state.taskId, '术语初译已生成，请人工确认或排除全部术语；确认后将自动完成后续流程。');
    return { stage: 'glossary_translation', decision: 'pause' };
  }
  async #runTranslating(state: RefinedWorkflowStateValue, signal: AbortSignal): Promise<Partial<RefinedWorkflowStateValue>> {
    // Metadata belongs to the normal glossary-confirmed flow. Recovery/retry jobs
    // that begin directly at translating should only repair their chapter work.
    if (!signal.aborted && this.#repository.getRefinedTranslationCheckpoint(state.taskId, 'glossary_translation')) await this.#translateMetadata(state.taskId, signal);
    const chapter = state.chapterId ? this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId) : this.#findNextChapter(state.taskId);
    if (!chapter) return { stage: 'reviewing', chapterId: null, decision: this.#hasFailures(state.taskId) ? 'needs_attention' : 'complete' };
    this.#setStage(state.taskId, 'translating', { chapterId: chapter.chapterId, chapterIndex: chapter.chapterIndex, transitionCondition: `调度第 ${chapter.chapterIndex} 章正文初翻（注入术语表与已译上下文）` });
    await this.#translateChapter(state.taskId, chapter.chapterId, signal);
    return { stage: 'checking', chapterId: chapter.chapterId, decision: 'review' };
  }
  async #runChecking(state: RefinedWorkflowStateValue, signal: AbortSignal): Promise<Partial<RefinedWorkflowStateValue>> {
    if (!state.chapterId) return { decision: this.#hasFailures(state.taskId) ? 'needs_attention' : 'complete' };
    this.#setStage(state.taskId, 'checking', { chapterId: state.chapterId, transitionCondition: '正文初翻完成，检查段落对齐、空译文与未翻译内容' });
    const result = await this.#checkChapter(state.taskId, state.chapterId, signal);
    if (result.retranslate) {
      const chapter = this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId);
      this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: 'checking', toStage: 'translating', condition: '发现需补译段落，回到正文初翻补译', chapterId: state.chapterId, reviewRound: chapter?.reviewRound ?? null });
      return { stage: 'translating', chapterId: state.chapterId, decision: 'retranslate' };
    }
    if (result.failed) {
      const nextChapter = this.#findNextChapter(state.taskId);
      return nextChapter ? { stage: 'translating', chapterId: nextChapter.chapterId, decision: 'next_chapter' } : { stage: 'checking', chapterId: null, decision: 'needs_attention' };
    }
    return { stage: 'reviewing', chapterId: state.chapterId, decision: 'review' };
  }
  async #runReviewing(state: RefinedWorkflowStateValue, signal: AbortSignal): Promise<Partial<RefinedWorkflowStateValue>> {
    if (!state.chapterId) return { decision: this.#hasFailures(state.taskId) ? 'needs_attention' : 'complete' };
    const existingChapter = this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId);
    const task = this.#repository.getRefinedTranslationTask(state.taskId);
    const pendingReviewRevision = this.#repository.listRefinedTranslationReviews(state.taskId, state.chapterId).some((review) => review.resolution === 'open');
    if (pendingReviewRevision) {
      this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: 'reviewing', toStage: 'revising', condition: '检测到上一轮开放审核意见，先逐段修订后再复审', chapterId: state.chapterId, reviewRound: existingChapter?.reviewRound ?? null });
      return { stage: 'revising', chapterId: state.chapterId, decision: 'revise' };
    }
    if (existingChapter && task && existingChapter.reviewRound >= task.modelConfig.maxReviewRounds) {
      this.#repository.updateRefinedTranslationChapterReview(state.taskId, state.chapterId, { reviewRound: existingChapter.reviewRound, reviewScore: existingChapter.reviewScore, status: 'reviewed' });
      this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: 'reviewing', toStage: 'translating', condition: `审核轮次已达上限 ${task.modelConfig.maxReviewRounds}；跳过重复审核并继续下一章`, chapterId: state.chapterId, reviewRound: existingChapter.reviewRound });
      this.#log(state.taskId, 'warn', `第 ${existingChapter.chapterIndex} 章已超过审核轮次上限，跳过重复审核并保留历史意见。`);
      const nextChapter = this.#findNextChapter(state.taskId);
      return nextChapter ? { stage: 'translating', chapterId: nextChapter.chapterId, decision: 'next_chapter' } : { stage: 'completed', chapterId: null, decision: 'complete' };
    }
    this.#setStage(state.taskId, 'reviewing', { chapterId: state.chapterId, transitionCondition: '遗漏检查通过，按章节审核译文、术语与相邻章节一致性' });
    const result = await this.#reviewChapter(state.taskId, state.chapterId, signal);
    if (result.needsRevision) {
      if (result.reviewRound >= result.maxReviewRounds) {
        const chapter = this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId);
        this.#repository.updateRefinedTranslationChapterReview(state.taskId, state.chapterId, { reviewRound: result.reviewRound, reviewScore: chapter?.reviewScore ?? null, status: 'reviewed' });
        this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: 'reviewing', toStage: 'translating', condition: `已达到第 ${result.reviewRound} 轮审核上限；保留待处理意见供任务完成后人工复核，自动继续下一章`, chapterId: state.chapterId, reviewRound: result.reviewRound });
        this.#log(state.taskId, 'warn', `第 ${chapter?.chapterIndex ?? '?'} 章达到审核轮次上限，已保留审核意见并自动继续后续章节。`);
        const nextChapter = this.#findNextChapter(state.taskId);
        return nextChapter ? { stage: 'translating', chapterId: nextChapter.chapterId, decision: 'next_chapter' } : { stage: 'completed', chapterId: null, decision: 'complete' };
      }
      const score = this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId)?.reviewScore;
      this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: 'reviewing', toStage: 'revising', condition: `第 ${result.reviewRound} 轮审核未通过（${score === null || score === undefined ? '模型未返回有效评分' : `评分 ${score}`}；存在强制修改项或评分低于 80），仅修订关联段落`, chapterId: state.chapterId, reviewRound: result.reviewRound });
      return { stage: 'revising', chapterId: state.chapterId, decision: 'revise' };
    }
    const nextChapter = this.#findNextChapter(state.taskId);
    return nextChapter ? { stage: 'translating', chapterId: nextChapter.chapterId, decision: 'next_chapter' } : { stage: 'completed', chapterId: null, decision: this.#hasFailures(state.taskId) ? 'needs_attention' : 'complete' };
  }
  async #runRevising(state: RefinedWorkflowStateValue, signal: AbortSignal): Promise<Partial<RefinedWorkflowStateValue>> {
    if (!state.chapterId) return { stage: 'checking', chapterId: null, decision: this.#hasFailures(state.taskId) ? 'needs_attention' : 'complete' };
    const chapter = this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId);
    const openReviews = this.#repository.listRefinedTranslationReviews(state.taskId, state.chapterId).filter((review) => review.resolution === 'open');
    this.#setStage(state.taskId, 'revising', {
      chapterId: state.chapterId,
      reviewRound: chapter?.reviewRound ?? null,
      transitionCondition: `第 ${chapter?.chapterIndex ?? '?'} 章审核未通过；仅按 ${openReviews.length} 条关联意见修订，不重翻全章`,
    });
    const result = await this.#reviseChapter(state.taskId, state.chapterId, signal);
    this.#checkpoint(state.taskId, 'revising', {
      chapterId: state.chapterId,
      reviewRound: chapter?.reviewRound ?? null,
      output: result,
      transitionCondition: `审核修订完成：处理 ${result.processed} 条意见，未处理 ${result.unresolved} 条`,
    });
    if (result.unresolved) {
      this.#repository.updateRefinedTranslationChapterReview(state.taskId, state.chapterId, { reviewRound: chapter?.reviewRound ?? 0, reviewScore: chapter?.reviewScore ?? null, status: 'needs_attention' });
      this.#log(state.taskId, 'warn', `第 ${chapter?.chapterIndex ?? '?'} 章有 ${result.unresolved} 条审核意见无法自动修订，保留至最终人工复核。`);
      return { stage: 'revising', chapterId: state.chapterId, decision: 'needs_attention' };
    }
    return { stage: 'checking', chapterId: state.chapterId, decision: 'review' };
  }
  async #runCompleted(state: RefinedWorkflowStateValue): Promise<Partial<RefinedWorkflowStateValue>> { const before = this.#repository.getRefinedTranslationTask(state.taskId); const openReviews = this.#repository.listRefinedTranslationReviews(state.taskId).filter((review) => review.resolution === 'open').length; this.#repository.updateRefinedTranslationTask(state.taskId, { stage: 'completed', status: 'completed' }); this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: before?.stage ?? null, toStage: 'completed', condition: openReviews ? `自动流程已完成，保留 ${openReviews} 条意见供最终人工复核` : '所有章节达到审核通过条件', chapterId: state.chapterId, reviewRound: null }); this.#checkpoint(state.taskId, 'completed', { output: openReviews ? 'automatic processing completed with final review items' : 'all eligible chapters passed review', openReviews }); this.#touch(state.taskId, openReviews ? `精翻自动流程已完成，保留 ${openReviews} 条意见供最终复核。` : '精翻任务已完成。'); return { stage: 'completed', decision: 'complete' }; }
  async #runNeedsAttention(state: RefinedWorkflowStateValue): Promise<Partial<RefinedWorkflowStateValue>> {
    const before = this.#repository.getRefinedTranslationTask(state.taskId);
    const nextChapter = this.#findNextChapter(state.taskId);
    if (nextChapter) {
      this.#repository.updateRefinedTranslationTask(state.taskId, { stage: 'translating', status: 'running' });
      this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: before?.stage ?? null, toStage: 'translating', condition: '当前章节存在不可自动恢复项，保留至最终复核并自动继续下一章', chapterId: nextChapter.chapterId, reviewRound: null });
      this.#checkpoint(state.taskId, 'translating', { event: 'defer_manual_review', chapterId: nextChapter.chapterId, transitionCondition: '当前章节保留至最终复核，自动继续下一章' });
      this.#touch(state.taskId, `当前章节已保留至最终复核，自动继续第 ${nextChapter.chapterIndex} 章。`);
      return { stage: 'translating', chapterId: nextChapter.chapterId, decision: 'next_chapter' };
    }
    this.#repository.updateRefinedTranslationTask(state.taskId, { status: 'needs_attention' });
    this.#repository.appendRefinedTranslationTransition({ taskId: state.taskId, fromStage: before?.stage ?? null, toStage: 'reviewing', condition: '所有章节已处理；存在不可自动恢复项，等待最终人工复核', chapterId: state.chapterId, reviewRound: state.chapterId ? this.#repository.getRefinedTranslationChapter(state.taskId, state.chapterId)?.reviewRound ?? null : null });
    this.#checkpoint(state.taskId, 'reviewing', { chapterId: state.chapterId, output: 'final manual review required' });
    this.#touch(state.taskId, '自动流程已处理全部章节，存在失败段落或未收敛审核意见，等待最终复核。');
    return { decision: 'needs_attention' };
  }

  async #tryRunToolAgent(taskId: string, route: { providerId: string; modelId: string }, system: string, prompt: string, tools: import('ai').ToolSet, firstToolName?: string): Promise<{ text: string; toolCallCount: number; toolCalls: Array<{ toolName: string; input: unknown }> } | null> {
    if (!this.#runToolAgent) return null;
    try {
      return await this.#runToolAgent(this.#preferences, route, system, prompt, tools, firstToolName);
    } catch (error) {
      this.#log(taskId, 'warn', `模型未完成工具调用，已回退到确定性工作流：${toMessage(error)}`);
      return null;
    }
  }
  #resolveRoute(task: StoredRefinedTranslationTaskRow, kind: 'translationModels' | 'omissionModel' | 'reviewModel') { const configured = kind === 'translationModels' ? task.modelConfig.translationModels[0] ?? null : task.modelConfig[kind]; return configured ?? resolveTranslationModel(this.#preferences) ?? null; }
  #resolveSegmentRoute(task: StoredRefinedTranslationTaskRow, paragraphIndex: number) { const routes = task.modelConfig.translationModels; return routes.length ? routes[paragraphIndex % routes.length] ?? null : resolveTranslationModel(this.#preferences) ?? null; }
  #findNextChapter(taskId: string) { return this.#repository.listRefinedTranslationChapters(taskId).find((chapter) => chapter.status !== 'reviewed' && chapter.status !== 'failed' && chapter.status !== 'needs_attention') ?? null; }
  #resumeRemainingAutomaticWork(taskId: string, reason: string): boolean {
    const task = this.#repository.getRefinedTranslationTask(taskId);
    if (!task || task.deletedAt || task.status !== 'needs_attention' || task.stage === 'completed') return false;
    const nextChapter = this.#findNextChapter(taskId);
    if (!nextChapter) return false;
    this.#repository.updateRefinedTranslationTask(taskId, { stage: 'translating', status: 'running' });
    this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: task.stage, toStage: 'translating', condition: `${reason}；自动恢复第 ${nextChapter.chapterIndex} 章`, chapterId: nextChapter.chapterId, reviewRound: null });
    this.#checkpoint(taskId, 'translating', { event: 'recover_stale_needs_attention', chapterId: nextChapter.chapterId, transitionCondition: reason });
    this.#log(taskId, 'warn', `${reason}，自动恢复第 ${nextChapter.chapterIndex} 章处理。`);
    void this.#run(taskId);
    return true;
  }
  #hasFailures(taskId: string) { return this.#repository.listRefinedTranslationChapters(taskId).some((chapter) => chapter.status === 'failed' || chapter.status === 'needs_attention'); }
  #restartManualReviewIfReady(taskId: string, chapterId: string): void {
    const task = this.#repository.getRefinedTranslationTask(taskId);
    const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId);
    if (!task || !chapter || task.status !== 'needs_attention') return;
    if (this.#repository.listRefinedTranslationReviews(taskId, chapterId).some((review) => review.resolution === 'open')) return;
    this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: 0, reviewScore: null, status: 'translated' });
    this.#repository.updateRefinedTranslationTask(taskId, { stage: 'checking', status: 'running' });
    this.#checkpoint(taskId, 'checking', { event: 'manual_review_resolved', chapterId, transitionCondition: '本章待处理审核意见均已人工处理，重新执行遗漏检查与审核' });
    this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: task.stage, toStage: 'checking', condition: '本章待处理审核意见均已人工处理，重新执行遗漏检查与审核', chapterId, reviewRound: 0 });
    this.#touch(taskId, `第 ${chapter.chapterIndex} 章待处理审核意见已清空，正在重新检查并审核。`);
    void this.#run(taskId);
  }

  async #suggestGlossary(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.#repository.getRefinedTranslationTask(taskId); if (!task) return;
    const route = task.modelConfig.termExtractionModel ?? this.#resolveRoute(task, 'translationModels');
    if (!route) { this.#repository.updateRefinedTranslationTask(taskId, { status: 'paused' }); this.#touch(taskId, '未配置术语提取模型，请人工确认术语候选。'); return; }
    if (!this.listTerms(taskId).length && !signal.aborted) {
      this.#touch(taskId, '现有术语候选为空，术语 AI 正在从任务原文提取候选。');
      try { await this.extractGlossaryCandidates(taskId); } catch (error) { this.#log(taskId, 'warn', `术语 AI 提取失败：${toMessage(error)}`); }
    }
    // The extraction response already carries a contextual suggestion per candidate. Do not
    // immediately re-read the full glossary once per term: it produces no new candidates and
    // was the source of the long tail seen on medium-sized novels.
    this.#repository.updateRefinedTranslationTask(taskId, { status: 'paused', stage: 'glossary_setup' }); this.#checkpoint(taskId, 'glossary_setup', { output: 'suggestions generated' }); this.#touch(taskId, '术语筛选建议已生成，请确认后进入术语翻译。');
  }
  async #translateGlossary(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.#repository.getRefinedTranslationTask(taskId); if (!task) return;
    const route = task.modelConfig.termTranslationModel ?? this.#resolveRoute(task, 'translationModels');
    if (!route) { this.#log(taskId, 'warn', '未配置术语翻译模型，将保留空术语译文并自动继续正文初翻。'); return; }
    for (const term of this.listTerms(taskId)) {
      if (signal.aborted) return;
      if (term.status === 'excluded' || term.targetTerm) continue;
      try {
        // A tool agent can stop after read_glossary and answer with prose such as
        // “术语 X 的译法已更新…”. For this scalar field, use the deterministic one-shot
        // generator so only the actual target-language term can reach targetTerm.
        const translated = await this.#generateText(this.#preferences, route, `将术语从${task.sourceLang}翻译成${task.targetLang}。仅输出术语译文，不加解释。实体类型：${term.entityType ?? '未知'}。`, term.sourceTerm);
        if (!signal.aborted) this.updateTerm(taskId, term.id, { targetTerm: translated, status: 'pending' });
      } catch (error) { this.#log(taskId, 'warn', `术语“${term.sourceTerm}”翻译失败：${toMessage(error)}`); }
    }
    this.#checkpoint(taskId, 'glossary_translation', { output: 'initial translations generated' }); this.#touch(taskId, '术语初译已生成，等待人工确认术语译法。');
  }
  async #translateMetadata(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.#repository.getRefinedTranslationTask(taskId);
    if (!task) return;
    const route = this.#resolveRoute(task, 'translationModels');
    if (!route) return;
    const source = task.sourceMetadata;
    const translated = task.translatedMetadata;
    const glossary = this.listTerms(taskId).filter((term) => term.status === 'confirmed' && term.targetTerm).map((term) => `${term.sourceTerm} = ${term.targetTerm}`).join('\n');
    const translate = async (kind: string, text: string) => this.#generateText(this.#preferences, route, `将小说${kind}从${task.sourceLang}翻译为${task.targetLang}。只输出译文，不添加说明。专有名词必须遵循术语表：\n${glossary || '（空）'}`, text);
    try {
      const update: Partial<typeof translated> = {};
      if (!translated.title && source.title.trim()) update.title = await translate('标题', source.title);
      if (!signal.aborted && !translated.author && source.author.trim()) update.author = await translate('作者/笔名', source.author);
      if (!signal.aborted && !translated.description && source.description.trim()) update.description = await translate('简介', source.description);
      if (!signal.aborted && !translated.tags.length && source.tags.length) update.tags = await Promise.all(source.tags.map((tag) => translate('标签', tag)));
      if (!signal.aborted && Object.keys(update).length) {
        this.#repository.updateRefinedTranslationMetadata(taskId, update);
        this.#touch(taskId, '作品元数据（标题、作者、简介与标签）已纳入翻译。');
      }
    } catch (error) { this.#log(taskId, 'warn', `作品元数据翻译失败，正文将继续：${toMessage(error)}`); }
  }
  async #translateChapter(taskId: string, chapterId: string, signal: AbortSignal): Promise<void> {
    const task = this.#repository.getRefinedTranslationTask(taskId); const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId); if (!task || !chapter) return;
    const glossary = this.listTerms(taskId).filter((term) => term.status !== 'excluded' && term.targetTerm).map((term) => `${term.sourceTerm} = ${term.targetTerm}`).join('\n');
    if (!chapter.translatedTitle?.trim() && chapter.title.trim() && !signal.aborted) {
      try {
        const route = this.#resolveSegmentRoute(task, 0);
        if (route) this.#repository.updateRefinedTranslationChapterTitle(taskId, chapterId, await this.#generateText(this.#preferences, route, `将章节标题翻译为${task.targetLang}，只输出标题译文。\n术语表：\n${glossary || '（空）'}`, chapter.title));
      } catch (error) { this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章标题翻译失败，正文将继续：${toMessage(error)}`); }
    }
    const pending = this.#repository.listRefinedTranslationSegments(taskId, chapterId).filter((segment) => segment.status !== 'translated' && segment.status !== 'skipped');
    let nextIndex = 0;
    const translateNext = async (): Promise<void> => {
      while (!signal.aborted) {
        const segment = pending[nextIndex++];
        if (!segment) return;
      const route = this.#resolveSegmentRoute(task, segment.paragraphIndex);
      if (!route) { this.writeSegment(taskId, chapterId, segment.paragraphIndex, { translatedText: null, status: 'failed' }); this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章缺少正文初翻模型。`); continue; }
      try {
        const context = this.#translationContext(taskId, chapterId, segment.paragraphIndex);
        const toolResult = await this.#tryRunToolAgent(taskId, route,
          `你是专业文学译者。必须先调用 read_original_chapter、read_current_translation 和 read_glossary，确认 task_id=${taskId}、chapter_id=${chapterId}、paragraphIndex=${segment.paragraphIndex} 的快照与术语。然后只输出该段从${task.sourceLang}到${task.targetLang}的译文，不得输出解释或调用写入工具。`,
          `翻译任务定位：chapter_id=${chapterId}，paragraphIndex=${segment.paragraphIndex}。`,
          createRefinedTranslationTools(this, { taskId, chapterIds: [chapterId], writable: false }),
        );
        const text = toolResult?.text || await this.#generateText(this.#preferences, route, `你是专业文学译者。将${task.sourceLang}翻译成${task.targetLang}。保持段落格式，只输出译文。\n术语表：\n${glossary || '（无）'}\n前文上下文：\n${context || '（当前为本章开头）'}`, segment.sourceText);
        if (!signal.aborted) this.writeSegment(taskId, chapterId, segment.paragraphIndex, { translatedText: text || null, status: text ? 'translated' : 'pending' });
      } catch (error) { if (!signal.aborted) { this.writeSegment(taskId, chapterId, segment.paragraphIndex, { translatedText: null, status: 'failed' }); this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章第 ${segment.paragraphIndex + 1} 段失败：${toMessage(error)}`); } }
    }
    };
    const concurrency = Math.max(1, Math.min(Math.floor(task.modelConfig.concurrency || 1), pending.length));
    await Promise.all(Array.from({ length: concurrency }, () => translateNext()));
    const translatedSegments = this.#repository.listRefinedTranslationSegments(taskId, chapterId);
    if (translatedSegments.length > 0 && translatedSegments.every((segment) => segment.status === 'translated' || segment.status === 'skipped')) {
      this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: chapter.reviewRound, reviewScore: null, status: 'translated' });
    }
  }
  /**
   * 审核修订是一个独立的深模块：它只暴露“处理当前章开放意见”的输入，
   * 不会进入章节标题或全文初翻路径，因此不会重置未经意见关联的段落。
   */
  async #reviseChapter(taskId: string, chapterId: string, signal: AbortSignal): Promise<{ processed: number; unresolved: number }> {
    const task = this.#repository.getRefinedTranslationTask(taskId);
    const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId);
    if (!task || !chapter) return { processed: 0, unresolved: 0 };
    const openReviews = this.#repository.listRefinedTranslationReviews(taskId, chapterId).filter((review) => review.resolution === 'open');
    if (!openReviews.length || signal.aborted) return { processed: 0, unresolved: openReviews.length };
    const glossary = this.listTerms(taskId).filter((term) => term.status !== 'excluded' && term.targetTerm).map((term) => `${term.sourceTerm} = ${term.targetTerm}`).join('\n');
    const rows = this.#repository.listRefinedTranslationSegments(taskId, chapterId);
    const reviewsByParagraph = new Map<number, StoredRefinedTranslationReviewRow[]>();
    for (const review of openReviews) {
      for (const paragraphIndex of review.paragraphIndices) {
        const reviews = reviewsByParagraph.get(paragraphIndex) ?? [];
        reviews.push(review);
        reviewsByParagraph.set(paragraphIndex, reviews);
      }
    }
    let processed = 0;
    const processedReviewIds = new Set<string>();
    for (const [paragraphIndex, reviews] of reviewsByParagraph) {
      if (signal.aborted) break;
      const segment = rows.find((item) => item.paragraphIndex === paragraphIndex);
      if (!segment) {
        for (const review of reviews) {
          if (processedReviewIds.has(review.id)) continue;
          this.#repository.updateRefinedTranslationReview(taskId, review.id, 'rejected', '审核意见未能定位到当前任务快照中的段落，未自动改动译文。');
          processedReviewIds.add(review.id);
          processed += 1;
        }
        continue;
      }
      const route = this.#resolveSegmentRoute(task, paragraphIndex);
      if (!route) {
        this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章未配置审核修订可用模型，相关意见将保留至最终人工复核。`);
        continue;
      }
      const activeReviews = reviews.filter((review) => !processedReviewIds.has(review.id));
      if (!activeReviews.length) continue;
      try {
        const toolResult = await this.#tryRunToolAgent(taskId, route,
          `你是文学翻译的审核修订 Agent。必须先调用 read_current_translation、read_review_issues 与 read_glossary。只允许处理 chapterId=${chapterId} 的 paragraphIndex=${paragraphIndex}：禁止重翻整章、禁止改动章节标题、禁止改动其他段落或术语表。对每条审核意见，按需调用 write_translation_segment 写入完整修订译文，并调用 resolve_review_issue 记录 accepted、partially_accepted 或 rejected 及理由。不要输出 JSON 提案；工具调用就是实际修订记录。`,
          `任务定位：task_id=${taskId}，chapter_id=${chapterId}，paragraphIndex=${paragraphIndex}。待处理意见：\n${activeReviews.map((review, index) => `${index + 1}. reviewId=${review.id}；意见：${review.suggestion}`).join('\n')}`,
          createRefinedTranslationTools(this, { taskId, chapterIds: [chapterId], writable: true }),
        );
        if (toolResult?.toolCallCount) {
          const resolvedByTools = activeReviews.filter((review) => this.#repository.listRefinedTranslationReviews(taskId, chapterId).some((stored) => stored.id === review.id && stored.resolution !== 'open'));
          if (resolvedByTools.length) {
            for (const review of resolvedByTools) {
              processedReviewIds.add(review.id);
              processed += 1;
            }
            continue;
          }
        }
        const rawText = await this.#generateText(
          this.#preferences,
          route,
          `你是文学翻译的审核修订 Agent。只允许修改当前给出的一个段落：禁止重翻整章、禁止改动章节标题、禁止改动其他段落或术语表。依据审核意见进行最小必要修改；若意见不应采纳，保留当前译文。\n术语表：\n${glossary || '（无）'}\n前文上下文：\n${this.#translationContext(taskId, chapterId, paragraphIndex) || '（当前为本章开头）'}\n只返回 JSON：{"translatedText":"修订后的完整当前段译文；不修改时返回当前译文","reviewFeedback":[{"reviewId":"...","decision":"accepted|partially_accepted|rejected","reason":"针对该意见的简短处理说明"}]}。reviewFeedback 必须覆盖每条 reviewId。`,
          `当前段原文：${segment.sourceText}\n当前段译文：${segment.translatedText ?? '（缺失）'}\n审核意见：\n${activeReviews.map((review, index) => `${index + 1}. reviewId=${review.id}；意见：${review.suggestion}`).join('\n')}`,
        );
        if (signal.aborted) break;
        const hasStructuredResponse = /\{[\s\S]*"translatedText"[\s\S]*\}/.test(rawText);
        const revision = parseRevisionResponse(rawText);
        const feedbackById = new Map(revision.reviewFeedback.map((feedback) => [feedback.reviewId, feedback]));
        const shouldApply = hasStructuredResponse && Boolean(revision.translatedText) && activeReviews.some((review) => feedbackById.get(review.id)?.decision !== 'rejected');
        if (shouldApply) this.writeSegment(taskId, chapterId, paragraphIndex, { translatedText: revision.translatedText, status: 'translated' });
        for (const review of activeReviews) {
          const feedback = feedbackById.get(review.id);
          const resolution = feedback?.decision ?? (shouldApply ? 'partially_accepted' : 'rejected');
          const note = feedback?.reason ?? (shouldApply ? '模型已修订当前段，但未返回该意见的明确结论。' : '模型未返回可验证的结构化审核修订结果，未自动改动译文。');
          this.#repository.updateRefinedTranslationReview(taskId, review.id, resolution, note);
          processedReviewIds.add(review.id);
          processed += 1;
        }
      } catch (error) {
        for (const review of activeReviews) {
          this.#repository.updateRefinedTranslationReview(taskId, review.id, 'rejected', `自动审核修订调用失败：${toMessage(error)}`);
          processedReviewIds.add(review.id);
          processed += 1;
        }
        this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章第 ${paragraphIndex + 1} 段审核修订失败：${toMessage(error)}`);
      }
    }
    const unresolved = this.#repository.listRefinedTranslationReviews(taskId, chapterId).filter((review) => review.resolution === 'open').length;
    if (processed) {
      this.#touch(taskId, `审核修订 Agent 已逐条处理 ${processed} 条审核意见，仅改动关联段落。`);
      this.#emit(taskId, { type: 'review_updated', taskId, chapterId });
    }
    return { processed, unresolved };
  }
  #translationContext(taskId: string, chapterId: string, paragraphIndex: number) { return this.#repository.listRefinedTranslationSegments(taskId, chapterId).filter((segment) => segment.paragraphIndex < paragraphIndex && segment.translatedText?.trim()).slice(-TRANSLATION_CONTEXT_SEGMENTS).map((segment) => `原文：${segment.sourceText}\n译文：${segment.translatedText}`).join('\n\n'); }
  async #checkChapter(taskId: string, chapterId: string, signal: AbortSignal): Promise<{ retranslate: boolean; failed: boolean }> {
    const task = this.#repository.getRefinedTranslationTask(taskId); const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId); if (!task || !chapter) return { retranslate: false, failed: true };
    const segments = this.#repository.listRefinedTranslationSegments(taskId, chapterId);
    const expectedParagraphCount = splitChapterParagraphs(chapter.sourceContent).length;
    if (segments.length !== expectedParagraphCount) {
      this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: chapter.reviewRound, reviewScore: null, status: 'needs_attention' });
      this.#log(taskId, 'error', `第 ${chapter.chapterIndex} 章段落快照不完整：应有 ${expectedParagraphCount} 段，实际为 ${segments.length} 段。`);
      this.#checkpoint(taskId, 'checking', { chapterId, output: { expectedParagraphCount, actualParagraphCount: segments.length, failed: true } });
      return { retranslate: false, failed: true };
    }
    const route = this.#resolveRoute(task, 'omissionModel'); let retranslate = false;
    for (const segment of segments) {
      if (signal.aborted) return { retranslate: false, failed: false };
      if (segment.status === 'translated' && !segment.translatedText?.trim()) this.writeSegment(taskId, chapterId, segment.paragraphIndex, { translatedText: null, status: 'pending' });
      if (segment.status !== 'pending') continue;
      const safeToCopy = /^\s*(?:https?:\/\/\S+|[\d０-９.,%\-+ ]+)\s*$/.test(segment.sourceText);
      if (safeToCopy) { this.writeSegment(taskId, chapterId, segment.paragraphIndex, { translatedText: segment.sourceText, status: 'skipped' }); continue; }
      if (route) {
        try { const answer = await this.#generateText(this.#preferences, route, '判断原文是否可不翻译并原样保留。只能回答 YES 或 NO。', segment.sourceText); if (/^yes\b/i.test(answer)) { this.writeSegment(taskId, chapterId, segment.paragraphIndex, { translatedText: segment.sourceText, status: 'skipped' }); continue; } } catch (error) { this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章第 ${segment.paragraphIndex + 1} 段遗漏判定失败，将回到初翻：${toMessage(error)}`); }
      }
      retranslate = true;
    }
    const failed = this.#repository.listRefinedTranslationSegments(taskId, chapterId).some((segment) => segment.status === 'failed');
    if (failed) this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound: chapter.reviewRound, reviewScore: null, status: 'failed' });
    this.#checkpoint(taskId, 'checking', { chapterId, output: { retranslate, failed } });
    return { retranslate, failed };
  }
  async #reviewChapter(taskId: string, chapterId: string, signal: AbortSignal): Promise<{ needsRevision: boolean; reviewRound: number; maxReviewRounds: number }> {
    const task = this.#repository.getRefinedTranslationTask(taskId); const chapter = this.#repository.getRefinedTranslationChapter(taskId, chapterId); if (!task || !chapter) return { needsRevision: true, reviewRound: 1, maxReviewRounds: 1 };
    const reviewRound = chapter.reviewRound + 1; const route = this.#resolveRoute(task, 'reviewModel');
    if (!route) { this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound, reviewScore: null, status: 'needs_attention' }); this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章未配置审核模型。`); return { needsRevision: true, reviewRound, maxReviewRounds: reviewRound }; }
    const rows = this.#repository.listRefinedTranslationSegments(taskId, chapterId);
    const content = rows.map((row) => `【${row.paragraphIndex + 1}】原文：${row.sourceText}\n译文：${row.translatedText ?? '（缺失）'}`).join('\n');
    const glossary = this.listTerms(taskId).filter((term) => term.status !== 'excluded' && term.targetTerm).map((term) => `${term.sourceTerm} = ${term.targetTerm}`).join('\n');
    const adjacent = this.readContextChapters(taskId, chapterId).map((item) => `${item.chapter.title}\n${item.segments.map((segment) => segment.translatedText ?? segment.sourceText).join('\n')}`).join('\n\n');
    const rejectedDirections = this.#repository.listRefinedTranslationReviews(taskId, chapterId).filter((review) => review.resolution === 'rejected' || review.resolution === 'ignored').map((review) => `段落 #${review.paragraphIndices.map((index) => index + 1).join('、')}：${review.suggestion}${review.resolutionNote ? `（理由：${review.resolutionNote}）` : ''}`).join('\n');
    try {
      const toolResult = await this.#tryRunToolAgent(taskId, route,
        `你是文学翻译审核 Agent。必须先调用 read_chapter_translation、read_context_chapters、read_glossary 和 read_review_issues，审核 chapter_id=${chapterId}。用户已拒绝的修改方向（除非出现新的严重错误，不要再次提出相同方向）：\n${rejectedDirections || '（无）'}\n随后只返回 JSON：{"score":0-100,"severity":"low|medium|high","issues":[{"paragraphIndex":0,"sourceExcerpt":"该段原文的连续短句","translationExcerpt":"该段当前译文的连续短句","suggestion":"简明说明问题与修改理由","replacementText":"可直接替换的完整目标译文；无法安全给出则为 null","forceChange":false}],"scores":{"fluency":0,"consistency":0,"termAccuracy":0,"format":0}}。paragraphIndex 只是提示；服务端只会以 sourceExcerpt 与 translationExcerpt 的唯一双锚点定位。每条意见必须给出这两个连续短句；无法可靠定位则不要输出该意见。`,
        `审核任务定位：task_id=${taskId}，chapter_id=${chapterId}，第 ${chapter.chapterIndex} 章。`,
        createRefinedTranslationTools(this, { taskId, chapterIds: [chapterId], writable: false }),
      );
      const response = toolResult?.text || await this.#generateText(this.#preferences, route, `审核文学翻译。术语表：\n${glossary || '（无）'}\n相邻章节译文（仅作一致性参考）：\n${adjacent || '（无）'}\n用户已拒绝的修改方向（除非出现新的严重错误，不要再次提出相同方向）：\n${rejectedDirections || '（无）'}\n仅返回 JSON：{"score":0-100,"severity":"low|medium|high","issues":[{"paragraphIndex":0,"sourceExcerpt":"该段原文的连续短句","translationExcerpt":"该段当前译文的连续短句","suggestion":"简明说明问题与修改理由","replacementText":"可直接替换的完整目标译文；无法安全给出则为 null","forceChange":false}],"scores":{"fluency":0,"consistency":0,"termAccuracy":0,"format":0}}。paragraphIndex 只是提示；服务端只会以 sourceExcerpt 与 translationExcerpt 的唯一双锚点定位。每条意见必须给出这两个连续短句；无法可靠定位则不要输出该意见。`, content);
      if (signal.aborted) return { needsRevision: false, reviewRound, maxReviewRounds: task.modelConfig.maxReviewRounds };
      const parsed = parseReviewJson(response); const needsRevision = parsed.score < 80 || parsed.issues.some((issue) => issue.forceChange);
      const superseded = this.#repository.supersedeOpenRefinedTranslationReviews(taskId, chapterId);
      if (superseded) this.#log(taskId, 'info', `第 ${chapter.chapterIndex} 章上一轮 ${superseded} 条未处理审核意见已由本轮复审归档替代。`);
      const issues = parsed.issues.length || !needsRevision ? parsed.issues : [{ paragraphIndex: 0, sourceExcerpt: rows[0]?.sourceText ?? '', translationExcerpt: rows[0]?.translatedText ?? '', suggestion: '审核评分未达标，请重新润色本章译文。', replacementText: null, forceChange: true }];
      for (const issue of issues) {
        const paragraphIndex = resolveReviewIssueParagraphIndex(issue, rows);
        if (paragraphIndex === null) { this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章审核意见缺少可靠段落锚点，已忽略以避免错挂到其他段落。`); continue; }
        this.markSegmentIssue(taskId, { chapterId, reviewRound, severity: parsed.severity, scores: parsed.scores, suggestion: issue.suggestion, replacementText: issue.replacementText, forceChange: issue.forceChange || parsed.score < 80, resolved: false, resolution: 'open', resolutionNote: null, paragraphIndex });
      }
      this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound, reviewScore: parsed.score, status: needsRevision ? 'pending' : 'reviewed' });
      this.#checkpoint(taskId, 'reviewing', { chapterId, input: { reviewRound }, output: { score: parsed.score, needsRevision, issueCount: issues.length } });
      return { needsRevision, reviewRound, maxReviewRounds: task.modelConfig.maxReviewRounds };
    } catch (error) { this.#repository.updateRefinedTranslationChapterReview(taskId, chapterId, { reviewRound, reviewScore: null, status: 'needs_attention' }); this.#log(taskId, 'warn', `第 ${chapter.chapterIndex} 章审核失败：${toMessage(error)}`); return { needsRevision: true, reviewRound, maxReviewRounds: reviewRound }; }
  }

  #setStage(taskId: string, stage: RefinedTranslationStage, checkpoint: Record<string, unknown>) { const before = this.#repository.getRefinedTranslationTask(taskId); this.#repository.updateRefinedTranslationTask(taskId, { stage, status: 'running' }); this.#repository.appendRefinedTranslationTransition({ taskId, fromStage: before?.stage ?? null, toStage: stage, condition: typeof checkpoint.transitionCondition === 'string' ? checkpoint.transitionCondition : typeof checkpoint.input === 'string' ? checkpoint.input : '自动调度到下一流程节点', chapterId: typeof checkpoint.chapterId === 'string' ? checkpoint.chapterId : null, reviewRound: typeof checkpoint.reviewRound === 'number' ? checkpoint.reviewRound : null }); this.#checkpoint(taskId, stage, checkpoint); this.#emit(taskId, { type: 'task_updated', taskId }); }
  #checkpoint(taskId: string, stage: RefinedTranslationStage, state: Record<string, unknown>) { this.#repository.saveRefinedTranslationCheckpoint(taskId, stage, { ...state, at: new Date().toISOString() }); }
  #editable(taskId: string) { const task = this.#repository.getRefinedTranslationTask(taskId); return Boolean(task && !task.deletedAt); }
  #log(taskId: string, level: 'info' | 'warn' | 'error', message: string) { this.#repository.appendRefinedTranslationLog(taskId, level, message); this.#emit(taskId, { type: 'log', taskId }); }
  #touch(taskId: string, message: string) { this.#log(taskId, 'info', message); this.#emit(taskId, { type: 'task_updated', taskId }); }
  #emit(taskId: string, event: RefinedTranslationStreamEvent) { this.#listeners.get(taskId)?.forEach((listener) => listener(event)); }
}

function toRoute(value: { providerId?: string; modelId?: string; thinkingEnabled?: boolean } | null | undefined) { return value?.providerId && value.modelId ? { providerId: value.providerId, modelId: value.modelId, ...(value.thinkingEnabled ? { thinkingEnabled: true } : {}) } : null; }
function toMessage(error: unknown) { return error instanceof Error ? error.message : '未知错误'; }
function parseReviewJson(text: string): { score: number; severity: string; scores: Record<string, number>; issues: Array<{ paragraphIndex: number; sourceExcerpt: string; translationExcerpt: string; suggestion: string; replacementText: string | null; forceChange: boolean }> } { try { const match = text.match(/\{[\s\S]*\}/); const parsed = JSON.parse(match?.[0] ?? '{}') as Record<string, unknown>; const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : []; return { score: typeof parsed.score === 'number' ? parsed.score : 0, severity: typeof parsed.severity === 'string' ? parsed.severity : 'medium', scores: parsed.scores && typeof parsed.scores === 'object' ? Object.fromEntries(Object.entries(parsed.scores as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {}, issues: rawIssues.flatMap((item) => { if (!item || typeof item !== 'object') return []; const value = item as Record<string, unknown>; return typeof value.paragraphIndex === 'number' && typeof value.suggestion === 'string' && typeof value.sourceExcerpt === 'string' && typeof value.translationExcerpt === 'string' ? [{ paragraphIndex: value.paragraphIndex, sourceExcerpt: value.sourceExcerpt.trim(), translationExcerpt: value.translationExcerpt.trim(), suggestion: value.suggestion, replacementText: typeof value.replacementText === 'string' && value.replacementText.trim() ? value.replacementText.trim() : null, forceChange: value.forceChange === true }] : []; }) }; } catch { return { score: 0, severity: 'medium', scores: {}, issues: [] }; } }
function resolveReviewIssueParagraphIndex(issue: { paragraphIndex: number; sourceExcerpt: string; translationExcerpt: string }, rows: Array<{ paragraphIndex: number; sourceText: string; translatedText: string | null }>): number | null { const normalize = (value: string) => value.replace(/[\s\p{P}]/gu, '').toLocaleLowerCase(); const source = normalize(issue.sourceExcerpt); const translation = normalize(issue.translationExcerpt); const matches = (row: { sourceText: string; translatedText: string | null }) => Boolean(source) && normalize(row.sourceText).includes(source) && Boolean(translation) && normalize(row.translatedText ?? '').includes(translation); const anchored = rows.filter(matches); return anchored.length === 1 ? anchored[0]!.paragraphIndex : null; }
function parseRevisionResponse(text: string): { translatedText: string; reviewFeedback: Array<{ reviewId: string; decision: Extract<RefinedTranslationReviewResolution, 'accepted' | 'partially_accepted' | 'rejected'>; reason: string | null }> } { try { const match = text.match(/\{[\s\S]*\}/); const parsed = JSON.parse(match?.[0] ?? '{}') as Record<string, unknown>; const translatedText = typeof parsed.translatedText === 'string' ? parsed.translatedText.trim() : text.trim(); const rawFeedback = Array.isArray(parsed.reviewFeedback) ? parsed.reviewFeedback : []; return { translatedText, reviewFeedback: rawFeedback.flatMap((item) => { if (!item || typeof item !== 'object') return []; const value = item as Record<string, unknown>; const decision = value.decision === 'accepted' || value.decision === 'partially_accepted' || value.decision === 'rejected' ? value.decision : null; return typeof value.reviewId === 'string' && decision ? [{ reviewId: value.reviewId, decision, reason: typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : null }] : []; }) }; } catch { return { translatedText: text.trim(), reviewFeedback: [] }; } }
function parseGlossaryCandidates(text: string): Array<{ sourceTerm: string; entityType: string | null; priority: number; suggestion: string | null }> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const payload = JSON.parse(match?.[0] ?? '{}') as { terms?: unknown };
    if (!Array.isArray(payload.terms)) return [];
    const seen = new Set<string>();
    return payload.terms.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      const sourceTerm = typeof value.sourceTerm === 'string' ? value.sourceTerm.trim() : '';
      if (!sourceTerm || seen.has(sourceTerm)) return [];
      seen.add(sourceTerm);
      return [{ sourceTerm, entityType: typeof value.entityType === 'string' ? value.entityType : null, priority: typeof value.priority === 'number' ? Math.max(0, Math.min(10, Math.round(value.priority))) : 0, suggestion: typeof value.suggestion === 'string' ? value.suggestion : null }];
    });
  } catch { return []; }
}
function parseChapterAgentResponse(text: string): { reply: string; edits: Array<{ paragraphIndex: number; translatedText: string }> } {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const value = JSON.parse(match?.[0] ?? '{}') as Record<string, unknown>;
    const edits = Array.isArray(value.edits) ? value.edits.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      return typeof entry.paragraphIndex === 'number' && typeof entry.translatedText === 'string' ? [{ paragraphIndex: entry.paragraphIndex, translatedText: entry.translatedText }] : [];
    }) : [];
    return { reply: typeof value.reply === 'string' ? value.reply : '', edits };
  } catch { return { reply: text.trim(), edits: [] }; }
}
function parseGlossarySuggestion(text: string): { status: RefinedTranslationTermStatus; entityType: string | null; priority: number; suggestion: string | null } { try { const match = text.match(/\{[\s\S]*\}/); const value = JSON.parse(match?.[0] ?? '{}') as Record<string, unknown>; return { status: value.status === 'excluded' ? 'excluded' : 'pending', entityType: typeof value.entityType === 'string' ? value.entityType : null, priority: typeof value.priority === 'number' ? Math.max(0, Math.min(10, Math.round(value.priority))) : 0, suggestion: typeof value.suggestion === 'string' ? value.suggestion : null }; } catch { return { status: 'pending', entityType: null, priority: 0, suggestion: null }; } }
