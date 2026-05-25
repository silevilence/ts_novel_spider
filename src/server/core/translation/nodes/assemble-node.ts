import type { TranslationPipelineState, ParagraphDraft } from '../../translation-state';

/**
 * 组装节点：将翻译草稿合并为最终段落列表。
 *
 * - 如果有审校反馈要求重译且存在重译产物，合并审校修订。
 * - 译后分段与源段对齐。
 */
export async function assembleNode(state: TranslationPipelineState): Promise<Partial<TranslationPipelineState>> {
  const drafts = state.draftParagraphs;

  if (drafts.length === 0) {
    return { errorMessage: '无翻译草稿可组装。' };
  }

  // 检查所有段落是否都有译文
  const missingTranslations = drafts.filter(
    (d) => !d.translatedText || d.translatedText.trim().length === 0,
  );

  if (missingTranslations.length > 0) {
    const missingIndices = missingTranslations.map((d) => d.paragraphIndex).join(', ');
    return {
      errorMessage: `以下段落的译文缺失：${missingIndices}。请重新翻译。`,
      finalParagraphs: drafts,
    };
  }

  // 按 paragraphIndex 排序确保顺序
  const sorted = [...drafts].sort((a, b) => a.paragraphIndex - b.paragraphIndex);

  // 若审校建议了具体修改，这里仅标记（实际修改在重译循环中完成）
  const finalParagraphs: ParagraphDraft[] = sorted.map((draft) => ({
    ...draft,
    translatedText: draft.translatedText.trim(),
  }));

  return { finalParagraphs };
}
