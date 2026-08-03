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
  const paragraphs = splitChapterParagraphs(state.sourceContent);

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
export function splitChapterParagraphs(text: string): string[] {
  // GFM 表格必须作为一个翻译单元保留，不能按单行或长段规则拆开。
  const coarseParts = splitMarkdownBlocks(text);

  // 对过长的普通段进行二次切分（按单换行）。表格无论多长都保持完整。
  const result: string[] = [];
  for (const part of coarseParts) {
    if (!part.isTable && part.text.length > 2000) {
      const subParts = part.text.split(/\n/).filter((p) => p.trim().length > 0);
      result.push(...subParts);
    } else {
      result.push(part.text);
    }
  }

  return result.length > 0 ? result : [text.trim()].filter((p) => p.length > 0);
}

function splitMarkdownBlocks(text: string): Array<{ text: string; isTable: boolean }> {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ text: part, isTable: isGfmTable(part) }));
}

function isGfmTable(block: string): boolean {
  const lines = block.split('\n');
  return lines.length >= 2
    && /\|/.test(lines[0] ?? '')
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[1] ?? '');
}
