import type { LibraryNovelDetailPayload } from '../../server/routes/library';
import type { ChapterDirectoryEntry } from '../components/chapter-directory';

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

export function splitChapterContent(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}