import { searchLibraryNovels } from './library-search';
import type { OpdsNovelFeedEntry } from './opds-feed';

export interface OpdsQuery {
  query?: string;
  title?: string;
  author?: string;
  tag?: string;
  authorExact?: string;
}

export function readOpdsQuery(input: Record<string, unknown>): OpdsQuery {
  const result: OpdsQuery = {};
  for (const key of ['query', 'title', 'author', 'tag', 'authorExact'] as const) {
    const value = input[key] ?? (key === 'query' ? input.q : undefined);
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 2000) throw new Error(`Invalid OPDS ${key} parameter.`);
    result[key] = value.trim();
  }
  return result;
}

/** Input must already be restricted to visible, non-deleted books. */
export function searchOpdsNovels(novels: OpdsNovelFeedEntry[], query: OpdsQuery): OpdsNovelFeedEntry[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const candidates = novels.filter(novel =>
    (!query.title || normalize(novel.title).includes(normalize(query.title))) &&
    (!query.author || normalize(novel.author).includes(normalize(query.author))) &&
    (!query.authorExact || normalize(novel.author) === normalize(query.authorExact)) &&
    (!query.tag || novel.tags.some(tag => normalize(tag) === normalize(query.tag!))),
  );
  candidates.sort((a, b) => `${a.sourceId}:${a.novelId}`.localeCompare(`${b.sourceId}:${b.novelId}`));
  return searchLibraryNovels(candidates.map(novel => ({
    ...novel,
    metadata: { ...novel, chapterCount: 0, infoPageUrl: '' },
    aliases: novel.aliases ?? [],
    updatedAt: novel.contentUpdatedAt ?? '',
  })), query.query ?? '');
}

export interface OpdsPageOptions {
  page: number;
  pageSize: number;
  sort: 'relevance' | 'title' | 'updated';
  browse?: 'authors' | 'tags';
}

export function readOpdsPage(input: Record<string, unknown>): OpdsPageOptions {
  function integer(key: string, fallback: number, max: number) {
    const value = input[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw new Error(`Invalid OPDS ${key} parameter.`);
    return Number(value);
  }
  const sort = input.sort ?? (input.query || input.q ? 'relevance' : 'title');
  if (sort !== 'relevance' && sort !== 'title' && sort !== 'updated') throw new Error('Invalid OPDS sort parameter.');
  const browse = input.browse;
  if (browse !== undefined && browse !== 'authors' && browse !== 'tags') throw new Error('Invalid OPDS browse parameter.');
  return { page: integer('page', 1, 1_000_000), pageSize: integer('pageSize', 30, 100), sort, ...(browse ? { browse } : {}) };
}

export function orderOpdsNovels(novels: OpdsNovelFeedEntry[], sort: OpdsPageOptions['sort']): OpdsNovelFeedEntry[] {
  const stable = [...novels].sort((a, b) => `${a.sourceId}:${a.novelId}`.localeCompare(`${b.sourceId}:${b.novelId}`));
  if (sort === 'relevance') return novels;
  return stable.sort((a, b) => (sort === 'updated' ? (b.contentUpdatedAt ?? '').localeCompare(a.contentUpdatedAt ?? '') : 0) || a.title.localeCompare(b.title, 'zh-CN'));
}
