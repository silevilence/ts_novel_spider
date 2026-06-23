import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeServer,
  createLibraryServer,
  waitForServerListening,
} from './library-test-helpers';

test('OPDS v1 root feed returns OPDS navigation content type', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/opds/v1`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'application/atom+xml;profile=opds-catalog; charset=utf-8',
    );
    const xml = await response.text();
    assert.ok(xml.includes('<?xml version="1.0"'));
    assert.ok(xml.includes('xmlns="http://www.w3.org/2005/Atom"'));
    assert.ok(xml.includes('离线书库样例'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v1 .opds root alias returns Atom XML', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/opds/v1.opds`);
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.ok(xml.includes(`<id>${baseUrl}/opds/v1.opds</id>`));
    assert.ok(xml.includes('href="/opds/v1.opds"'));
    assert.ok(xml.includes('href="/opds/v1/syosetu/n1000lib.opds"'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v1 single-novel feed returns OPDS acquisition content type', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/opds/v1/syosetu/n1000lib`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8',
    );
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v1 root feed excludes invisible novels', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v1`);
    const xml = await response.text();
    assert.ok(!xml.includes('离线书库样例'));
    assert.ok(xml.includes('<feed'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v1 single-novel feed returns 404 for missing novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v1/syosetu/missing`);
    assert.equal(response.status, 404);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v1 .opds single-novel alias returns Atom XML', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v1/syosetu/n1000lib.opds`);
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.ok(xml.includes(`<id>${baseUrl}/opds/v1/syosetu/n1000lib.opds</id>`));
    assert.ok(xml.includes('href="/opds/v1/syosetu/n1000lib.opds"'));
    assert.ok(xml.includes('href="/opds/v1.opds"'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v2 root feed returns JSON-LD with correct content type', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);

    const response = await fetch(`${baseUrl}/opds/v2`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('application/opds+json'));
    const json = await response.json() as {
      '@context': string;
      publications: Array<{
        metadata: { title: string };
        links: Array<{ rel: string; href: string; type: string }>;
      }>;
    };
    assert.equal(json['@context'], 'https://readium.org/webpub-manifest/context.jsonld');
    assert.ok(Array.isArray(json.publications));
    assert.ok(json.publications.some((p) => p.metadata.title === '离线书库样例'));
    const publication = json.publications.find((p) => p.metadata.title === '离线书库样例');
    assert.ok(publication);
    assert.ok(publication.links.some((l) => l.rel === 'self' && l.href === '/opds/v2/syosetu/n1000lib'));
    assert.ok(!publication.links.some((l) => l.rel === 'http://opds-spec.org/acquisition' && l.type === 'application/opds+json'));
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS v2 single-novel publication returns 404 for missing novel', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/v2/syosetu/missing`);
    assert.equal(response.status, 404);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS artifact download returns 404 for nonexistent file', async () => {
  const { app, cleanup, repository } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    repository.updateOpdsVisible('syosetu', 'n1000lib', true);
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/artifacts/syosetu/n1000lib/original.epub`);
    assert.equal(response.status, 404);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS artifact download rejects invalid file name', async () => {
  const { app, cleanup } = createLibraryServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/artifacts/syosetu/n1000lib/../../etc/passwd`);
    assert.equal(response.status, 404);
  } finally {
    await closeServer(server);
    cleanup();
  }
});

test('OPDS artifact download returns file stream when file exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-artifact-test-'));
  const artifactsRoot = path.join(tempDir, 'artifacts');
  const novelDir = path.join(artifactsRoot, 'syosetu', 'n1000lib');
  fs.mkdirSync(novelDir, { recursive: true });
  const fakeEpubContent = Buffer.from('fake epub content for testing');
  fs.writeFileSync(path.join(novelDir, 'original.epub'), fakeEpubContent);

  const { createServerApp } = await import('../app');
  const { ControlCenterService } = await import('../core/control-center');
  const { SqliteNovelRepository } = await import('../core/novel-repository');
  const { SystemPreferencesService } = await import('../core/system-preferences');

  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  repository.saveMetadata('syosetu', {
    novelId: 'n1000lib',
    title: '测试小说',
    author: '作者',
    description: '简介',
    tags: [],
    chapterCount: 1,
    infoPageUrl: 'https://example.com',
  });
  repository.saveChapterIndex('syosetu', 'n1000lib', [{
    id: 'c1', index: 1, title: '第一章', volumeTitle: null, url: 'https://example.com/c1',
  }]);
  repository.saveChapterContent('syosetu', 'n1000lib', {
    chapterId: 'c1', index: 1, title: '第一章', volumeTitle: null,
    url: 'https://example.com/c1', content: '内容',
  });
  repository.updateOpdsVisible('syosetu', 'n1000lib', true);

  const controlCenter = new ControlCenterService({
    repository,
    spiders: [],
    systemPreferences: new SystemPreferencesService(),
    offlineAssetStoragePath: path.join(tempDir, 'assets'),
    exportStoragePath: path.join(tempDir, 'exports'),
    opdsArtifactsPath: artifactsRoot,
  });
  const app = createServerApp({ controlCenter });
  const server = app.listen(0, '127.0.0.1');

  try {
    const baseUrl = await waitForServerListening(server);
    const response = await fetch(`${baseUrl}/opds/artifacts/syosetu/n1000lib/original.epub`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('application/epub+zip'));
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(buffer, fakeEpubContent);
  } finally {
    await closeServer(server);
    controlCenter.close();
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
