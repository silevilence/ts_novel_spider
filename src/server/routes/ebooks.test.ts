import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import type { EbookImportSummary } from '../contracts/ebook';
import { makeEpubFixture } from '../core/ebook-test-fixtures';
import { closeServer, createLibraryServer, waitForServerListening } from './library-test-helpers';

test('batch ebook API isolates failures, previews and confirms, detects duplicate and trashed books', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');
  try {
    const base = `${await waitForServerListening(server)}/api/library/ebooks`;
    const upload = async (fileName: string, content: Buffer | string) => {
      const response = await fetch(`${base}?fileName=${encodeURIComponent(fileName)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: content });
      assert.equal(response.status, 202);
      return response.json() as Promise<{ id: string; duplicate: boolean }>;
    };
    const text = '第一章 开始\n正文';
    const good = await upload('同名.txt', text);
    const bad = await upload('损坏.epub', 'bad zip');
    await upload('本地.epub', await makeEpubFixture());
    let records: EbookImportSummary[] = [];
    for (let i = 0; i < 200; i++) {
      records = (await (await fetch(base)).json() as { imports: EbookImportSummary[] }).imports;
      if (records.every(entry => !['uploaded', 'parsing'].includes(entry.status))) break;
      await setTimeout(10);
    }
    assert.equal(records.filter(entry => entry.status === 'ready').length, 2);
    assert.equal(records.find(entry => entry.id === bad.id)?.status, 'failed');
    assert.equal((await upload('改名.txt', text)).duplicate, true);
    const confirmation = { title: '同名', author: '测试', description: '', tags: ['导入'] };
    const confirm = () => fetch(`${base}/${good.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(confirmation) });
    const { novelId } = await (await confirm()).json() as { novelId: string };
    assert.equal(await (await fetch(`${base}/${good.id}/original`)).text(), text);
    assert.equal(repository.getSnapshot('manual', novelId)?.chapters.length, 1);
    assert.equal((await (await confirm()).json() as { novelId: string }).novelId, novelId);
    const libraryBase = base.replace(/\/ebooks$/, '');
    const metadataResponse = await fetch(`${libraryBase}/novels/manual/${novelId}/metadata`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...confirmation, title: '修改后书名', tags: ['新标签'] }) });
    assert.equal(metadataResponse.status, 200);
    const books = await (await fetch(`${libraryBase}/novels?q=${encodeURIComponent('site:imported + tag:新标签')}`)).json() as { novels: Array<{ origin?: string; ebook?: { format: string }; metadata: { title: string } }> };
    assert.equal(books.novels.length, 1);
    assert.equal(books.novels[0]?.origin, 'imported');
    assert.equal(books.novels[0]?.ebook?.format, 'txt');
    assert.equal(books.novels[0]?.metadata.title, '修改后书名');
    assert.equal((await fetch(`${libraryBase}/novels/manual/${novelId}/metadata-sync`, { method: 'POST' })).status, 422);
    repository.moveNovelToTrash('manual', novelId);
    assert.equal((await fetch(`${base}/${good.id}/original`)).status, 404);
    assert.equal((await fetch(`${libraryBase}/novels/manual/${novelId}`)).status, 404);
    assert.equal((await fetch(`${libraryBase}/novels/manual/${novelId}/export/txt`)).status, 404);
    records = (await (await fetch(base)).json() as { imports: EbookImportSummary[] }).imports;
    assert.equal(records.find(entry => entry.id === good.id)?.deleted, true);
    assert.equal((await upload('同名.txt', text)).id, good.id);
    assert.equal((await fetch(`${libraryBase}/novels/manual/${novelId}/restore`, { method: 'POST' })).status, 204);
    assert.equal((await fetch(`${libraryBase}/novels/manual/${novelId}`)).status, 200);
    const invalid = await fetch(`${base}/${good.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...confirmation, title: '' }) });
    assert.equal(invalid.status, 422);
  } finally { await closeServer(server); cleanup(); }
});
