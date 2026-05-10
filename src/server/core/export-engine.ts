import fs from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';

import type { OfflineLibraryAssetService } from './offline-library';
import type { StoredChapterRecord, StoredNovelSnapshot } from './spider';

export const LIBRARY_EXPORT_FORMATS = ['markdown', 'txt', 'epub'] as const;

export type LibraryExportFormat = (typeof LIBRARY_EXPORT_FORMATS)[number];

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
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
const CHAPTER_SECTION_DIVIDER = '---';

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

  async generate(snapshot: StoredNovelSnapshot, format: LibraryExportFormat): Promise<GeneratedLibraryExport> {
    const strategy = this.#strategies.get(format);

    if (!strategy) {
      throw new Error(`Unsupported export format: ${format}`);
    }

    const context = this.prepareContext(snapshot);
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

  private prepareContext(snapshot: StoredNovelSnapshot): ExportRenderContext {
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

      for (const chapter of volume.chapters) {
        const chapterFileName = `chapter-${String(chapterFileIndex).padStart(4, '0')}.xhtml`;
        const itemId = `chapter-${chapterFileIndex}`;
        content.file(chapterFileName, renderEpubChapter(context, chapter, volume.title, chapterFileIndex));
        manifestItems.push(
          `<item id="${itemId}" href="${chapterFileName}" media-type="application/xhtml+xml"/>`,
        );
        spineItems.push(`<itemref idref="${itemId}"/>`);
        volumeChapterLinks.push(`<li><a href="${chapterFileName}">${escapeXml(formatChapterHeading(chapter))}</a></li>`);
        chapterFileIndex += 1;
      }

      navLinks.push(`
<li>
  <a href="${volumeFileName}">${escapeXml(volume.title)}</a>
  <ol>
    ${volumeChapterLinks.join('\n    ')}
  </ol>
</li>`.trim());
    }

    content.file(
      'nav.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
  <head>
    <title>${escapeXml(context.snapshot.metadata.title)}</title>
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

    content.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(context.snapshot.metadata.title)}</dc:title>
    <dc:creator>${escapeXml(context.snapshot.metadata.author || '未知作者')}</dc:creator>
    <dc:description>${escapeXml(context.snapshot.metadata.description || '')}</dc:description>
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
  const lines: string[] = [
    `# ${context.snapshot.metadata.title}`,
    '',
    `- 作者：${context.snapshot.metadata.author || '未知作者'}`,
    `- 数据源：${context.snapshot.sourceId}`,
    `- 作品 ID：${context.snapshot.metadata.novelId}`,
    `- 已导出章节：${context.chapters.length}/${context.snapshot.metadata.chapterCount}`,
    `- 更新时间：${context.snapshot.updatedAt}`,
  ];

  if (context.snapshot.metadata.tags.length > 0) {
    lines.push(`- 标签：${context.snapshot.metadata.tags.join(' / ')}`);
  }

  lines.push('', '## 简介', '', context.snapshot.metadata.description || '暂无简介。', '');

  for (const volume of context.volumeGroups) {
    lines.push(`## ${volume.title}`, '');

    for (const chapter of volume.chapters) {
      const assets = context.assetsByChapterId.get(chapter.id) ?? [];
      lines.push(`### ${formatChapterHeading(chapter)}`, '');
      lines.push(rewriteMarkdownContent(chapter.content ?? '', assets), '');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderPlainTextDocument(context: ExportRenderContext): string {
  const lines: string[] = [
    context.snapshot.metadata.title,
    `作者：${context.snapshot.metadata.author || '未知作者'}`,
    '',
    normalizePlainParagraph(context.snapshot.metadata.description || '暂无简介。'),
    '',
  ];

  context.chapters.forEach((chapter, index) => {
    const chapterTitle = formatChapterHeading(chapter);
    const paragraphs = splitParagraphs(chapter.content ?? '').map(normalizePlainParagraph);
    lines.push(chapterTitle);
    lines.push(...paragraphs);

    if (index < context.chapters.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderEpubIntro(context: ExportRenderContext): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${escapeXml(context.snapshot.metadata.title)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <section>
      <h1>${escapeXml(context.snapshot.metadata.title)}</h1>
      <p class="meta">作者：${escapeXml(context.snapshot.metadata.author || '未知作者')}</p>
      <p class="meta">数据源：${escapeXml(context.snapshot.sourceId)}</p>
      <p class="meta">作品 ID：${escapeXml(context.snapshot.metadata.novelId)}</p>
      <p class="meta">已导出章节：${context.chapters.length}/${context.snapshot.metadata.chapterCount}</p>
      <p>${escapeXml(context.snapshot.metadata.description || '暂无简介。')}</p>
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
  const body = splitParagraphs(chapter.content ?? '')
    .map((paragraph) => renderEpubParagraph(paragraph, assets))
    .join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${escapeXml(formatChapterHeading(chapter))}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <article>
      <h1>${escapeXml(formatChapterHeading(chapter))}</h1>
      <p class="meta">${escapeXml(volumeTitle)}</p>
      ${body}
    </article>
  </body>
</html>`;
}

function renderEpubVolume(
  _context: ExportRenderContext,
  volume: ExportRenderContext['volumeGroups'][number],
): string {
  const chapterLinks = volume.chapters
    .map((chapter) => {
      const chapterFileName = `chapter-${String(chapter.index).padStart(4, '0')}.xhtml`;
      return `<li><a href="${chapterFileName}">${escapeXml(formatChapterHeading(chapter))}</a></li>`;
    })
    .join('\n        ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${escapeXml(volume.title)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <section>
      <h1>${escapeXml(volume.title)}</h1>
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

function rewriteMarkdownContent(content: string, assets: PreparedMediaAsset[]): string {
  const replacements = new Map(assets.map((asset) => [asset.sourceUrl, asset.markdownTarget]));
  const withMarkdownImages = content.replace(MARKDOWN_IMAGE_PATTERN, (_match, altText: string, sourceUrl: string) => {
    const target = replacements.get(sourceUrl) ?? sourceUrl;
    return `![${altText}](${target})`;
  });

  return withMarkdownImages.replace(IMAGE_URL_PATTERN, (match) => replacements.get(match) ?? match);
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