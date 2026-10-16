import type { TranslationBackgroundParagraph, TranslationTermEntry } from '../../translation-state';
import { translationBackground, translationLanguageName, translationSourceText, translationTermLines, hasUnexpectedPromptMarker, type TranslationPromptEcho } from './translation-prompt-materials';

/** Index 自己维护硬/软约束标记，分别识别术语、背景和模板区块回显。 */
export function detectIndexTranslatePromptEcho(response: string, source: string): TranslationPromptEcho {
  return {
    glossary: hasUnexpectedPromptMarker(response, source, ['专名/术语对照:']),
    background: hasUnexpectedPromptMarker(response, source, ['【注意】']),
    template: hasUnexpectedPromptMarker(response, source, ['【源文】', '【约束要求】', '【硬性要求】']),
  };
}

/** Index 模板的语言和可选材料；通过具名字段避免源/目标语言与参考材料错位。 */
export interface IndexTranslatePromptOptions {
  sourceLang: string;
  targetLang: string;
  glossary: TranslationTermEntry[];
  previousParagraphs: TranslationBackgroundParagraph[];
}

/** Index-Translate 官方 trans_prompt 的默认/instTrans 结构；背景是项目软约束。
 * https://github.com/bilibili/Index-Translate/blob/main/inference/llm/translate.py
 */
export function buildIndexTranslatePrompt(
  batch: Array<{ sourceText: string }>, options: IndexTranslatePromptOptions,
): string {
  const { sourceLang, targetLang, glossary, previousParagraphs } = options;
  const source = !sourceLang || sourceLang.toLowerCase() === 'auto' ? '' : translationLanguageName(sourceLang);
  const target = translationLanguageName(targetLang);
  const text = translationSourceText(batch);
  const terms = translationTermLines(batch, glossary, '→');
  const background = translationBackground(previousParagraphs);
  const constraints: string[] = [];
  if (terms.length) constraints.push(`【硬性要求】专名/术语对照: ${terms.join('、')}`);
  if (batch.length > 1) constraints.push('【硬性要求】每段前的【数字编号】要求原样保留');
  if (background) constraints.push(`【注意】以下为上下文背景，仅用于理解当前源文，不要翻译或复述背景：${background}`);
  if (!constraints.length) return `请将以下${source}文本翻译为${target}，直接输出翻译结果，不要进行任何解释。\n\n${text}`;
  return `请将以下${source}文本翻译成${target}，并且严格遵循所有约束要求。\n\n【源文】\n${text}\n\n【约束要求】\n${constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n只输出译文，不要有任何额外说明。`;
}
