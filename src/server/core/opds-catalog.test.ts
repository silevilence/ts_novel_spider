import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { prepareOpdsCatalog, decorateOpdsCatalog } from './opds-catalog';
import { readOpdsPage, searchOpdsNovels } from './opds-query';
import { OpdsFeedService, type OpdsNovelFeedEntry } from './opds-feed';

const books: OpdsNovelFeedEntry[] = Array.from({ length: 7 }, (_, index) => ({
  sourceId: 'manual', novelId: String(index), title: '同名', author: index < 3 ? 'A & B' : '其他',
  tags: ['标签', '另一标签'], description: '', contentUpdatedAt: '2026-11-13', epubCompiledAt: null, hasTranslation: false,
}));
test('catalog pagination preserves query, sorts ties and exposes identical v1/v2 metadata', () => {
  const feed = new OpdsFeedService();
  const seen: string[] = [];
  for (let page = 1; page <= 4; page++) {
    const params = { page: String(page), pageSize: '2', query: 'name:同名' };
    const catalog = prepareOpdsCatalog(searchOpdsNovels(books, params), readOpdsPage(params), '/opds/v2/search?' + new URLSearchParams(params));
    seen.push(...catalog.books.map(book => book.novelId));
    const json = JSON.parse(decorateOpdsCatalog(feed.buildOpds2RootFeed(catalog.books), catalog));
    assert.equal(json.metadata.numberOfItems, 7);
    if (page < 4) assert(new URL(json.links.find((link: {rel: string}) => link.rel === 'next').href, 'http://test').searchParams.get('query') === params.query);
    const xmlCatalog = prepareOpdsCatalog(books, readOpdsPage(params), '/opds/v1/search?' + new URLSearchParams(params));
    const $ = load(decorateOpdsCatalog(feed.buildAtomSearchFeed(catalog.books, new Map(), '/search'), xmlCatalog), { xml: true });
    assert.equal($('opensearch\\:totalResults').text(), '7');
    assert.equal($('entry').length, catalog.books.length);
  }
  assert.equal(new Set(seen).size, 7);
  assert.equal(seen.length, 7);
});

test('author and tag directories count books, encode names and paginate categories', () => {
  const options = readOpdsPage({ browse: 'authors', pageSize: '1', page: '2' });
  const catalog = prepareOpdsCatalog(books, options, '/opds/v2?browse=authors&pageSize=1&page=2');
  assert.equal(catalog.metadata.numberOfItems, 2);
  assert.equal(catalog.navigation.length, 1);
  const link = new URL(catalog.navigation[0]!.href, 'http://test');
  assert.equal(link.searchParams.get('authorExact'), 'A & B');
  assert.equal(searchOpdsNovels(books, { authorExact: 'A & B' }).length, 3);
  assert.equal(prepareOpdsCatalog(books, readOpdsPage({ page: '99' }), '/opds/v2?page=99').books.length, 0);
  for (const input of [{ page: '0' }, { pageSize: '101' }, { sort: 'no' }, { browse: ['tags'] }]) assert.throws(() => readOpdsPage(input));
});
