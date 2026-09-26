import type { ParagraphDraft, TranslationSegment, TranslationTermEntry } from '../../translation-state';
import { isGfmTable } from './segment-node';

// 留出术语、背景、模板和输出的空间；预算以 UTF-16 字符数计。
export const HY_MT2_TEXT_BUDGET = 1600;
const BACKGROUND_BUDGET = 800;
const GLOSSARY_BUDGET = 1600;
const LANGUAGE_NAMES = new Intl.DisplayNames(['zh-CN'], { type: 'language', fallback: 'none' });

/** 仅在请求层切分长段，段落索引保持不变，落库前重新合并。 */
export function batchHyMt2Segments(segments: TranslationSegment[], batchSize: number): TranslationSegment[][] {
  const batches: TranslationSegment[][] = [];
  let batch: TranslationSegment[] = [];
  let size = 0;
  for (const segment of segments) {
    // 表格必须整体翻译，不能通过硬切破坏 Markdown 结构。
    if (isGfmTable(segment.sourceText) && segment.sourceText.length > HY_MT2_TEXT_BUDGET) {
      throw new Error('HY-MT2 待译表格超过字符预算，请改用通用格式模型翻译此章节。');
    }
    let offset = 0;
    while (offset < segment.sourceText.length) {
      let end = Math.min(offset + HY_MT2_TEXT_BUDGET, segment.sourceText.length);
      // 不在代理对中间切分。
      if (end < segment.sourceText.length && /[\uD800-\uDBFF]/.test(segment.sourceText[end - 1]!)) end--;
      const piece = { ...segment, sourceText: segment.sourceText.slice(offset, end) };
      if (batch.length && (batch.length >= Math.max(1, batchSize) || size + piece.sourceText.length > HY_MT2_TEXT_BUDGET)) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(piece);
      size += piece.sourceText.length;
      offset = end;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** 按原始段落重组请求碎片；缺少任一碎片时不暴露残缺译文。 */
export function mergeHyMt2Drafts(segments: TranslationSegment[], drafts: ParagraphDraft[]): ParagraphDraft[] {
  const byParagraph = new Map<number, ParagraphDraft[]>();
  for (const draft of drafts) {
    const pieces = byParagraph.get(draft.paragraphIndex) ?? [];
    pieces.push(draft);
    byParagraph.set(draft.paragraphIndex, pieces);
  }
  return segments.flatMap((segment) => {
    const pieces = byParagraph.get(segment.paragraphIndex) ?? [];
    if (!pieces.length || pieces.map((piece) => piece.sourceText).join('') !== segment.sourceText) return [];
    const complete = pieces.every((piece) => piece.translatedText.trim());
    return [{
      ...pieces[0]!,
      sourceText: segment.sourceText,
      translatedText: complete ? pieces.map((piece) => piece.translatedText).join('') : '',
      confidence: complete ? Math.min(...pieces.map((piece) => piece.confidence)) : 0,
      appliedTermIds: [...new Set(pieces.flatMap((piece) => piece.appliedTermIds))],
    }];
  });
}

/** HY-MT2 只接收当前 user 消息；背景最多取同章前两段，绝不发送历史对话。 */
export function buildHyMt2Prompt(
  batch: Array<{ sourceText: string }>,
  targetLang: string,
  glossary: TranslationTermEntry[],
  previousParagraphs: ParagraphDraft[],
): string {
  const languageNames: Record<string, string> = { ja: '日语', 'zh-CN': '简体中文', 'zh-TW': '繁体中文', en: '英语', ko: '韩语' };
  let languageName = languageNames[targetLang];
  if (!languageName) {
    try { languageName = LANGUAGE_NAMES.of(targetLang); } catch { /* 自定义语言名不是 BCP 47 标签。 */ }
    if (!languageName && /\p{Script=Han}/u.test(targetLang)) languageName = targetLang;
  }
  if (!languageName) throw new Error(`HY-MT2 不支持目标语言：${targetLang}`);
  const parts = [`将以下文本翻译为${languageName}，注意只需要输出翻译后的结果，不要额外解释：`];
  const source = batch.map((segment) => segment.sourceText).join('\n');
  const terms: string[] = [];
  let termSize = 0;
  for (const term of [...glossary].sort((a, b) => Number(source.includes(b.sourceTerm)) - Number(source.includes(a.sourceTerm)) || b.priority - a.priority)) {
    if (!term.targetTerm) continue;
    const line = `${term.sourceTerm} → ${term.targetTerm}`;
    if (termSize + line.length + 1 > GLOSSARY_BUDGET) continue;
    terms.push(line);
    termSize += line.length + 1;
  }
  if (terms.length) {
    parts.push(`参考下面的翻译：\n${terms.join('\n')}`);
    const background = previousParagraphs.slice(-2).map((p) => p.translatedText || p.sourceText).join('\n').slice(-BACKGROUND_BUDGET);
    if (background) parts.push(`【背景信息】\n${background}`);
  }
  if (batch.length > 1) parts.push('请在译文中保留【1】【2】等编号，逐段对应，不要合并段落。');
  const text = batch.length === 1 ? batch[0]!.sourceText : batch.map((segment, index) => `【${index + 1}】${segment.sourceText}`).join('\n\n');
  parts.push(terms.length ? `【待翻译文本】\n${text}` : text);
  return parts.join('\n\n');
}
