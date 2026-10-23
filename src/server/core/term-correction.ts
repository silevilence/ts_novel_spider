import { randomUUID } from 'node:crypto';
import type { TermCorrection, TermCorrectionTarget } from '../contracts/term-correction';
import type { SqliteNovelRepository } from './novel-repository';
import { TranslationService, simpleHash } from './translation-service';
import type { SystemPreferencesService } from './system-preferences';
import { splitChapterParagraphs } from './translation/nodes/segment-node';
import { generateRefinedTranslationText } from './translation/nodes/translate-node';
import { resolveCapabilityRoute } from './library-intelligence';

function protectedMarkdown(text: string): string { return JSON.stringify(text.match(/!?\[[^\]]*\]\([^)]*\)|`[^`]*`|https?:\/\/\S+|<[^>]*>|^\s*(?:#{1,6} |[-*+] |\d+\. )|\|/gm) ?? []); }

/** Previews and approved edits stay scoped to saved library translations, never refined snapshots. */
export class TermCorrectionService {
  constructor(readonly repository: SqliteNovelRepository, readonly translation: TranslationService, readonly preferences: SystemPreferencesService, readonly generate = generateRefinedTranslationText) {}
  list(sourceId: string, novelId: string) { return { changes: this.repository.listTermChanges(sourceId, novelId), corrections: this.repository.listTermCorrections(sourceId, novelId) }; }
  private units(sourceId: string, novelId: string, sourceLang: string, targetLang: string) {
    const snapshot = this.repository.getSnapshot(sourceId, novelId);
    if (!snapshot || this.repository.getNovelPurgeStatus(sourceId, novelId)?.deletedAt) throw new Error('小说不存在或已在回收站。');
    return TranslationService.buildTranslationUnits(snapshot, sourceLang, targetLang);
  }
  preview(sourceId: string, novelId: string, changeId: string, chapterIds?: string[]): TermCorrection {
    const change = this.repository.listTermChanges(sourceId, novelId).find((item) => item.id === changeId);
    const terms = this.repository.listTranslationTerms(sourceId, novelId);
    const term = terms.find((item) => item.id === change?.termId);
    if (!change || !term || !change.after?.trim() || term.targetTerm !== change.after) throw new Error('术语变更不存在或已被新的译名取代。');
    const profile = this.translation.getTranslationProfile(sourceId, novelId);
    if (!profile) throw new Error('未配置翻译语言。');
    const { sourceLang, targetLang } = profile;
    const units = this.units(sourceId, novelId, sourceLang, targetLang);
    if (chapterIds?.some((id) => !units.some((unit) => unit.id === id && unit.kind === 'chapter'))) throw new Error('章节范围无效。');
    const targets: TermCorrectionTarget[] = [];
    for (const unit of units.filter((item) => !chapterIds || chapterIds.includes(item.id))) {
      const saved = this.repository.getChapterTranslation(sourceId, novelId, unit.id, sourceLang, targetLang);
      if (!saved) continue;
      const segments = splitChapterParagraphs(unit.content);
      const paragraphs = this.repository.listChapterTranslationParagraphs(sourceId, novelId, unit.id);
      const candidates = [{ index: null, source: segments[0] ?? unit.title, translated: saved.translatedTitle, termIds: [] as string[] }, ...paragraphs.map((paragraph) => ({ index: paragraph.paragraphIndex, source: paragraph.sourceText, translated: paragraph.translatedText, termIds: paragraph.appliedTermIds }))];
      for (const candidate of candidates) {
        if (!candidate.translated || (!candidate.source.includes(term.sourceTerm) && !candidate.termIds.includes(term.id))) continue;
        const oldTerm = change.before ?? '';
        const hasOld = Boolean(oldTerm && candidate.translated.includes(oldTerm));
        const aligned = !hasOld && candidate.translated.includes(change.after);
        const ambiguous = saved.sourceContentHash !== simpleHash(unit.content) || !candidate.source.includes(term.sourceTerm) || (candidate.index !== null && segments[candidate.index] !== candidate.source)
          || terms.some((other) => other.id !== term.id && (other.targetTerm === oldTerm || Boolean(other.targetTerm?.includes(oldTerm) && candidate.translated!.includes(other.targetTerm)) || other.sourceTerm.includes(term.sourceTerm) && candidate.source.includes(other.sourceTerm)));
        const suggested = hasOld ? candidate.translated.split(oldTerm).join(change.after) : null;
        const safe = hasOld && !ambiguous && suggested !== null && protectedMarkdown(candidate.translated) === protectedMarkdown(suggested);
        const target: TermCorrectionTarget = { id: randomUUID(), chapterId: unit.id, title: unit.title, paragraphIndex: candidate.index, sourceText: candidate.source, before: candidate.translated,
          suggestion: safe ? suggested : null, classification: aligned ? 'aligned' : safe ? 'replace' : 'review', reason: aligned ? '当前译名已一致' : safe ? '原文命中且旧译名映射明确，请检查后确认' : '缺少明确旧译名、材料不一致、译名重叠或 Markdown 保护范围，需核对语境', materialKey: '' };
        target.materialKey = this.materialKey(sourceId, novelId, sourceLang, targetLang, target);
        targets.push(target);
      }
    }
    const now = new Date().toISOString();
    const record: TermCorrection = { id: randomUUID(), sourceId, novelId, changeId, termId: term.id, termKey: JSON.stringify(terms), oldTerm: change.before ?? '', newTerm: change.after, sourceLang, targetLang, createdAt: now, updatedAt: now, targets };
    this.repository.saveTermCorrection(record); return record;
  }
  private materialKey(sourceId: string, novelId: string, sourceLang: string, targetLang: string, target: TermCorrectionTarget): string {
    const unit = this.units(sourceId, novelId, sourceLang, targetLang).find((item) => item.id === target.chapterId);
    const saved = this.repository.getChapterTranslation(sourceId, novelId, target.chapterId, sourceLang, targetLang);
    const paragraph = target.paragraphIndex === null ? null : this.repository.listChapterTranslationParagraphs(sourceId, novelId, target.chapterId).find((item) => item.paragraphIndex === target.paragraphIndex);
    return JSON.stringify([unit?.content, saved?.sourceContentHash, target.paragraphIndex === null ? saved?.translatedTitle : [paragraph?.sourceText, paragraph?.translatedText]]);
  }
  private checked(sourceId: string, novelId: string, id: string): TermCorrection {
    const record = this.repository.listTermCorrections(sourceId, novelId).find((item) => item.id === id);
    if (!record) throw new Error('修正记录不存在。');
    const terms = this.repository.listTranslationTerms(sourceId, novelId);
    const profile = this.translation.getTranslationProfile(sourceId, novelId);
    if (JSON.stringify(terms) !== record.termKey || profile?.sourceLang !== record.sourceLang || profile?.targetLang !== record.targetLang) throw new Error('术语或语言已变化，请重新预览。');
    return record;
  }
  private checkTarget(record: TermCorrection, target: TermCorrectionTarget, undo = false): void {
    if (this.materialKey(record.sourceId, record.novelId, record.sourceLang, record.targetLang, target) !== (undo ? target.appliedKey : target.materialKey)) throw new Error('原文或译文已变化，请重新预览，当前译文保持不变。');
  }
  /** Generates a proposal only; applying still requires an explicit target selection. */
  async suggest(sourceId: string, novelId: string, id: string, targetId: string): Promise<TermCorrection> {
    const record = this.checked(sourceId, novelId, id);
    const target = record.targets.find((item) => item.id === targetId && !item.applied);
    if (!target || target.classification === 'aligned') throw new Error('目标不可修订。');
    this.checkTarget(record, target);
    const override = this.translation.getTranslationProfile(sourceId, novelId)?.termExtractionModel;
    const route = resolveCapabilityRoute(this.preferences.getLlmState(), 'chat', override?.providerId && override.modelId ? { providerId: override.providerId, modelId: override.modelId } : null, this.preferences.getModelGateway());
    if (!route) throw new Error('未配置普通对话模型用于术语修订。');
    const suggestion = await this.generate(this.preferences, { providerId: route.provider.id, modelId: route.model.modelId },
      `只修正当前译文中对应源术语的译法，统一为“${record.newTerm}”。保留其他内容和 Markdown 结构，不能添加解释。只输出修正后的当前段落或标题。`, JSON.stringify({ source: target.sourceText, translation: target.before, oldTerm: record.oldTerm, newTerm: record.newTerm }), AbortSignal.timeout(120000));
    const current = this.checked(sourceId, novelId, id);
    const currentTarget = current.targets.find((item) => item.id === targetId)!;
    this.checkTarget(current, currentTarget);
    if (currentTarget.applied || !suggestion.trim() || protectedMarkdown(target.before) !== protectedMarkdown(suggestion) || !suggestion.includes(record.newTerm)) throw new Error('建议为空、不含目标译名或修改了受保护格式；未修改译文。');
    currentTarget.suggestion = suggestion.trim(); current.updatedAt = new Date().toISOString();
    this.repository.saveTermCorrection(current); return current;
  }
  apply(sourceId: string, novelId: string, id: string, targetIds: string[], undo = false): TermCorrection {
    if (this.translation.isRunning(sourceId, novelId)) throw new Error('本书翻译正在运行，请暂停并等待结束后再修正。');
    const record = this.checked(sourceId, novelId, id);
    if (!targetIds.length || new Set(targetIds).size !== targetIds.length || targetIds.some((targetId) => !record.targets.some((target) => target.id === targetId))) throw new Error('请选择有效且不重复的修正项。');
    const targets = record.targets.filter((target) => targetIds.includes(target.id) && (undo ? target.applied && !target.reverted : !target.applied && !target.reverted));
    for (const target of targets) { this.checkTarget(record, target, undo); if (!target.suggestion || target.classification === 'aligned') throw new Error('选中项没有可应用的修正建议。'); }
    return this.repository.withTranslationTransaction(() => {
      for (const target of targets) {
        this.repository.writeTermCorrectionTarget(record, target, undo);
        target.applied = true;
        if (undo) target.reverted = true;
        else target.appliedKey = this.materialKey(sourceId, novelId, record.sourceLang, record.targetLang, target);
      }
      if (targets.length) this.repository.bumpNovelContentUpdatedAt(sourceId, novelId);
      record.updatedAt = new Date().toISOString(); this.repository.saveTermCorrection(record); return record;
    });
  }
}
