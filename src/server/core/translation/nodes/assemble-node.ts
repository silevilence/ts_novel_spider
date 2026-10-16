import type { TranslationPipelineState, ParagraphDraft } from '../../translation-state';

/**
 * 组装节点：将翻译草稿合并为最终段落列表。
 *
 * - 按 paragraphIndex 排序确保顺序。
 * - 检查缺失译文并报告。
 */
export async function assembleNode(state: TranslationPipelineState): Promise<Partial<TranslationPipelineState>> {
  if (state.errorMessage) return {};
  // 如果已被暂停或取消，直接透传
  if (state.pauseRequested) {
    return { finalParagraphs: state.draftParagraphs };
  }

  const drafts = state.draftParagraphs;

  if (drafts.length === 0) {
    return { errorMessage: '无翻译草稿可组装。' };
  }

  // 缺失译文必须阻止保存，避免覆盖已有有效结果。
  const missingTranslations = drafts.filter(
    (d) => !d.translatedText || d.translatedText.trim().length === 0,
  );

  if (missingTranslations.length > 0) {
    const missingIndices = missingTranslations.map((d) => d.paragraphIndex).join(', ');
    return { errorMessage: `译文缺失 (索引: ${missingIndices})，不保存失败单元。` };
  }

  // 按 paragraphIndex 排序确保顺序
  const sorted = [...drafts].sort((a, b) => a.paragraphIndex - b.paragraphIndex);

  const finalParagraphs: ParagraphDraft[] = sorted.map((draft) => ({
    ...draft,
    translatedText: draft.translatedText.trim(),
  }));

  return { finalParagraphs };
}
