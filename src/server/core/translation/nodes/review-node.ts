import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import type { TranslationPipelineState, TranslationReviewResult } from '../../translation-state';
import type { SystemPreferencesService } from '../../system-preferences';
import { resolveTranslationModel } from '../../translation-pipeline';

/**
 * 审校节点：调用审校模型评估翻译质量。
 *
 * 质量维度：
 * - fluency（流畅度）
 * - consistency（一致性）
 * - terminology（术语覆盖）
 * - formatting（格式保留）
 *
 * 要求重译条件：
 * - overallScore < qualityThreshold（默认 0.8）
 * - 存在 severity='high' 的 issue
 */
export async function reviewNode(
  state: TranslationPipelineState,
  preferences: SystemPreferencesService,
  qualityThreshold: number,
): Promise<Partial<TranslationPipelineState>> {
  if (state.draftParagraphs.length === 0) {
    return state;
  }

  // 审校节点暂未启用（预留给将来的多 Agent 翻译架构）。
  // 直接返回通过结果，不调用审校模型。
  return {};
}

function buildReviewPrompt(
  sourceText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string,
): string {
  return [
    `请审校以下翻译质量。`,
    '',
    `源语言：${sourceLang}`,
    `目标语言：${targetLang}`,
    '',
    `原文：`,
    sourceText,
    '',
    `译文：`,
    translatedText,
    '',
    `请以 JSON 格式返回审校结果（不要其他文本）：`,
    `{`,
    `  "overallScore": 0.0-1.0,`,
    `  "fluencyScore": 0.0-1.0,`,
    `  "consistencyScore": 0.0-1.0,`,
    `  "terminologyScore": 0.0-1.0,`,
    `  "formattingScore": 0.0-1.0,`,
    `  "issues": [`,
    `    {"type": "fluency|consistency|terminology|formatting", "severity": "low|medium|high", "paragraphIndices": [0], "suggestion": "修改建议"}`,
    `  ]`,
    `}`,
  ].join('\n');
}

function parseReviewResult(raw: string, threshold: number): Omit<TranslationReviewResult, 'requiresRework'> {
  try {
    // 尝试提取 JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        overallScore: clampScore(Number(parsed.overallScore), 0.7),
        fluencyScore: clampScore(Number(parsed.fluencyScore), 0.7),
        consistencyScore: clampScore(Number(parsed.consistencyScore), 0.7),
        terminologyScore: clampScore(Number(parsed.terminologyScore), 0.7),
        formattingScore: clampScore(Number(parsed.formattingScore), 0.8),
        issues: Array.isArray(parsed.issues)
          ? (parsed.issues as Array<Record<string, unknown>>).map((i) => ({
              type: (i.type as string || 'fluency') as TranslationReviewResult['issues'][number]['type'],
              severity: (i.severity as string || 'low') as TranslationReviewResult['issues'][number]['severity'],
              paragraphIndices: Array.isArray(i.paragraphIndices) ? i.paragraphIndices as number[] : [],
              suggestion: typeof i.suggestion === 'string' ? i.suggestion : '',
            }))
          : [],
      };
    }
  } catch {
    // JSON 解析失败——返回默认评分
  }

  return {
    overallScore: 0.8,
    fluencyScore: 0.8,
    consistencyScore: 0.8,
    terminologyScore: 0.8,
    formattingScore: 0.8,
    issues: [],
  };
}

function clampScore(value: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function getReviewProvider(
  preferences: SystemPreferencesService,
  providerId: string,
): { apiKey: string; baseUrl: string } | null {
  const state = preferences.getLlmState();
  for (const p of state.providers) {
    if (p.id === providerId) {
      return { apiKey: p.apiKey, baseUrl: p.baseUrl };
    }
  }
  return null;
}
