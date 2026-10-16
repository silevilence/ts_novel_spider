/**
 * 浏览器与服务端均可运行的共享契约，选项、校验和类型使用同一格式目录。
 * contracts 目录是跨端导入边界：不得依赖 Node.js、服务实现或持久化配置。
 * web 可运行时导入此目录；core/routes 的类型仍应通过 import type 引用。
 */
export const TRANSLATION_MESSAGE_FORMATS = [
  { value: 'general', label: '通用' },
  { value: 'hy-mt2', label: 'HY-MT2' },
  { value: 'bilibili-index-translate', label: 'Bilibili Index-Translate' },
] as const;

export type TranslationMessageFormat = typeof TRANSLATION_MESSAGE_FORMATS[number]['value'];

/** 校验 API 输入与持久化配置，不依赖提供商类型或模型名称。 */
export function isTranslationMessageFormat(value: unknown): value is TranslationMessageFormat {
  return TRANSLATION_MESSAGE_FORMATS.some((format) => format.value === value);
}

export function translationMessageFormatLabel(value: TranslationMessageFormat = 'general'): string {
  return TRANSLATION_MESSAGE_FORMATS.find((format) => format.value === value)!.label;
}
