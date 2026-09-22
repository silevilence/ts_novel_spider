export const GLOSSARY_EXTRACTION_SOURCE_LIMIT = 18_000;

export function buildGlossaryExtractionPrompt(sourceLang: string): string {
  return `从${sourceLang}小说原文中提取需要保持一致的术语候选。只返回 JSON：{"terms":[{"sourceTerm":"...","entityType":"character|location|organization|item|concept|other","priority":0-10,"suggestion":"简短说明"}]}。不要翻译术语，也不要输出 JSON 之外的内容。`;
}

export interface GlossarySourceChapter { id: string; index: number; title: string; content: string; }
export interface GlossarySourceWindow { source: string; chapterIds: string[]; }

/** Character windows retain chapter provenance, including chapters spanning multiple windows. */
export function buildGlossarySourceWindows(chapters: GlossarySourceChapter[], limit = GLOSSARY_EXTRACTION_SOURCE_LIMIT, maxWindows = Infinity): GlossarySourceWindow[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('原文窗口必须为正整数。');
  const windows: GlossarySourceWindow[] = [];
  let source = '';
  let chapterIds = new Set<string>();
  for (const [index, chapter] of chapters.entries()) {
    let text = `${index ? '\n\n' : ''}【第 ${chapter.index} 章 ${chapter.title}】\n${chapter.content}`;
    while (text.length) {
      const take = Math.min(limit - source.length, text.length);
      source += text.slice(0, take);
      chapterIds.add(chapter.id);
      text = text.slice(take);
      if (source.length === limit) {
        windows.push({ source, chapterIds: [...chapterIds] });
        if (windows.length >= maxWindows) return windows;
        source = ''; chapterIds = new Set();
      }
    }
  }
  if (source) windows.push({ source, chapterIds: [...chapterIds] });
  return windows;
}

export function parseGlossaryCandidates(text: string): Array<{ sourceTerm: string; entityType: string | null; priority: number; suggestion: string | null }> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const payload = JSON.parse(match?.[0] ?? '{}') as { terms?: unknown };
    if (!Array.isArray(payload.terms)) return [];
    const seen = new Set<string>();
    return payload.terms.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      const sourceTerm = typeof value.sourceTerm === 'string' ? value.sourceTerm.trim() : '';
      if (!sourceTerm || seen.has(sourceTerm)) return [];
      seen.add(sourceTerm);
      return [{ sourceTerm, entityType: typeof value.entityType === 'string' ? value.entityType : null, priority: typeof value.priority === 'number' ? Math.max(0, Math.min(10, Math.round(value.priority))) : 0, suggestion: typeof value.suggestion === 'string' ? value.suggestion : null }];
    });
  } catch { return []; }
}
