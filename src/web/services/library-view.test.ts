import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTextPreview,
  calculateRemainingTaskChapters,
  findPreferredReaderChapter,
  formatLibraryTaskStatus,
  parseReaderContent,
  splitChapterContent,
  summarizeChapterMedia,
  toLibraryDirectoryChapters,
} from './library-view';

test('toLibraryDirectoryChapters maps stored chapters to shared directory entries', () => {
  const entries = toLibraryDirectoryChapters([
    {
      id: 'chapter-1',
      index: 1,
      title: '第一章',
      volumeTitle: '第一卷',
      url: 'https://example.com/1',
      content: '正文',
      status: 'downloaded',
      errorMessage: null,
      downloadedAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
      hasContent: true,
      media: { total: 2, cached: 1, pending: 1 },
    },
  ]);

  assert.equal(entries[0]?.wasDownloaded, true);
  assert.equal(entries[0]?.media?.cached, 1);
  assert.equal(entries[0]?.volumeTitle, '第一卷');
});

test('findPreferredReaderChapter chooses the first chapter with local content', () => {
  const chapterId = findPreferredReaderChapter({
    sourceId: 'syosetu',
    metadata: {
      novelId: 'n1000lib',
      title: '测试书籍',
      author: '测试作者',
      description: '描述',
      tags: [],
      chapterCount: 2,
      infoPageUrl: 'https://example.com',
    },
    updatedAt: '2026-05-08T00:00:00.000Z',
    stats: { total: 2, downloaded: 1, failed: 0, pending: 1 },
    media: { total: 0, cached: 0, pending: 0 },
    chapters: [
      {
        id: 'chapter-1',
        index: 1,
        title: '第一章',
        url: 'https://example.com/1',
        content: null,
        status: 'indexed',
        errorMessage: null,
        downloadedAt: null,
        updatedAt: '2026-05-08T00:00:00.000Z',
        hasContent: false,
        media: { total: 0, cached: 0, pending: 0 },
      },
      {
        id: 'chapter-2',
        index: 2,
        title: '第二章',
        url: 'https://example.com/2',
        content: '正文',
        status: 'downloaded',
        errorMessage: null,
        downloadedAt: '2026-05-08T00:00:00.000Z',
        updatedAt: '2026-05-08T00:00:00.000Z',
        hasContent: true,
        media: { total: 0, cached: 0, pending: 0 },
      },
    ],
  });

  assert.equal(chapterId, 'chapter-2');
});

test('splitChapterContent removes blank paragraphs', () => {
  assert.deepEqual(splitChapterContent('第一段\n\n\n第二段\n\n第三段'), ['第一段', '第二段', '第三段']);
});

test('buildTextPreview collapses line breaks and truncates long text', () => {
  assert.deepEqual(buildTextPreview('第一行\n\n第二行', 20), {
    text: '第一行 第二行',
    fullText: '第一行\n\n第二行',
    isTruncated: false,
  });

  assert.deepEqual(buildTextPreview('abcdefghijklmnopqrstuvwxyz', 10), {
    text: 'abcdefghij...',
    fullText: 'abcdefghijklmnopqrstuvwxyz',
    isTruncated: true,
  });
});

test('calculateRemainingTaskChapters excludes completed and failed chapters from pending count', () => {
  assert.equal(calculateRemainingTaskChapters({
    catalogChapters: 83,
    queuedChapters: 83,
    completedChapters: 60,
    failedChapters: 0,
  }), 23);

  assert.equal(calculateRemainingTaskChapters({
    catalogChapters: 0,
    queuedChapters: 5,
    completedChapters: 3,
    failedChapters: 1,
  }), 1);
});

test('parseReaderContent maps separators and markdown images to reader blocks', () => {
  assert.deepEqual(
    parseReaderContent('前言\n\n---\n\n![挿絵](https://cdn.example/illust.jpg)\n\n正文'),
    [
      { type: 'paragraph', text: '前言' },
      { type: 'divider' },
      { type: 'image', alt: '挿絵', sourceUrl: 'https://cdn.example/illust.jpg' },
      { type: 'paragraph', text: '正文' },
    ],
  );
});

test('summarizeChapterMedia distinguishes no-image, partial-cache and full-cache states', () => {
  assert.deepEqual(summarizeChapterMedia(undefined), {
    hasMedia: false,
    presenceLabel: '无图',
    cacheLabel: null,
    cacheComplete: true,
  });

  assert.deepEqual(summarizeChapterMedia({ total: 2, cached: 1, pending: 1 }), {
    hasMedia: true,
    presenceLabel: '有图 2 张',
    cacheLabel: '已缓存 1/2',
    cacheComplete: false,
  });

  assert.deepEqual(summarizeChapterMedia({ total: 3, cached: 3, pending: 0 }), {
    hasMedia: true,
    presenceLabel: '有图 3 张',
    cacheLabel: '已缓存 3/3',
    cacheComplete: true,
  });
});

test('formatLibraryTaskStatus returns user-facing task labels', () => {
  assert.equal(formatLibraryTaskStatus('queued'), '排队中');
  assert.equal(formatLibraryTaskStatus('running'), '执行中');
  assert.equal(formatLibraryTaskStatus('completed'), '已完成');
  assert.equal(formatLibraryTaskStatus('failed'), '已失败');
});