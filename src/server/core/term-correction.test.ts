import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteNovelRepository } from './novel-repository';
import { SystemPreferencesService } from './system-preferences';
import { TranslationService, simpleHash } from './translation-service';
import { TermCorrectionService } from './term-correction';
import { splitChapterParagraphs } from './translation/nodes/segment-node';
import { OpdsCompilationService } from './opds-compilation';
import { LocalExportEngine } from './export-engine';
import { SpiderLogDispatcher } from './logging';
import JSZip from 'jszip';
import { OfflineLibraryAssetService } from './offline-library';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'term-correction-'));
  const db = new SqliteNovelRepository(':memory:');
  db.saveMetadata('test', { novelId: 'n', title: 'アリス物語', author: '', description: 'アリスの旅', tags: [], chapterCount: 2, infoPageUrl: '' });
  db.saveChapterIndex('test', 'n', ['a', 'b'].map((id, index) => ({ id, index: index + 1, title: 'アリス登場', volumeTitle: 'アリス編', url: '' })));
  for (const [chapterId, index] of [['a', 1], ['b', 2]] as const) db.saveChapterContent('test', 'n', { chapterId, index, title: 'アリス登場', volumeTitle: 'アリス編', url: '', content: 'アリスは来た。\n\n無関係な段落。' });
  const preferences = new SystemPreferencesService({ storageFilePath: path.join(dir, 'preferences.json') });
  preferences.updateLlmProviders([{ id: 'fake', type: 'openai-compatible', enabled: true, apiKey: 'fake', baseUrl: 'http://fake.invalid/v1', models: [{ id: 'general', modelId: 'general', enabled: true, capabilityMode: 'manual', capabilities: ['chat'] }] }]);
  preferences.updateModelGateway({ chat: { providerId: 'fake', modelId: 'general' } });
  const translation = new TranslationService(db, preferences);
  const units = TranslationService.buildTranslationUnits(db.getSnapshot('test', 'n')!, 'ja', 'zh-CN');
  for (const unit of units) {
    if (unit.kind !== 'chapter') db.ensureSyntheticChapter('test', 'n', unit.id, unit.title, unit.index);
    db.saveChapterTranslation({ sourceId: 'test', novelId: 'n', chapterId: unit.id, sourceLang: 'ja', targetLang: 'zh-CN', translatedTitle: '艾莉丝标题', status: 'completed', sourceContentHash: simpleHash(unit.content), glossaryVersion: 1, profileVersion: 1 });
    db.replaceChapterTranslationParagraphs('test', 'n', unit.id, splitChapterParagraphs(unit.content).slice(1).map((sourceText, index) => ({ paragraphIndex: index + 1, sourceText, translatedText: sourceText.includes('アリス') ? '艾莉丝来了。' : '无关内容。', appliedTermIds: [] })));
  }
  const term = db.createTranslationTerm({ sourceId: 'test', novelId: 'n', sourceTerm: 'アリス', targetTerm: '艾莉丝' });
  db.updateTranslationTerm('test', 'n', term.id, { targetTerm: '爱丽丝' });
  const change = db.listTermChanges('test', 'n')[0]!;
  const service = new TermCorrectionService(db, translation, preferences, async () => '爱丽丝来了。');
  return { db, preferences, translation, service, term, change, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('correction preview finds all chapters, metadata and volume titles without requiring usage records or modifying translations', () => {
  const f = fixture();
  try {
    const before = f.db.listChapterTranslationParagraphs('test', 'n', 'a');
    const record = f.service.preview('test', 'n', f.change.id);
    assert(record.targets.some((item) => item.chapterId === '__novel_meta__'));
    assert(record.targets.some((item) => item.chapterId !== 'a' && item.chapterId !== 'b' && item.chapterId !== '__novel_meta__'));
    assert(record.targets.some((item) => item.chapterId === 'b'));
    assert(record.targets.every((item) => item.classification === 'replace'));
    assert.deepEqual(f.db.listChapterTranslationParagraphs('test', 'n', 'a'), before);
    assert(f.service.preview('test', 'n', f.change.id, ['a']).targets.every((item) => item.chapterId === 'a'));
    assert.throws(() => f.service.preview('test', 'foreign', f.change.id));
    f.db.createTranslationTerm({ sourceId: 'test', novelId: 'n', sourceTerm: '別人', targetTerm: '艾莉丝' });
    assert(f.service.preview('test', 'n', f.change.id).targets.every((item) => item.classification === 'review'));
  } finally { f.cleanup(); }
});

test('approved corrections are scoped, idempotent, visible in stored translations and reversible', () => {
  const f = fixture();
  try {
    const record = f.service.preview('test', 'n', f.change.id);
    const selected = record.targets.filter((target) => target.chapterId === 'a');
    const unselected = f.db.listChapterTranslationParagraphs('test', 'n', 'b');
    f.service.apply('test', 'n', record.id, selected.map((target) => target.id));
    assert.equal(f.db.getChapterTranslation('test', 'n', 'a', 'ja', 'zh-CN')?.translatedTitle, '爱丽丝标题');
    assert.equal(f.db.listChapterTranslationParagraphs('test', 'n', 'a')[0]?.translatedText, '爱丽丝来了。');
    assert.equal(f.db.listChapterTranslationParagraphs('test', 'n', 'a')[1]?.translatedText, '无关内容。');
    assert.deepEqual(f.db.listChapterTranslationParagraphs('test', 'n', 'b'), unselected);
    f.service.apply('test', 'n', record.id, selected.map((target) => target.id));
    const undone = f.service.apply('test', 'n', record.id, selected.map((target) => target.id), true);
    assert(selected.every((target) => undone.targets.find((entry) => entry.id === target.id)?.reverted));
    assert.equal(f.db.getChapterTranslation('test', 'n', 'a', 'ja', 'zh-CN')?.translatedTitle, '艾莉丝标题');
  } finally { f.cleanup(); }
});

test('conflicting translations and later glossary changes reject stale proposals before any selected write', () => {
  const f = fixture();
  try {
    const record = f.service.preview('test', 'n', f.change.id, ['a']);
    const saved = f.db.getChapterTranslation('test', 'n', 'a', 'ja', 'zh-CN')!;
    f.db.saveChapterTranslation({ ...saved, translatedTitle: '人工标题' });
    assert.throws(() => f.service.apply('test', 'n', record.id, record.targets.map((target) => target.id)), /已变化/);
    assert.equal(f.db.listChapterTranslationParagraphs('test', 'n', 'a')[0]?.translatedText, '艾莉丝来了。');
    const fresh = f.service.preview('test', 'n', f.change.id, ['b']);
    f.db.updateTranslationTerm('test', 'n', f.term.id, { targetTerm: '第三译名' });
    assert.throws(() => f.service.apply('test', 'n', fresh.id, [fresh.targets[0]!.id]), /术语或语言/);
  } finally { f.cleanup(); }
});

test('AI suggestions never write immediately and late suggestions cannot replace an applied proposal', async () => {
  const f = fixture();
  try {
    const record = f.service.preview('test', 'n', f.change.id, ['a']);
    const target = record.targets.find((item) => item.paragraphIndex === 1)!;
    const proposed = await f.service.suggest('test', 'n', record.id, target.id);
    assert.equal(proposed.targets.find((item) => item.id === target.id)?.suggestion, '爱丽丝来了。');
    assert.equal(f.db.listChapterTranslationParagraphs('test', 'n', 'a')[0]?.translatedText, '艾莉丝来了。');
    let release!: (text: string) => void;
    const slow = new TermCorrectionService(f.db, f.translation, f.preferences, async () => new Promise<string>((resolve) => { release = resolve; }));
    const pending = slow.suggest('test', 'n', record.id, target.id);
    f.service.apply('test', 'n', record.id, [target.id]); release('爱丽丝改变了。');
    await assert.rejects(pending, /已变化|格式/);
    assert.equal(f.db.listChapterTranslationParagraphs('test', 'n', 'a')[0]?.translatedText, '爱丽丝来了。');
  } finally { f.cleanup(); }
});

test('correction invalidates compiled OPDS and recompiled translated EPUB contains the approved name', async () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-epub-'));
  try {
    f.db.updateOpdsVisible('test', 'n', true);
    const errors: string[] = [];
    const compilation = new OpdsCompilationService({ repository: f.db, preferences: f.preferences, exportEngine: new LocalExportEngine({ outputRoot: path.join(directory, 'exports'), assetService: new OfflineLibraryAssetService({ storageRoot: path.join(directory, 'assets') }) }), logger: new SpiderLogDispatcher([{ log: (event) => { if (event.level === 'error') errors.push(event.message); } }]), artifactsRoot: path.join(directory, 'artifacts') });
    await compilation.runScanAllForTest();
    assert.deepEqual(errors, []);
    const originalCompiled = f.db.getOpdsNovel('test', 'n')!.epubCompiledAt!;
    const record = f.service.preview('test', 'n', f.change.id);
    f.service.apply('test', 'n', record.id, record.targets.map((target) => target.id));
    assert(f.db.getOpdsNovel('test', 'n')!.contentUpdatedAt! > originalCompiled);
    await compilation.runScanAllForTest();
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(directory, 'artifacts', 'test', 'n', 'translated.epub')));
    const documents = await Promise.all(Object.values(zip.files).filter((file) => file.name.endsWith('.xhtml')).map((file) => file.async('string')));
    assert(documents.join('\n').includes('爱丽丝'));
    assert(!documents.join('\n').includes('艾莉丝'));
  } finally { f.cleanup(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('correction refuses overlapping names and preserves Markdown targets and unrelated checkpoints', async () => {
  const f = fixture();
  try {
    f.db.createTranslationTerm({ sourceId: 'test', novelId: 'n', sourceTerm: 'アリス姫', targetTerm: '艾莉丝公主' });
    f.db.replaceChapterTranslationParagraphs('test', 'n', 'a', [{ paragraphIndex: 1, sourceText: 'アリスは来た。', translatedText: '[艾莉丝](https://example.test/艾莉丝)' }]);
    const record = f.service.preview('test', 'n', f.change.id, ['a']);
    assert.equal(record.targets.find((target) => target.paragraphIndex === 1)?.classification, 'review');
    const title = record.targets.find((target) => target.paragraphIndex === null)!;
    f.db.saveTranslationBuildCheckpoint({ sourceId: 'test', novelId: 'n', chapterId: 'a', chapterIndex: 1, stage: 'failed', warningMessage: 'fixture', pipelineStateJson: JSON.stringify({ drafts: [{ paragraphIndex: 3, sourceText: '其他段落', translatedText: '有效草稿' }] }) });
    f.service.apply('test', 'n', record.id, [title.id]);
    assert.match(f.db.getTranslationBuildCheckpoint('test', 'n', 'a')!.pipelineStateJson, /有效草稿/);
  } finally { f.cleanup(); }
});
