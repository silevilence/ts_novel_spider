import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_EBOOK_BYTES, type EbookImport, type EbookImportSummary, type EbookMetadata } from '../contracts/ebook';
import type { SqliteNovelRepository } from './novel-repository';
import { parseTextEbook } from './ebook-txt';
import { parseEpubEbook, preserveEpubResources } from './ebook-epub';

export class EbookImportService {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(readonly repository: SqliteNovelRepository, readonly storageRoot: string) {
    fs.mkdirSync(storageRoot, { recursive: true });
    for (const entry of repository.listEbookImports()) {
      if (entry.status === 'parsing') repository.saveEbookImport({ ...entry, status: 'failed', error: '服务已重启，请重试解析。' });
    }
  }

  list(): EbookImport[] { return this.repository.listEbookImports(); }
  summaries(): EbookImportSummary[] {
    const novels = this.repository.listNovels();
    return this.list().map(entry => ({ ...entry,
      deleted: Boolean(entry.novelId && this.repository.getNovelPurgeStatus('manual', entry.novelId)?.deletedAt),
      sameTitleCount: entry.preview ? novels.filter(novel => novel.metadata.title === entry.preview!.title && novel.metadata.novelId !== entry.novelId).length : 0,
      preview: entry.preview ? {
        title: entry.preview.title, author: entry.preview.author, description: entry.preview.description, tags: entry.preview.tags,
        chapterCount: entry.preview.chapters.length, excerpt: entry.preview.chapters.slice(0, 3).map(chapter => `${chapter.title}\n${chapter.content.slice(0, 1000)}`).join('\n\n'),
        warnings: entry.preview.warnings, ...(entry.preview.encoding ? { encoding: entry.preview.encoding } : {}),
      } : null,
    }));
  }

  startParse(id: string, encoding?: string): void {
    const entry = this.get(id);
    if (entry.status === 'parsing' || entry.novelId) return;
    this.repository.saveEbookImport({ ...entry, status: 'parsing', error: null });
    this.#queue = this.#queue.then(async () => {
      this.repository.saveEbookImport({ ...this.get(id), status: 'uploaded' });
      await this.parse(id, encoding);
    }).catch(error => { console.error('Ebook import failed:', error instanceof Error ? error.message : 'unknown'); });
  }
  get(id: string): EbookImport {
    const entry = this.list().find(item => item.id === id);
    if (!entry) throw new Error('导入记录不存在。');
    return entry;
  }
  directory(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('无效的导入标识。');
    return path.join(this.storageRoot, id);
  }
  originalPath(entry: EbookImport): string { return path.join(this.directory(entry.id), `original.${entry.format}`); }

  upload(fileName: string, data: Buffer): { entry: EbookImport; duplicate: boolean } {
    const format = path.extname(fileName).slice(1).toLowerCase();
    if (format !== 'epub' && format !== 'txt') throw new Error('仅支持 EPUB 和 TXT 文件。');
    if (!data.length || data.length > MAX_EBOOK_BYTES) throw new Error('文件不能为空且不能超过 32 MB。');
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const existing = this.list().find(entry => entry.sha256 === sha256);
    if (existing) return { entry: existing, duplicate: true };
    const entry: EbookImport = {
      id: crypto.randomUUID(), fileName: fileName.split(/[\\/]/).pop()!, format, size: data.length, sha256,
      status: 'uploaded', novelId: null, preview: null, error: null, updatedAt: new Date().toISOString(),
    };
    const directory = this.directory(entry.id);
    fs.mkdirSync(directory);
    try {
      fs.writeFileSync(this.originalPath(entry), data, { flag: 'wx' });
      this.repository.saveEbookImport(entry);
    } catch (error) { fs.rmSync(directory, { recursive: true }); throw error; }
    return { entry, duplicate: false };
  }

  confirm(id: string, metadata: EbookMetadata): string {
    const entry = this.get(id);
    if (!fs.existsSync(this.originalPath(entry))) throw new Error('原始文件缺失，请重新上传。');
    return this.repository.commitEbookImport(id, metadata);
  }

  async parse(id: string, encoding?: string): Promise<EbookImport> {
    const entry = this.get(id);
    if (entry.status === 'parsing' || entry.novelId) return entry;
    this.repository.saveEbookImport({ ...entry, status: 'parsing', error: null });
    try {
      const data = await fs.promises.readFile(this.originalPath(entry));
      const preview = entry.format === 'txt' ? parseTextEbook(data, entry.fileName, encoding)
        : preserveEpubResources(await parseEpubEbook(data, entry.fileName), path.join(this.directory(entry.id), 'assets'));
      this.repository.saveEbookImport({ ...entry, status: 'ready', preview, error: null, updatedAt: new Date().toISOString() });
    } catch (error) {
      this.repository.saveEbookImport({ ...entry, status: 'failed', preview: null, error: error instanceof Error ? error.message : '解析失败。', updatedAt: new Date().toISOString() });
    }
    return this.get(id);
  }

  assetPath(novelId: string, name: string): string | null {
    if (!/^[a-f0-9]{64}\.(png|jpe?g|gif|webp)$/.test(name) || this.repository.getNovelPurgeStatus('manual', novelId)?.deletedAt) return null;
    const entry = this.repository.getEbookForNovel(novelId);
    if (!entry) return null;
    const file = path.join(this.directory(entry.id), 'assets', name);
    return fs.existsSync(file) ? file : null;
  }

  purge(novelId: string, relatedDirectories: string[] = []): boolean {
    const entry = this.repository.getEbookForNovel(novelId);
    if (!entry || !this.repository.getNovelPurgeStatus('manual', novelId)?.canPurge) return false;
    this.repository.saveEbookImport({ ...entry, purging: true });
    for (const directory of [...relatedDirectories, this.directory(entry.id)]) {
      try { if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true }); }
      catch (error) {
        const message = `清理未完成：${directory}；${error instanceof Error ? error.message : '无法删除文件'}。请处理后重试永久清理。`;
        this.repository.saveEbookImport({ ...entry, purging: true, error: message });
        throw new Error(message);
      }
    }
    if (!this.repository.purgeNovel('manual', novelId)) return false;
    this.repository.removeEbookImport(entry.id);
    return true;
  }
}
