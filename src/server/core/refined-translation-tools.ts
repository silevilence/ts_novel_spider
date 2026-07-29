import type { RefinedTranslationService } from './refined-translation';

/** Task-scoped tool surface consumed by refined-translation agents. */
export function createRefinedTranslationTools(service: RefinedTranslationService) {
  return {
    read_original_chapter: (taskId: string, chapterId: string) => service.readOriginalChapter(taskId, chapterId),
    read_original_chapters: (taskId: string, chapterIds?: string[]) => service.readOriginalChapters(taskId, chapterIds),
    read_current_translation: (taskId: string, chapterId: string) => service.readCurrentTranslation(taskId, chapterId),
    read_current_translations: (taskId: string, chapterIds?: string[]) => service.readCurrentTranslations(taskId, chapterIds),
    read_untranslated_segments: (taskId: string, chapterId?: string) => service.readUntranslatedSegments(taskId, chapterId),
    write_translation_segment: (taskId: string, chapterId: string, paragraphIndex: number, translatedText: string) => service.writeSegment(taskId, chapterId, paragraphIndex, { translatedText }),
    write_translation_segments: (taskId: string, updates: Array<{ chapterId: string; paragraphIndex: number; translatedText: string }>) => service.writeSegments(taskId, updates),
    read_glossary: (taskId: string) => service.readGlossary(taskId),
    update_glossary_term: (taskId: string, termId: string, targetTerm: string) => service.updateGlossaryTerm(taskId, termId, { targetTerm }),
    read_review_issues: (taskId: string, chapterId?: string) => service.readReviewIssues(taskId, chapterId),
    read_chapter_translation: (taskId: string, chapterId: string) => service.readChapterTranslation(taskId, chapterId),
    read_context_chapters: (taskId: string, chapterId: string) => service.readContextChapters(taskId, chapterId),
    write_review_result: service.writeReview.bind(service),
    mark_segment_issue: service.markSegmentIssue.bind(service),
  };
}
