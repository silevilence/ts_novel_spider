/** A historical snapshot, independent of the current book title and AI summaries. */
export interface SchedulingNovelResult {
  sourceId: string;
  novelId: string;
  title: string;
  result: 'new_chapters' | 'up_to_date' | 'skipped' | 'error';
  message: string;
  checkedAt: string;
  chapters: Array<{ id: string; title: string; downloaded: boolean }>;
}
