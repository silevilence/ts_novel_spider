import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { EbookPreview } from '../contracts/ebook';

const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export function resolveEpubPath(baseFile: string, href: string): string {
  const decoded = decodeURIComponent(href.split('#')[0]!);
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.includes('\\') || decoded.startsWith('/')) throw new Error('不支持的 EPUB 资源路径。');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), decoded));
  if (resolved === '..' || resolved.startsWith('../')) throw new Error('EPUB 资源路径越界。');
  return resolved;
}

/** Read inflated entries with actual byte limits, including archives with misleading headers. */
async function readZipEntry(entry: JSZip.JSZipObject): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = entry.nodeStream('nodebuffer') as Readable;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_ENTRY_BYTES) {
        reject(new Error('EPUB 单个资源解压后超过 16 MB。'));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export interface EpubMaterial {
  files: Map<string, Buffer>;
  chapterFiles: Map<string, string>;
  html: string[];
}

export async function parseEpubEbook(data: Buffer, fileName: string): Promise<{ preview: EbookPreview; material: EpubMaterial }> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('EPUB 压缩包损坏或格式不支持。'); }
  const entries = Object.values(zip.files);
  if (entries.length > 5000) throw new Error('EPUB 资源条目超过 5000。');
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const entry of entries) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (original.split(/[\\/]/).includes('..') || original.includes('\\') || original.startsWith('/') || /^[a-z]:/i.test(original)) throw new Error('EPUB 压缩条目路径越界。');
    if (entry.dir) continue;
    const bytes = await readZipEntry(entry);
    total += bytes.length;
    if (total > MAX_UNPACKED_BYTES) throw new Error('EPUB 总解压体积超过 128 MB。');
    files.set(entry.name, bytes);
  }
  const container = files.get('META-INF/container.xml');
  if (!container) throw new Error('EPUB 缺少 container.xml。');
  const containerXml = load(container.toString('utf8'), { xml: true });
  const opfPath = containerXml('rootfile').first().attr('full-path');
  if (!opfPath || !files.has(opfPath)) throw new Error('EPUB 缺少内容清单。');
  const $ = load(files.get(opfPath)!.toString('utf8'), { xml: true });
  if ($('meta[property="rendition:layout"]').text().trim() === 'pre-paginated' || $('meta[name="fixed-layout"]').attr('content') === 'true') throw new Error('首版不支持固定版式 EPUB。');
  const items = new Map<string, string>();
  $('manifest item').each((_, item) => {
    const id = $(item).attr('id'); const href = $(item).attr('href');
    if (id && href) items.set(id, resolveEpubPath(opfPath, href));
  });
  const labels = new Map<string, string>();
  const navItem = $('manifest item').filter((_, node) => ($(node).attr('properties') ?? '').split(/\s+/).includes('nav')).first();
  const navPath = items.get(navItem.attr('id') ?? '');
  const ncxPath = items.get($('spine').attr('toc') ?? '');
  if (navPath && files.has(navPath)) {
    const nav = load(files.get(navPath)!.toString('utf8'));
    nav('nav a[href]').each((_, node) => {
      const target = resolveEpubPath(navPath, nav(node).attr('href')!);
      if (!labels.has(target)) labels.set(target, nav(node).text().trim());
    });
  } else if (ncxPath && files.has(ncxPath)) {
    const ncx = load(files.get(ncxPath)!.toString('utf8'), { xml: true });
    ncx('navPoint').each((_, node) => {
      const href = ncx(node).children('content').attr('src');
      if (href) { const target = resolveEpubPath(ncxPath, href); if (!labels.has(target)) labels.set(target, ncx(node).children('navLabel').text().trim()); }
    });
  }
  const warnings: string[] = [];
  if (!labels.size) warnings.push('未找到可用目录，已按阅读顺序生成章节列表。');
  const chapters: EbookPreview['chapters'] = [];
  const chapterFiles = new Map<string, string>();
  const html: string[] = [];
  $('spine itemref').each((_, node) => {
    const target = items.get($(node).attr('idref') ?? '');
    if (!target || !files.has(target)) throw new Error('EPUB 阅读顺序引用的正文缺失。');
    const source = files.get(target)!.toString('utf8');
    if (!/<(?:[a-z]+:)?(?:html|body)[\s>]/i.test(source)) throw new Error('EPUB 正文无法解析，可能已加密或损坏。');
    const doc = load(source);
    const id = crypto.randomUUID();
    const title = labels.get(target) || doc('h1,h2,title').first().text().trim() || `第 ${chapters.length + 1} 章`;
    const content = htmlToEbookMarkdown(source);
    if (!content.trim()) { warnings.push(`章节“${title}”未提取到文字。`); }
    chapters.push({ id, title, content }); chapterFiles.set(target, id); html.push(source);
  });
  if (!chapters.length || !chapters.some(chapter => chapter.content.trim())) throw new Error('EPUB 没有可导入的文字正文。');
  return {
    preview: {
      title: $('metadata > dc\\:title').first().text().trim() || path.parse(fileName).name,
      author: $('metadata > dc\\:creator').map((_, node) => $(node).text().trim()).get().join('、'),
      description: $('metadata > dc\\:description').text().trim(),
      tags: $('metadata > dc\\:subject').map((_, node) => $(node).text().trim()).get().filter(Boolean), chapters, warnings,
    }, material: { files, chapterFiles, html },
  };
}

export function htmlToEbookMarkdown(html: string, mapImage?: (src: string) => string, mapLink?: (href: string) => string, mapAnchor?: (id: string) => string): string {
  const $ = load(html);
  function render(node: AnyNode): string {
    if (node.type === 'text') return node.data.replace(/[\\`*_[\]<>]/g, '\\$&');
    if (node.type !== 'tag') return '';
    const el = $(node);
    if (['script', 'style', 'iframe', 'object', 'form'].includes(node.name)) return '';
    const inside = () => node.children.map(render).join('');
    const anchor = el.attr('id') && mapAnchor ? `\n\n${mapAnchor(el.attr('id')!)}\n\n` : '';
    let text: string;
    switch (node.name) {
      case 'img': { const src = mapImage?.(el.attr('src') ?? ''); text = src ? `![${(el.attr('alt') ?? '图片').replace(/[\[\]]/g, '')}](${src})` : '[图片未转换]'; break; }
      case 'br': text = '  \n'; break;
      case 'hr': text = '\n\n---\n\n'; break;
      case 'strong': case 'b': text = `**${inside()}**`; break;
      case 'em': case 'i': text = `*${inside()}*`; break;
      case 'a': { const href = mapLink?.(el.attr('href') ?? ''); text = href ? `[${inside()}](${href})` : inside(); break; }
      case 'li': text = `\n- ${inside().trim()}\n`; break;
      case 'table': {
        const cells: string[][] = [];
        el.find('tr').each((_, row) => { cells.push($(row).children('th,td').toArray().map(cell => $(cell).contents().toArray().map(render).join('').trim().replace(/\|/g, '\\|').replace(/\n/g, ' '))); });
        const width = Math.max(0, ...cells.map(row => row.length));
        const tableRows = cells.map(row => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`);
        if (tableRows.length) tableRows.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
        text = `\n\n${tableRows.join('\n')}\n\n`; break;
      }
      default: text = /^h[1-6]$/.test(node.name) ? `\n\n${'#'.repeat(Number(node.name[1]))} ${inside().trim()}\n\n`
        : ['p', 'div', 'section', 'article', 'aside', 'blockquote', 'ul', 'ol'].includes(node.name) ? `\n\n${inside()}\n\n` : inside();
    }
    return anchor + text;
  }
  return $('body').contents().toArray().map(render).join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function preserveEpubResources(parsed: Awaited<ReturnType<typeof parseEpubEbook>>, directory: string): EbookPreview {
  const { preview, material } = parsed;
  const anchor = (chapterId: string, fragment: string) => `ebook-${chapterId}-${crypto.createHash('sha256').update(fragment).digest('hex').slice(0, 16)}`;
  const warnings = new Set(preview.warnings);
  const paths = [...material.chapterFiles.keys()];
  preview.chapters.forEach((chapter, index) => {
    const base = paths[index]!;
    const image = (src: string) => {
      try {
        const target = resolveEpubPath(base, src);
        const data = material.files.get(target);
        const extension = path.posix.extname(target).toLowerCase();
        if (!data || !['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) throw new Error('图片缺失或格式不支持');
        const name = `${crypto.createHash('sha256').update(data).digest('hex')}${extension}`;
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, name), data);
        return `ebook://${name}`;
      } catch { warnings.add(`章节“${chapter.title}”有图片缺失、不支持或属于外部资源，未自动下载。`); return ''; }
    };
    const link = (href: string) => {
      if (!href) return '';
      if (/^https?:\/\//i.test(href)) return href.replace(/[()\s]/g, encodeURIComponent);
      try {
        const target = href.startsWith('#') ? base : resolveEpubPath(base, href);
        const chapterId = material.chapterFiles.get(target);
        if (!chapterId) throw new Error('无法定位');
        return `#${anchor(chapterId, decodeURIComponent(href.split('#').slice(1).join('#')))}`;
      } catch { warnings.add(`章节“${chapter.title}”有无法转换的内部链接。`); return ''; }
    };
    const markAnchor = (fragment: string) => `[${anchor(chapter.id, fragment)}]: #`;
    chapter.content = `${markAnchor('')}\n\n${htmlToEbookMarkdown(material.html[index]!, image, link, markAnchor)}`;
  });
  preview.warnings = [...warnings];
  return preview;
}
