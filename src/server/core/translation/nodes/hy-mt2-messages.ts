import type { TranslationTermEntry, TranslationBackgroundParagraph } from '../../translation-state';
import { translationLanguageName, translationTermLines, translationBackground, translationSourceText, hasUnexpectedPromptMarker, type TranslationPromptEcho } from './translation-prompt-materials';

/** HY-MT2 自己维护模板标记；不把其他翻译格式的区块当作本格式提示词。 */
export function detectHyMt2PromptEcho(response: string, source: string): TranslationPromptEcho {
  return {
    glossary: hasUnexpectedPromptMarker(response, source, ['参考下面的翻译：']),
    background: hasUnexpectedPromptMarker(response, source, ['〖背景信息〗', '【背景信息】']),
    template: hasUnexpectedPromptMarker(response, source, ['〖待翻译文本〗', '【待翻译文本】']),
  };
}

/** HY-MT2 只接收当前 user 消息；背景最多取同章前两段，绝不发送历史对话。 */
export function buildHyMt2Prompt(
  batch: Array<{ sourceText: string }>,
  targetLang: string,
  glossary: TranslationTermEntry[],
  previousParagraphs: TranslationBackgroundParagraph[],
): string {
  const languageName = translationLanguageName(targetLang);
  const terms = translationTermLines(batch, glossary, ' 翻译成 ');
  const background = translationBackground(previousParagraphs);
  if (terms.length && background) {
    return `参考下面的翻译：\n${terms.join('\n')}\n\n〖背景信息〗\n${background}\n\n请参考上述术语翻译并结合背景信息，将以下文本翻译为${languageName}，注意只需要输出翻译后的结果，不要额外解释：\n〖待翻译文本〗\n${translationSourceText(batch)}`;
  }
  const parts: string[] = [];
  if (terms.length) parts.push(`参考下面的翻译：\n${terms.join('\n')}`);
  if (background) {
    parts.push(`〖背景信息〗\n${background}`, `请结合背景信息将以下文本翻译为${languageName}。`, '〖待翻译文本〗');
  } else {
    parts.push(`将以下文本翻译为${languageName}，注意只需要输出翻译后的结果，不要额外解释：`);
  }
  parts.push(translationSourceText(batch));
  return parts.join('\n');
}
