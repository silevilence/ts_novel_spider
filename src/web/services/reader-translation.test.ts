import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterTranslationPayload } from './api';
import { buildChapterTranslationView } from './reader-translation';

const original = { title: '章題', content: '晴れた\n\n風が吹いた\n\n雨が降った' };
const partial: ChapterTranslationPayload = {
  chapterId: 'c', sourceLang: 'ja', targetLang: 'zh-CN', status: 'failed', translatedTitle: '章节标题', overallQualityScore: null, qaRecords: [],
  readingSummary: { totalParagraphs: 3, translatedParagraphs: 2, draftParagraphs: 1, retainedParagraphs: 1 },
  paragraphs: [
    { paragraphIndex: 1, sourceText: '晴れた', translatedText: '天晴了', confidence: 1, appliedTermIds: [] },
    { paragraphIndex: 2, sourceText: '風が吹いた', translatedText: '风吹起来了', confidence: 1, appliedTermIds: [] },
    { paragraphIndex: 3, sourceText: '雨が降った', translatedText: null, confidence: null, appliedTermIds: [] },
  ],
};

test('failed chapters show successful drafts, retained text and labelled source gaps', () => {
  const view = buildChapterTranslationView(original, partial, 'translated');
  assert.equal(view.title, '章节标题');
  assert.equal(view.content, '天晴了\n\n风吹起来了\n\n**待译（原文）**\n\n雨が降った');
  assert.match(view.notice!, /正文已译 2\/3 段/);
  assert.match(view.notice!, /1 段成功草稿/);
  assert.match(view.notice!, /保留 1 段已有译文/);
});

test('bilingual partial chapters preserve every source paragraph in order', () => {
  const view = buildChapterTranslationView(original, partial, 'bilingual');
  assert.equal(view.title, '章題【章节标题】');
  assert.equal(view.content, '晴れた\n\n天晴了\n\n風が吹いた\n\n风吹起来了\n\n**待译（原文）**\n\n雨が降った');
});

test('original mode never includes preview text or notices', () => {
  assert.deepEqual(buildChapterTranslationView(original, partial, 'original'), { ...original, notice: null });
});

test('retranslation failure leaves a complete previous translation readable', () => {
  const detail: ChapterTranslationPayload = { ...partial,
    paragraphs: [{ ...partial.paragraphs[0]!, translatedText: '已有完整译文' }],
    readingSummary: { totalParagraphs: 1, translatedParagraphs: 1, draftParagraphs: 0, retainedParagraphs: 1 },
  };
  const view = buildChapterTranslationView(original, detail, 'translated');
  assert.equal(view.content, '已有完整译文');
  assert.match(view.notice!, /保留 1 段已有译文/);
  assert.doesNotMatch(view.content, /待译/);
  assert.equal(buildChapterTranslationView(original, { ...detail, status: 'completed' }, 'translated').notice, null);
});

test('title-only success keeps the full untranslated body and table structure', () => {
  const table = '| A | B |\n| --- | --- |\n| 猫 | 犬 |';
  const detail: ChapterTranslationPayload = { ...partial,
    paragraphs: [{ ...partial.paragraphs[0]!, sourceText: table, translatedText: null }],
    readingSummary: { totalParagraphs: 1, translatedParagraphs: 0, draftParagraphs: 0, retainedParagraphs: 0 },
  };
  const view = buildChapterTranslationView({ title: '章題', content: table }, detail, 'translated');
  assert.equal(view.title, '章节标题');
  assert.equal(view.content, `**待译（原文）**\n\n${table}`);
  assert.match(view.notice!, /0\/1 段/);
  assert.equal(buildChapterTranslationView(original, null, 'translated').content, original.content);
});
