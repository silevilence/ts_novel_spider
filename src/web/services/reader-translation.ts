import type { ChapterTranslationPayload, TranslationExportMode } from './api';

/** 为阅读器组合草稿、已保存译文和缺译原文；不依赖整章完成状态。 */
export function buildChapterTranslationView(
  original: { title: string; content: string },
  translation: ChapterTranslationPayload | null,
  mode: TranslationExportMode,
): { title: string; content: string; notice: string | null } {
  if (mode === 'original') return { ...original, notice: null };
  if (!translation) return { ...original, notice: '本章暂无可用译文，当前显示原文。' };

  const content = translation.paragraphs.map((paragraph) => {
    if (!paragraph.translatedText?.trim()) return `**待译（原文）**\n\n${paragraph.sourceText}`;
    const translated = stripNumberPrefix(paragraph.sourceText, paragraph.translatedText);
    return mode === 'bilingual' && translated !== paragraph.sourceText
      ? `${paragraph.sourceText}\n\n${translated}` : translated;
  }).join('\n\n') || original.content;
  const summary = translation.readingSummary;
  const pending = summary.totalParagraphs - summary.translatedParagraphs;
  const notice = translation.status !== 'completed' || pending > 0
    ? `本章翻译尚未完成：正文已译 ${summary.translatedParagraphs}/${summary.totalParagraphs} 段。`
      + (summary.draftParagraphs ? `已显示 ${summary.draftParagraphs} 段成功草稿。` : '')
      + (summary.retainedParagraphs ? `保留 ${summary.retainedParagraphs} 段已有译文。` : '')
      + (pending > 0 ? '待译段落以原文显示。' : '')
    : null;
  const title = translation.translatedTitle
    ? mode === 'bilingual' ? `${original.title}【${translation.translatedTitle}】` : translation.translatedTitle
    : original.title;
  return { title, content, notice };
}

/** 原文自带的序号属于正文，只清理模型额外添加的编号。 */
function stripNumberPrefix(sourceText: string, translatedText: string): string {
  const pattern = /^\s*(?:\d+[\.\、\)]\s*|段落\d+[：:]\s*|【\d+】\s*)/;
  const trimmed = translatedText.trim();
  return pattern.test(sourceText.trim()) ? trimmed : trimmed.replace(pattern, '').trim();
}
