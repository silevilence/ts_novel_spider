import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_EBOOK_BYTES, type EbookImport, type EbookMetadata } from '../contracts/ebook';
import type { SqliteNovelRepository } from './novel-repository';

export class EbookImportService {
  constructor(readonly repository: SqliteNovelRepository, readonly storageRoot: string) {
    fs.mkdirSync(storageRoot, { recursive: true });
    for (const entry of repository.listEbookImports()) {
      if (entry.status === 'parsing') repository.saveEbookImport({ ...entry, status: 'failed', error: '服务已重启，请重试解析。' });
    }
  }

  list(): EbookImport[] { return this.repository.listEbookImports(); }
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
}
