import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { LocalExportEngine, type TranslatedParagraph, type ExportTranslationOptions } from './export-engine';
import { OfflineLibraryAssetService } from './offline-library';
import type { StoredNovelSnapshot } from './spider';

test('LocalExportEngine preserves chapter section dividers across export formats', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-export-'));

  try {
    const engine = new LocalExportEngine({
      outputRoot: path.join(tempDir, 'exports'),
      assetService: new OfflineLibraryAssetService({
        storageRoot: path.join(tempDir, 'assets'),
      }),
    });
    const snapshot: StoredNovelSnapshot = {
      sourceId: 'syosetu18',
      metadata: {
        novelId: 'n7777aa',
        title: '深夜の迷宮',
        author: '夜狐',
        description: '迷宮都市で生き延びる物語。',
        tags: [],
        chapterCount: 1,
        infoPageUrl: 'https://example.com/novel',
      },
      updatedAt: '2026-05-10T00:00:00.000Z',
      chapters: [
        {
          id: '1',
          index: 1,
          title: '迷宮へ',
          volumeTitle: '第一幕',
          url: 'https://example.com/novel/1',
          content: '前書きです。\n\n---\n\n本文です。\n\n---\n\n後書きです。',
          status: 'downloaded',
          errorMessage: null,
          downloadedAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      ],
    };

    const markdownArtifact = await engine.generate(snapshot, 'markdown');
    const markdownZip = await JSZip.loadAsync(fs.readFileSync(markdownArtifact.filePath));
    const markdownEntry = markdownZip.file(/\.md$/u)[0];
    assert.ok(markdownEntry);
    assert.match(await markdownEntry!.async('string'), /前書きです。\n\n---\n\n本文です。\n\n---\n\n後書きです。/u);

    const textArtifact = await engine.generate(snapshot, 'txt');
    assert.match(fs.readFileSync(textArtifact.filePath, 'utf8'), /前書きです。\n---\n本文です。\n---\n後書きです。/u);

    const epubArtifact = await engine.generate(snapshot, 'epub');
    const epubZip = await JSZip.loadAsync(fs.readFileSync(epubArtifact.filePath));
    const chapterEntry = epubZip.file('OEBPS/chapter-0001.xhtml');
    assert.ok(chapterEntry);
    assert.match(await chapterEntry!.async('string'), /<hr class="section-divider"\/>/u);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalExportEngine strips number prefix from translated paragraphs in translated and bilingual mode', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-export-prefix-'));

  try {
    const engine = new LocalExportEngine({
      outputRoot: path.join(tempDir, 'exports'),
      assetService: new OfflineLibraryAssetService({
        storageRoot: path.join(tempDir, 'assets'),
      }),
    });
    const snapshot: StoredNovelSnapshot = {
      sourceId: 'syosetu',
      metadata: {
        novelId: 'n8888prefix',
        title: '番号テスト',
        author: 'テスト',
        description: '翻訳番号除去テスト。',
        tags: [],
        chapterCount: 1,
        infoPageUrl: 'https://example.com/n8888prefix',
      },
      updatedAt: '2026-06-02T00:00:00.000Z',
      chapters: [
        {
          id: 'ch1',
          index: 1,
          title: '第一章',
          volumeTitle: null,
          url: 'https://example.com/n8888prefix/1',
          content: 'こんにちは世界。\n\nこれはテストです。',
          status: 'downloaded',
          errorMessage: null,
          downloadedAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    };

    // 模拟带【1】前缀的脏译文（场景：批量回退到单条后，模型仍输出编号）
    const dirtyParagraphs: TranslatedParagraph[] = [
      { paragraphIndex: 0, sourceText: 'こんにちは世界。', translatedText: '【1】你好世界。', confidence: 0.85 },
      { paragraphIndex: 1, sourceText: 'これはテストです。', translatedText: '【2】这是测试。', confidence: 0.85 },
    ];

    const translationOptions: ExportTranslationOptions = {
      mode: 'translated',
      translatedParagraphsByChapterId: new Map([['ch1', dirtyParagraphs]]),
    };

    // translated 模式——验证【N】被去除
    const markdownArtifact = await engine.generate(snapshot, 'markdown', translationOptions);
    const markdownZip = await JSZip.loadAsync(fs.readFileSync(markdownArtifact.filePath));
    const markdownEntry = markdownZip.file(/\.md$/u)[0];
    assert.ok(markdownEntry);
    const markdownContent = await markdownEntry!.async('string');
    assert.doesNotMatch(markdownContent, /【1】/u, 'translated 模式下不应保留【1】前缀');
    assert.doesNotMatch(markdownContent, /【2】/u, 'translated 模式下不应保留【2】前缀');
    assert.match(markdownContent, /你好世界。/u);
    assert.match(markdownContent, /这是测试。/u);

    // bilingual 模式
    const bilingualOptions: ExportTranslationOptions = {
      mode: 'bilingual',
      translatedParagraphsByChapterId: new Map([['ch1', dirtyParagraphs]]),
    };
    const bilingualArtifact = await engine.generate(snapshot, 'markdown', bilingualOptions);
    const bilingualZip = await JSZip.loadAsync(fs.readFileSync(bilingualArtifact.filePath));
    const bilingualEntry = bilingualZip.file(/\.md$/u)[0];
    assert.ok(bilingualEntry);
    const bilingualContent = await bilingualEntry!.async('string');
    assert.doesNotMatch(bilingualContent, /【1】/u, 'bilingual 模式下不应保留【1】前缀');
    assert.doesNotMatch(bilingualContent, /【2】/u, 'bilingual 模式下不应保留【2】前缀');
    // 原文不应被影响
    assert.match(bilingualContent, /こんにちは世界。/u);
    assert.match(bilingualContent, /これはテストです。/u);
    // 译文应在双语对照中正确显示
    assert.match(bilingualContent, /你好世界。/u);
    assert.match(bilingualContent, /这是测试。/u);

    // 原文本身就带前缀的场景——不应清洗
    const sourcePrefixedParagraphs: TranslatedParagraph[] = [
      { paragraphIndex: 0, sourceText: '【1】重要な注意', translatedText: '【1】重要提醒', confidence: 0.85 },
    ];
    const prefixedOptions: ExportTranslationOptions = {
      mode: 'bilingual',
      translatedParagraphsByChapterId: new Map([['ch1', sourcePrefixedParagraphs]]),
    };
    const snapshot2: StoredNovelSnapshot = {
      ...snapshot,
      metadata: { ...snapshot.metadata, novelId: 'n9999prefix' },
      chapters: [{
        ...snapshot.chapters[0]!,
        content: '【1】重要な注意',
      }],
    };
    const prefixedArtifact = await engine.generate(snapshot2, 'markdown', prefixedOptions);
    const prefixedZip = await JSZip.loadAsync(fs.readFileSync(prefixedArtifact.filePath));
    const prefixedEntry = prefixedZip.file(/\.md$/u)[0];
    assert.ok(prefixedEntry);
    const prefixedContent = await prefixedEntry!.async('string');
    // 原文有【1】，译文也应保留【1】
    assert.match(prefixedContent, /【1】/u, '原文带前缀时译文应保留【1】');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});