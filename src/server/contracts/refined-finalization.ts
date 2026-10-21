export interface ParagraphRevisionState {
  count: number;
  epoch: number;
  lastCycle: string | null;
  status: 'none' | 'finalized' | 'failed';
  finalization: {
    model: { providerId: string; modelId: string };
    triggerCount: number;
    reason: string;
    before: string;
    after: string | null;
    reviewIds: string[];
    prompt: string;
  } | null;
}

export function defaultParagraphRevisionState(): ParagraphRevisionState {
  return { count: 0, epoch: 0, lastCycle: null, status: 'none', finalization: null };
}

/** Legacy tasks keep their chapter cap and receive a bounded effective paragraph limit. */
export function paragraphRevisionLimit(value: unknown, maxReviewRounds = 5): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20 ? value : Math.max(1, Math.min(3, maxReviewRounds - 2));
}

/** Shared form/API validation; leave one round to observe failure and hand off to the reviewer. */
export function revisionLimitsError(limit: number, rounds: number): string | null {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return '同一段最多自动修订次数须为 1–20 的整数。';
  if (!Number.isInteger(rounds) || rounds < limit + 2 || rounds > 100) return `章节最大审核轮次须为 ${limit + 2}–100，才能触发段落定稿。`;
  return null;
}
