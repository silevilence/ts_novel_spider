import fs from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';
import { marked } from 'marked';

import type { OfflineLibraryAssetService } from './offline-library';
import type { StoredChapterRecord, StoredNovelSnapshot } from './spider';
import { stripTranslationNumberPrefix } from './translation/nodes/translate-node';

export const LIBRARY_EXPORT_FORMATS = ['markdown', 'txt', 'epub'] as const;

export type LibraryExportFormat = (typeof LIBRARY_EXPORT_FORMATS)[number];

export const LIBRARY_EXPORT_TRANSLATION_MODES = ['original', 'translated', 'bilingual'] as const;

export type LibraryExportTranslationMode = (typeof LIBRARY_EXPORT_TRANSLATION_MODES)[number];

export function isLibraryExportTranslationMode(value: unknown): value is LibraryExportTranslationMode {
  return typeof value === 'string' && (LIBRARY_EXPORT_TRANSLATION_MODES as readonly string[]).includes(value);
}

export interface GeneratedLibraryExport {
  format: LibraryExportFormat;
  fileName: string;
  filePath: string;
  contentType: string;
  generatedAt: string;
  size: number;
}

export interface LocalExportEngineOptions {
  outputRoot?: string;
  assetService: OfflineLibraryAssetService;
}

interface PreparedMediaAsset {
  sourceUrl: string;
  markdownTarget: string;
  epubTarget: string;
  fileName: string;
  data: Buffer | null;
  mediaType: string;
}

/** 段落级翻译数据（注入导出上下文） */
export interface TranslatedParagraph {
  paragraphIndex: number;
  sourceText: string;
  translatedText: string | null;
  confidence: number | null;
}

interface ExportRenderContext {
  snapshot: StoredNovelSnapshot;
  chapters: StoredChapterRecord[];
  volumeGroups: Array<{
    index: number;
    rawTitle: string;
    title: string;
    chapters: StoredChapterRecord[];
  }>;
  assetsByChapterId: Map<string, PreparedMediaAsset[]>;
  /** 导出语言模式：original（默认）、translated、bilingual */
  translationMode: LibraryExportTranslationMode;
  /** 章节 ID → 段落翻译列表 */
  translatedParagraphsByChapterId: Map<string, TranslatedParagraph[]>;
  /** 翻译后的小说标题 */
  translatedNovelTitle?: string | null | undefined;
  /** 翻译后的作者/笔名 */
  translatedAuthor?: string | null | undefined;
  /** 翻译后的标签 */
  translatedTags?: string[] | undefined;
  /** 翻译后的小说简介段落 */
  translatedDescriptionParagraphs?: TranslatedParagraph[] | undefined;
  /** 卷原标题 → 卷标题译文 */
  translatedVolumeTitles?: Map<string, string> | undefined;
  /** 章节 ID → 章节标题译文 */
  translatedChapterTitles?: Map<string, string> | undefined;
}

interface StrategyOutput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

interface LibraryExportStrategy {
  readonly format: LibraryExportFormat;

  generate(context: ExportRenderContext): Promise<StrategyOutput>;
}

const IMAGE_URL_PATTERN = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s)]*)?)/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(((?:https?:\/\/|manual:\/\/)[^)\s]+)\)/gi;
const CHAPTER_SECTION_DIVIDER = '---';

export interface ExportTranslationOptions {
  mode: LibraryExportTranslationMode;
  translatedParagraphsByChapterId: Map<string, TranslatedParagraph[]>;
  /** 小说标题译文（来自 __novel_meta__ 单元） */
  translatedNovelTitle?: string | null | undefined;
  /** 作者/笔名译文 */
  translatedAuthor?: string | null | undefined;
  /** 标签译文 */
  translatedTags?: string[] | undefined;
  /** 小说简介译文段落（来自 __novel_meta__ 单元） */
  translatedDescriptionParagraphs?: TranslatedParagraph[] | undefined;
  /** 卷标题译文映射：卷 ID → 译文 */
  translatedVolumeTitles?: Map<string, string> | undefined;
  /** 真实章节标题译文映射：chapterId → 译文 */
  translatedChapterTitles?: Map<string, string> | undefined;
}

export class LocalExportEngine {
  readonly #outputRoot: string;
  readonly #assetService: OfflineLibraryAssetService;
  readonly #strategies: Map<LibraryExportFormat, LibraryExportStrategy>;

  constructor(options: LocalExportEngineOptions) {
    this.#outputRoot = options.outputRoot ?? path.resolve(process.cwd(), 'data', 'exports');
    this.#assetService = options.assetService;
    this.#strategies = new Map<LibraryExportFormat, LibraryExportStrategy>([
      ['markdown', new MarkdownExportStrategy()],
      ['txt', new TextExportStrategy()],
      ['epub', new EpubExportStrategy()],
    ]);
    fs.mkdirSync(this.#outputRoot, { recursive: true });
  }

  async generate(
    snapshot: StoredNovelSnapshot,
    format: LibraryExportFormat,
    translation?: ExportTranslationOptions,
  ): Promise<GeneratedLibraryExport> {
    const strategy = this.#strategies.get(format);

    if (!strategy) {
      throw new Error(`Unsupported export format: ${format}`);
    }

    const context = this.prepareContext(snapshot, translation);
    const output = await strategy.generate(context);
    const outputDirectory = path.join(this.#outputRoot, snapshot.sourceId, snapshot.metadata.novelId);
    const filePath = path.join(outputDirectory, output.fileName);

    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(filePath, output.data);

    return {
      format,
      fileName: output.fileName,
      filePath,
      contentType: output.contentType,
      generatedAt: new Date().toISOString(),
      size: output.data.byteLength,
    };
  }

  private prepareContext(
    snapshot: StoredNovelSnapshot,
    translation?: ExportTranslationOptions,
  ): ExportRenderContext {
    const chapters = snapshot.chapters.filter((chapter) => typeof chapter.content === 'string' && chapter.content.trim().length > 0);

    if (chapters.length === 0) {
      throw new Error(`Library novel ${snapshot.sourceId}/${snapshot.metadata.novelId} has no downloaded chapters to export.`);
    }

    const volumeGroups = groupChaptersByVolume(chapters);
    const assetsByChapterId = new Map<string, PreparedMediaAsset[]>();

    for (const chapter of chapters) {
      const assets = this.#assetService.listMediaAssets(snapshot, chapter);
      const prepared = assets.map((asset) => {
        const filePath = this.#assetService.getCachedMediaFilePath(snapshot, chapter.id, asset.id);
        const extension = filePath ? path.extname(filePath).toLowerCase() : inferUrlExtension(asset.sourceUrl);
        const fileName = `chapter-${String(chapter.index).padStart(4, '0')}-${asset.id}${extension || '.bin'}`;

        return {
          sourceUrl: asset.sourceUrl,
          markdownTarget: asset.cached && filePath ? `./assets/${fileName}` : asset.sourceUrl,
          epubTarget: asset.cached && filePath ? `assets/${fileName}` : asset.sourceUrl,
          fileName,
          data: asset.cached && filePath ? fs.readFileSync(filePath) : null,
          mediaType: inferMediaType(filePath ?? asset.sourceUrl),
        } satisfies PreparedMediaAsset;
      });

      assetsByChapterId.set(chapter.id, prepared);
    }

    return {
      snapshot,
      chapters,
      volumeGroups,
      assetsByChapterId,
      translationMode: translation?.mode ?? 'original',
      translatedParagraphsByChapterId: translation?.translatedParagraphsByChapterId ?? new Map(),
      translatedNovelTitle: translation?.translatedNovelTitle,
      translatedAuthor: translation?.translatedAuthor,
      translatedTags: translation?.translatedTags,
      translatedDescriptionParagraphs: translation?.translatedDescriptionParagraphs,
      translatedVolumeTitles: translation?.translatedVolumeTitles,
      translatedChapterTitles: translation?.translatedChapterTitles,
    };
  }
}

class MarkdownExportStrategy implements LibraryExportStrategy {
  readonly format = 'markdown' as const;

  async generate(context: ExportRenderContext): Promise<StrategyOutput> {
    const zip = new JSZip();
    const baseName = buildBaseName(context.snapshot);
    const markdownFileName = `${baseName}.md`;
    const zipFileName = `${baseName}.md.zip`;
    const markdown = renderMarkdownDocument(context);

    zip.file(markdownFileName, markdown);

    for (const assets of context.assetsByChapterId.values()) {
      for (const asset of assets) {
        if (asset.data) {
          zip.file(`assets/${asset.fileName}`, asset.data);
        }
      }
    }

    const data = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    return {
      fileName: zipFileName,
      contentType: 'application/zip',
      data,
    };
  }
}

class TextExportStrategy implements LibraryExportStrategy {
  readonly format = 'txt' as const;

  async generate(context: ExportRenderContext): Promise<StrategyOutput> {
    const baseName = buildBaseName(context.snapshot);
    const text = renderPlainTextDocument(context);

    return {
      fileName: `${baseName}.txt`,
      contentType: 'text/plain; charset=utf-8',
      data: Buffer.from(text, 'utf8'),
    };
  }
}

class EpubExportStrategy implements LibraryExportStrategy {
  readonly format = 'epub' as const;

  async generate(context: ExportRenderContext): Promise<StrategyOutput> {
    const baseName = buildBaseName(context.snapshot);
    const bookId = `${context.snapshot.sourceId}-${context.snapshot.metadata.novelId}`;
    const zip = new JSZip();
    const content = zip.folder('OEBPS');

    if (!content) {
      throw new Error('Failed to initialize EPUB package directory.');
    }

    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF')?.file(
      'container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    );

    const manifestItems: string[] = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="style" href="styles/book.css" media-type="text/css"/>',
      '<item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>',
    ];
    const spineItems: string[] = ['<itemref idref="intro"/>'];
    const navLinks: string[] = ['<li><a href="intro.xhtml">作品信息</a></li>'];

    content.folder('styles')?.file(
      'book.css',
      'body { font-family: serif; line-height: 1.75; } h1, h2, h3 { line-height: 1.3; } img { max-width: 100%; display: block; margin: 1rem auto; } p { text-indent: 2em; } .meta { text-indent: 0; color: #555; } .section-divider { border: 0; border-top: 1px solid #999; margin: 1.5rem 0; }',
    );
    content.file('intro.xhtml', renderEpubIntro(context));

    const assetsFolder = content.folder('assets');
    if (!assetsFolder) {
      throw new Error('Failed to initialize EPUB asset directory.');
    }

    const addedAssets = new Set<string>();
    for (const assets of context.assetsByChapterId.values()) {
      for (const asset of assets) {
        if (asset.data && !addedAssets.has(asset.fileName)) {
          addedAssets.add(asset.fileName);
          assetsFolder.file(asset.fileName, asset.data);
          manifestItems.push(
            `<item id="asset-${asset.fileName}" href="assets/${escapeXmlAttribute(asset.fileName)}" media-type="${asset.mediaType}"/>`,
          );
        }
      }
    }

    let chapterFileIndex = 1;
    for (const volume of context.volumeGroups) {
      const volumeFileName = `volume-${String(volume.index).padStart(4, '0')}.xhtml`;
      const volumeItemId = `volume-${volume.index}`;
      const volumeChapterLinks: string[] = [];

      content.file(volumeFileName, renderEpubVolume(context, volume));
      manifestItems.push(
        `<item id="${volumeItemId}" href="${volumeFileName}" media-type="application/xhtml+xml"/>`,
      );
      spineItems.push(`<itemref idref="${volumeItemId}"/>`);

      const volTitleLocalized = localizedText(volume.title, context.translatedVolumeTitles?.get(volume.rawTitle), context.translationMode);
      navLinks.push(`
<li>
  <a href="${volumeFileName}">${escapeXml(volTitleLocalized)}</a>
  <ol>
    ${volume.chapters.map((chapter) => {
      const chHeading = localizedText(formatChapterHeading(chapter), context.translatedChapterTitles?.get(chapter.id), context.translationMode);
      const chapterFileName = `chapter-${String(chapterFileIndex).padStart(4, '0')}.xhtml`;
      const itemId = `chapter-${chapterFileIndex}`;
      content.file(chapterFileName, renderEpubChapter(context, chapter, volume.title, chapterFileIndex));
      manifestItems.push(
        `<item id="${itemId}" href="${chapterFileName}" media-type="application/xhtml+xml"/>`,
      );
      spineItems.push(`<itemref idref="${itemId}"/>`);
      chapterFileIndex += 1;
      return `<li><a href="${chapterFileName}">${escapeXml(chHeading)}</a></li>`;
    }).join('\n      ')}
  </ol>
</li>`.trim());
    }

    content.file(
      'nav.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
  <head>
    <title>${escapeXml(localizedText(context.snapshot.metadata.title, context.translatedNovelTitle, context.translationMode))}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
        ${navLinks.join('\n        ')}
      </ol>
    </nav>
  </body>
</html>`,
    );

    const opfTitle = localizedText(context.snapshot.metadata.title, context.translatedNovelTitle, context.translationMode);
    let opfDescription = escapeXml(context.snapshot.metadata.description || '');
    if (context.translationMode !== 'original' && context.translatedDescriptionParagraphs && context.translatedDescriptionParagraphs.length > 0) {
      if (context.translationMode === 'translated') {
        opfDescription = context.translatedDescriptionParagraphs
          .map((p) => escapeXml(stripTranslationNumberPrefix(p.sourceText, p.translatedText ?? p.sourceText)))
          .join('<br/>');
      } else {
        const td = context.translatedDescriptionParagraphs
          .map((p) => {
            const safe = p.translatedText
              ? stripTranslationNumberPrefix(p.sourceText, p.translatedText)
              : null;
            return safe ? `${escapeXml(p.sourceText)}<br/>${escapeXml(safe)}` : escapeXml(p.sourceText);
          })
          .join('<br/>');
        opfDescription = `${escapeXml(context.snapshot.metadata.description || '')}<br/><br/>${td}`;
      }
    }

    content.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(opfTitle)}</dc:title>
    <dc:creator>${escapeXml(localizedText(context.snapshot.metadata.author || '未知作者', context.translatedAuthor, context.translationMode))}</dc:creator>
    <dc:description>${opfDescription}</dc:description>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`,
    );

    const data = await zip.generateAsync({
      type: 'nodebuffer',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    return {
      fileName: `${baseName}.epub`,
      contentType: 'application/epub+zip',
      data,
    };
  }
}

function renderMarkdownDocument(context: ExportRenderContext): string {
  const { translationMode } = context;
  const novelTitle = localizedText(context.snapshot.metadata.title, context.translatedNovelTitle, translationMode);
  const lines: string[] = [
    `# ${novelTitle}`,
    '',
    `- 作者：${localizedText(context.snapshot.metadata.author || '未知作者', context.translatedAuthor, translationMode)}`,
    `- 数据源：${context.snapshot.sourceId}`,
    `- 作品 ID：${context.snapshot.metadata.novelId}`,
    `- 已导出章节：${context.chapters.length}/${context.snapshot.metadata.chapterCount}`,
    `- 更新时间：${context.snapshot.updatedAt}`,
  ];

  if (context.snapshot.metadata.tags.length > 0) {
    lines.push(`- 标签：${localizedTags(context.snapshot.metadata.tags, context.translatedTags, translationMode).join(' / ')}`);
  }

  if (context.translationMode !== 'original') {
    lines.push(`- 导出模式：${context.translationMode === 'translated' ? '纯译文' : '双语对照'}`);
  }

  // 简介翻译
  const description = context.snapshot.metadata.description || '暂无简介。';
  if (translationMode === 'original' || !context.translatedDescriptionParagraphs || context.translatedDescriptionParagraphs.length === 0) {
    lines.push('', '## 简介', '', description, '');
  } else if (translationMode === 'translated') {
    const translatedDesc = context.translatedDescriptionParagraphs
      .map((p) => stripTranslationNumberPrefix(p.sourceText, p.translatedText ?? p.sourceText))
      .join('\n\n');
    lines.push('', '## 简介', '', translatedDesc || description, '');
  } else {
    // bilingual
    const translatedDesc = context.translatedDescriptionParagraphs
      .map((p) => {
        const safe = p.translatedText
          ? stripTranslationNumberPrefix(p.sourceText, p.translatedText)
          : null;
        return safe ? `${p.sourceText}\n\n${safe}` : p.sourceText;
      })
      .join('\n\n');
    lines.push('', '## 简介', '', description, '', translatedDesc || description, '');
  }

  for (const volume of context.volumeGroups) {
    const volTitle = localizedText(volume.title, context.translatedVolumeTitles?.get(volume.rawTitle), translationMode);
    lines.push(`## ${volTitle}`, '');

    for (const chapter of volume.chapters) {
      const assets = context.assetsByChapterId.get(chapter.id) ?? [];
      const content = resolveChapterExportContent(context, chapter);
      const chHeading = localizedText(formatChapterHeading(chapter), context.translatedChapterTitles?.get(chapter.id), translationMode);

      lines.push(`### ${chHeading}`, '');
      lines.push(rewriteMarkdownContent(content, assets), '');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderPlainTextDocument(context: ExportRenderContext): string {
  const { translationMode } = context;
  const novelTitle = localizedText(context.snapshot.metadata.title, context.translatedNovelTitle, translationMode);

  // 简介
  let descriptionText = context.snapshot.metadata.description || '暂无简介。';
  if (translationMode !== 'original' && context.translatedDescriptionParagraphs && context.translatedDescriptionParagraphs.length > 0) {
    if (translationMode === 'translated') {
      descriptionText = context.translatedDescriptionParagraphs
        .map((p) => stripTranslationNumberPrefix(p.sourceText, p.translatedText ?? p.sourceText))
        .join('\n\n');
    } else {
      const translatedDesc = context.translatedDescriptionParagraphs
        .map((p) => {
          const safe = p.translatedText
            ? stripTranslationNumberPrefix(p.sourceText, p.translatedText)
            : null;
          return safe ? `${p.sourceText}\n\n${safe}` : p.sourceText;
        })
        .join('\n\n');
      descriptionText = `${descriptionText}\n\n${translatedDesc}`;
    }
  }

  const lines: string[] = [
    novelTitle,
    `作者：${localizedText(context.snapshot.metadata.author || '未知作者', context.translatedAuthor, translationMode)}`,
    '',
    normalizePlainParagraph(markdownToPlainText(descriptionText)),
    '',
  ];

  context.chapters.forEach((chapter, index) => {
    const chHeading = localizedText(formatChapterHeading(chapter), context.translatedChapterTitles?.get(chapter.id), translationMode);
    const content = resolveChapterExportContent(context, chapter);
    const paragraphs = splitParagraphs(markdownToPlainText(content)).map(normalizePlainParagraph);
    lines.push(chHeading);
    lines.push(...paragraphs);

    if (index < context.chapters.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderEpubIntro(context: ExportRenderContext): string {
  const { translationMode } = context;
  const novelTitle = localizedText(context.snapshot.metadata.title, context.translatedNovelTitle, translationMode);

  let descriptionHtml = escapeXmlWithLineBreaks(context.snapshot.metadata.description || '暂无简介。');
  if (translationMode !== 'original' && context.translatedDescriptionParagraphs && context.translatedDescriptionParagraphs.length > 0) {
    if (translationMode === 'translated') {
      descriptionHtml = context.translatedDescriptionParagraphs
        .map((p) => escapeXmlWithLineBreaks(stripTranslationNumberPrefix(p.sourceText, p.translatedText ?? p.sourceText)))
        .join('<br/>');
    } else {
      const td = context.translatedDescriptionParagraphs
        .map((p) => {
          const safe = p.translatedText
            ? stripTranslationNumberPrefix(p.sourceText, p.translatedText)
            : null;
          return safe
            ? `${escapeXmlWithLineBreaks(p.sourceText)}<br/>${escapeXmlWithLineBreaks(safe)}`
            : escapeXmlWithLineBreaks(p.sourceText);
        })
        .join('<br/>');
      descriptionHtml = `${escapeXmlWithLineBreaks(context.snapshot.metadata.description || '暂无简介。')}<br/><br/>${td}`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${escapeXml(novelTitle)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <section>
      <h1>${escapeXml(novelTitle)}</h1>
      <p class="meta">作者：${escapeXml(localizedText(context.snapshot.metadata.author || '未知作者', context.translatedAuthor, translationMode))}</p>
      <p class="meta">数据源：${escapeXml(context.snapshot.sourceId)}</p>
      <p class="meta">作品 ID：${escapeXml(context.snapshot.metadata.novelId)}</p>
      <p class="meta">已导出章节：${context.chapters.length}/${context.snapshot.metadata.chapterCount}</p>
      <p>${descriptionHtml}</p>
    </section>
  </body>
</html>`;
}

function renderEpubChapter(
  context: ExportRenderContext,
  chapter: StoredChapterRecord,
  volumeTitle: string,
  chapterNumber: number,
): string {
  const assets = context.assetsByChapterId.get(chapter.id) ?? [];
  const content = resolveChapterExportContent(context, chapter);
  const body = renderEpubMarkdown(content, assets);
  const modeNote = context.translationMode === 'bilingual'
    ? '<p class="meta">双语对照 · 原文<span style="opacity:0.55"> / 译文</span></p>'
    : context.translationMode === 'translated'
      ? '<p class="meta">译文</p>'
      : '';
  const chHeading = localizedText(formatChapterHeading(chapter), context.translatedChapterTitles?.get(chapter.id), context.translationMode);
  const volLocalized = volumeTitle ? localizedText(volumeTitle, context.translatedVolumeTitles?.get(volumeTitle), context.translationMode) : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${escapeXml(chHeading)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <article>
      <h1>${escapeXml(chHeading)}</h1>
      ${volLocalized ? `<p class="meta">${escapeXml(volLocalized)}</p>` : ''}
      ${modeNote}
      ${body}
    </article>
  </body>
</html>`;
}

function renderEpubVolume(
  context: ExportRenderContext,
  volume: ExportRenderContext['volumeGroups'][number],
): string {
  const volTitleLocalized = localizedText(volume.title, context.translatedVolumeTitles?.get(volume.rawTitle), context.translationMode);
  const chapterLinks = volume.chapters
    .map((chapter) => {
      const chHeading = localizedText(formatChapterHeading(chapter), context.translatedChapterTitles?.get(chapter.id), context.translationMode);
      const chapterFileName = `chapter-${String(chapter.index).padStart(4, '0')}.xhtml`;
      return `<li><a href="${chapterFileName}">${escapeXml(chHeading)}</a></li>`;
    })
    .join('\n        ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${escapeXml(volTitleLocalized)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <section>
      <h1>${escapeXml(volTitleLocalized)}</h1>
      <p class="meta">本卷目录</p>
      <ol>
        ${chapterLinks}
      </ol>
    </section>
  </body>
</html>`;
}

function renderEpubParagraph(paragraph: string, assets: PreparedMediaAsset[]): string {
  const trimmed = paragraph.trim();

  if (trimmed === CHAPTER_SECTION_DIVIDER) {
    return '<hr class="section-divider"/>';
  }

  const markdownImageMatch = paragraph.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/i);

  if (markdownImageMatch) {
    const altText = markdownImageMatch[1] ?? '';
    const sourceUrl = markdownImageMatch[2];
    const asset = assets.find((candidate) => candidate.sourceUrl === sourceUrl);

    if (asset?.data) {
      return `<figure><img src="${escapeXmlAttribute(asset.epubTarget)}" alt="${escapeXmlAttribute(altText)}"/></figure>`;
    }

    if (sourceUrl) {
      return `<p><a href="${escapeXmlAttribute(sourceUrl)}">${escapeXml(sourceUrl)}</a></p>`;
    }
  }

  const bareImageMatch = trimmed.match(/^https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s)]*)?$/i);

  if (bareImageMatch) {
    const sourceUrl = bareImageMatch[0];
    const asset = assets.find((candidate) => candidate.sourceUrl === sourceUrl);

    if (asset?.data) {
      return `<figure><img src="${escapeXmlAttribute(asset.epubTarget)}" alt="章节插图"/></figure>`;
    }

    return `<p><a href="${escapeXmlAttribute(sourceUrl)}">${escapeXml(sourceUrl)}</a></p>`;
  }

  const html = escapeXml(paragraph).replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1">$1</a>');
  return `<p>${html}</p>`;
}

function groupChaptersByVolume(chapters: StoredChapterRecord[]): Array<{
  index: number;
  rawTitle: string;
  title: string;
  chapters: StoredChapterRecord[];
}> {
  const groups: Array<{
    index: number;
    rawTitle: string;
    title: string;
    chapters: StoredChapterRecord[];
  }> = [];

  for (const chapter of chapters) {
    const rawTitle = chapter.volumeTitle?.trim() || '正文';
    const current = groups.at(-1);

    if (!current || current.rawTitle !== rawTitle) {
      const groupIndex = groups.length + 1;
      groups.push({
        index: groupIndex,
        rawTitle,
        title: formatVolumeHeading(groupIndex, rawTitle),
        chapters: [chapter],
      });
      continue;
    }

    current.chapters.push(chapter);
  }

  return groups;
}

/**
 * 根据导出翻译模式解析章节内容。
 *
 * - `original`：返回原始章节内容。
 * - `translated`：按段落拼接译文；无译文的段落保留原文。
 * - `bilingual`：逐段输出「原文\n译文」对照格式。
 */
function resolveChapterExportContent(context: ExportRenderContext, chapter: StoredChapterRecord): string {
  if (context.translationMode === 'original') {
    return chapter.content ?? '';
  }

  const translatedParagraphs = context.translatedParagraphsByChapterId.get(chapter.id);
  if (!translatedParagraphs || translatedParagraphs.length === 0) {
    return chapter.content ?? '';
  }

  if (context.translationMode === 'translated') {
    return translatedParagraphs
      .map((tp) => {
        const cleaned = tp.translatedText
          ? stripTranslationNumberPrefix(tp.sourceText, tp.translatedText)
          : tp.sourceText;
        return cleaned;
      })
      .join('\n\n');
  }

  // bilingual mode：仅当译文有效且与原文不同时才显示双语对照
  return translatedParagraphs
    .map((tp) => {
      const safeText = tp.translatedText && tp.translatedText !== tp.sourceText && tp.translatedText.trim().length > 0
        ? stripTranslationNumberPrefix(tp.sourceText, tp.translatedText)
        : null;
      if (safeText) {
        return `${tp.sourceText}\n\n${safeText}`;
      }
      return tp.sourceText;
    })
    .join('\n\n');
}

function rewriteMarkdownContent(content: string, assets: PreparedMediaAsset[]): string {
  const replacements = new Map(assets.map((asset) => [asset.sourceUrl, asset.markdownTarget]));
  const withMarkdownImages = content.replace(MARKDOWN_IMAGE_PATTERN, (_match, altText: string, sourceUrl: string) => {
    const target = replacements.get(sourceUrl) ?? sourceUrl;
    return `![${altText}](${target})`;
  });

  return withMarkdownImages.replace(IMAGE_URL_PATTERN, (match) => replacements.get(match) ?? match);
}

function renderEpubMarkdown(content: string, assets: PreparedMediaAsset[]): string {
  const rewritten = rewriteMarkdownContent(content, assets)
    .replace(/<\/?[a-z][^>]*>/gi, (tag) => tag.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return String(marked.parse(rewritten, { async: false, gfm: true, breaks: false })).replace(/<hr>/g, '<hr class="section-divider"/>');
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function normalizePlainParagraph(paragraph: string): string {
  return paragraph
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

function markdownToPlainText(markdown: string): string {
  const html = String(marked.parse(markdown, { async: false, gfm: true, breaks: false }))
    .replace(/<hr\s*\/?>/gi, '\n---\n');
  return decodeHtmlEntities(stripHtmlTags(html))
    .replace(/\u00a0/g, ' ')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildBaseName(snapshot: StoredNovelSnapshot): string {
  const normalizedTitle = snapshot.metadata.title
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-');

  return [snapshot.sourceId, snapshot.metadata.novelId, normalizedTitle || 'novel']
    .filter((segment) => segment.length > 0)
    .join('-')
    .toLowerCase();
}

function inferUrlExtension(sourceUrl: string): string {
  try {
    return path.extname(new URL(sourceUrl).pathname).toLowerCase();
  } catch {
    return '';
  }
}

function inferMediaType(filePathOrUrl: string): string {
  switch (path.extname(filePathOrUrl).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXml(value);
}

export function isLibraryExportFormat(value: string): value is LibraryExportFormat {
  return LIBRARY_EXPORT_FORMATS.includes(value as LibraryExportFormat);
}

/**
 * 根据导出模式获取翻译后的文本。
 *
 * - original: 返回原文
 * - translated: 返回译文，缺省回退原文
 * - bilingual: 返回 原文【译文】，缺译回退原文
 */
function localizedText(original: string, translated: string | null | undefined, mode: LibraryExportTranslationMode): string {
  if (mode === 'original' || !translated) return original;
  if (mode === 'translated') return translated;
  return `${original}【${translated}】`;
}

function formatChapterHeading(chapter: StoredChapterRecord): string {
  return `第${chapter.index}章 ${chapter.title}`;
}

function formatVolumeHeading(index: number, rawTitle: string): string {
  const normalizedTitle = rawTitle
    .replace(/^第\s*[0-9一二三四五六七八九十百千]+\s*[卷巻章部篇幕節节回話话]\s*/u, '')
    .replace(/^[0-9]+\s*/u, '')
    .trim();

  if (normalizedTitle.length === 0 || normalizedTitle === '正文') {
    return `第${index}卷`;
  }

  return `第${index}卷 ${normalizedTitle}`;
}

function escapeXmlWithLineBreaks(value: string): string {
  return escapeXml(value).replace(/\r?\n/g, '<br/>');
}

function localizedTags(original: string[], translated: string[] | undefined, mode: LibraryExportTranslationMode): string[] {
  if (mode === 'original' || !translated?.length) return original;
  if (mode === 'translated') return translated;
  return original.map((tag, index) => translated[index] ? `${tag}【${translated[index]}】` : tag);
}
