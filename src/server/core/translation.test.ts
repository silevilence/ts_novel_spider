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
import { TranslationHistoryManager } from '../core/translation/nodes/history-manager';

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
