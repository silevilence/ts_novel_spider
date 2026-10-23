export interface TermChange {
  id: string; sourceId: string; novelId: string; termId: string; sourceTerm: string;
  before: string | null; after: string | null; createdAt: string;
}
export interface TermCorrectionTarget {
  id: string; chapterId: string; title: string; paragraphIndex: number | null;
  sourceText: string; before: string; suggestion: string | null;
  classification: 'replace' | 'review' | 'aligned'; reason: string;
  materialKey: string; appliedKey?: string; applied?: boolean; reverted?: boolean;
}
export interface TermCorrection {
  id: string; sourceId: string; novelId: string; changeId: string; termId: string; termKey: string;
  oldTerm: string; newTerm: string; sourceLang: string; targetLang: string;
  createdAt: string; updatedAt: string; targets: TermCorrectionTarget[];
}
