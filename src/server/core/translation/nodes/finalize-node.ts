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

  const allParagraphs = state.finalParagraphs.length > 0 ? state.finalParagraphs : state.draftParagraphs;

  if (allParagraphs.length === 0) {
    return { errorMessage: '无翻译结果可保存。' };
  }

  // 按 paragraphIndex 排序，确保首段即为标题段
  const sortedParagraphs = [...allParagraphs].sort((a, b) => a.paragraphIndex - b.paragraphIndex);

  // 从首段提取标题译文（仅对 chapter / meta / volume 单元有效）
  let translatedTitle = state.translatedTitle;
  let bodyParagraphs = sortedParagraphs;
  if (state.unitKind === 'chapter' || state.unitKind === 'meta' || state.unitKind === 'volume') {
    const firstSegmentSource = state.segments[0]?.sourceText ?? '';
    if (sortedParagraphs.length > 0 && !translatedTitle) {
      translatedTitle = sortedParagraphs[0]!.translatedText;
      bodyParagraphs = sortedParagraphs.slice(1);
    }
  }

  // 检查是否需要保存正文段落（volume 单元可能只有标题无需段落）
  const hasBodyParagraphs = bodyParagraphs.length > 0;
  const hasValidTranslations = bodyParagraphs.some((p) => p.translatedText && p.translatedText.trim().length > 0)
    || (translatedTitle !== null && translatedTitle.trim().length > 0);

  if (!hasValidTranslations) {
    return { errorMessage: '所有翻译结果均为空，无法保存。' };
  }

  try {
    const status = hasValidTranslations ? 'completed' as const : 'failed' as const;
    const totalParagraphs = sortedParagraphs.length;
    const validCount = sortedParagraphs.filter((p) => p.translatedText && p.translatedText.trim().length > 0).length;
    const partialNote = validCount < totalParagraphs ? ` (${validCount}/${totalParagraphs} 段有效)` : '';
    console.log(`[translation] finalizeNode: saving chapter ${state.chapterId} (unitKind=${state.unitKind}) with status=${status}, paragraphs=${sortedParagraphs.length}, body=${bodyParagraphs.length}, valid=${validCount}${partialNote}${state.errorMessage ? ', warn: ' + state.errorMessage : ''}`);

    repository.saveChapterTranslation({
      sourceId: state.sourceId,
      novelId: state.novelId,
      chapterId: state.chapterId,
      sourceLang: state.sourceLang,
      targetLang: state.targetLang,
      translatedTitle,
      status,
      overallQualityScore: null,
      translatorModelId: state.translatorModelId,
      reviewerModelId: null,
      tokenUsageJson: state.tokenUsageJson,
      sourceContentHash: state.sourceContentHash,
      glossaryVersion: state.glossaryVersion,
      profileVersion: state.profileVersion,
    });

    // 批量替换段落翻译（仅保存正文段落）
    if (hasBodyParagraphs) {
      repository.replaceChapterTranslationParagraphs(
        state.sourceId,
        state.novelId,
        state.chapterId,
        bodyParagraphs.map((p) => ({
          paragraphIndex: p.paragraphIndex,
          sourceText: p.sourceText,
          translatedText: p.translatedText,
          confidence: p.confidence,
          appliedTermIds: p.appliedTermIds,
          modelId: p.modelId,
        })),
      );
    } else {
      // 仅标题无正文的单元（如 volume），仍需清空旧段落
      repository.replaceChapterTranslationParagraphs(
        state.sourceId,
        state.novelId,
        state.chapterId,
        [],
      );
    }

    // 审校（QA）功能暂未启用——不写入 chapter_translation_qa 表

    return {};
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : '翻译结果保存失败。',
    };
  }
}
