import { paragraphRevisionLimit } from '../contracts/refined-finalization';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { RefinedRevisionRecord, RevisionConstraint } from '../contracts/refined-revision';
import type { RefinedModelRoute, SqliteNovelRepository, StoredRefinedTranslationTaskRow } from './novel-repository';
import type { SystemPreferencesService } from './system-preferences';
import { refinedModelFormat, resolveRefinedChatRoute } from './refined-translation-models';
import { modelContextLimit, textRequestFits } from './llm-context-budget';
import { buildIndexTranslatePrompt, detectIndexTranslatePromptEcho } from './translation/nodes/index-translate-messages';
import { hasTranslationGlossaryEcho } from './translation/nodes/translation-prompt-materials';

export type RevisionGenerator = (preferences: SystemPreferencesService, route: RefinedModelRoute, system: string, prompt: string, signal?: AbortSignal) => Promise<string>;
const planSchema = z.object({ decisions: z.array(z.object({
  reviewId: z.string(), decision: z.enum(['accepted', 'partially_accepted', 'rejected', 'manual']), reason: z.string().min(1),
  constraints: z.array(z.object({ kind: z.enum(['hard', 'soft']), text: z.string().trim().min(1), paragraphIndices: z.array(z.number().int().nonnegative()).min(1) })),
})) });
const verificationSchema = z.object({ resolved: z.boolean(), reason: z.string().trim().min(1) });

function parseJson(text: string): unknown { return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
function fingerprint(value: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
class StaleRevisionMaterialsError extends Error {}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Complete constraints must fit. Never trim mandatory requirements or split a revision paragraph. */
function checkBudget(preferences: SystemPreferencesService, route: RefinedModelRoute, system: string, prompt: string): void {
  if (!textRequestFits(modelContextLimit(preferences, route), system, prompt)) throw new Error('修订约束或关联段落超过模型预算，请人工处理或增大上下文上限。');
}

/** Validate scalar translation output before replacing a valid paragraph. */
export function validateRevisionText(output: string, source: string): string {
  const text = output.trim();
  if (!text) throw new Error('修订模型返回空译文。');
  if (Object.values(detectIndexTranslatePromptEcho(text, source)).some(Boolean) || /^```(?:json)?\s*\{/i.test(text) || /^\s*\{\s*"(?:translatedText|decisions)"/.test(text)) throw new Error('修订模型回显提示词或返回了结构化决策，未保存译文。');
  if (/^\s*\|.*\|\s*$/m.test(source) && source.split('\n').filter((line) => /^\s*\|/.test(line)).length !== text.split('\n').filter((line) => /^\s*\|/.test(line)).length) throw new Error('修订表格结构不完整。');
  return text;
}

/** A bounded plan → paragraph revision → whole-issue verification workflow. */
export async function reviseRefinedChapter(options: {
  repository: SqliteNovelRepository; preferences: SystemPreferencesService; task: StoredRefinedTranslationTaskRow;
  chapterId: string; signal: AbortSignal; generate: RevisionGenerator;
  segmentRoute: (paragraphIndex: number) => RefinedModelRoute | null;
}): Promise<{ processed: number; unresolved: number }> {
  const { repository, preferences, task, chapterId, signal, generate, segmentRoute } = options;
  let reviews = repository.listRefinedTranslationReviews(task.id, chapterId).filter((review) => review.resolution === 'open');
  if (!reviews.length) return { processed: 0, unresolved: 0 };
  let rows = repository.listRefinedTranslationSegments(task.id, chapterId);
  const glossary = repository.listRefinedTranslationTerms(task.id).filter((term) => term.status === 'confirmed' && term.targetTerm?.trim());
  const chat = resolveRefinedChatRoute(preferences, task.modelConfig.reviewModel);
  if (!chat) throw new Error('审核修订需要普通对话审核模型。');
  const materialStamp = fingerprint({ glossary, languages: [task.sourceLang, task.targetLang] });
  const assertCurrentMaterials = (segmentId: string, source: string, translation: string | null) => {
    const currentTask = repository.getRefinedTranslationTask(task.id);
    const current = repository.listRefinedTranslationSegments(task.id, chapterId).find((row) => row.id === segmentId);
    const currentGlossary = repository.listRefinedTranslationTerms(task.id).filter((term) => term.status === 'confirmed' && term.targetTerm?.trim());
    if (!currentTask || currentTask.deletedAt || current?.sourceText !== source || current.translatedText !== translation || fingerprint({ glossary: currentGlossary, languages: [currentTask.sourceLang, currentTask.targetLang] }) !== materialStamp) throw new StaleRevisionMaterialsError('修订期间原文、译文、术语或语言配置已变化，未覆盖新材料，请重新审核。');
  };

  const finalized = new Set<number>();
  const blocked = new Set<number>();
  for (const segment of rows.filter((row) => reviews.some((review) => review.paragraphIndices.includes(row.paragraphIndex)))) {
    const state = repository.getParagraphRevisionState(task.id, segment.id);
    if (state.status === 'finalized') { finalized.add(segment.paragraphIndex); continue; }
    if (state.status === 'failed') { blocked.add(segment.paragraphIndex); continue; }
    if (state.count < paragraphRevisionLimit(task.modelConfig.maxParagraphRevisions, task.modelConfig.maxReviewRounds)) continue;
    signal.throwIfAborted();
    const related = reviews.filter((review) => review.paragraphIndices.includes(segment.paragraphIndex));
    const history = repository.listRefinedTranslationReviews(task.id, chapterId).filter((review) => review.paragraphIndices.includes(segment.paragraphIndex));
    const finalSystem = '审核模型直接定稿：当前段已达到自动修订上限。结合原文、术语、上下文和历次反馈，只输出该段完整最终译文。禁止修改标题、其他段落或术语。此输出是直接定稿，不代表另一次独立复审通过。';
    const prompt = JSON.stringify({ sourceLang: task.sourceLang, targetLang: task.targetLang, source: segment.sourceText, currentTranslation: segment.translatedText, glossary, feedback: history, context: rows.filter((row) => row.paragraphIndex < segment.paragraphIndex).slice(-2) });
    const finalization = { model: chat, triggerCount: state.count, reason: `已完成 ${state.count} 次修订并复审，仍有审核意见`, before: segment.translatedText ?? '', after: null as string | null, reviewIds: related.map((review) => review.id), prompt };
    const record: RefinedRevisionRecord = { id: crypto.randomUUID(), kind: 'finalization', taskId: task.id, chapterId, paragraphIndex: segment.paragraphIndex, round: repository.getRefinedTranslationChapter(task.id, chapterId)?.reviewRound ?? 0, fingerprint: fingerprint({ source: segment.sourceText, epoch: state.epoch }), reviewIds: finalization.reviewIds, constraints: [], model: chat, before: finalization.before, after: null, prompt, status: 'prepared', verification: [], error: null };
    repository.saveRefinedRevision(record);
    try {
      assertCurrentMaterials(segment.id, segment.sourceText, segment.translatedText);
      checkBudget(preferences, chat, finalSystem, prompt);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          signal.throwIfAborted();
          const text = validateRevisionText(await generate(preferences, chat, finalSystem, prompt, signal), segment.sourceText);
          signal.throwIfAborted();
          assertCurrentMaterials(segment.id, segment.sourceText, segment.translatedText);
          record.after = text; record.status = 'revised'; finalization.after = text;
          repository.applyParagraphFinalization(record, segment.id, { ...state, status: 'finalized', finalization });
          finalized.add(segment.paragraphIndex); break;
        } catch (error) { if (signal.aborted || error instanceof StaleRevisionMaterialsError || attempt === 2) throw error; }
      }
    } catch (error) {
      record.status = signal.aborted ? 'cancelled' : 'failed'; record.error = errorMessage(error); repository.saveRefinedRevision(record);
      if (signal.aborted) return { processed: 0, unresolved: reviews.length };
      repository.saveParagraphRevisionState(task.id, segment.id, { ...state, status: 'failed', finalization: { ...finalization, reason: errorMessage(error) } });
      blocked.add(segment.paragraphIndex);
    }
  }
  for (const review of reviews.filter((review) => review.paragraphIndices.length && review.paragraphIndices.every((index) => finalized.has(index)))) {
    repository.updateRefinedTranslationReview(task.id, review.id, 'ignored', '关联段落已由审核模型直接定稿，退出自动返工；未声称独立复审通过，可人工重新开启。', false);
  }
  reviews = reviews.filter((review) => !review.paragraphIndices.length || !review.paragraphIndices.every((index) => finalized.has(index)));
  if (!reviews.length) return { processed: finalized.size, unresolved: 0 };
  rows = repository.listRefinedTranslationSegments(task.id, chapterId);
  const linked = new Set(reviews.flatMap((review) => review.paragraphIndices));
  const material = JSON.stringify({ reviews, paragraphs: rows.filter((row) => linked.has(row.paragraphIndex)), glossary });
  const system = '审核意见约束规划：判断每条意见是否应采纳，发现相互冲突、无法定位、无法执行时 decision=manual 并解释；不要把所有意见当硬性要求。只返回 JSON {"decisions":[{"reviewId":"原意见ID","decision":"accepted|partially_accepted|rejected|manual","reason":"原因","constraints":[{"kind":"hard|soft","text":"可执行要求","paragraphIndices":[0]}]}]}。覆盖全部意见，约束只能属于意见关联段落，不输出译文。';
  let plan: z.infer<typeof planSchema>;
  try {
    for (const review of reviews) if (!review.paragraphIndices.length || review.paragraphIndices.some((index) => !rows.some((row) => row.paragraphIndex === index))) throw new Error('审核意见无法定位到完整关联段落。');
    checkBudget(preferences, chat, system, material);
    plan = planSchema.parse(parseJson(await generate(preferences, chat, system, material, signal)));
    signal.throwIfAborted();
    if (plan.decisions.length !== reviews.length || new Set(plan.decisions.map((item) => item.reviewId)).size !== reviews.length) throw new Error('约束规划未完整覆盖审核意见。');
    for (const decision of plan.decisions) {
      const review = reviews.find((item) => item.id === decision.reviewId);
      if (!review || decision.constraints.some((constraint) => constraint.paragraphIndices.some((index) => !review.paragraphIndices.includes(index)))) throw new Error('约束包含不属于审核意见的段落。');
      if (['accepted', 'partially_accepted'].includes(decision.decision) && review.paragraphIndices.some((index) => !decision.constraints.some((constraint) => constraint.paragraphIndices.includes(index)))) throw new Error('采纳意见缺少覆盖关联段落的可执行约束。');
    }
  } catch (error) {
    if (signal.aborted) return { processed: 0, unresolved: reviews.length };
    for (const review of reviews) repository.updateRefinedTranslationReview(task.id, review.id, 'open', `约束规划失败，待人工处理：${errorMessage(error)}`, false);
    return { processed: 0, unresolved: reviews.length };
  }
  const constraints: RevisionConstraint[] = plan.decisions.flatMap((decision) => ['accepted', 'partially_accepted'].includes(decision.decision) ? decision.constraints.map((constraint) => ({ ...constraint, reviewId: decision.reviewId })) : []);
  const manual = new Set(plan.decisions.filter((item) => item.decision === 'manual').map((item) => item.reviewId));
  for (const decision of plan.decisions) {
    if (decision.decision === 'rejected') repository.updateRefinedTranslationReview(task.id, decision.reviewId, 'rejected', decision.reason);
    if (decision.decision === 'manual') repository.updateRefinedTranslationReview(task.id, decision.reviewId, 'open', `待人工处理：${decision.reason}`, false);
  }
  const records: RefinedRevisionRecord[] = [];
  const failed = new Set<string>([...manual, ...reviews.filter((review) => review.paragraphIndices.some((index) => blocked.has(index))).map((review) => review.id)]);
  const round = repository.getRefinedTranslationChapter(task.id, chapterId)?.reviewRound ?? 0;
  for (const segment of rows.filter((row) => !finalized.has(row.paragraphIndex) && !blocked.has(row.paragraphIndex) && constraints.some((constraint) => constraint.paragraphIndices.includes(row.paragraphIndex)))) {
    signal.throwIfAborted();
    const applicable = constraints.filter((constraint) => constraint.paragraphIndices.includes(segment.paragraphIndex));
    const ids = [...new Set(applicable.map((constraint) => constraint.reviewId))];
    // A conflict on any opinion for this paragraph blocks the paragraph as a whole.
    if (reviews.some((review) => manual.has(review.id) && review.paragraphIndices.includes(segment.paragraphIndex))) { ids.forEach((id) => failed.add(id)); continue; }
    const route = segmentRoute(segment.paragraphIndex);
    if (!route) { ids.forEach((id) => failed.add(id)); continue; }
    const signature = fingerprint({ round, epoch: repository.getParagraphRevisionState(task.id, segment.id).epoch, source: segment.sourceText, glossary, reviews: reviews.filter((review) => ids.includes(review.id)), route, languages: [task.sourceLang, task.targetLang] });
    const previous = repository.listRefinedRevisions(task.id, chapterId).reverse().find((record) => record.paragraphIndex === segment.paragraphIndex && record.fingerprint === signature && record.after === segment.translatedText && ['revised', 'verified'].includes(record.status));
    if (previous) { records.push(previous); continue; }
    const context = rows.filter((row) => row.paragraphIndex < segment.paragraphIndex).slice(-2).map((row) => ({ sourceText: row.sourceText, ...(row.translatedText ? { translatedText: row.translatedText } : {}) }));
    const isIndex = refinedModelFormat(preferences, route) === 'bilibili-index-translate';
    const references = [{ kind: 'soft' as const, text: `旧译文仅作修订参考，不是待译正文：${segment.translatedText ?? '（空）'}。以最小必要修改为目标。` }, ...applicable];
    const prompt = buildIndexTranslatePrompt([{ sourceText: segment.sourceText }], { sourceLang: task.sourceLang, targetLang: task.targetLang, glossary, previousParagraphs: context, constraints: references });
    const revisionSystem = isIndex ? '' : '根据已判定的审核约束修订当前段，只输出完整段落译文。禁止修改章节标题、其他段落或术语表。';
    const record: RefinedRevisionRecord = { id: crypto.randomUUID(), taskId: task.id, chapterId, paragraphIndex: segment.paragraphIndex, round, fingerprint: signature, reviewIds: ids, constraints: applicable, model: { providerId: route.providerId, modelId: route.modelId }, before: segment.translatedText ?? '', after: null, prompt, status: 'prepared', verification: [], error: null };
    repository.saveRefinedRevision(record);
    try {
      assertCurrentMaterials(segment.id, segment.sourceText, segment.translatedText);
      checkBudget(preferences, route, revisionSystem, prompt);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          signal.throwIfAborted();
          const output = validateRevisionText(await generate(preferences, isIndex ? { ...route, thinkingEnabled: false } : route, revisionSystem, prompt, signal), segment.sourceText);
          signal.throwIfAborted();
          if (hasTranslationGlossaryEcho(output, segment.sourceText, glossary)) throw new Error('修订模型回显术语表。');
          assertCurrentMaterials(segment.id, segment.sourceText, segment.translatedText);
          record.after = output; record.status = 'revised';
          repository.applyRefinedRevision(record);
          records.push(record); break;
        } catch (error) { if (signal.aborted || error instanceof StaleRevisionMaterialsError || attempt === 2) throw error; }
      }
    } catch (error) {
      record.status = signal.aborted ? 'cancelled' : 'failed'; record.error = errorMessage(error); repository.saveRefinedRevision(record);
      ids.forEach((id) => failed.add(id));
      if (signal.aborted) return { processed: records.length, unresolved: reviews.length };
    }
  }
  for (const decision of plan.decisions.filter((item) => ['accepted', 'partially_accepted'].includes(item.decision))) {
    const review = reviews.find((item) => item.id === decision.reviewId)!;
    const related = records.filter((record) => record.reviewIds.includes(review.id));
    if (failed.has(review.id) || review.paragraphIndices.some((index) => !finalized.has(index) && !related.some((record) => record.paragraphIndex === index))) {
      repository.updateRefinedTranslationReview(task.id, review.id, 'open', '部分关联段落未完成有效修订，保留原译文及执行记录，待人工处理。', false); failed.add(review.id); continue;
    }
    try {
      signal.throwIfAborted();
      const verificationSystem = '修订结果复审：检查该意见的全部关联段落是否解决问题；生成了译文不等于问题解决。只返回 JSON {"resolved":true或false,"reason":"复审依据"}。';
      const verificationRows = repository.listRefinedTranslationSegments(task.id, chapterId).filter((row) => review.paragraphIndices.includes(row.paragraphIndex));
      const verificationPrompt = JSON.stringify({ review, paragraphs: verificationRows, revisions: related });
      checkBudget(preferences, chat, verificationSystem, verificationPrompt);
      const verification = verificationSchema.parse(parseJson(await generate(preferences, chat, verificationSystem, verificationPrompt, signal)));
      signal.throwIfAborted();
      for (const row of verificationRows) assertCurrentMaterials(row.id, row.sourceText, row.translatedText);
      for (const record of related) {
        record.verification = [...record.verification.filter((item) => item.reviewId !== review.id), { reviewId: review.id, ...verification }];
        record.status = record.reviewIds.every((id) => record.verification.some((item) => item.reviewId === id)) ? 'verified' : 'revised';
        if (record.status === 'verified') {
          const segment = rows.find((row) => row.paragraphIndex === record.paragraphIndex)!;
          const state = repository.getParagraphRevisionState(task.id, segment.id);
          repository.completeParagraphRevisionCycle(record, segment.id, `${state.epoch}:${round}`);
        } else repository.saveRefinedRevision(record);
      }
      repository.updateRefinedTranslationReview(task.id, review.id, decision.decision as 'accepted' | 'partially_accepted', `${decision.reason}；复审${verification.resolved ? '通过' : '未通过'}：${verification.reason}`, verification.resolved);
    } catch (error) {
      if (signal.aborted) return { processed: records.length, unresolved: reviews.length };
      failed.add(review.id); repository.updateRefinedTranslationReview(task.id, review.id, 'open', `复审失败：${errorMessage(error)}`, false);
    }
  }
  return { processed: plan.decisions.length - failed.size, unresolved: failed.size };
}
