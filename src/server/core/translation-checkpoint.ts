import { z } from 'zod';
import type { SqliteNovelRepository } from './novel-repository';
import type { ParagraphDraft, TranslationPipelineState } from './translation-state';

const checkpointSchema = z.object({
  version: z.literal(1),
  sourceContent: z.string(), sourceLang: z.string(), targetLang: z.string(),
  glossaryKey: z.string(), modelKey: z.string(),
  drafts: z.array(z.object({
    paragraphIndex: z.number().int().nonnegative(), sourceText: z.string(), translatedText: z.string().trim().min(1),
    confidence: z.number(), appliedTermIds: z.array(z.string()), modelId: z.string(),
  })),
});

/** 仅恢复同一原文、语言对、术语和实际模型的有效整段草稿；损坏或旧版检查点忽略。 */
export function restoreTranslationDrafts(repository: SqliteNovelRepository, state: TranslationPipelineState, modelKey: string): ParagraphDraft[] {
  const saved = repository.getTranslationBuildCheckpoint(state.sourceId, state.novelId, state.chapterId);
  if (!saved || saved.stage === 'completed') return [];
  try {
    const checkpoint = checkpointSchema.parse(JSON.parse(saved.pipelineStateJson));
    if (checkpoint.sourceContent !== state.sourceContent || checkpoint.sourceLang !== state.sourceLang
      || checkpoint.targetLang !== state.targetLang || checkpoint.glossaryKey !== JSON.stringify(state.glossary)
      || checkpoint.modelKey !== modelKey) return [];
    return checkpoint.drafts;
  } catch { return []; }
}

/** 保存可恢复的成功草稿；失败摘要使用 warningMessage，不额外复制结构化错误。 */
export function saveTranslationDrafts(repository: SqliteNovelRepository, state: TranslationPipelineState, modelKey: string, options: { completed?: boolean } = {}): void {
  const completed = options.completed ?? false;
  repository.saveTranslationBuildCheckpoint({
    sourceId: state.sourceId, novelId: state.novelId, chapterId: state.chapterId, chapterIndex: state.chapterIndex,
    stage: completed ? 'completed' : state.errorMessage ? 'failed' : 'translating',
    warningMessage: state.errorMessage,
    pipelineStateJson: JSON.stringify({
      version: 1, sourceContent: state.sourceContent, sourceLang: state.sourceLang, targetLang: state.targetLang,
      glossaryKey: JSON.stringify(state.glossary), modelKey,
      drafts: completed ? [] : state.draftParagraphs.filter((draft) => draft.translatedText.trim()),
    }),
  });
}
