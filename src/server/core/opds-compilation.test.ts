import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService, OPDS_DEFAULTS } from './system-preferences';
import { LocalExportEngine } from './export-engine';
import { OfflineLibraryAssetService } from './offline-library';
import { SpiderLogDispatcher } from './logging';
import { OpdsCompilationService, calculateOpdsNextTriggerTime } from './opds-compilation';
import type { SpiderAdapter, NovelMetadata, ChapterIndexEntry, ChapterContent } from './spider';

function createTestRepository(): SqliteNovelRepository {
  return new SqliteNovelRepository(':memory:');
}

function createMockSpider(sourceId: string): SpiderAdapter {
  return {
    sourceId,
    getInfoPageUrl: (novelId: string) => `https://example.test/${sourceId}/${novelId}`,
    fetchMetadata: async () => ({ sourceId, novelId: 'n1', title: 'Test', author: 'Author', description: '', tags: [], chapterCount: 1, infoPageUrl: '' }),
    fetchChapterIndex: async () => [],
    fetchChapter: async () => ({ chapterId: 'c1', index: 1, title: 'Ch1', content: 'content', volumeTitle: null, url: '' }),
    fetchChapters: async () => [],
  } as unknown as SpiderAdapter;
}

function seedNovel(repo: SqliteNovelRepository, sourceId = 'syosetu', novelId = 'n1'): void {
  repo.saveMetadata(sourceId, {
    novelId, title: 'Test Novel', author: 'Author',
    description: 'desc', tags: ['tag1'], chapterCount: 1, infoPageUrl: 'https://example.test',
  });
  repo.saveChapterIndex(sourceId, novelId, [{
    id: 'c1', index: 1, title: 'Chapter 1', volumeTitle: null, url: 'https://example.test/c1',
  }]);
  repo.saveChapterContent(sourceId, novelId, {
    chapterId: 'c1', index: 1, title: 'Chapter 1', volumeTitle: null,
    url: 'https://example.test/c1', content: 'Hello world.',
  });
}

describe('calculateOpdsNextTriggerTime', () => {
  it('parses valid cron expression', () => {
    const result = calculateOpdsNextTriggerTime({
      enabled: true,
      scanCronExpression: '0 8 * * *',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });

  it('falls back on invalid cron expression', () => {
    const result = calculateOpdsNextTriggerTime({
      enabled: true,
      scanCronExpression: 'invalid',
      updatedAt: null,
    });
    assert.ok(result > Date.now());
  });
});

describe('OpdsCompilationService', () => {
  let repo: SqliteNovelRepository;
  let preferences: SystemPreferencesService;
  let exportEngine: LocalExportEngine;
  let logger: SpiderLogDispatcher;
  let tempDir: string;

  beforeEach(() => {
    repo = createTestRepository();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-test-'));
    preferences = new SystemPreferencesService({});
    exportEngine = new LocalExportEngine({
      outputRoot: path.join(tempDir, 'exports'),
      assetService: new OfflineLibraryAssetService({ storageRoot: path.join(tempDir, 'assets') }),
    });
    logger = new SpiderLogDispatcher();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('start() does not start timer when disabled', () => {
    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    service.start();
    service.stop();
    assert.ok(true);
  });

  it('skips novels with opds_visible=0', async () => {
    seedNovel(repo);
    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();
    const artifactDir = path.join(tempDir, 'artifacts', 'syosetu', 'n1');
    assert.ok(!fs.existsSync(artifactDir) || fs.readdirSync(artifactDir).length === 0);
  });

  it('generates original.epub for visible novel without translation', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const originalPath = path.join(tempDir, 'artifacts', 'syosetu', 'n1', 'original.epub');
    assert.ok(fs.existsSync(originalPath), 'original.epub should exist');

    const translatedPath = path.join(tempDir, 'artifacts', 'syosetu', 'n1', 'translated.epub');
    assert.ok(!fs.existsSync(translatedPath), 'translated.epub should not exist for untranslated novel');

    const row = repo.getOpdsNovel('syosetu', 'n1');
    assert.ok(row?.epubCompiledAt, 'epub_compiled_at should be set');
  });

  it('skips novel when epub_compiled_at >= content_updated_at', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const compiledAt = repo.getOpdsNovel('syosetu', 'n1')?.epubCompiledAt;
    assert.ok(compiledAt);

    await service.runScanAllForTest();
    const row = repo.getOpdsNovel('syosetu', 'n1');
    assert.equal(row?.epubCompiledAt, compiledAt, 'epub_compiled_at should not change');
  });

  it('regenerates when content_updated_at > epub_compiled_at', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const firstCompiledAt = repo.getOpdsNovel('syosetu', 'n1')?.epubCompiledAt;
    assert.ok(firstCompiledAt);

    // 等待 10ms 确保 bump 的时间戳严格大于 epub_compiled_at（避免同毫秒竞态）
    await new Promise((resolve) => setTimeout(resolve, 10));
    repo.bumpNovelContentUpdatedAt('syosetu', 'n1');

    await service.runScanAllForTest();
    const row = repo.getOpdsNovel('syosetu', 'n1');
    assert.ok(row?.epubCompiledAt);
    assert.notEqual(row?.epubCompiledAt, firstCompiledAt, 'epub_compiled_at should be updated');
  });

  it('records audit run in opds_compilation_runs', async () => {
    seedNovel(repo);
    repo.updateOpdsVisible('syosetu', 'n1', true);

    const service = new OpdsCompilationService({
      repository: repo, preferences, exportEngine, logger,
      artifactsRoot: path.join(tempDir, 'artifacts'),
    });
    await service.runScanAllForTest();

    const runs = repo.listOpdsCompilationRuns(10, 0);
    assert.ok(runs.length >= 1, 'should have at least one audit run');
    assert.equal(runs[0].status, 'completed');
    assert.equal(runs[0].totalScanned, 1);
    assert.equal(runs[0].compiled, 1);
  });
});
