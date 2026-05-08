import type { ResolvedChapterState } from '../../server/core/spider';

export interface ChapterVolumeGroup {
  id: string;
  title: string;
  chapters: ResolvedChapterState[];
  summary: {
    total: number;
    pendingCount: number;
    newCount: number;
    downloadedCount: number;
    failedCount: number;
  };
}

export function groupResolvedChapters(chapters: ResolvedChapterState[]): ChapterVolumeGroup[] {
  const groups = new Map<string, ResolvedChapterState[]>();

  for (const chapter of chapters) {
    const groupTitle = chapter.volumeTitle?.trim() || '未分卷';
    const existing = groups.get(groupTitle);

    if (existing) {
      existing.push(chapter);
      continue;
    }

    groups.set(groupTitle, [chapter]);
  }

  return [...groups.entries()].map(([title, groupedChapters], index) => ({
    id: `${index}-${title}`,
    title,
    chapters: groupedChapters,
    summary: {
      total: groupedChapters.length,
      pendingCount: groupedChapters.filter((chapter) => chapter.status !== 'downloaded').length,
      newCount: groupedChapters.filter((chapter) => chapter.isNew).length,
      downloadedCount: groupedChapters.filter((chapter) => chapter.wasDownloaded).length,
      failedCount: groupedChapters.filter((chapter) => chapter.status === 'failed').length,
    },
  }));
}

export function filterChapterGroups(groups: ChapterVolumeGroup[], query: string): ChapterVolumeGroup[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return groups;
  }

  return groups
    .map((group) => {
      const chapters = group.chapters.filter((chapter) => {
        const haystacks = [group.title, chapter.title, String(chapter.index)];
        return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
      });

      if (chapters.length === 0) {
        return null;
      }

      return {
        ...group,
        chapters,
        summary: {
          total: chapters.length,
          pendingCount: chapters.filter((chapter) => chapter.status !== 'downloaded').length,
          newCount: chapters.filter((chapter) => chapter.isNew).length,
          downloadedCount: chapters.filter((chapter) => chapter.wasDownloaded).length,
          failedCount: chapters.filter((chapter) => chapter.status === 'failed').length,
        },
      } satisfies ChapterVolumeGroup;
    })
    .filter((group): group is ChapterVolumeGroup => group !== null);
}