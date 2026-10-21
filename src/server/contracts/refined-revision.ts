export interface RevisionConstraint {
  reviewId: string;
  kind: 'hard' | 'soft';
  text: string;
  paragraphIndices: number[];
}

export interface RefinedRevisionRecord {
  kind?: 'revision' | 'finalization';
  id: string;
  taskId: string;
  chapterId: string;
  paragraphIndex: number;
  round: number;
  fingerprint: string;
  reviewIds: string[];
  constraints: RevisionConstraint[];
  model: { providerId: string; modelId: string };
  before: string;
  after: string | null;
  prompt: string;
  status: 'prepared' | 'revised' | 'verified' | 'failed' | 'cancelled';
  verification: Array<{ reviewId: string; resolved: boolean; reason: string }>;
  error: string | null;
}
