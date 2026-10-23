import { z } from 'zod';

export const processingSettingsSchema = z.object({
  extractTerms: z.boolean(), translate: z.boolean(), candidatePolicy: z.enum(['manual', 'automatic']),
});
export type ProcessingSettings = z.infer<typeof processingSettingsSchema>;
export const defaultProcessingSettings: ProcessingSettings = { extractTerms: false, translate: false, candidatePolicy: 'manual' };
export type ProcessingStage = 'extraction' | 'confirmation' | 'terms' | 'translation' | 'completed';
export interface ProcessingJob {
  id: string; sourceId: string; novelId: string; origin: 'scheduled' | 'capture' | 'refetch';
  chapterHashes: Record<string, string>; settings: ProcessingSettings;
  status: 'queued' | 'running' | 'waiting' | 'paused' | 'cancelled' | 'failed' | 'completed';
  stage: ProcessingStage; message: string; createdAt: string; updatedAt: string;
  candidateIds: string[]; extractionRunId: string | null; termRunId: string | null; translationStartedAt: string | null;
  retryRequested?: boolean;
  languageKey?: string;
}
export const processingStageLabels: Record<ProcessingStage, string> = { extraction: '提取术语', confirmation: '确认候选', terms: '翻译术语', translation: '翻译章节', completed: '处理完成' };
