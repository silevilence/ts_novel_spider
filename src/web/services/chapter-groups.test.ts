import assert from 'node:assert/strict';
import test from 'node:test';

import { filterChapterGroups, groupResolvedChapters } from './chapter-groups';

const chapters = [
  {
    id: 'c1',
    index: 1,
    title: '序章',
    volumeTitle: '第一卷',
    url: '/1',
    wasDownloaded: false,
    isNew: true,
    status: 'indexed',
  },
  {
    id: 'c2',
    index: 2,
    title: '启程',
    volumeTitle: '第一卷',
    url: '/2',
    wasDownloaded: true,
    isNew: false,
    status: 'downloaded',
  },
  {
    id: 'c3',
    index: 3,
    title: '终章',
    volumeTitle: '第二卷',
    url: '/3',
    wasDownloaded: false,
    isNew: false,
    status: 'failed',
  },
] as const;

test('groupResolvedChapters keeps volume order and aggregates summary', () => {
  const grouped = groupResolvedChapters([...chapters]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.title, '第一卷');
  assert.deepEqual(grouped[0]?.summary, {
    total: 2,
    pendingCount: 1,
    newCount: 1,
    downloadedCount: 1,
    failedCount: 0,
  });
  assert.equal(grouped[1]?.summary.failedCount, 1);
});

test('filterChapterGroups narrows chapters by query', () => {
  const grouped = groupResolvedChapters([...chapters]);
  const filtered = filterChapterGroups(grouped, '终章');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.title, '第二卷');
  assert.equal(filtered[0]?.chapters.length, 1);
  assert.equal(filtered[0]?.chapters[0]?.id, 'c3');
});