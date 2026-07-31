import { Router, type Response } from 'express';

import type { ControlCenterService } from '../core/control-center';
import { isLibraryExportFormat, isLibraryExportTranslationMode } from '../core/export-engine';

export function createRefinedTranslationRouter({ service }: { service: ControlCenterService }): Router {
  const router = Router();

  router.get('/tasks', (request, response) => response.json({ tasks: service.listRefinedTranslationTasks(request.query.recycleBin === 'true') }));
  router.post('/tasks', (request, response) => {
    try {
      const body = objectBody(request.body); const sourceId = requiredString(body, 'sourceId'); const novelId = requiredString(body, 'novelId');
      const task = service.createRefinedTranslationTask(sourceId, novelId, { ...(optionalString(body.name) ? { name: optionalString(body.name) } : {}), ...(optionalString(body.sourceLang) ? { sourceLang: optionalString(body.sourceLang) } : {}), ...(optionalString(body.targetLang) ? { targetLang: optionalString(body.targetLang) } : {}), ...(isRecord(body.modelConfig) ? { modelConfig: body.modelConfig } : {}) });
      response.status(201).json({ task });
    } catch (error) { response.status(422).json({ message: error instanceof Error ? error.message : '创建精翻任务失败。' }); }
  });
  router.get('/tasks/:taskId', (request, response) => {
    const task = service.getRefinedTranslationTask(request.params.taskId); if (!task) return response.status(404).json({ message: '精翻任务不存在。' }); return response.json(task);
  });
  router.put('/tasks/:taskId', (request, response) => { const body = objectBody(request.body); const task = service.updateRefinedTranslationTaskConfiguration(request.params.taskId, { ...(optionalString(body.name) ? { name: optionalString(body.name) } : {}), ...(optionalString(body.sourceLang) ? { sourceLang: optionalString(body.sourceLang) } : {}), ...(optionalString(body.targetLang) ? { targetLang: optionalString(body.targetLang) } : {}), ...(isRecord(body.modelConfig) ? { modelConfig: body.modelConfig as unknown as NonNullable<Parameters<ControlCenterService['updateRefinedTranslationTaskConfiguration']>[1]['modelConfig']> } : {}) }); return task ? response.json({ task }) : response.status(404).json({ message: '精翻任务不存在或已在回收站。' }); });
  router.get('/tasks/:taskId/stream', (request, response) => {
    response.status(200); response.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); response.setHeader('Cache-Control', 'no-cache, no-transform'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders();
    const send = () => { const task = service.getRefinedTranslationTask(request.params.taskId); response.write(`event: task_updated\ndata: ${JSON.stringify(task)}\n\n`); };
    send(); const unsubscribe = service.subscribeToRefinedTranslationTask(request.params.taskId, send); request.on('close', unsubscribe);
  });
  router.get('/tasks/:taskId/chapters/:chapterId', (request, response) => { const chapter = service.getRefinedTranslationChapter(request.params.taskId, request.params.chapterId); return chapter ? response.json(chapter) : response.status(404).json({ message: '章节快照不存在。' }); });
  router.put('/tasks/:taskId/chapters/:chapterId/segments/:paragraphIndex', (request, response) => {
    const body = objectBody(request.body); const paragraphIndex = Number(request.params.paragraphIndex); if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return response.status(422).json({ message: '段落索引无效。' });
    const translatedText = typeof body.translatedText === 'string' ? body.translatedText : null; const status = body.status === 'pending' || body.status === 'translated' || body.status === 'skipped' || body.status === 'failed' ? body.status : undefined;
    const segment = service.writeRefinedTranslationSegment(request.params.taskId, request.params.chapterId, paragraphIndex, { translatedText, ...(status ? { status } : {}) }); return segment ? response.json({ segment }) : response.status(404).json({ message: '段落快照不存在。' });
  });
  router.put('/tasks/:taskId/chapters/:chapterId/title', (request, response) => {
    const body = objectBody(request.body);
    const translatedTitle = typeof body.translatedTitle === 'string' ? body.translatedTitle : null;
    const chapter = service.updateRefinedTranslationChapterTitle(request.params.taskId, request.params.chapterId, translatedTitle);
    return chapter ? response.json({ chapter }) : response.status(404).json({ message: '章节快照不存在或任务不可修改。' });
  });
  router.get('/tasks/:taskId/terms', (request, response) => response.json({ terms: service.listRefinedTranslationTerms(request.params.taskId) }));
  router.post('/tasks/:taskId/terms/extract', async (request, response) => {
    try { return response.json({ terms: await service.extractRefinedTranslationTerms(request.params.taskId) }); }
    catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '术语 AI 提取失败。' }); }
  });
  router.post('/tasks/:taskId/terms', (request, response) => { try { const body = objectBody(request.body); const term = service.createRefinedTranslationTerm(request.params.taskId, { sourceTerm: requiredString(body, 'sourceTerm'), ...((typeof body.targetTerm === 'string' || body.targetTerm === null) ? { targetTerm: body.targetTerm } : {}), ...((typeof body.entityType === 'string' || body.entityType === null) ? { entityType: body.entityType } : {}), ...(typeof body.priority === 'number' ? { priority: body.priority } : {}) }); return term ? response.status(201).json({ term }) : response.status(404).json({ message: '精翻任务不存在或已在回收站。' }); } catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '无法创建术语。' }); } });
  router.put('/tasks/:taskId/terms/:termId', (request, response) => { const body = objectBody(request.body); const status = body.status === 'pending' || body.status === 'confirmed' || body.status === 'excluded' ? body.status : undefined; const term = service.updateRefinedTranslationTerm(request.params.taskId, request.params.termId, { ...((typeof body.targetTerm === 'string' || body.targetTerm === null) ? { targetTerm: body.targetTerm } : {}), ...((typeof body.entityType === 'string' || body.entityType === null) ? { entityType: body.entityType } : {}), ...(typeof body.priority === 'number' ? { priority: body.priority } : {}), ...((typeof body.suggestion === 'string' || body.suggestion === null) ? { suggestion: body.suggestion } : {}), ...(status ? { status } : {}) }); return term ? response.json({ term }) : response.status(404).json({ message: '术语不存在。' }); });
  router.delete('/tasks/:taskId/terms/:termId', (request, response) => service.deleteRefinedTranslationTerm(request.params.taskId, request.params.termId) ? response.status(204).end() : response.status(404).json({ message: '术语不存在或任务不可修改。' }));
  router.post('/tasks/:taskId/terms/bulk-status', (request, response) => { const body = objectBody(request.body); const status = body.status === 'confirmed' || body.status === 'excluded' ? body.status : null; const termIds = Array.isArray(body.termIds) ? body.termIds.filter((item): item is string => typeof item === 'string') : []; if (!status || !termIds.length) return response.status(422).json({ message: '请选择术语和目标状态。' }); return response.json({ terms: service.bulkUpdateRefinedTranslationTerms(request.params.taskId, termIds, status) }); });
  router.post('/tasks/:taskId/terms/bulk-delete', (request, response) => { const body = objectBody(request.body); const termIds = Array.isArray(body.termIds) ? body.termIds.filter((item): item is string => typeof item === 'string') : []; if (!termIds.length) return response.status(422).json({ message: '请选择要删除的术语。' }); return response.json({ deletedIds: service.deleteRefinedTranslationTerms(request.params.taskId, termIds) }); });
  router.post('/tasks/:taskId/terms/:termId/agent-suggestion', async (request, response) => { try { const feedback = requiredString(objectBody(request.body), 'feedback'); const suggestion = await service.suggestRefinedTranslationGlossaryRevision(request.params.taskId, request.params.termId, feedback); return response.json({ suggestion }); } catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '无法生成术语建议。' }); } });
  router.post('/tasks/:taskId/chapters/:chapterId/segments/:paragraphIndex/agent-suggestion', async (request, response) => { try { const index = Number(request.params.paragraphIndex); if (!Number.isInteger(index) || index < 0) throw new Error('段落索引无效。'); const feedback = requiredString(objectBody(request.body), 'feedback'); const suggestion = await service.suggestRefinedTranslationSegmentRevision(request.params.taskId, request.params.chapterId, index, feedback); return response.json({ suggestion }); } catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '无法生成译文建议。' }); } });
  router.post('/tasks/:taskId/chapters/:chapterId/agent-chat', async (request, response) => {
    try {
      const body = objectBody(request.body);
      const mode = body.mode === 'read' || body.mode === 'edit_review' || body.mode === 'edit_skip_review' ? body.mode : 'read';
      const paragraphIndices = Array.isArray(body.paragraphIndices) ? body.paragraphIndices.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0) : [];
      const history = Array.isArray(body.history) ? body.history.flatMap((item): Array<{ role: 'user' | 'assistant'; content: string }> => isRecord(item) && typeof item.content === 'string' && item.role === 'user' ? [{ role: 'user', content: item.content }] : isRecord(item) && typeof item.content === 'string' && item.role === 'assistant' ? [{ role: 'assistant', content: item.content }] : []) : [];
      return response.json(await service.chatAboutRefinedTranslationChapter(request.params.taskId, request.params.chapterId, { message: requiredString(body, 'message'), mode, paragraphIndices, history }));
    } catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '章节 Agent 请求失败。' }); }
  });
  router.post('/tasks/:taskId/chapters/:chapterId/agent-edits/approve', async (request, response) => {
    try {
      const body = objectBody(request.body);
      const mode = body.mode === 'edit_review' || body.mode === 'edit_skip_review' ? body.mode : null;
      const edits = Array.isArray(body.edits) ? body.edits.flatMap((item): Array<{ paragraphIndex: number; translatedText: string }> => isRecord(item) && typeof item.paragraphIndex === 'number' && Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0 && typeof item.translatedText === 'string' ? [{ paragraphIndex: item.paragraphIndex, translatedText: item.translatedText }] : []) : [];
      if (!mode || !edits.length) throw new Error('没有可确认的修改提案。');
      return response.json(await service.applyRefinedTranslationChapterAgentEdits(request.params.taskId, request.params.chapterId, { mode, edits }));
    } catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '确认 Agent 修改失败。' }); }
  });
  router.get('/tasks/:taskId/reviews', (request, response) => response.json({ reviews: service.listRefinedTranslationReviews(request.params.taskId, typeof request.query.chapterId === 'string' ? request.query.chapterId : undefined) }));
  router.post('/tasks/:taskId/reviews', (request, response) => { try { const body = objectBody(request.body); const review = service.writeRefinedTranslationReview(request.params.taskId, { chapterId: requiredString(body, 'chapterId'), reviewRound: typeof body.reviewRound === 'number' ? Math.max(1, Math.trunc(body.reviewRound)) : 1, severity: optionalString(body.severity) ?? 'medium', paragraphIndices: Array.isArray(body.paragraphIndices) ? body.paragraphIndices.filter((value): value is number => typeof value === 'number') : [], scores: isRecord(body.scores) ? Object.fromEntries(Object.entries(body.scores).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {}, suggestion: optionalString(body.suggestion) ?? '', replacementText: optionalString(body.replacementText) ?? null, forceChange: body.forceChange === true, resolved: false, resolution: 'open', resolutionNote: null }); response.status(201).json({ review }); } catch (error) { response.status(422).json({ message: error instanceof Error ? error.message : '审核意见无效。' }); } });
  router.put('/tasks/:taskId/reviews/:reviewId', (request, response) => { const body = objectBody(request.body); const resolution = body.resolution === 'accepted' || body.resolution === 'partially_accepted' || body.resolution === 'rejected' || body.resolution === 'resolved' || body.resolution === 'ignored' || body.resolution === 'open' ? body.resolution : body.resolved === true ? 'accepted' : 'open'; return response.json({ ok: service.resolveRefinedTranslationReview(request.params.taskId, request.params.reviewId, resolution, optionalString(body.resolutionNote) ?? null) }); });
  router.post('/tasks/:taskId/advance', (request, response) => {
    try { return respondTask(response, service.advanceRefinedTranslationTask(request.params.taskId)); }
    catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '无法推进精翻流程。' }); }
  });
  router.post('/tasks/:taskId/pause', (request, response) => respondTask(response, service.pauseRefinedTranslationTask(request.params.taskId)));
  router.post('/tasks/:taskId/resume', (request, response) => respondTask(response, service.resumeRefinedTranslationTask(request.params.taskId)));
  router.post('/tasks/:taskId/retry-failed', (request, response) => { const body = objectBody(request.body); const chapterId = typeof body.chapterId === 'string' ? body.chapterId : undefined; const paragraphIndex = typeof body.paragraphIndex === 'number' && Number.isInteger(body.paragraphIndex) && body.paragraphIndex >= 0 ? body.paragraphIndex : undefined; return respondTask(response, service.retryRefinedTranslationFailedSegments(request.params.taskId, chapterId, paragraphIndex)); });
  router.delete('/tasks/:taskId', (request, response) => respondTask(response, service.deleteRefinedTranslationTask(request.params.taskId)));
  router.post('/tasks/:taskId/restore', (request, response) => respondTask(response, service.restoreRefinedTranslationTask(request.params.taskId)));
  router.get('/tasks/:taskId/purge-status', (request, response) => { const status = service.getRefinedTranslationPurgeStatus(request.params.taskId); return status ? response.json(status) : response.status(404).json({ message: '精翻任务不存在。' }); });
  router.delete('/tasks/:taskId/purge', (request, response) => { try { const purged = service.purgeRefinedTranslationTask(request.params.taskId); return response.status(purged ? 204 : 404).end(); } catch (error) { return response.status(422).json({ message: error instanceof Error ? error.message : '任务尚不能永久删除。' }); } });
  router.get('/tasks/:taskId/export/:format', async (request, response) => {
    const format = request.params.format;
    const mode = typeof request.query.mode === 'string' && isLibraryExportTranslationMode(request.query.mode) ? request.query.mode : 'translated';
    if (!isLibraryExportFormat(format)) return response.status(422).json({ message: '不支持的导出格式。' });
    try {
      const artifact = await service.exportRefinedTranslationTask(request.params.taskId, format, mode, request.query.includeIncomplete === 'true');
      if (!artifact) return response.status(404).json({ message: '精翻任务不存在。' });
      response.setHeader('Content-Type', artifact.contentType);
      return response.download(artifact.filePath, artifact.fileName);
    } catch (error) {
      return response.status(422).json({ message: error instanceof Error ? error.message : '导出失败。' });
    }
  });
  return router;
}

function objectBody(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requiredString(body: Record<string, unknown>, key: string): string { const value = optionalString(body[key]); if (!value) throw new Error(`${key} 必须填写。`); return value; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function respondTask(response: Response, task: unknown) { return task ? response.json({ task }) : response.status(404).json({ message: '精翻任务不存在或当前不可操作。' }); }
