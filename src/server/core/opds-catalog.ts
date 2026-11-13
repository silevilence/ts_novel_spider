import { load } from 'cheerio';
import type { OpdsNovelFeedEntry } from './opds-feed';
import { orderOpdsNovels, type OpdsPageOptions } from './opds-query';

interface CatalogLink { rel?: string; href: string; title?: string; count?: number }
export function prepareOpdsCatalog(novels: OpdsNovelFeedEntry[], options: OpdsPageOptions, originalUrl: string) {
  const url = new URL(originalUrl, 'http://opds.local');
  const v1 = url.pathname.includes('/v1');
  const root = v1 ? '/opds/v1.opds' : '/opds/v2';
  const href = (changes: Record<string, string | null>, pathname = url.pathname) => {
    const next = new URL(url);
    next.pathname = pathname;
    for (const [key, value] of Object.entries(changes)) value === null ? next.searchParams.delete(key) : next.searchParams.set(key, value);
    return next.pathname + next.search;
  };
  let navigation: CatalogLink[] = [];
  let total = novels.length;
  if (options.browse) {
    const counts = new Map<string, number>();
    for (const novel of novels) {
      const values = options.browse === 'authors' ? [novel.author] : novel.tags;
      for (const value of new Set(values.filter(Boolean))) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    navigation = [...counts].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([title, count]) => ({
      title: `${title}（${count}）`, count,
      href: href({ browse: null, page: null, [options.browse === 'authors' ? 'authorExact' : 'tag']: title }, v1 ? '/opds/v1/search' : '/opds/v2/search'),
    }));
    total = navigation.length;
  }
  const offset = (options.page - 1) * options.pageSize;
  const books = options.browse ? [] : orderOpdsNovels(novels, options.sort).slice(offset, offset + options.pageSize);
  navigation = options.browse ? navigation.slice(offset, offset + options.pageSize) : [
    { title: '全部书籍', href: root },
    { title: '按作者', href: `${root}?browse=authors` },
    { title: '按标签', href: `${root}?browse=tags` },
    { title: '最近更新', href: `${root}?sort=updated` },
  ];
  const last = Math.max(1, Math.ceil(total / options.pageSize));
  const links: CatalogLink[] = [{ rel: 'self', href: url.pathname + url.search }, { rel: 'start', href: root }, { rel: 'up', href: root }];
  links.push({ rel: 'first', href: href({ page: '1' }) }, { rel: 'last', href: href({ page: String(last) }) });
  if (options.page > 1) links.push({ rel: 'previous', href: href({ page: String(Math.min(options.page - 1, last)) }) });
  if (options.page < last) links.push({ rel: 'next', href: href({ page: String(options.page + 1) }) });
  const metadata = { numberOfItems: total, itemsPerPage: options.pageSize, currentPage: options.page };
  return { books, navigation, links, metadata, root, v1, browse: options.browse };
}

export function decorateOpdsCatalog(feed: string, catalog: ReturnType<typeof prepareOpdsCatalog>): string {
  const type = catalog.v1 ? 'application/atom+xml;profile=opds-catalog' : 'application/opds+json';
  if (!catalog.v1) {
    const json = JSON.parse(feed);
    json.metadata = { ...json.metadata, ...catalog.metadata };
    json.links = [...json.links.filter((link: CatalogLink) => link.rel === 'search'), ...catalog.links.map(link => ({ ...link, type }))];
    json.navigation = catalog.navigation.map(link => ({ ...link, type }));
    if (catalog.browse) delete json.publications;
    return JSON.stringify(json);
  }
  const $ = load(feed, { xml: true });
  const root = $('feed');
  root.attr('xmlns:opensearch', 'http://a9.com/-/spec/opensearch/1.1/');
  root.children('link').filter((_, element) => ['self', 'start', 'up', 'first', 'last', 'next', 'previous'].includes($(element).attr('rel') ?? '')).remove();
  for (const link of catalog.links) root.append($('<link/>').attr({ rel: link.rel!, href: link.href, type }));
  root.append($('<opensearch:totalResults/>').text(String(catalog.metadata.numberOfItems)));
  root.append($('<opensearch:itemsPerPage/>').text(String(catalog.metadata.itemsPerPage)));
  root.append($('<opensearch:startIndex/>').text(String((catalog.metadata.currentPage - 1) * catalog.metadata.itemsPerPage + 1)));
  if (catalog.browse) root.children('entry').remove();
  for (const link of catalog.navigation) {
    if (!catalog.browse && catalog.links[0]!.href.includes('/search')) continue;
    const entry = $('<entry/>');
    entry.append($('<id/>').text(link.href), $('<title/>').text(link.title!), $('<updated/>').text(root.children('updated').text()));
    entry.append($('<link/>').attr({ rel: 'subsection', href: link.href, type }));
    root.append(entry);
  }
  return $.xml();
}
