import type { TranslationPipelineState, TranslationSegment } from '../../translation-state';

/**
 * 分段节点：将章节正文按段落标记切分为段落列表。
 *
 * 策略：
 * - 优先按连续两个换行符切分（标准段落分隔）。
 * - 单段过长时按单换行符切分。
 * - 过滤空白段，保留原文顺序。
 */
export async function segmentNode(state: TranslationPipelineState): Promise<Partial<TranslationPipelineState>> {
  const paragraphs = splitParagraphs(state.sourceContent);

  if (paragraphs.length === 0) {
    return {
      errorMessage: '章节正文为空，无法分段。',
    };
  }

  const segments: TranslationSegment[] = paragraphs.map((text, index) => ({
    id: `${state.chapterId}-p${String(index + 1).padStart(4, '0')}`,
    paragraphIndex: index,
    sourceText: text.trim(),
  }));

  console.log(`[translation] 分段完成: ${segments.length} 个段落`);
  return { segments };
}

/** 按标准小说段落分隔符切分 */
function splitParagraphs(text: string): string[] {
  // 优先按双换行切分
  const coarseParts = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  // 对过长的段进行二次切分（按单换行）
  const result: string[] = [];
  for (const part of coarseParts) {
    if (part.length > 2000) {
      const subParts = part.split(/\n/).filter((p) => p.trim().length > 0);
      result.push(...subParts);
    } else {
      result.push(part);
    }
  }

  return result.length > 0 ? result : [text.trim()].filter((p) => p.length > 0);
}
