import type { ParagraphDraft, TranslationSegment, TranslationTermEntry, TranslationBackgroundParagraph } from '../../translation-state';
import { isGfmTable } from './segment-node';

// 留出术语、背景、模板和输出的空间；预算以 UTF-16 字符数计。
export const TRANSLATION_TEXT_BUDGET = 1600;
const BACKGROUND_BUDGET = 800;
const GLOSSARY_BUDGET = 1600;
const LANGUAGE_NAMES = new Intl.DisplayNames(['zh-CN'], { type: 'language', fallback: 'none' });

/** 区分被回显的材料；重试只移除对应材料，模板标记回显不推断材料失效。 */
export interface TranslationPromptEcho {
  glossary: boolean;
  background: boolean;
  template: boolean;
}

/** 原文自身包含的标记属于正文，不当作提示词泄露。 */
export function hasUnexpectedPromptMarker(response: string, source: string, markers: readonly string[]): boolean {
  return markers.some((marker) => response.includes(marker) && !source.includes(marker));
}

/** 只按当前待译原文筛选术语，不让历史/背景中的词占用提示词预算。 */
export function selectTranslationTerms(batch: Array<{ sourceText: string }>, glossary: TranslationTermEntry[]): TranslationTermEntry[] {
  return glossary.filter((term) => term.sourceTerm.trim() && term.targetTerm?.trim()
    && batch.some((segment) => segment.sourceText.includes(term.sourceTerm)));
}

/** 拒绝未带区块标题的背景复述；原文自身重复同一句时允许其译文重复。 */
export function hasTranslationBackgroundEcho(response: string, batch: Array<{ sourceText: string }>, previous: TranslationBackgroundParagraph[]): boolean {
  const normalize = (text: string) => text.normalize('NFKC').replace(/【\d+】/gu, '').replace(/\s+/gu, '');
  const output = normalize(response);
  const context = previous.slice(-2).filter((paragraph) => !batch.some((segment) => normalize(segment.sourceText) === normalize(paragraph.sourceText)));
  const texts = context.map((paragraph) => paragraph.translatedText || paragraph.sourceText);
  return [...texts, texts.join('\n').slice(-BACKGROUND_BUDGET)]
    .some((text) => normalize(text).length >= 12 && normalize(text) === output);
}

/** 识别没有标题的术语回显，包括模型把术语左侧也翻译后的「译名 → 译名」。 */
export function hasTranslationGlossaryEcho(response: string, source: string, glossary: TranslationTermEntry[]): boolean {
  const compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').replace(/(?:[-=]+>|[⇒➜⟶]|翻译成)/gu, '→');
  const output = compact(response);
  if (!output.includes('→')) return false;
  const original = compact(source);
  return glossary.some((term) => {
    if (!term.sourceTerm.trim() || !term.targetTerm?.trim()) return false;
    const from = compact(term.sourceTerm);
    const to = compact(term.targetTerm);
    const pairs = [`${from}→${to}`, `${to}→${to}`];
    // 原文本来就在展示该映射/箭头时，译文中的箭头属于正文，不应拒绝。
    if (original.includes(`${from}→${from}`) || pairs.some((pair) => original.includes(pair))) return false;
    return pairs.some((pair) => output.includes(pair));
  });
}

/** 仅在请求层切分长段，段落索引保持不变，落库前重新合并。 */
export function batchTranslationSegments(segments: TranslationSegment[], batchSize: number): TranslationSegment[][] {
  const batches: TranslationSegment[][] = [];
  let batch: TranslationSegment[] = [];
  let size = 0;
  for (const segment of segments) {
    // 表格必须整体翻译，不能通过硬切破坏 Markdown 结构。
    if (isGfmTable(segment.sourceText) && segment.sourceText.length > TRANSLATION_TEXT_BUDGET) {
      throw new Error('专用翻译格式的待译表格超过字符预算，请改用通用格式模型翻译此章节。');
    }
    let offset = 0;
    while (offset < segment.sourceText.length) {
      let end = Math.min(offset + TRANSLATION_TEXT_BUDGET, segment.sourceText.length);
      // 不在代理对中间切分。
      if (end < segment.sourceText.length && /[\uD800-\uDBFF]/.test(segment.sourceText[end - 1]!)) end--;
      const piece = { ...segment, sourceText: segment.sourceText.slice(offset, end) };
      if (batch.length && (batch.length >= Math.max(1, batchSize) || size + piece.sourceText.length > TRANSLATION_TEXT_BUDGET)) {
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
export function mergeTranslationDrafts(segments: TranslationSegment[], drafts: ParagraphDraft[]): ParagraphDraft[] {
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

/** 使用完整语言名；未知代码不得原样进入专用翻译指令。 */
export function translationLanguageName(targetLang: string): string {
  const languageNames: Record<string, string> = { ja: '日语', 'zh-CN': '简体中文', 'zh-TW': '繁体中文', en: '英语', ko: '韩语' };
  let languageName = languageNames[targetLang];
  if (!languageName) {
    try { languageName = LANGUAGE_NAMES.of(targetLang); } catch { /* 自定义语言名不是 BCP 47 标签。 */ }
    if (!languageName && /\p{Script=Han}/u.test(targetLang)) languageName = targetLang;
  }
  if (!languageName) throw new Error(`不支持目标语言或源语言：${targetLang}`);
  return languageName;
}

/** 当前正文命中的有效术语按优先级分配预算。确认状态由服务层筛选。 */
export function translationTermLines(batch: Array<{ sourceText: string }>, glossary: TranslationTermEntry[], separator: string): string[] {
  const terms: string[] = [];
  let termSize = 0;
  for (const term of selectTranslationTerms(batch, glossary).sort((a, b) => b.priority - a.priority)) {
    if (!term.targetTerm) continue;
    const line = `${term.sourceTerm}${separator}${term.targetTerm}`;
    if (termSize + line.length + 1 > GLOSSARY_BUDGET) continue;
    terms.push(line);
    termSize += line.length + 1;
  }
  return terms;
}

/** 只取同章最近两段；缺少有效译文时用原文参考，不接收失败响应。 */
export function translationBackground(previousParagraphs: TranslationBackgroundParagraph[]): string {
  return previousParagraphs.slice(-2)
    .map((p) => p.translatedText?.trim() || p.sourceText.trim()).filter(Boolean).join('\n').slice(-BACKGROUND_BUDGET);
}

/** 单段不加内部编号，多段保留局部索引用于响应对齐。 */
export function translationSourceText(batch: Array<{ sourceText: string }>): string {
  return batch.length === 1 ? batch[0]!.sourceText : batch.map((segment, index) => `【${index + 1}】${segment.sourceText}`).join('\n\n');
}
