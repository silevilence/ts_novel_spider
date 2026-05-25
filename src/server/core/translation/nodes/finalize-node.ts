import type { TranslationPipelineState } from '../../translation-state';
import type { SqliteNovelRepository } from '../../novel-repository';

/**
 * 最终化节点：将翻译结果持久化到 SQLite。
 *
 * 写入：
 * - chapter_translations（章节翻译汇总记录）
 * - chapter_translation_paragraphs（段落级原文-译文绑定）
 *
 * 注意：审校（QA）功能暂未启用，预留给将来的多 Agent 翻译架构。
 */
export async function finalizeNode(
  state: TranslationPipelineState,
  repository: SqliteNovelRepository,
): Promise<Partial<TranslationPipelineState>> {
  // 如果已被暂停或取消，不持久化（保留草稿供恢复）
  if (state.pauseRequested) {
    console.log(`[translation] finalizeNode: 翻译已暂停，跳过持久化`);
    return {};
  }

  if (state.finalParagraphs.length === 0 && state.draftParagraphs.length > 0) {
    // 有草稿但未组装——先尝试组装
    return state;
  }

  const paragraphs = state.finalParagraphs.length > 0 ? state.finalParagraphs : state.draftParagraphs;

  if (paragraphs.length === 0) {
    return { errorMessage: '无翻译结果可保存。' };
  }

  const hasValidTranslations = paragraphs.some((p) => p.translatedText && p.translatedText.trim().length > 0);

  if (!hasValidTranslations) {
    return { errorMessage: '所有段落译文均为空，无法保存。' };
  }

  try {
    // 状态判定：只要有任何段落译文有效就视为成功，缺失部分记入日志
    const status = hasValidTranslations ? 'completed' as const : 'failed' as const;
    const totalParagraphs = paragraphs.length;
    const validCount = paragraphs.filter((p) => p.translatedText && p.translatedText.trim().length > 0).length;
    const partialNote = validCount < totalParagraphs ? ` (${validCount}/${totalParagraphs} 段有效)` : '';
    console.log(`[translation] finalizeNode: saving chapter ${state.chapterId} with status=${status}, paragraphs=${paragraphs.length}, valid=${validCount}${partialNote}${state.errorMessage ? ', warn: ' + state.errorMessage : ''}`);

    repository.saveChapterTranslation({
      sourceId: state.sourceId,
      novelId: state.novelId,
      chapterId: state.chapterId,
      sourceLang: state.sourceLang,
      targetLang: state.targetLang,
      translatedTitle: state.translatedTitle,
      status,
      overallQualityScore: null,
      translatorModelId: state.translatorModelId,
      reviewerModelId: null,
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

    // 审校（QA）功能暂未启用——不写入 chapter_translation_qa 表

    return {};
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : '翻译结果保存失败。',
    };
  }
}
