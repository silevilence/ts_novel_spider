import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { LocalExportEngine } from './export-engine';
import { SqliteNovelRepository } from './novel-repository';
import { OfflineLibraryAssetService } from './offline-library';
import { RefinedTranslationService } from './refined-translation';
import { SystemPreferencesService } from './system-preferences';

test('refined translation task owns its source snapshot and supports recycle-bin recovery', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    const task = repository.createRefinedTranslationTask({
      id: 'task-1', sourceId: 'syosetu', novelId: 'n1', name: '独立精翻', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 2, maxReviewRounds: 5 },
      sourceMetadata: { title: '测试小说', author: '作者', description: '独立保存的作品简介', tags: ['奇幻'], infoPageUrl: 'https://example.test/novel' },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文一\n\n原文二', paragraphs: ['原文一', '原文二'] }],
      terms: [{ sourceTerm: '主人公', targetTerm: null, entityType: 'character', priority: 2, suggestion: '建议保留' }],
    });
    assert.equal(task.status, 'paused');
    assert.equal(repository.listRefinedTranslationSegments('task-1', 'c1').length, 2);
    assert.equal(repository.listRefinedTranslationTerms('task-1').length, 1);
    assert.equal(repository.getRefinedTranslationTask('task-1')?.sourceMetadata.description, '独立保存的作品简介');
    assert.equal(repository.updateRefinedTranslationChapterTitle('task-1', 'c1', '第一章译文')?.translatedTitle, '第一章译文');
    const extraTerm = repository.createRefinedTranslationTerm('task-1', { sourceTerm: '新术语', targetTerm: null });
    assert.equal(repository.deleteRefinedTranslationTerm('task-1', extraTerm.id), true);
    const bulkTermOne = repository.createRefinedTranslationTerm('task-1', { sourceTerm: '批量术语一', targetTerm: null });
    const bulkTermTwo = repository.createRefinedTranslationTerm('task-1', { sourceTerm: '批量术语二', targetTerm: null });
    assert.deepEqual(repository.deleteRefinedTranslationTerms('task-1', [bulkTermOne.id, bulkTermTwo.id, bulkTermOne.id]), [bulkTermOne.id, bulkTermTwo.id]);
    assert.equal(repository.listRefinedTranslationTerms('task-1').length, 1);
    const saved = repository.updateRefinedTranslationSegment('task-1', 'c1', 0, '译文一', 'translated');
    assert.equal(saved?.translatedText, '译文一');
    repository.saveRefinedTranslationCheckpoint('task-1', 'translating', { chapterId: 'c1', paragraphIndex: 0 });
    assert.deepEqual(repository.getRefinedTranslationCheckpoint('task-1', 'translating')?.state, { chapterId: 'c1', paragraphIndex: 0 });
    const review = repository.createRefinedTranslationReview({ taskId: 'task-1', chapterId: 'c1', reviewRound: 1, severity: 'high', paragraphIndices: [0], scores: { fluency: 75 }, suggestion: '调整语序', forceChange: true, resolved: false, resolution: 'open' });
    assert.equal(review.reviewRound, 1);
    assert.equal(review.forceChange, true);
    assert.ok(review.createdAt);
    assert.equal(repository.updateRefinedTranslationReview('task-1', review.id, 'resolved'), true);
    assert.equal(repository.listRefinedTranslationReviews('task-1', 'c1')[0]?.resolved, true);
    assert.equal(repository.markRefinedTranslationTaskDeleted('task-1')?.status, 'deleted');
    assert.equal(repository.getRefinedTranslationPurgeStatus('task-1')?.canPurge, false);
    assert.equal(repository.purgeRefinedTranslationTask('task-1'), false);
    assert.equal(repository.listRefinedTranslationTasks().length, 0);
    assert.equal(repository.restoreRefinedTranslationTask('task-1')?.deletedAt, null);
    assert.equal(repository.getRefinedTranslationTask('task-1')?.novelTitle, '测试小说');
  } finally { repository.close(); fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('refined translation can extract glossary candidates when the copied sources are empty', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-terms-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-empty-terms', sourceId: 'syosetu', novelId: 'n1', name: '空术语任务', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: { providerId: 'fake', modelId: 'model' }, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '勇者アリスは王都へ向かった。', paragraphs: ['勇者アリスは王都へ向かった。'] }],
      terms: [],
    });
    const service = new RefinedTranslationService(
      repository,
      new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }),
      new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }),
      async () => '{"terms":[{"sourceTerm":"アリス","entityType":"character","priority":9,"suggestion":"主角姓名"},{"sourceTerm":"王都","entityType":"location","priority":7,"suggestion":"城市名"}]}',
    );

    const result = await service.extractGlossaryCandidates('task-empty-terms');
    assert.deepEqual(result.terms.map((term) => term.sourceTerm), ['アリス', '王都']);
    assert.equal(result.terms[0]?.status, 'pending');
    assert.deepEqual({ candidates: result.candidates, added: result.added, total: result.total }, { candidates: 2, added: 2, total: 2 });
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('glossary setup does not re-run a tool agent for candidates that extraction already explained', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-glossary-fast-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-glossary-fast', sourceId: 'syosetu', novelId: 'n1', name: '快速术语提取', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: { providerId: 'fake', modelId: 'model' }, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: 'アリス在王都使用フェロモン。', paragraphs: ['アリス在王都使用フェロモン。'] }], terms: [],
    });
    let toolAgentCalls = 0;
    const result = '{"terms":[{"sourceTerm":"アリス","entityType":"character","priority":9,"suggestion":"角色名"},{"sourceTerm":"フェロモン","entityType":"concept","priority":8,"suggestion":"设定用语"}]}';
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async () => result, async () => { toolAgentCalls += 1; return { text: result, toolCallCount: 1, toolCalls: [] }; });

    service.resume('task-glossary-fast');
    await waitFor(() => repository.getRefinedTranslationTask('task-glossary-fast')?.status === 'paused');
    assert.equal(toolAgentCalls, 0);
    assert.equal(repository.listRefinedTranslationTerms('task-glossary-fast').length, 2);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('glossary translation falls back when the tool agent replies with narration instead of writing the term', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-glossary-translation-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-glossary-translation', sourceId: 'syosetu', novelId: 'n1', name: '术语译法', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: { providerId: 'fake', modelId: 'model' }, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: 'フェロモン', paragraphs: ['フェロモン'] }],
      terms: [{ sourceTerm: 'フェロモン', targetTerm: null, entityType: 'concept', priority: 8, suggestion: '设定用语', status: 'confirmed' }],
    });
    repository.updateRefinedTranslationTask('task-glossary-translation', { stage: 'glossary_translation', status: 'paused' });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async () => '费洛蒙', async () => ({ text: '术语「フェロモン」的译法已更新为「费洛蒙」。', toolCallCount: 1, toolCalls: [{ toolName: 'read_glossary', input: {} }] }));

    service.resume('task-glossary-translation');
    await waitFor(() => repository.getRefinedTranslationTask('task-glossary-translation')?.status === 'paused');
    assert.equal(repository.listRefinedTranslationTerms('task-glossary-translation')[0]?.targetTerm, '费洛蒙');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chapter agent carries task locators and requires approval before applying edit proposals', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-agent-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-agent', sourceId: 'syosetu', novelId: 'n1', name: '章节 Agent', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文一', paragraphs: ['原文一'] }], terms: [],
    });
    let prompt = '';
    let agentReadMaterial: unknown = null;
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (_preferences, _route, system, input) => {
      prompt = `${system}\n${input}`;
      return system.includes('仅返回 JSON') ? '{"reply":"已调整语气","edits":[{"paragraphIndex":0,"translatedText":"修改后的译文"}]}' : '只读分析结果';
    }, async (_preferences, _route, system, input, tools) => {
      prompt = `${system}\n${input}`;
      const readTool = tools.read_current_translation as { execute?: (toolInput: { chapterId: string }) => Promise<unknown> };
      agentReadMaterial = await readTool.execute?.({ chapterId: 'c1' });
      if (system.includes('只读模式')) return { text: '只读分析结果', toolCallCount: 1, toolCalls: [] };
      return { text: '已生成待确认修改。', toolCallCount: 2, toolCalls: [{ toolName: 'write_translation_segment', input: { chapterId: 'c1', paragraphIndex: 0, translatedText: '修改后的译文' } }] };
    });

    const readResult = await service.chatAboutChapter('task-agent', 'c1', { message: '分析这一章', mode: 'read', paragraphIndices: [0] });
    assert.equal(readResult.reply, '只读分析结果');
    assert.match(prompt, /task_id=task-agent/);
    assert.match(prompt, /chapter_id=c1/);
    assert.ok(agentReadMaterial);
    assert.equal(repository.listRefinedTranslationSegments('task-agent', 'c1')[0]?.translatedText, null);

    const editResult = await service.chatAboutChapter('task-agent', 'c1', { message: '直接改写', mode: 'edit_skip_review', paragraphIndices: [0] });
    assert.deepEqual(editResult.proposedEdits.map((edit) => edit.paragraphIndex), [0]);
    assert.equal(repository.listRefinedTranslationSegments('task-agent', 'c1')[0]?.translatedText, null);
    const approval = await service.applyChapterAgentEdits('task-agent', 'c1', { mode: 'edit_skip_review', edits: editResult.proposedEdits });
    assert.deepEqual(approval.appliedParagraphIndices, [0]);
    assert.equal(repository.listRefinedTranslationSegments('task-agent', 'c1')[0]?.translatedText, '修改后的译文');
    assert.equal(repository.getRefinedTranslationChapter('task-agent', 'c1')?.status, 'reviewed');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reprocessing a needs-attention chapter keeps an unprocessed review open when no translation model is available', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-supersede-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-supersede', sourceId: 'syosetu', novelId: 'n1', name: '重处理审核', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文一', paragraphs: ['原文一'] }], terms: [],
    });
    repository.updateRefinedTranslationChapterReview('task-supersede', 'c1', { reviewRound: 5, reviewScore: 62, status: 'needs_attention' });
    const oldIssue = repository.createRefinedTranslationReview({ taskId: 'task-supersede', chapterId: 'c1', reviewRound: 5, severity: 'high', paragraphIndices: [0], scores: { fluency: 62 }, suggestion: '旧意见', forceChange: true, resolved: false, resolution: 'open' });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }));
    service.retryFailedSegments('task-supersede', 'c1');
    await waitFor(() => repository.getRefinedTranslationTask('task-supersede')?.status === 'needs_attention');
    assert.equal(repository.listRefinedTranslationReviews('task-supersede', 'c1').find((review) => review.id === oldIssue.id)?.resolution, 'open');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolving a final manual review never restarts automatic checking or review', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-manual-review-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-manual-review', sourceId: 'syosetu', novelId: 'n1', name: '人工审核恢复', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文一', paragraphs: ['原文一'] }], terms: [],
    });
    repository.updateRefinedTranslationSegment('task-manual-review', 'c1', 0, '已修订译文', 'translated');
    repository.updateRefinedTranslationChapterReview('task-manual-review', 'c1', { reviewRound: 5, reviewScore: 65, status: 'needs_attention' });
    repository.updateRefinedTranslationTask('task-manual-review', { stage: 'reviewing', status: 'needs_attention' });
    const issue = repository.createRefinedTranslationReview({ taskId: 'task-manual-review', chapterId: 'c1', reviewRound: 5, severity: 'high', paragraphIndices: [0], scores: { fluency: 65 }, suggestion: '修正语气', replacementText: null, forceChange: true, resolved: false, resolution: 'open', resolutionNote: null });
    let automaticModelCalls = 0;
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async () => {
      automaticModelCalls += 1;
      return '{"score":90,"severity":"low","issues":[],"scores":{"fluency":90}}';
    });
    assert.equal(service.resolveReview('task-manual-review', issue.id, 'accepted', '已手动修正。'), true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(automaticModelCalls, 0);
    assert.equal(repository.getRefinedTranslationTask('task-manual-review')?.status, 'needs_attention');
    assert.equal(repository.getRefinedTranslationTask('task-manual-review')?.stage, 'reviewing');
    assert.equal(repository.getRefinedTranslationChapter('task-manual-review', 'c1')?.reviewRound, 5);
    assert.equal(repository.listRefinedTranslationTransitions('task-manual-review').some((transition) => transition.toStage === 'checking' && transition.condition.includes('均已人工处理')), false);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refined translation retries failed paragraphs with the configured concurrency', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-run-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-run', sourceId: 'syosetu', novelId: 'n1', name: '并发精翻', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 2, maxReviewRounds: 2 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '一\n\n二\n\n三', paragraphs: ['一', '二', '三'] }],
      terms: [],
    });
    for (const index of [0, 1, 2]) repository.updateRefinedTranslationSegment('task-run', 'c1', index, null, 'failed');

    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const service = new RefinedTranslationService(
      repository,
      new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }),
      new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }),
      async (_preferences, _route, system) => {
        if (system.includes('审核文学翻译')) return '{"score":90,"severity":"low","issues":[],"scores":{"fluency":90}}';
        if (system.includes('章节标题')) return '标题译文';
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate;
        active -= 1;
        return '译文';
      },
    );

    service.retryFailedSegments('task-run');
    await waitFor(() => calls === 2);
    assert.equal(maximumActive, 2);
    releaseGate?.();
    await waitFor(() => repository.listRefinedTranslationSegments('task-run', 'c1').every((segment) => segment.status === 'translated'));
    assert.equal(maximumActive, 2);
    assert.equal(repository.getRefinedTranslationTask('task-run')?.status, 'completed');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refined translation export excludes incomplete chapters when requested', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-export-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-export', sourceId: 'syosetu', novelId: 'n1', name: '导出精翻', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 2 },
      chapters: [
        { id: 'complete', index: 1, title: '已完成章节', volumeTitle: null, content: '完成原文', paragraphs: ['完成原文'] },
        { id: 'pending', index: 2, title: '未完成章节', volumeTitle: null, content: '未完成原文', paragraphs: ['未完成原文'] },
      ],
      terms: [],
    });
    repository.updateRefinedTranslationSegment('task-export', 'complete', 0, '完成译文', 'translated');
    const service = new RefinedTranslationService(
      repository,
      new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }),
      new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }),
    );

    const completedOnly = await service.exportTask('task-export', 'markdown', 'bilingual', false);
    assert.ok(completedOnly);
    const completedContent = await readMarkdownArtifact(completedOnly.filePath);
    assert.match(completedContent, /已完成章节/);
    assert.doesNotMatch(completedContent, /未完成章节/);

    const allChapters = await service.exportTask('task-export', 'markdown', 'bilingual', true);
    assert.ok(allChapters);
    assert.match(await readMarkdownArtifact(allChapters.filePath), /未完成章节/);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refined translation pauses for both glossary confirmations, translates metadata, then completes automatically', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-workflow-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-workflow', sourceId: 'syosetu', novelId: 'n1', name: '流程精翻', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: { providerId: 'fake', modelId: 'model' }, termTranslationModel: { providerId: 'fake', modelId: 'model' }, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: { providerId: 'fake', modelId: 'model' }, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 2, maxReviewRounds: 2 },
      sourceMetadata: { title: '测试小说', author: '作者', description: '作品简介', tags: ['奇幻'], infoPageUrl: 'https://example.test/novel' },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文一\n\n原文二', paragraphs: ['原文一', '原文二'] }],
      terms: [{ sourceTerm: '主人公', targetTerm: null, entityType: 'character', priority: 2, suggestion: null }],
    });
    const service = new RefinedTranslationService(
      repository,
      new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }),
      new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }),
      async (_preferences, _route, system) => {
        if (system.includes('评估小说术语')) return '{"status":"pending","entityType":"character","priority":8,"suggestion":"保留角色名"}';
        if (system.includes('将术语')) return '主角';
        if (system.includes('小说标题')) return '测试小说译名';
        if (system.includes('作者/笔名')) return '作者译名';
        if (system.includes('小说简介')) return '作品简介译文';
        if (system.includes('小说标签')) return '幻想';
        if (system.includes('判断原文')) return 'NO';
        if (system.includes('审核文学翻译')) return '{"score":91,"severity":"low","issues":[],"scores":{"fluency":91,"consistency":91,"termAccuracy":91,"format":91}}';
        return '测试译文';
      },
    );

    service.resume('task-workflow');
    await waitFor(() => repository.getRefinedTranslationTask('task-workflow')?.status === 'paused');
    assert.equal(repository.getRefinedTranslationTask('task-workflow')?.stage, 'glossary_setup');
    service.advance('task-workflow');
    await waitFor(() => repository.getRefinedTranslationTask('task-workflow')?.stage === 'glossary_translation' && repository.getRefinedTranslationTask('task-workflow')?.status === 'paused');
    assert.equal(repository.listRefinedTranslationTerms('task-workflow')[0]?.targetTerm, '主角');
    assert.throws(() => service.advance('task-workflow'), /待确认/u);
    const term = repository.listRefinedTranslationTerms('task-workflow')[0];
    assert.ok(term);
    repository.updateRefinedTranslationTerm('task-workflow', term.id, { status: 'confirmed' });
    service.advance('task-workflow');
    await waitFor(() => repository.getRefinedTranslationTask('task-workflow')?.status === 'completed');
    assert.equal(repository.getRefinedTranslationChapter('task-workflow', 'c1')?.status, 'reviewed');
    assert.equal(repository.getRefinedTranslationChapter('task-workflow', 'c1')?.reviewScore, 91);
    assert.deepEqual(repository.getRefinedTranslationTask('task-workflow')?.translatedMetadata, { title: '测试小说译名', author: '作者译名', description: '作品简介译文', tags: ['幻想'] });
    const exported = await service.exportTask('task-workflow', 'markdown', 'translated', true);
    assert.ok(exported);
    const content = await readMarkdownArtifact(exported.filePath);
    assert.match(content, /# 测试小说译名/);
    assert.match(content, /作者：作者译名/);
    assert.match(content, /标签：幻想/);
    assert.match(content, /作品简介译文/);
    assert.ok(repository.getRefinedTranslationCheckpoint('task-workflow', 'reviewing'));
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refined translation revises only review-linked segments in a dedicated agent node', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-revision-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-auto-revision', sourceId: 'syosetu', novelId: 'n1', name: '自动修订', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 2 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文一\n\n原文二', paragraphs: ['原文一', '原文二'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-auto-revision', { stage: 'translating', status: 'paused' });
    let revisionPrompt = '';
    const initialTranslationPrompts: string[] = [];
    const service = new RefinedTranslationService(
      repository,
      new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }),
      new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }),
      async (_preferences, _route, system, prompt) => {
        if (system.includes('审核文学翻译')) return prompt.includes('按审核意见修订的译文')
          ? '{"score":92,"severity":"low","issues":[],"scores":{"fluency":92,"consistency":92,"termAccuracy":92,"format":92}}'
          : '{"score":65,"severity":"medium","issues":[{"paragraphIndex":0,"sourceExcerpt":"原文一","translationExcerpt":"初始译文一","suggestion":"将语气改得更自然。","replacementText":"按审核意见修订的译文","forceChange":true}],"scores":{"fluency":65}}';
        if (system.includes('审核修订 Agent')) {
          revisionPrompt = `${system}\n${prompt}`;
          const reviewId = prompt.match(/reviewId=([^；\n]+)/u)?.[1] ?? '';
          return `{"translatedText":"按审核意见修订的译文","reviewFeedback":[{"reviewId":"${reviewId}","decision":"accepted","reason":"已采用建议并调整语气。"}]}`;
        }
        if (system.includes('你是专业文学译者')) {
          initialTranslationPrompts.push(prompt);
          return prompt === '原文一' ? '初始译文一' : '不应改动的译文二';
        }
        return '初始译文一';
      },
    );

    service.resume('task-auto-revision');
    await waitFor(() => repository.getRefinedTranslationTask('task-auto-revision')?.status === 'completed');
    assert.match(revisionPrompt, /将语气改得更自然/);
    assert.match(revisionPrompt, /当前段译文：初始译文一/);
    assert.doesNotMatch(revisionPrompt, /原文二/);
    assert.deepEqual(initialTranslationPrompts, ['原文一', '原文二']);
    assert.equal(repository.listRefinedTranslationSegments('task-auto-revision', 'c1')[0]?.translatedText, '按审核意见修订的译文');
    assert.equal(repository.listRefinedTranslationSegments('task-auto-revision', 'c1')[1]?.translatedText, '不应改动的译文二');
    assert.equal(repository.listRefinedTranslationReviews('task-auto-revision', 'c1')[0]?.replacementText, '按审核意见修订的译文');
    assert.equal(repository.listRefinedTranslationReviews('task-auto-revision', 'c1')[0]?.resolution, 'accepted');
    assert.equal(repository.listRefinedTranslationReviews('task-auto-revision', 'c1')[0]?.resolutionNote, '已采用建议并调整语气。');
    assert.equal(repository.getRefinedTranslationChapter('task-auto-revision', 'c1')?.reviewRound, 2);
    assert.ok(repository.listRefinedTranslationTransitions('task-auto-revision').some((item) => item.fromStage === 'reviewing' && item.toStage === 'revising'));
    assert.ok(repository.listRefinedTranslationTransitions('task-auto-revision').some((item) => item.fromStage === 'revising' && item.toStage === 'checking'));
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('review round cap keeps unresolved opinions for final review and continues later chapters', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-review-cap-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-review-cap', sourceId: 'syosetu', novelId: 'n1', name: '审核上限继续', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 1 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '甲', paragraphs: ['甲'] }, { id: 'c2', index: 2, title: '第二章', volumeTitle: null, content: '乙', paragraphs: ['乙'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-review-cap', { stage: 'translating', status: 'paused' });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (_preferences, _route, system, prompt) => {
      if (system.includes('审核文学翻译')) { const source = prompt.includes('【1】原文：甲') ? '甲' : '乙'; return `{"score":60,"severity":"high","issues":[{"paragraphIndex":0,"sourceExcerpt":"${source}","translationExcerpt":"译文","suggestion":"请润色。","replacementText":null,"forceChange":true}],"scores":{"fluency":60}}`; }
      return '译文';
    });
    service.resume('task-review-cap');
    await waitFor(() => repository.getRefinedTranslationTask('task-review-cap')?.status === 'completed');
    assert.equal(repository.getRefinedTranslationChapter('task-review-cap', 'c1')?.status, 'reviewed');
    assert.equal(repository.getRefinedTranslationChapter('task-review-cap', 'c2')?.status, 'reviewed');
    assert.equal(repository.listRefinedTranslationReviews('task-review-cap').filter((review) => review.resolution === 'open').length, 2);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reading task detail resumes a stale needs-attention task when later chapters remain', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-stale-recovery-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-stale-recovery', sourceId: 'syosetu', novelId: 'n1', name: '状态恢复', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 2 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '甲', paragraphs: ['甲'] }, { id: 'c2', index: 2, title: '第二章', volumeTitle: null, content: '乙', paragraphs: ['乙'] }], terms: [],
    });
    repository.updateRefinedTranslationChapterReview('task-stale-recovery', 'c1', { reviewRound: 1, reviewScore: 90, status: 'reviewed' });
    repository.updateRefinedTranslationTask('task-stale-recovery', { stage: 'translating', status: 'needs_attention' });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (_preferences, _route, system) => {
      if (system.includes('审核文学翻译')) return '{"score":90,"severity":"low","issues":[],"scores":{"fluency":90}}';
      return '译文';
    });

    service.getTaskDetail('task-stale-recovery');
    await waitFor(() => repository.getRefinedTranslationTask('task-stale-recovery')?.status === 'completed');
    assert.equal(repository.getRefinedTranslationChapter('task-stale-recovery', 'c2')?.status, 'reviewed');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task detail reports the active chapter review round instead of a historical maximum', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-current-round-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-current-round', sourceId: 'syosetu', novelId: 'n1', name: '当前轮次', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 5 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '甲', paragraphs: ['甲'] }, { id: 'c2', index: 2, title: '第二章', volumeTitle: null, content: '乙', paragraphs: ['乙'] }], terms: [],
    });
    repository.updateRefinedTranslationChapterReview('task-current-round', 'c1', { reviewRound: 10, reviewScore: 70, status: 'reviewed' });
    repository.updateRefinedTranslationChapterReview('task-current-round', 'c2', { reviewRound: 1, reviewScore: 85, status: 'pending' });
    repository.updateRefinedTranslationTask('task-current-round', { stage: 'reviewing', status: 'paused' });
    repository.saveRefinedTranslationCheckpoint('task-current-round', 'reviewing', { chapterId: 'c2' });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }));

    assert.equal(service.getTaskDetail('task-current-round')?.progress.currentRound, 1);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('updated task model configuration is used by the next model call', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-config-live-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-config-live', sourceId: 'syosetu', novelId: 'n1', name: '运行中换模型', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'old-translation' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'old-review' }, concurrency: 1, maxReviewRounds: 2 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '甲', paragraphs: ['甲'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-config-live', { stage: 'translating', status: 'paused' });
    const routes: Array<{ modelId: string; thinkingEnabled?: boolean }> = [];
    let releaseFirstTranslation: (() => void) | null = null;
    const firstTranslationStarted = new Promise<void>((resolve) => { releaseFirstTranslation = resolve; });
    let waitForRelease: (() => void) | null = null;
    const allowFirstTranslation = new Promise<void>((resolve) => { waitForRelease = resolve; });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (_preferences, route, system) => {
      routes.push({ modelId: route.modelId, thinkingEnabled: route.thinkingEnabled });
      if (route.modelId === 'old-translation') { releaseFirstTranslation?.(); await allowFirstTranslation; return '译文'; }
      if (system.includes('审核文学翻译')) return '{"score":90,"severity":"low","issues":[],"scores":{"fluency":90}}';
      return '译文';
    });

    service.resume('task-config-live');
    await firstTranslationStarted;
    service.updateTaskConfiguration('task-config-live', { modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'new-translation' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'new-review', thinkingEnabled: true }, concurrency: 1, maxReviewRounds: 2 } });
    waitForRelease?.();
    await waitFor(() => repository.getRefinedTranslationTask('task-config-live')?.status === 'completed');

    assert.equal(routes[0]?.modelId, 'old-translation');
    assert.ok(routes.some((route) => route.modelId === 'new-review' && route.thinkingEnabled === true));
    assert.equal(repository.getRefinedTranslationTask('task-config-live')?.modelConfig.reviewModel?.modelId, 'new-review');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pausing an automatic refined translation prevents later model calls and keeps the task paused', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-pause-cancellation-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-pause-cancellation', sourceId: 'syosetu', novelId: 'n1', name: '暂停止损', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 1 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文', paragraphs: ['原文'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-pause-cancellation', { stage: 'translating', status: 'paused' });
    repository.updateRefinedTranslationChapterTitle('task-pause-cancellation', 'c1', '第一章译文');
    let modelCalls = 0;
    let announceFirstCall: (() => void) | null = null;
    let releaseFirstCall: (() => void) | null = null;
    const firstCallStarted = new Promise<void>((resolve) => { announceFirstCall = resolve; });
    const allowFirstCallToFinish = new Promise<void>((resolve) => { releaseFirstCall = resolve; });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        announceFirstCall?.();
        await allowFirstCallToFinish;
        return '译文';
      }
      throw new Error('model call started after task was paused');
    });

    service.resume('task-pause-cancellation');
    await firstCallStarted;
    service.pause('task-pause-cancellation');
    releaseFirstCall?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if (modelCalls > 1) await waitFor(() => repository.getRefinedTranslationTask('task-pause-cancellation')?.status !== 'running');

    assert.equal(modelCalls, 1);
    assert.equal(service.getTaskDetail('task-pause-cancellation')?.task.status, 'paused');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('automatic refined translation passes its cancellation signal to the text generator', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-generator-signal-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-generator-signal', sourceId: 'syosetu', novelId: 'n1', name: '请求取消信号', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 1 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文', paragraphs: ['原文'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-generator-signal', { stage: 'translating', status: 'paused' });
    repository.updateRefinedTranslationChapterTitle('task-generator-signal', 'c1', '第一章译文');
    let receivedSignal: AbortSignal | undefined;
    let announceCall: (() => void) | null = null;
    let releaseCall: (() => void) | null = null;
    const callStarted = new Promise<void>((resolve) => { announceCall = resolve; });
    const allowCallToFinish = new Promise<void>((resolve) => { releaseCall = resolve; });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (...args: unknown[]) => {
      receivedSignal = args[4] instanceof AbortSignal ? args[4] : undefined;
      announceCall?.();
      await allowCallToFinish;
      return '译文';
    });

    service.resume('task-generator-signal');
    await callStarted;
    service.pause('task-generator-signal');
    releaseCall?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(receivedSignal.aborted, true);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('automatic refined translation passes its cancellation signal to the tool agent', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-tool-signal-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-tool-signal', sourceId: 'syosetu', novelId: 'n1', name: '工具取消信号', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: null, concurrency: 1, maxReviewRounds: 1 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文', paragraphs: ['原文'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-tool-signal', { stage: 'translating', status: 'paused' });
    repository.updateRefinedTranslationChapterTitle('task-tool-signal', 'c1', '第一章译文');
    let receivedSignal: AbortSignal | undefined;
    let announceCall: (() => void) | null = null;
    let releaseCall: (() => void) | null = null;
    const callStarted = new Promise<void>((resolve) => { announceCall = resolve; });
    const allowCallToFinish = new Promise<void>((resolve) => { releaseCall = resolve; });
    const service = new RefinedTranslationService(
      repository,
      new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }),
      new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }),
      async () => 'fallback should not run',
      async (...args: unknown[]) => {
        receivedSignal = args[6] instanceof AbortSignal ? args[6] : undefined;
        announceCall?.();
        await allowCallToFinish;
        return { text: '译文', toolCallCount: 1, toolCalls: [] };
      },
    );

    service.resume('task-tool-signal');
    await callStarted;
    service.pause('task-tool-signal');
    releaseCall?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(receivedSignal.aborted, true);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pausing during the omission check cancels the request and preserves the paused state', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-checking-cancellation-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-checking-cancellation', sourceId: 'syosetu', novelId: 'n1', name: '检查止损', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: { providerId: 'fake', modelId: 'omission' }, reviewModel: null, concurrency: 1, maxReviewRounds: 1 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文', paragraphs: ['原文'] }], terms: [],
    });
    repository.updateRefinedTranslationTask('task-checking-cancellation', { stage: 'checking', status: 'paused' });
    repository.saveRefinedTranslationCheckpoint('task-checking-cancellation', 'checking', { chapterId: 'c1' });
    let modelCalls = 0;
    let receivedSignal: AbortSignal | undefined;
    let announceCall: (() => void) | null = null;
    let releaseCall: (() => void) | null = null;
    const callStarted = new Promise<void>((resolve) => { announceCall = resolve; });
    const allowCallToFinish = new Promise<void>((resolve) => { releaseCall = resolve; });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (...args: unknown[]) => {
      modelCalls += 1;
      receivedSignal = args[4] instanceof AbortSignal ? args[4] : undefined;
      announceCall?.();
      await allowCallToFinish;
      return 'NO';
    });

    service.resume('task-checking-cancellation');
    await callStarted;
    service.pause('task-checking-cancellation');
    releaseCall?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    assert.equal(modelCalls, 1);
    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(receivedSignal.aborted, true);
    assert.equal(service.getTaskDetail('task-checking-cancellation')?.task.status, 'paused');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('deleting an automatic refined translation during review prevents later model calls and keeps it deleted', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-delete-cancellation-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-delete-cancellation', sourceId: 'syosetu', novelId: 'n1', name: '删除止损', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 2 },
      chapters: [{ id: 'c1', index: 1, title: '第一章', volumeTitle: null, content: '原文', paragraphs: ['原文'] }], terms: [],
    });
    repository.updateRefinedTranslationSegment('task-delete-cancellation', 'c1', 0, '译文', 'translated');
    repository.updateRefinedTranslationChapterReview('task-delete-cancellation', 'c1', { reviewRound: 0, reviewScore: null, status: 'translated' });
    repository.updateRefinedTranslationTask('task-delete-cancellation', { stage: 'reviewing', status: 'paused' });
    repository.saveRefinedTranslationCheckpoint('task-delete-cancellation', 'reviewing', { chapterId: 'c1' });
    let modelCalls = 0;
    let announceReviewCall: (() => void) | null = null;
    let releaseReviewCall: (() => void) | null = null;
    const reviewCallStarted = new Promise<void>((resolve) => { announceReviewCall = resolve; });
    const allowReviewCallToFinish = new Promise<void>((resolve) => { releaseReviewCall = resolve; });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async () => {
      modelCalls += 1;
      announceReviewCall?.();
      await allowReviewCallToFinish;
      return '{"score":90,"severity":"low","issues":[],"scores":{"fluency":90}}';
    });

    service.resume('task-delete-cancellation');
    await reviewCallStarted;
    service.markDeleted('task-delete-cancellation');
    releaseReviewCall?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const task = service.getTaskDetail('task-delete-cancellation')?.task;
    assert.equal(modelCalls, 1);
    assert.equal(task?.status, 'deleted');
    assert.ok(task?.deletedAt);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refined translation continues with later chapters after a paragraph failure', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-refined-isolation-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    repository.createRefinedTranslationTask({
      id: 'task-isolation', sourceId: 'syosetu', novelId: 'n1', name: '隔离精翻', novelTitle: '测试小说', author: '作者', sourceLang: 'ja', targetLang: 'zh-CN',
      modelConfig: { termExtractionModel: null, termTranslationModel: null, translationModels: [{ providerId: 'fake', modelId: 'model' }], omissionModel: null, reviewModel: { providerId: 'fake', modelId: 'model' }, concurrency: 1, maxReviewRounds: 2 },
      chapters: [{ id: 'bad', index: 1, title: '失败章', volumeTitle: null, content: 'bad', paragraphs: ['bad'] }, { id: 'good', index: 2, title: '成功章', volumeTitle: null, content: 'good', paragraphs: ['good'] }],
      terms: [],
    });
    repository.updateRefinedTranslationTask('task-isolation', { stage: 'translating', status: 'paused' });
    const service = new RefinedTranslationService(repository, new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') }), new LocalExportEngine({ outputRoot: path.join(tempDir, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }) }), async (_preferences, _route, system, prompt) => {
      if (system.includes('审核文学翻译')) return '{"score":90,"severity":"low","issues":[],"scores":{"fluency":90}}';
      if (prompt === 'bad') throw new Error('simulated model failure');
      return '译文';
    });
    service.resume('task-isolation');
    await waitFor(() => repository.getRefinedTranslationTask('task-isolation')?.status === 'needs_attention');
    assert.equal(repository.getRefinedTranslationChapter('task-isolation', 'bad')?.status, 'failed');
    assert.equal(repository.getRefinedTranslationChapter('task-isolation', 'good')?.status, 'reviewed');
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function readMarkdownArtifact(filePath: string): Promise<string> {
  const archive = await JSZip.loadAsync(fs.readFileSync(filePath));
  const entry = archive.file(/\.md$/u)[0];
  assert.ok(entry);
  return entry.async('string');
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not met before timeout');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
