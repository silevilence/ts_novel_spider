import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { LocalExportEngine } from './export-engine';
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