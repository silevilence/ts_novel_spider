export interface EbookChapter { id: string; title: string; content: string }
export interface EbookPreview {
  title: string;
  author: string;
  description: string;
  tags: string[];
  chapters: EbookChapter[];
  warnings: string[];
  encoding?: string;
}
export interface EbookImport {
  id: string;
  fileName: string;
  format: 'epub' | 'txt';
  size: number;
  sha256: string;
  status: 'uploaded' | 'parsing' | 'ready' | 'failed' | 'completed';
  novelId: string | null;
  preview: EbookPreview | null;
  error: string | null;
  updatedAt: string;
}
export type EbookMetadata = Pick<EbookPreview, 'title' | 'author' | 'description' | 'tags'>;
export type EbookOriginalInfo = Pick<EbookImport, 'id' | 'fileName' | 'format' | 'size'>;
export interface EbookImportSummary extends Omit<EbookImport, 'preview'> {
  preview: (EbookMetadata & { chapterCount: number; excerpt: string; warnings: string[]; encoding?: string }) | null;
  deleted: boolean;
  sameTitleCount: number;
}
export const MAX_EBOOK_BYTES = 32 * 1024 * 1024;
