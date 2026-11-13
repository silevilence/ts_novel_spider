import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpdsQuery, searchOpdsNovels } from './opds-query';
import type { OpdsNovelFeedEntry } from './opds-feed';

const novels: OpdsNovelFeedEntry[] = [
  { sourceId: 'manual', novelId: '1', title: '魔法の旅', author: '夏目 漱石', description: '猫と旅', tags: ['奇幻'], aliases: [{ alias: '別名 A&B' }], contentUpdatedAt: null, epubCompiledAt: null, hasTranslation: false },
  { sourceId: 'manual', novelId: '2', title: '魔法の旅', author: '另一作者', description: '', tags: ['奇幻小说', '恐怖'], contentUpdatedAt: null, epubCompiledAt: null, hasTranslation: false },
];

test('OPDS shares field search and combines literal filters without syntax injection', () => {
  assert.deepEqual(searchOpdsNovels(novels, { query: 'author:夏目 + -tag:恐怖' }).map(n => n.novelId), ['1']);
  assert.equal(searchOpdsNovels(novels, { query: '別名' })[0]?.novelId, '1');
  assert.equal(searchOpdsNovels(novels, { tag: '奇幻' }).length, 1);
  assert.equal(searchOpdsNovels(novels, { query: 'tag:奇幻' }).length, 2);
  assert.equal(searchOpdsNovels(novels, { title: '魔法', author: '夏目 漱石' }).length, 1);
  assert.equal(searchOpdsNovels(novels, { author: '夏目,另一作者' }).length, 0);
  assert.equal(searchOpdsNovels(novels, {}).length, 2);
  assert.equal(searchOpdsNovels([], { query: '魔法' }).length, 0);
});

test('OPDS accepts q alias and rejects repeated, object and oversized query parameters', () => {
  assert.deepEqual(readOpdsQuery({ q: ' 猫 ' }), { query: '猫' });
  for (const value of [[], {}, 'a'.repeat(2001)]) assert.throws(() => readOpdsQuery({ query: value }));
});
