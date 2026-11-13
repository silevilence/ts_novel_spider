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
    assert.doesNotMatch(service.summaries()[0]!.preview!.excerpt, /ebook[-:]/);
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

test('ebook purge respects retention, reports partial cleanup and can retry without deleting other books', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ebook-purge-'));
  const repository = new SqliteNovelRepository(':memory:');
  try {
    const service = new EbookImportService(repository, root);
    const { entry } = service.upload('book.txt', Buffer.from('正文内容'));
    const parsed = await service.parse(entry.id);
    const novelId = service.confirm(entry.id, parsed.preview!);
    const other = service.upload('other.txt', Buffer.from('其他书籍')).entry;
    repository.updateOpdsVisible('manual', novelId, true);
    repository.moveNovelToTrash('manual', novelId);
    assert.equal(service.purge(novelId), false);
    assert.equal(fs.existsSync(service.originalPath(entry)), true);
    repository.restoreNovelFromTrash('manual', novelId);
    assert.equal(repository.getOpdsNovel('manual', novelId)?.opdsVisible, true);
    repository.moveNovelToTrash('manual', novelId);
    const deletedAt = repository.getNovelPurgeStatus('manual', novelId)!.deletedAt!;
    t.mock.method(Date, 'now', () => Date.parse(deletedAt) + 16 * 86400000);
    const blocked = path.join(root, 'blocked'); fs.mkdirSync(blocked);
    const remove = fs.rmSync;
    const mocked = t.mock.method(fs, 'rmSync', (target: fs.PathLike, options?: fs.RmOptions) => {
      if (target === blocked) throw new Error('File in use');
      return remove(target, options);
    });
    assert.throws(() => service.purge(novelId, [blocked]), /清理未完成.*blocked/);
    assert.equal(service.get(entry.id).purging, true);
    assert(repository.getSnapshot('manual', novelId));
    mocked.mock.restore();
    assert.equal(service.purge(novelId, [blocked]), true);
    assert.equal(repository.getSnapshot('manual', novelId), null);
    assert.equal(fs.existsSync(service.directory(entry.id)), false);
    assert.equal(fs.readFileSync(service.originalPath(other), 'utf8'), '其他书籍');
  } finally { t.mock.restoreAll(); repository.close(); fs.rmSync(root, { recursive: true }); }
});

test('imported edits, ordering and version restores invalidate OPDS generated editions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ebook-opds-edits-'));
  const repository = new SqliteNovelRepository(':memory:');
  try {
    const service = new EbookImportService(repository, root);
    const { entry } = service.upload('book.txt', Buffer.from('第一章 开始\n正文\n第二章 结束\n结尾'));
    const parsed = await service.parse(entry.id);
    const id = service.confirm(entry.id, parsed.preview!);
    repository.updateOpdsVisible('manual', id, true);
    const chapters = repository.getSnapshot('manual', id)!.chapters;
    const first = chapters[0]!;
    repository.updateManualMetadata(id, { ...parsed.preview!, author: '作者' });
    const metadataVersion = repository.listMetadataVersions('manual', id)[0]!.version;
    const chapterVersion = repository.listChapterVersions('manual', id, first.id)[0]!.version;
    const actions = [
      () => repository.updateManualMetadata(id, { ...parsed.preview!, title: '新书名' }),
      () => repository.saveManualChapter(id, { chapterId: first.id, title: '新章名', content: '新正文', volumeTitle: '第一卷' }),
      () => repository.reorderManualChapters(id, chapters.map(chapter => chapter.id).reverse()),
      () => repository.renameManualVolume(id, '第一卷', '新卷'),
      () => repository.restoreMetadataVersion('manual', id, metadataVersion),
      () => repository.restoreChapterVersion('manual', id, first.id, chapterVersion),
      () => repository.deleteManualChapter(id, chapters[1]!.id),
      () => repository.deleteManualVolume(id, '新卷'),
    ];
    for (const action of actions) {
      const compiled = repository.getOpdsNovel('manual', id)!.contentUpdatedAt!;
      repository.updateNovelEpubCompiledAt('manual', id, compiled);
      await new Promise(resolve => setTimeout(resolve, 3));
      action();
      assert(repository.getOpdsNovel('manual', id)!.contentUpdatedAt! > compiled);
    }
    assert.equal(fs.readFileSync(service.originalPath(entry), 'utf8'), '第一章 开始\n正文\n第二章 结束\n结尾');
  } finally { repository.close(); fs.rmSync(root, { recursive: true }); }
});
