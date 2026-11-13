import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EbookImportService } from './ebook-import';
import { SqliteNovelRepository } from './novel-repository';
import { makeEpubFixture } from './ebook-test-fixtures';
import { OfflineLibraryAssetService } from './offline-library';

test('ebook originals survive metadata edits; confirmation is atomic and idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ebook-import-'));
  const repository = new SqliteNovelRepository(':memory:');
  try {
    const service = new EbookImportService(repository, root);
    const data = Buffer.from('第一章\n正文');
    const { entry } = service.upload('../书.txt', data);
    assert.equal(entry.fileName, '书.txt');
    assert.deepEqual(fs.readFileSync(service.originalPath(entry)), data);
    assert.equal(service.upload('不同名.txt', data).duplicate, true);
    assert.throws(() => service.directory('../outside'));
    assert.throws(() => service.upload('book.pdf', data));
    assert.throws(() => service.upload('book.txt', Buffer.alloc(0)));
    const preview = { title: '书', author: '', description: '', tags: [], warnings: [], chapters: [{ id: crypto.randomUUID(), title: '第一章', content: '正文' }] };
    repository.saveEbookImport({ ...entry, status: 'ready', preview });
    assert.throws(() => service.confirm(entry.id, { ...preview, title: '' }));
    assert.equal(repository.listNovels().length, 0);
    const novelId = service.confirm(entry.id, preview);
    assert.equal(service.confirm(entry.id, preview), novelId);
    assert.equal(repository.listNovels().length, 1);
    repository.updateManualMetadata(novelId, { ...preview, title: '已改名' });
    assert.deepEqual(fs.readFileSync(service.originalPath(entry)), data);
    assert.equal(repository.getSnapshot('manual', novelId)?.chapters[0]?.content, '正文');
    assert.equal(repository.getOpdsNovel('manual', novelId)?.opdsVisible, false);
  } finally { repository.close(); fs.rmSync(root, { recursive: true }); }
});

test('EPUB package images and cross-chapter footnotes survive import without network', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ebook-assets-'));
  const repository = new SqliteNovelRepository(':memory:');
  try {
    const service = new EbookImportService(repository, root);
    const { entry } = service.upload('book.epub', await makeEpubFixture());
    const parsed = await service.parse(entry.id);
    assert.equal(parsed.status, 'ready');
    const novelId = service.confirm(entry.id, parsed.preview!);
    const snapshot = repository.getSnapshot('manual', novelId)!;
    assert.match(snapshot.chapters[0]!.content!, /\]\(#ebook-/);
    assert.match(snapshot.chapters[1]!.content!, /\[返回\]\(#ebook-/);
    const assets = new OfflineLibraryAssetService({ storageRoot: path.join(root, 'cache'), ebookAssetPath: (id, name) => service.assetPath(id, name), fetchImpl: async () => { throw new Error('Network is forbidden'); } });
    const media = assets.listMediaAssets(snapshot, snapshot.chapters[0]!);
    assert.equal(media.length, 1);
    assert.equal(media[0]!.cached, true);
    const file = assets.getCachedMediaFilePath(snapshot, snapshot.chapters[0]!.id, media[0]!.id)!;
    assert.equal(fs.readFileSync(file).subarray(1, 4).toString(), 'PNG');
    assert.equal(service.assetPath(novelId, '../../outside'), null);
    repository.moveNovelToTrash('manual', novelId);
    assert.equal(assets.getCachedMediaFilePath(snapshot, snapshot.chapters[0]!.id, media[0]!.id), null);
  } finally { repository.close(); fs.rmSync(root, { recursive: true }); }
});

test('ebook migration preserves existing books and restart exposes interrupted imports for retry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ebook-restart-'));
  let repository = new SqliteNovelRepository(path.join(root, 'books.db'));
  try {
    const novel = repository.createManualNovel('已有书籍');
    let service = new EbookImportService(repository, path.join(root, 'files'));
    const { entry } = service.upload('book.txt', Buffer.from('测试内容'));
    repository.saveEbookImport({ ...entry, status: 'parsing' });
    repository.close();
    repository = new SqliteNovelRepository(path.join(root, 'books.db'));
    service = new EbookImportService(repository, path.join(root, 'files'));
    assert.equal(service.get(entry.id).status, 'failed');
    assert.match(service.get(entry.id).error!, /重试/);
    assert.equal(repository.getSnapshot('manual', novel.metadata.novelId)?.metadata.title, '已有书籍');
    assert.equal(fs.readFileSync(service.originalPath(entry), 'utf8'), '测试内容');
  } finally { repository.close(); fs.rmSync(root, { recursive: true }); }
});
