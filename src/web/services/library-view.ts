import type { LibraryNovelDetailPayload } from '../../server/routes/library';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import type { ChapterDirectoryEntry } from '../components/chapter-directory';

interface ChapterMediaSummaryInput {
  total: number;
  cached: number;
  pending: number;
}

export interface ChapterMediaSummaryView {
  hasMedia: boolean;
  presenceLabel: string;
  cacheLabel: string | null;
  cacheComplete: boolean;
}

export interface TextPreview {
  text: string;
  fullText: string;
  isTruncated: boolean;
}

interface TaskProgressLike {
  catalogChapters: number;
  queuedChapters: number;
  completedChapters: number;
  failedChapters: number;
}

export type ReaderContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'image'; alt: string; sourceUrl: string }
  | { type: 'divider' };

const CHAPTER_SECTION_DIVIDER = '---';
const MARKDOWN_IMAGE_PATTERN = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/i;
const MANUAL_ASSET_URL_PATTERN = /manual:\/\/([^\s)]+)/g;

export function toLibraryDirectoryChapters(
  chapters: LibraryNovelDetailPayload['novel']['chapters'],
  options: {
    readingProgress?: LibraryNovelDetailPayload['novel']['readingProgress'];
    bookmarks?: LibraryNovelDetailPayload['novel']['bookmarks'];
  } = {},
): ChapterDirectoryEntry[] {
  const bookmarkCountByChapterId = new Map<string, number>();

  for (const bookmark of options.bookmarks ?? []) {
    bookmarkCountByChapterId.set(
      bookmark.chapterId,
      (bookmarkCountByChapterId.get(bookmark.chapterId) ?? 0) + 1,
    );
  }

  return chapters.map((chapter) => ({
    id: chapter.id,
    index: chapter.index,
    title: chapter.title,
    url: chapter.url,
    status: chapter.status,
    isNew: false,
    wasDownloaded: chapter.status === 'downloaded',
    isCurrentProgress: options.readingProgress?.currentChapterId === chapter.id,
    isProgressWatermark: options.readingProgress?.highestChapterId === chapter.id,
    bookmarkCount: bookmarkCountByChapterId.get(chapter.id) ?? 0,
    versionChangeCount: chapter.versionChangeCount ?? 0,
    ...(chapter.volumeTitle ? { volumeTitle: chapter.volumeTitle } : {}),
    media: chapter.media,
  }));
}

export function findPreferredReaderChapter(
  detail: LibraryNovelDetailPayload['novel'] | null,
): string | null {
  if (!detail) {
    return null;
  }

  return (
    detail.chapters.find((chapter) => chapter.hasContent)?.id
    ?? detail.chapters.find((chapter) => chapter.status === 'downloaded')?.id
    ?? null
  );
}

export function summarizeChapterMedia(
  media: ChapterMediaSummaryInput | undefined,
): ChapterMediaSummaryView {
  if (!media || media.total === 0) {
    return {
      hasMedia: false,
      presenceLabel: '无图',
      cacheLabel: null,
      cacheComplete: true,
    };
  }

  return {
    hasMedia: true,
    presenceLabel: `有图 ${media.total} 张`,
    cacheLabel: `已缓存 ${media.cached}/${media.total}`,
    cacheComplete: media.pending === 0,
  };
}

export function formatLibraryTaskStatus(status: ApiTaskSnapshot['status']): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '执行中';
    case 'completed':
      return '已采集';
    case 'failed':
      return '已失败';
    default:
      return status;
  }
}

export function buildTextPreview(content: string | null | undefined, maxLength: number): TextPreview {
  const fullText = normalizeFullText(content);
  const previewText = collapsePreviewText(fullText);

  if (previewText.length <= maxLength) {
    return {
      text: previewText,
      fullText,
      isTruncated: false,
    };
  }

  return {
    text: `${previewText.slice(0, Math.max(1, maxLength)).trimEnd()}...`,
    fullText,
    isTruncated: true,
  };
}

export function calculateRemainingTaskChapters(progress: TaskProgressLike | null | undefined): number {
  if (!progress) {
    return 0;
  }

  const settled = progress.completedChapters + progress.failedChapters;
  const totalKnown = Math.max(progress.catalogChapters, progress.queuedChapters, settled);

  return Math.max(0, totalKnown - settled);
}

export function splitChapterContent(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function parseReaderContent(content: string): ReaderContentBlock[] {
  return splitChapterContent(content).map((paragraph) => {
    if (paragraph === CHAPTER_SECTION_DIVIDER) {
      return { type: 'divider' } satisfies ReaderContentBlock;
    }

    const markdownImageMatch = paragraph.match(MARKDOWN_IMAGE_PATTERN);
    if (markdownImageMatch) {
      return {
        type: 'image',
        alt: markdownImageMatch[1] ?? '章节插图',
        sourceUrl: markdownImageMatch[2] ?? '',
      } satisfies ReaderContentBlock;
    }

    return {
      type: 'paragraph',
      text: paragraph,
    } satisfies ReaderContentBlock;
  });
}

function normalizeFullText(content: string | null | undefined): string {
  if (!content) {
    return '暂无简介。';
  }

  const normalized = content
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return normalized || '暂无简介。';
}

function collapsePreviewText(content: string): string {
  const collapsed = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();

  return collapsed || '暂无简介。';
}

/**
 * Converts the private manual-asset scheme to the same-origin URL before
 * rehype-sanitize processes the Markdown.  The sanitizer intentionally drops
 * non-web protocols, so resolving it later in a React image renderer is too late.
 */
export function resolveManualAssetUrls(content: string, novelId: string): string {
  return content.replace(MANUAL_ASSET_URL_PATTERN, (_match, assetId: string) => (
    `/api/library/manual-assets/${encodeURIComponent(novelId)}/${encodeURIComponent(assetId)}`
  ));
}
