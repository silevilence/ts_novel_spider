import type { TranslationLanguageCode, TranslationChapterStatus, TranslationBuildStage } from './novel-repository';

/** 翻译段（段落级切分结果） */
export interface TranslationSegment {
  id: string;
  paragraphIndex: number;
  sourceText: string;
}

/** 翻译结果（单个段落） */
export interface TranslatedSegment {
  segmentId: string;
  paragraphIndex: number;
  sourceText: string;
  translatedText: string;
  confidence: number;
  appliedTermIds: string[];
  modelId: string;
}

/** 术语条目（流水线内部使用） */
export interface TranslationTermEntry {
  id: string;
  sourceTerm: string;
  targetTerm: string | null;
  entityType: string | null;
  priority: number;
}

/** QC 审查反馈 */
export interface TranslationReviewIssue {
  type: 'fluency' | 'consistency' | 'terminology' | 'formatting';
  severity: 'low' | 'medium' | 'high';
  paragraphIndices: number[];
  suggestion: string;
}

/** QC 审查结果 */
export interface TranslationReviewResult {
  overallScore: number;
  fluencyScore: number;
  consistencyScore: number;
  terminologyScore: number;
  formattingScore: number;
  issues: TranslationReviewIssue[];
  requiresRework: boolean;
}

/** 段落级翻译草稿（初译输出） */
export interface ParagraphDraft {
  paragraphIndex: number;
  sourceText: string;
  translatedText: string;
  confidence: number;
  appliedTermIds: string[];
  modelId: string;
}

/** 单章翻译任务的输入 */
export interface TranslationChapterInput {
  sourceId: string;
  novelId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  sourceContent: string;
  sourceLang: TranslationLanguageCode;
  targetLang: TranslationLanguageCode;
  glossary: TranslationTermEntry[];
  sourceContentHash: string;
  glossaryVersion: number;
  profileVersion: number;
}

/** LangGraph 流水线状态 */
export interface TranslationPipelineState {
  // 输入
  sourceId: string;
  novelId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  sourceContent: string;
  sourceLang: TranslationLanguageCode;
  targetLang: TranslationLanguageCode;
  glossary: TranslationTermEntry[];

  // 阶段产物
  segments: TranslationSegment[];
  draftParagraphs: ParagraphDraft[];
  reviewResult: TranslationReviewResult | null;

  // 翻译结果
  translatedTitle: string | null;
  finalParagraphs: ParagraphDraft[];

  // 模型路由
  translatorModelId: string | null;
  reviewerModelId: string | null;

  // 元信息
  tokenUsageJson: string | null;
  sourceContentHash: string;
  glossaryVersion: number;
  profileVersion: number;

  // 控制
  retryCount: number;
  maxRetries: number;
  pauseRequested: boolean;
  errorMessage: string | null;
}


/** 流水线事件类型 */
export type TranslationPipelineEventType =
  | 'chapter_queued'
  | 'chapter_started'
  | 'segmenting_completed'
  | 'translating_started'
  | 'translating_progress'
  | 'translating_completed'
  | 'reviewing_started'
  | 'reviewing_completed'
  | 'rework_required'
  | 'assembling_completed'
  | 'chapter_completed'
  | 'chapter_failed'
  | 'chapter_paused';

/** 流水线事件 */
export interface TranslationPipelineEvent {
  type: TranslationPipelineEventType;
  sourceId: string;
  novelId: string;
  chapterId: string;
  chapterIndex: number;
  stage: TranslationChapterStatus;
  progress?: {
    completed: number;
    total: number;
  };
  reviewResult?: TranslationReviewResult;
  errorMessage?: string;
  timestamp: string;
}

/** 构建日志条目 */
export interface TranslationBuildLogEntry {
  stage: TranslationBuildStage;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** 翻译模型统计 */
export interface TranslationModelStat {
  providerId: string;
  modelId: string;
  source: 'global' | 'novel';
  maxConcurrency: number;
  attemptCount: number;
  successCount: number;
  failureCount: number;
  totalTokensUsed: number;
  avgLatencyMs: number;
}
