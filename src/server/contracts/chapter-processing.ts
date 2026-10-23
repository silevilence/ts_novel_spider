import { z } from 'zod';

/** A supplied scope must be nonempty; omission means the whole novel. */
export const chapterScopeSchema = z.array(z.string().trim().min(1)).min(1).max(10000)
  .refine((ids) => new Set(ids).size === ids.length, '章节不能重复');
export const extractionOptionsSchema = z.object({
  chapterIds: chapterScopeSchema.optional(),
  fromScratch: z.boolean().optional(),
  incremental: z.boolean().optional(),
});
export type ExtractionOptions = z.infer<typeof extractionOptionsSchema>;

/** Reject foreign and unavailable chapters before creating any background run. */
export function selectDownloadedChapters<T extends { id: string; content?: string | null }>(chapters: T[], ids?: string[]): T[] {
  if (ids) chapterScopeSchema.parse(ids);
  const available = chapters.filter((chapter) => chapter.content?.trim());
  if (ids?.some((id) => !available.some((chapter) => chapter.id === id))) throw new Error('所选章节不存在、属于其他小说或尚未下载正文。');
  return ids ? available.filter((chapter) => ids.includes(chapter.id)) : available;
}
