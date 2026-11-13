import crypto from 'node:crypto';
import path from 'node:path';
import type { EbookChapter, EbookPreview } from '../contracts/ebook';

export function parseTextEbook(data: Buffer, fileName: string, requestedEncoding?: string): EbookPreview {
  if (requestedEncoding && !['utf-8', 'gb18030'].includes(requestedEncoding)) throw new Error('不支持此文本编码。');
  let encoding = requestedEncoding ?? 'utf-8';
  let text: string;
  const warnings: string[] = [];
  try { text = new TextDecoder(encoding, { fatal: true }).decode(data); }
  catch {
    if (requestedEncoding) throw new Error('文件无法按所选编码解码，请切换编码。');
    encoding = 'gb18030';
    try { text = new TextDecoder(encoding, { fatal: true }).decode(data); }
    catch { throw new Error('无法解码文本，请检查文件或选择正确编码。'); }
    warnings.push('按 GB18030 解码，请检查正文预览；如有乱码请切换编码后重新解析。');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim() || text.includes('\0')) throw new Error('文件没有有效文本正文。');
  const title = path.parse(fileName).name;
  const chapters: EbookChapter[] = [];
  let chapterTitle = '序言';
  let lines: string[] = [];
  function flush() {
    if (lines.join('\n').trim()) chapters.push({ id: crypto.randomUUID(), title: chapterTitle, content: lines.join('\n').trim() });
    lines = [];
  }
  let hasHeading = false;
  for (const line of text.split('\n')) {
    if (/^\s*(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回卷部篇][ \t　]*.*|chapter\s+\d+.*)\s*$/i.test(line) && line.trim().length <= 100) {
      flush(); chapterTitle = line.trim(); hasHeading = true;
    } else lines.push(line);
  }
  flush();
  if (!hasHeading && chapters[0]) chapters[0].title = '正文';
  if (!chapters.length) throw new Error('只识别到标题，未找到可导入的正文。');
  return { title, author: '', description: '', tags: [], chapters, warnings, encoding };
}
