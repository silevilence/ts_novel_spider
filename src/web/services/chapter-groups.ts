import type { ResolvedChapterState } from '../../server/core/spider';

type GroupableChapter = ResolvedChapterState & {
  media?: {
    total: number;
    cached: number;
    pending: number;
  };
};

export interface ChapterVolumeGroup<TChapter extends GroupableChapter = GroupableChapter> {
  id: string;
  title: string;
  chapters: TChapter[];
  summary: {
    total: number;
    pendingCount: number;
    newCount: number;
    downloadedCount: number;
    failedCount: number;
  };
}

export function groupResolvedChapters<TChapter extends GroupableChapter>(
  chapters: TChapter[],
): ChapterVolumeGroup<TChapter>[] {
  const groups = new Map<string, TChapter[]>();

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

export function filterChapterGroups<TChapter extends GroupableChapter>(
  groups: ChapterVolumeGroup<TChapter>[],
  query: string,
): ChapterVolumeGroup<TChapter>[] {
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
      } satisfies ChapterVolumeGroup<TChapter>;
    })
    .filter((group): group is ChapterVolumeGroup<TChapter> => group !== null);
}