import type { TranslationPipelineState } from '../../translation-state';
import type { SqliteNovelRepository } from '../../novel-repository';

/**
 * 最终化节点：将翻译结果持久化到 SQLite。
 *
 * 写入：
 * - chapter_translations（章节翻译汇总记录）
 * - chapter_translation_paragraphs（段落级原文-译文绑定）
 * - chapter_translation_qa（质量审查记录）
 */
export async function finalizeNode(
  state: TranslationPipelineState,
  repository: SqliteNovelRepository,
): Promise<Partial<TranslationPipelineState>> {
  if (state.finalParagraphs.length === 0 && state.draftParagraphs.length > 0) {
    // 有草稿但未组装——先尝试组装
    return state;
  }

  const paragraphs = state.finalParagraphs.length > 0 ? state.finalParagraphs : state.draftParagraphs;

  if (paragraphs.length === 0) {
    return { errorMessage: '无翻译结果可保存。' };
  }

  // 计算综合质量分
  const overallQualityScore = state.reviewResult?.overallScore ?? null;
  const hasValidTranslations = paragraphs.some((p) => p.translatedText && p.translatedText.trim().length > 0);

  if (!hasValidTranslations) {
    return { errorMessage: '所有段落译文均为空，无法保存。' };
  }

  try {
    const status = state.errorMessage ? 'failed' as const : 'completed' as const;
    console.log(`[translation] finalizeNode: saving chapter ${state.chapterId} with status=${status}, paragraphs=${paragraphs.length}, errorMessage=${state.errorMessage ?? 'null'}`);

    repository.saveChapterTranslation({
      sourceId: state.sourceId,
      novelId: state.novelId,
      chapterId: state.chapterId,
      sourceLang: state.sourceLang,
      targetLang: state.targetLang,
      translatedTitle: state.translatedTitle,
      status,
      overallQualityScore,
      translatorModelId: state.translatorModelId,
      reviewerModelId: state.reviewerModelId,
      tokenUsageJson: state.tokenUsageJson,
      sourceContentHash: state.sourceContentHash,
      glossaryVersion: state.glossaryVersion,
      profileVersion: state.profileVersion,
    });

    // 批量替换段落翻译
    repository.replaceChapterTranslationParagraphs(
      state.sourceId,
      state.novelId,
      state.chapterId,
      paragraphs.map((p) => ({
        paragraphIndex: p.paragraphIndex,
        sourceText: p.sourceText,
        translatedText: p.translatedText,
        confidence: p.confidence,
        appliedTermIds: p.appliedTermIds,
        modelId: p.modelId,
      })),
    );

    // 保存 QA 记录
    if (state.reviewResult && state.reviewResult.issues.length > 0) {
      repository.replaceChapterTranslationQa(
        state.sourceId,
        state.novelId,
        state.chapterId,
        state.reviewResult.issues.map((issue) => ({
          checkType: issue.type,
          score: 0,
          severity: issue.severity,
          suggestion: issue.suggestion,
          paragraphIndices: issue.paragraphIndices,
        })),
      );
    }

    return {};
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : '翻译结果保存失败。',
    };
  }
}
