import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OpdsFeedService,
  type OpdsNovelFeedEntry,
  type OpdsArtifactAvailability,
} from './opds-feed';

function makeNovel(overrides: Partial<OpdsNovelFeedEntry> = {}): OpdsNovelFeedEntry {
  return {
    sourceId: 'syosetu',
    novelId: 'n1',
    title: '测试小说',
    author: '测试作者',
    description: '简介内容',
    tags: ['标签1', '标签2'],
    contentUpdatedAt: '2026-06-22T00:00:00.000Z',
    epubCompiledAt: '2026-06-22T01:00:00.000Z',
    hasTranslation: true,
    ...overrides,
  };
}

function makeAvailability(overrides: Partial<OpdsArtifactAvailability> = {}): OpdsArtifactAvailability {
  return {
    original: true,
    translated: true,
    bilingual: true,
    ...overrides,
  };
}

describe('OpdsFeedService - OPDS 1.2 (Atom XML)', () => {
  const service = new OpdsFeedService();

  it('root feed contains XML declaration and Atom namespace', () => {
    const xml = service.buildAtomRootFeed([]);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('xmlns="http://www.w3.org/2005/Atom"'));
  });

  it('root feed contains all visible novels as entries', () => {
    const xml = service.buildAtomRootFeed([
      makeNovel({ novelId: 'n1', title: '小说一' }),
      makeNovel({ novelId: 'n2', title: '小说二' }),
    ]);
    assert.ok(xml.includes('<title>小说一</title>'));
    assert.ok(xml.includes('<title>小说二</title>'));
    assert.ok(xml.includes('urn:opds:novel:syosetu:n1'));
    assert.ok(xml.includes('urn:opds:novel:syosetu:n2'));
  });

  it('root feed with empty list still returns valid document', () => {
    const xml = service.buildAtomRootFeed([]);
    assert.ok(xml.includes('<feed'));
    assert.ok(xml.includes('</feed>'));
    assert.ok(!xml.includes('<entry>'));
  });

  it('root feed updated takes max content_updated_at', () => {
    const xml = service.buildAtomRootFeed([
      makeNovel({ contentUpdatedAt: '2026-06-20T00:00:00.000Z' }),
      makeNovel({ contentUpdatedAt: '2026-06-22T00:00:00.000Z' }),
    ]);
    assert.ok(xml.includes('<updated>2026-06-22T00:00:00.000Z</updated>'));
  });

  it('root feed entry links to single-novel feed', () => {
    const xml = service.buildAtomRootFeed([makeNovel({ sourceId: 'syosetu', novelId: 'n1' })]);
    assert.ok(xml.includes('href="/opds/v1/syosetu/n1"'));
    assert.ok(xml.includes('type="application/atom+xml;profile=opds-catalog;kind=acquisition"'));
  });

  it('single-novel feed contains acquisition links for available versions', () => {
    const xml = service.buildAtomNovelFeed(
      makeNovel({ title: '测试小说' }),
      makeAvailability({ original: true, translated: true, bilingual: false }),
    );
    assert.ok(xml.includes('href="/opds/artifacts/syosetu/n1/original.epub"'));
    assert.ok(xml.includes('href="/opds/artifacts/syosetu/n1/translated.epub"'));
    assert.ok(!xml.includes('href="/opds/artifacts/syosetu/n1/bilingual.epub"'));
  });

  it('single-novel feed has up link to root', () => {
    const xml = service.buildAtomNovelFeed(makeNovel(), makeAvailability());
    assert.ok(xml.includes('rel="up"'));
    assert.ok(xml.includes('href="/opds/v1"'));
  });

  it('XML special characters are escaped', () => {
    const xml = service.buildAtomRootFeed([
      makeNovel({ title: 'A<B>&"C"', description: 'D&E<F>' }),
    ]);
    assert.ok(xml.includes('A&lt;B&gt;&amp;&quot;C&quot;'));
    assert.ok(xml.includes('D&amp;E&lt;F&gt;'));
    assert.ok(!xml.includes('A<B>&"C"'));
  });

  it('single-novel feed updated uses epub_compiled_at', () => {
    const xml = service.buildAtomNovelFeed(
      makeNovel({ epubCompiledAt: '2026-06-22T01:00:00.000Z', contentUpdatedAt: '2026-06-22T00:00:00.000Z' }),
      makeAvailability(),
    );
    assert.ok(xml.includes('<updated>2026-06-22T01:00:00.000Z</updated>'));
  });
});

describe('OpdsFeedService - OPDS 2.0 (JSON-LD)', () => {
  const service = new OpdsFeedService();

  it('root feed contains @context, metadata, links, publications', () => {
    const json = service.buildOpds2RootFeed([]);
    const parsed = JSON.parse(json);
    assert.equal(parsed['@context'], 'https://readium.org/webpub-manifest/context.jsonld');
    assert.ok(parsed.metadata);
    assert.ok(parsed.links);
    assert.ok(Array.isArray(parsed.publications));
  });

  it('root feed publications contain novel metadata', () => {
    const json = service.buildOpds2RootFeed([makeNovel({ title: '小说X', author: '作者Y' })]);
    const parsed = JSON.parse(json);
    assert.equal(parsed.publications.length, 1);
    assert.equal(parsed.publications[0].metadata.title, '小说X');
    assert.equal(parsed.publications[0].metadata.author, '作者Y');
    assert.equal(parsed.publications[0].metadata.identifier, 'urn:opds:novel:syosetu:n1');
  });

  it('root feed publication links to single-novel publication', () => {
    const json = service.buildOpds2RootFeed([makeNovel({ sourceId: 'syosetu', novelId: 'n1' })]);
    const parsed = JSON.parse(json);
    assert.ok(parsed.publications[0].links.some((l: { href: string }) => l.href === '/opds/v2/syosetu/n1'));
  });

  it('root feed omits tags when empty', () => {
    const json = service.buildOpds2RootFeed([makeNovel({ tags: [] })]);
    const parsed = JSON.parse(json);
    assert.equal(parsed.publications[0].metadata.tags, undefined);
  });

  it('single-novel publication contains acquisition links for available versions', () => {
    const json = service.buildOpds2NovelPublication(
      makeNovel({ title: '小说X' }),
      makeAvailability({ original: true, translated: false, bilingual: true }),
    );
    const parsed = JSON.parse(json);
    const acquisitionLinks = parsed.links.filter((l: { rel: string }) => l.rel === 'http://opds-spec.org/acquisition');
    assert.ok(acquisitionLinks.some((l: { href: string }) => l.href === '/opds/artifacts/syosetu/n1/original.epub'));
    assert.ok(acquisitionLinks.some((l: { href: string }) => l.href === '/opds/artifacts/syosetu/n1/bilingual.epub'));
    assert.ok(!acquisitionLinks.some((l: { href: string }) => l.href === '/opds/artifacts/syosetu/n1/translated.epub'));
  });

  it('single-novel publication has self link', () => {
    const json = service.buildOpds2NovelPublication(makeNovel(), makeAvailability());
    const parsed = JSON.parse(json);
    assert.ok(parsed.links.some((l: { rel: string; href: string }) => l.rel === 'self' && l.href === '/opds/v2/syosetu/n1'));
  });

  it('JSON is parseable', () => {
    const json1 = service.buildOpds2RootFeed([makeNovel()]);
    const json2 = service.buildOpds2NovelPublication(makeNovel(), makeAvailability());
    assert.doesNotThrow(() => JSON.parse(json1));
    assert.doesNotThrow(() => JSON.parse(json2));
  });
});
