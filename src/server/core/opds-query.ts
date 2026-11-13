import { searchLibraryNovels } from './library-search';
import type { OpdsNovelFeedEntry } from './opds-feed';

export interface OpdsQuery {
  query?: string;
  title?: string;
  author?: string;
  tag?: string;
}

export function readOpdsQuery(input: Record<string, unknown>): OpdsQuery {
  const result: OpdsQuery = {};
  for (const key of ['query', 'title', 'author', 'tag'] as const) {
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
    (!query.tag || novel.tags.some(tag => normalize(tag) === normalize(query.tag!))),
  );
  return searchLibraryNovels(candidates.map(novel => ({
    ...novel,
    metadata: { ...novel, chapterCount: 0, infoPageUrl: '' },
    aliases: novel.aliases ?? [],
    updatedAt: novel.contentUpdatedAt ?? '',
  })), query.query ?? '');
}
