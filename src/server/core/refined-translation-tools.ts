import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import type { RefinedTranslationReviewResolution } from './novel-repository';
import type { RefinedTranslationService } from './refined-translation';

export interface RefinedTranslationToolScope {
  taskId: string;
  chapterIds?: readonly string[];
  writable?: boolean;
  abortSignal?: AbortSignal;
  /**
   * Chapter-chat edits use AI SDK's approval request. Background pipeline
   * agents are already authorized by the task state machine and execute writes.
   */
  requireWriteApproval?: boolean;
}

const reviewResolutionSchema = z.enum(['accepted', 'partially_accepted', 'rejected', 'resolved', 'ignored']);
const emptyInput = z.object({});

/**
 * The task-material Module has one Interface for both deterministic workflow
 * code and LLM agents. The scope binds a tool call to its task/chapter so an
 * LLM never gets authority to address arbitrary task data.
 */
export function createRefinedTranslationTools(service: RefinedTranslationService, scope: RefinedTranslationToolScope): ToolSet {
  const allowedChapters = scope.chapterIds ? new Set(scope.chapterIds) : null;
  const requireActive = () => scope.abortSignal?.throwIfAborted();
  const requireChapter = (chapterId: string) => {
    requireActive();
    if (allowedChapters && !allowedChapters.has(chapterId)) throw new Error('当前 Agent 无权访问该章节。');
    return chapterId;
  };
  const requireWrite = () => {
    requireActive();
    if (!scope.writable) throw new Error('当前 Agent 为只读模式，不能修改任务物料。');
  };
  const writeOptions = scope.requireWriteApproval ? { needsApproval: true as const } : {};

  return {
    read_original_chapter: tool({
      description: '读取指定章节的任务原文快照和段落编号。',
      inputSchema: z.object({ chapterId: z.string().min(1) }),
      execute: ({ chapterId }) => service.readOriginalChapter(scope.taskId, requireChapter(chapterId)),
    }),
    read_original_chapters: tool({
      description: '读取当前任务范围内多个章节的原文快照。',
      inputSchema: z.object({ chapterIds: z.array(z.string().min(1)).optional() }),
      execute: ({ chapterIds }) => { requireActive(); return service.readOriginalChapters(scope.taskId, chapterIds?.map(requireChapter)); },
    }),
    read_current_translation: tool({
      description: '读取指定章节当前的原文、译文、段落状态和审核意见。',
      inputSchema: z.object({ chapterId: z.string().min(1) }),
      execute: ({ chapterId }) => service.readCurrentTranslation(scope.taskId, requireChapter(chapterId)),
    }),
    read_untranslated_segments: tool({
      description: '读取指定章节仍待翻译或失败的段落。',
      inputSchema: z.object({ chapterId: z.string().min(1) }),
      execute: ({ chapterId }) => service.readUntranslatedSegments(scope.taskId, requireChapter(chapterId)),
    }),
    write_translation_segment: tool({
      description: '写入一个段落的完整译文。编辑必须使用任务段落索引。',
      inputSchema: z.object({ chapterId: z.string().min(1), paragraphIndex: z.number().int().min(0), translatedText: z.string().min(1) }),
      ...writeOptions,
      execute: ({ chapterId, paragraphIndex, translatedText }) => {
        requireWrite();
        return service.writeSegment(scope.taskId, requireChapter(chapterId), paragraphIndex, { translatedText, status: 'translated' });
      },
    }),
    read_glossary: tool({
      description: '读取当前任务独立术语表。',
      inputSchema: emptyInput,
      execute: () => { requireActive(); return service.readGlossary(scope.taskId); },
    }),
    update_glossary_term: tool({
      description: '更新任务术语表中一个术语的目标语言译法。',
      inputSchema: z.object({ termId: z.string().min(1), targetTerm: z.string().min(1) }),
      ...writeOptions,
      execute: ({ termId, targetTerm }) => {
        requireWrite();
        return service.updateGlossaryTerm(scope.taskId, termId, { targetTerm });
      },
    }),
    read_review_issues: tool({
      description: '读取指定章节的审核意见及其处理状态。',
      inputSchema: z.object({ chapterId: z.string().min(1) }),
      execute: ({ chapterId }) => service.readReviewIssues(scope.taskId, requireChapter(chapterId)),
    }),
    read_chapter_translation: tool({
      description: '读取单章完整原文/译文对照，供审核使用。',
      inputSchema: z.object({ chapterId: z.string().min(1) }),
      execute: ({ chapterId }) => service.readChapterTranslation(scope.taskId, requireChapter(chapterId)),
    }),
    read_context_chapters: tool({
      description: '读取目标章节前后章节的当前译文，用于跨章一致性检查。',
      inputSchema: z.object({ chapterId: z.string().min(1) }),
      execute: ({ chapterId }) => service.readContextChapters(scope.taskId, requireChapter(chapterId)),
    }),
    write_review_result: tool({
      description: '写入一条审核意见；段落索引必须来自已读取的章节。',
      inputSchema: z.object({
        chapterId: z.string().min(1), reviewRound: z.number().int().min(1), severity: z.enum(['low', 'medium', 'high']),
        paragraphIndex: z.number().int().min(0), suggestion: z.string().min(1), replacementText: z.string().min(1).nullable(),
        forceChange: z.boolean(), scores: z.record(z.string(), z.number()),
      }),
      ...writeOptions,
      execute: ({ chapterId, reviewRound, severity, paragraphIndex, suggestion, replacementText, forceChange, scores }) => {
        requireWrite();
        return service.markSegmentIssue(scope.taskId, { chapterId: requireChapter(chapterId), reviewRound, severity, paragraphIndex, suggestion, replacementText, forceChange, scores, resolved: false, resolution: 'open', resolutionNote: null });
      },
    }),
    mark_segment_issue: tool({
      description: '为一个段落写入审核意见。与 write_review_result 等价，适合逐条输出。',
      inputSchema: z.object({
        chapterId: z.string().min(1), reviewRound: z.number().int().min(1), severity: z.enum(['low', 'medium', 'high']),
        paragraphIndex: z.number().int().min(0), suggestion: z.string().min(1), replacementText: z.string().min(1).nullable(),
        forceChange: z.boolean(), scores: z.record(z.string(), z.number()),
      }),
      ...writeOptions,
      execute: ({ chapterId, reviewRound, severity, paragraphIndex, suggestion, replacementText, forceChange, scores }) => {
        requireWrite();
        return service.markSegmentIssue(scope.taskId, { chapterId: requireChapter(chapterId), reviewRound, severity, paragraphIndex, suggestion, replacementText, forceChange, scores, resolved: false, resolution: 'open', resolutionNote: null });
      },
    }),
    resolve_review_issue: tool({
      description: '记录审核修订对一条意见的接受、部分接受或拒绝结论。',
      inputSchema: z.object({ reviewId: z.string().min(1), resolution: reviewResolutionSchema, resolutionNote: z.string().min(1) }),
      ...writeOptions,
      execute: ({ reviewId, resolution, resolutionNote }) => {
        requireWrite();
        return { updated: service.resolveReview(scope.taskId, reviewId, resolution as RefinedTranslationReviewResolution, resolutionNote) };
      },
    }),
  };
}
