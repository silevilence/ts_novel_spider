import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SqliteNovelRepository } from '../core/novel-repository';
import type { StoredTranslationProfileInput } from '../core/novel-repository';
import {
  SystemPreferencesService,
  normalizeTranslationPreferencesInput,
  TRANSLATION_DEFAULTS,
} from '../core/system-preferences';
import {
  LIBRARY_EXPORT_TRANSLATION_MODES,
  isLibraryExportTranslationMode,
} from '../core/export-engine';
import { createTranslationPipelineGraph } from '../core/translation-pipeline';
import { TranslationService } from '../core/translation-service';
import { TranslationHistoryManager } from '../core/translation/nodes/history-manager';
import { stripTranslationNumberPrefix } from '../core/translation/nodes/translate-node';

// ── SQLite 迁移 + CRUD ──

test('translation tables are created by migration', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-translation-'));
  const db = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));

  try {
    // Seed a novel + chapters
    db.saveMetadata('syosetu', {
      novelId: 'n1000t',
      title: '翻译测试',
      author: '测试',
      description: '',
      tags: [],
      chapterCount: 1,
      infoPageUrl: 'https://example.com/n1000t',
    });
    db.saveChapterIndex('syosetu', 'n1000t', [
      { id: 'chapter-1', index: 1, title: '第一章', volumeTitle: null, url: 'https://example.com/n1000t/1' },
    ]);
    db.saveChapterContent('syosetu', 'n1000t', {
      chapterId: 'chapter-1', index: 1, title: '第一章', volumeTitle: null,
      url: 'https://example.com/n1000t/1', content: 'テスト内容',
    });

    // Profile save/load round-trip
    const profileInput: StoredTranslationProfileInput = {
      sourceId: 'syosetu',
      novelId: 'n1000t',
      sourceLang: 'ja',
      targetLang: 'zh-CN',
      termExtractionModel: null,
      translationModels: [{ providerId: 'p1', modelId: 'gpt-4o', maxConcurrency: 2 }],
      reviewModel: null,
      translationConcurrency: 2,
      qualityThreshold: 0.85,
      autoRejectUntranslatedTerms: true,
      defaultExportMode: 'bilingual',
      configLocked: false,
      lockedAt: null,
    };

    const saved = db.saveTranslationProfile(profileInput);
    assert.equal(saved.sourceLang, 'ja');
    assert.equal(saved.targetLang, 'zh-CN');
    assert.equal(saved.translationModels.length, 1);
    assert.equal(saved.translationModels[0]?.modelId, 'gpt-4o');
    assert.equal(saved.qualityThreshold, 0.85);
    assert.equal(saved.defaultExportMode, 'bilingual');
    assert.ok(saved.updatedAt);

    const loaded = db.getTranslationProfile('syosetu', 'n1000t');
    assert.ok(loaded);
    assert.equal(loaded!.sourceLang, 'ja');

    // Build save/load
    const build = db.saveTranslationBuild({
      sourceId: 'syosetu',
      novelId: 'n1000t',
      status: 'queued',
      stage: 'idle',
      progressPercent: 0,
      message: '准备开始翻译',
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      modelStatsJson: '[]',
      translatedChapters: 0,
      reviewedChapters: 0,
      failedChapters: 0,
      glossaryVersion: 1,
      profileVersion: 1,
    });

    assert.equal(build.status, 'queued');
    assert.equal(build.glossaryVersion, 1);

    const buildLoaded = db.getTranslationBuild('syosetu', 'n1000t');
    assert.ok(buildLoaded);
    assert.equal(buildLoaded!.status, 'queued');

    // Term CRUD
    const term = db.createTranslationTerm({
      sourceId: 'syosetu',
      novelId: 'n1000t',
      sourceTerm: '魔法使い',
      targetTerm: '魔法师',
      entityType: 'character',
      priority: 10,
    });

    assert.equal(term.sourceTerm, '魔法使い');
    assert.equal(term.targetTerm, '魔法师');
    assert.equal(term.entityType, 'character');

    const terms = db.listTranslationTerms('syosetu', 'n1000t');
    assert.equal(terms.length, 1);
    assert.equal(terms[0]!.targetTerm, '魔法师');

    // Missing terms
    db.createTranslationTerm({
      sourceId: 'syosetu', novelId: 'n1000t', sourceTerm: '未定義', targetTerm: null,
    });
    const missing = db.listMissingTranslationTerms('syosetu', 'n1000t');
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!.sourceTerm, '未定義');

    // Upsert
    const result = db.upsertTranslationTerms('syosetu', 'n1000t', [
      { sourceTerm: '魔法使い', targetTerm: '魔导师' },
      { sourceTerm: '剣士', targetTerm: '剑士' },
    ]);
    assert.equal(result.skipped, 1); // already has targetTerm
    assert.equal(result.created, 1);

    // Update term
    const updated = db.updateTranslationTerm('syosetu', 'n1000t', term.id, { priority: 20 });
    assert.ok(updated);
    assert.equal(updated!.priority, 20);

    // Delete term
    const createdTerm2 = db.createTranslationTerm({
      sourceId: 'syosetu', novelId: 'n1000t', sourceTerm: '删除テスト',
    });
    assert.ok(db.deleteTranslationTerm('syosetu', 'n1000t', createdTerm2.id));
    assert.equal(db.listTranslationTerms('syosetu', 'n1000t').length, 3); // 魔法使い, 未定義, 剣士

    // Build log
    const log = db.appendTranslationBuildLog({
      sourceId: 'syosetu',
      novelId: 'n1000t',
      stage: 'translating',
      level: 'info',
      message: '开始翻译第一章',
    });
    assert.equal(log.stage, 'translating');

    const logs = db.listTranslationBuildLogs('syosetu', 'n1000t');
    assert.ok(logs.length >= 1);

    // Checkpoint
    db.saveTranslationBuildCheckpoint({
      sourceId: 'syosetu',
      novelId: 'n1000t',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      stage: 'completed',
      pipelineStateJson: '{}',
      warningMessage: null,
    });
    const cps = db.listTranslationBuildCheckpoints('syosetu', 'n1000t');
    assert.equal(cps.length, 1);
    assert.equal(cps[0]!.stage, 'completed');

    // Chapter translation
    const ct = db.saveChapterTranslation({
      sourceId: 'syosetu',
      novelId: 'n1000t',
      chapterId: 'chapter-1',
      sourceLang: 'ja',
      targetLang: 'zh-CN',
      status: 'completed',
      overallQualityScore: 0.92,
      sourceContentHash: 'abc123',
      glossaryVersion: 1,
      profileVersion: 1,
    });
    assert.equal(ct.status, 'completed');

    // Paragraphs
    const paragraphs = db.replaceChapterTranslationParagraphs('syosetu', 'n1000t', 'chapter-1', [
      { paragraphIndex: 0, sourceText: 'こんにちは', translatedText: '你好', confidence: 0.95 },
      { paragraphIndex: 1, sourceText: '世界', translatedText: '世界', confidence: 0.9 },
    ]);
    assert.equal(paragraphs.length, 2);
    assert.equal(paragraphs[0]!.translatedText, '你好');

    const loadedParagraphs = db.listChapterTranslationParagraphs('syosetu', 'n1000t', 'chapter-1');
    assert.equal(loadedParagraphs.length, 2);

    // QA
    const qas = db.replaceChapterTranslationQa('syosetu', 'n1000t', 'chapter-1', [
      { checkType: 'fluency', score: 0.9, severity: 'low' },
      { checkType: 'terminology', score: 0.7, severity: 'medium', suggestion: '术语不一致' },
    ]);
    assert.equal(qas.length, 2);
    assert.equal(qas[1]!.severity, 'medium');

    const loadedQas = db.listChapterTranslationQa('syosetu', 'n1000t', 'chapter-1');
    assert.equal(loadedQas.length, 2);

    // Resumable builds
    const resumable = db.listResumableTranslationBuilds();
    assert.ok(resumable.length >= 1);

    // Clear (Note: clearTranslationData preserves glossary terms — they're user data)
    db.clearTranslationData('syosetu', 'n1000t');
    assert.equal(db.listChapterTranslationParagraphs('syosetu', 'n1000t', 'chapter-1').length, 0);
    assert.equal(db.listChapterTranslationQa('syosetu', 'n1000t', 'chapter-1').length, 0);
    // Terms persist after clear (they're user-managed glossary)
    assert.equal(db.listTranslationTerms('syosetu', 'n1000t').length, 3);

    // Profile persists after clear (not cleared by clearTranslationData)
    assert.ok(db.getTranslationProfile('syosetu', 'n1000t'));
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── 系统偏好 ──

test('global translation preferences default and normalization', () => {
  assert.equal(TRANSLATION_DEFAULTS.sourceLang, 'ja');
  assert.equal(TRANSLATION_DEFAULTS.targetLang, 'zh-CN');
  assert.equal(TRANSLATION_DEFAULTS.translationConcurrency, 2);
  assert.equal(TRANSLATION_DEFAULTS.autoRejectUntranslatedTerms, true);

  const normalized = normalizeTranslationPreferencesInput({});
  assert.equal(normalized.sourceLang, 'ja');
  assert.equal(normalized.targetLang, 'zh-CN');

  const custom = normalizeTranslationPreferencesInput({
    sourceLang: 'en',
    targetLang: 'zh-CN',
    translationConcurrency: 5,
  });
  assert.equal(custom.sourceLang, 'en');
  assert.equal(custom.translationConcurrency, 5);
});

test('system preferences persist translation config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-trans-prefs-'));
  const prefsPath = path.join(tempDir, 'preferences.json');

  try {
    const prefs = new SystemPreferencesService({ storageFilePath: prefsPath });
    const state = prefs.getTranslationState();
    assert.equal(state.config.sourceLang, 'ja');

    prefs.updateTranslationPreferences({
      sourceLang: 'ja',
      targetLang: 'zh-CN',
      translationConcurrency: 5,
    });
    const updated = prefs.getTranslationState();
    assert.equal(updated.config.translationConcurrency, 5);

    // Reload from disk
    const prefs2 = new SystemPreferencesService({ storageFilePath: prefsPath });
    const reloaded = prefs2.getTranslationState();
    assert.equal(reloaded.config.translationConcurrency, 5);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system preferences persist model gateway routes across reloads', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-model-gateway-'));
  const prefsPath = path.join(tempDir, 'preferences.json');

  try {
    const prefs = new SystemPreferencesService({ storageFilePath: prefsPath });

    prefs.updateModelGateway({
      chat: { providerId: 'provider-chat', modelId: 'deepseek-v4-pro' },
      embedding: { providerId: 'provider-embed', modelId: 'qwen-embed-8b' },
      rerank: { providerId: 'provider-rerank', modelId: 'bge-reranker-v2' },
    });

    const reloaded = new SystemPreferencesService({ storageFilePath: prefsPath });
    assert.deepEqual(reloaded.getModelGateway(), {
      chat: { providerId: 'provider-chat', modelId: 'deepseek-v4-pro' },
      embedding: { providerId: 'provider-embed', modelId: 'qwen-embed-8b' },
      rerank: { providerId: 'provider-rerank', modelId: 'bge-reranker-v2' },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── 翻译文本编号前缀清洗 ──

test('stripTranslationNumberPrefix retains clean translation unchanged', () => {
  assert.equal(stripTranslationNumberPrefix('こんにちは', '你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('世界', '世界'), '世界');
});

test('stripTranslationNumberPrefix removes number prefix when source has none', () => {
  assert.equal(stripTranslationNumberPrefix('こんにちは', '【1】你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('こんにちは', '1.你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('こんにちは', '1、你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('こんにちは', '1)你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('こんにちは', '段落1：你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('こんにちは', '段落1:你好'), '你好');
  assert.equal(stripTranslationNumberPrefix('こんにちは', '【10】你好'), '你好');
});

test('stripTranslationNumberPrefix retains prefix when source text also has it', () => {
  // 原文本身就带序号，说明是正文一部分
  assert.equal(stripTranslationNumberPrefix('【1】原文开头', '【1】译文开头'), '【1】译文开头');
  assert.equal(stripTranslationNumberPrefix('1.原文开头', '1.译文开头'), '1.译文开头');
  assert.equal(stripTranslationNumberPrefix('1、原文开头', '1、译文开头'), '1、译文开头');
});

test('stripTranslationNumberPrefix handles edge cases', () => {
  assert.equal(stripTranslationNumberPrefix('', '【1】仅译文有内容'), '仅译文有内容');
  assert.equal(stripTranslationNumberPrefix('原文', ''), '');
  assert.equal(stripTranslationNumberPrefix('原文', '   '), '');
  assert.equal(stripTranslationNumberPrefix('【1】原文', ''), '');
});

// ── 合成傀儡章节记录 ──

test('ensureSyntheticChapter creates stub chapter for FK constraint compliance', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-synthetic-'));
  const db = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));

  try {
    db.saveMetadata('syosetu', {
      novelId: 'n1000syn',
      title: '合成章节测试',
      author: '测试',
      description: '',
      tags: [],
      chapterCount: 0,
      infoPageUrl: 'https://example.com/n1000syn',
    });

    // 创建傀儡章节
    db.ensureSyntheticChapter('syosetu', 'n1000syn', '__novel_meta__', '元数据', 0);
    db.ensureSyntheticChapter('syosetu', 'n1000syn', '__volume_1__', '第一卷', 1);

    // 确认可以读取
    const metaChapter = db.getChapter('syosetu', 'n1000syn', '__novel_meta__');
    assert.ok(metaChapter);
    assert.equal(metaChapter!.title, '元数据');
    assert.equal(metaChapter!.status, 'indexed');

    const volChapter = db.getChapter('syosetu', 'n1000syn', '__volume_1__');
    assert.ok(volChapter);
    assert.equal(volChapter!.title, '第一卷');

    // 确认可以正常写入翻译（不会违反 FK 约束）
    const saved = db.saveChapterTranslation({
      sourceId: 'syosetu', novelId: 'n1000syn', chapterId: '__novel_meta__',
      sourceLang: 'ja', targetLang: 'zh-CN',
      translatedTitle: '测试元数据',
      status: 'completed', sourceContentHash: 'abc', glossaryVersion: 1, profileVersion: 1,
    });
    assert.equal(saved.status, 'completed');
    assert.equal(saved.translatedTitle, '测试元数据');

    // 幂等性：再次调用不报错
    db.ensureSyntheticChapter('syosetu', 'n1000syn', '__novel_meta__', '元数据', 0);
    assert.ok(db.getChapter('syosetu', 'n1000syn', '__novel_meta__'));

    // 清理后傀儡章节仍然保留
    db.clearTranslationData('syosetu', 'n1000syn');
    assert.ok(db.getChapter('syosetu', 'n1000syn', '__novel_meta__'));
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── 导出引擎双语 ──

test('export engine bilingual mode renders translated content', () => {
  assert.deepEqual(LIBRARY_EXPORT_TRANSLATION_MODES, ['original', 'translated', 'bilingual']);
  assert.equal(isLibraryExportTranslationMode('bilingual'), true);
  assert.equal(isLibraryExportTranslationMode('original'), true);
  assert.equal(isLibraryExportTranslationMode('invalid'), false);
  assert.equal(isLibraryExportTranslationMode(undefined), false);
});

// ── LangGraph 流水线 ──

test('translation pipeline graph compiles with all nodes', () => {
  const graph = createTranslationPipelineGraph({
    preferences: {} as unknown as SystemPreferencesService,
    repository: {} as unknown as SqliteNovelRepository,
    historyManager: new TranslationHistoryManager(),
    paragraphsPerBatch: 2,
  });
  assert.ok(graph);
  assert.equal(typeof graph.invoke, 'function');
});

test('auto translation readiness blocks paused translation builds', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-translation-readiness-'));
  const db = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  const prefs = new SystemPreferencesService({ storageFilePath: path.join(tempDir, 'preferences.json') });
  const service = new TranslationService(db, prefs);

  try {
    db.saveMetadata('syosetu', {
      novelId: 'n1000pause',
      title: '暂停测试',
      author: '测试',
      description: '',
      tags: [],
      chapterCount: 1,
      infoPageUrl: 'https://example.com/n1000pause',
    });

    db.saveTranslationBuild({
      sourceId: 'syosetu',
      novelId: 'n1000pause',
      status: 'paused',
      stage: 'failed',
      progressPercent: 40,
      message: '用户手动暂停',
      errorMessage: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:10:00.000Z',
      modelStatsJson: '[]',
      translatedChapters: 2,
      reviewedChapters: 0,
      failedChapters: 0,
      glossaryVersion: 1,
      profileVersion: 1,
    });

    assert.deepEqual(service.getAutoTranslationReadiness('syosetu', 'n1000pause'), {
      ready: false,
      reason: '翻译任务已暂停，请手动恢复或重启后再试。',
    });
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── 翻译状态类型 ──

test('translation state types compile with minimal values', () => {
  const state = {
    sourceId: 'syosetu',
    novelId: 'n1000t',
    chapterId: 'chapter-1',
    chapterIndex: 1,
    chapterTitle: 'テスト',
    sourceContent: 'こんにちは世界',
    sourceLang: 'ja',
    targetLang: 'zh-CN',
    glossary: [],
    segments: [],
    draftParagraphs: [],
    translatedTitle: null,
    finalParagraphs: [],
    translatorModelId: null,
    tokenUsageJson: null,
    sourceContentHash: 'abc',
    glossaryVersion: 1,
    profileVersion: 1,
    retryCount: 0,
    maxRetries: 3,
    pauseRequested: false,
    errorMessage: null,
  } as const;
  assert.equal(state.sourceId, 'syosetu');
  assert.equal(state.sourceLang, 'ja');
});
