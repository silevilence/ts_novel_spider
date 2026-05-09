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

export function toLibraryDirectoryChapters(
  chapters: LibraryNovelDetailPayload['novel']['chapters'],
): ChapterDirectoryEntry[] {
  return chapters.map((chapter) => ({
    id: chapter.id,
    index: chapter.index,
    title: chapter.title,
    url: chapter.url,
    status: chapter.status,
    isNew: false,
    wasDownloaded: chapter.status === 'downloaded',
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
      return '已完成';
    case 'failed':
      return '已失败';
    default:
      return status;
  }
}

export function splitChapterContent(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}