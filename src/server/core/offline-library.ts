import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  NovelMetadata,
  StoredChapterRecord,
  StoredNovelSnapshot,
} from './spider';

export interface LibraryNovelSummary {
  sourceId: string;
  metadata: NovelMetadata;
  updatedAt: string;
  downloadedChapters: number;
  failedChapters: number;
  indexedChapters: number;
  latestDownloadedAt: string | null;
}

export interface LibraryMediaSummary {
  total: number;
  cached: number;
  pending: number;
}

export interface LibraryMediaAsset {
  id: string;
  mediaType: 'image';
  sourceUrl: string;
  cached: boolean;
  fileName: string | null;
  publicUrl: string | null;
}

export interface LibraryChapterSummary extends StoredChapterRecord {
  hasContent: boolean;
  media: LibraryMediaSummary;
}

export interface LibraryNovelDetail {
  sourceId: string;
  metadata: NovelMetadata;
  updatedAt: string;
  chapters: LibraryChapterSummary[];
  stats: {
    total: number;
    downloaded: number;
    failed: number;
    pending: number;
  };
  media: LibraryMediaSummary;
}

export interface LibraryChapterDetail {
  sourceId: string;
  metadata: NovelMetadata;
  updatedAt: string;
  chapter: LibraryChapterSummary & {
    content: string;
  };
  previousChapterId: string | null;
  nextChapterId: string | null;
  mediaAssets: LibraryMediaAsset[];
}

export interface OfflineLibraryAssetServiceOptions {
  storageRoot?: string;
  fetchImpl?: typeof fetch;
}

const IMAGE_URL_PATTERN = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s)]*)?)/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;

export class OfflineLibraryAssetService {
  readonly #storageRoot: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: OfflineLibraryAssetServiceOptions = {}) {
    this.#storageRoot = options.storageRoot ?? path.resolve(process.cwd(), 'data', 'offline-assets');
    this.#fetchImpl = options.fetchImpl ?? fetch;
    fs.mkdirSync(this.#storageRoot, { recursive: true });
  }

  listMediaAssets(snapshot: StoredNovelSnapshot, chapter: StoredChapterRecord): LibraryMediaAsset[] {
    return extractMediaUrls(chapter.content).map((sourceUrl) => {
      const cachedFilePath = this.findCachedAssetFile(snapshot.sourceId, snapshot.metadata.novelId, chapter.id, sourceUrl);

      return {
        id: hashMediaUrl(sourceUrl),
        mediaType: 'image',
        sourceUrl,
        cached: cachedFilePath !== null,
        fileName: cachedFilePath ? path.basename(cachedFilePath) : null,
        publicUrl: cachedFilePath
          ? buildMediaPublicUrl(snapshot.sourceId, snapshot.metadata.novelId, chapter.id, sourceUrl)
          : null,
      } satisfies LibraryMediaAsset;
    });
  }

  summarizeChapter(snapshot: StoredNovelSnapshot, chapter: StoredChapterRecord): LibraryChapterSummary {
    const mediaAssets = this.listMediaAssets(snapshot, chapter);

    return {
      ...chapter,
      hasContent: typeof chapter.content === 'string' && chapter.content.trim().length > 0,
      media: summarizeMediaAssets(mediaAssets),
    };
  }

  buildNovelDetail(snapshot: StoredNovelSnapshot): LibraryNovelDetail {
    const chapters = snapshot.chapters.map((chapter) => this.summarizeChapter(snapshot, chapter));
    const mediaAssets = chapters.flatMap((chapter) =>
      this.listMediaAssets(snapshot, chapter),
    );

    return {
      sourceId: snapshot.sourceId,
      metadata: snapshot.metadata,
      updatedAt: snapshot.updatedAt,
      chapters,
      stats: {
        total: chapters.length,
        downloaded: chapters.filter((chapter) => chapter.status === 'downloaded').length,
        failed: chapters.filter((chapter) => chapter.status === 'failed').length,
        pending: chapters.filter((chapter) => chapter.status !== 'downloaded').length,
      },
      media: summarizeMediaAssets(mediaAssets),
    };
  }

  buildChapterDetail(snapshot: StoredNovelSnapshot, chapterId: string): LibraryChapterDetail | null {
    const chapterIndex = snapshot.chapters.findIndex((chapter) => chapter.id === chapterId);

    if (chapterIndex < 0) {
      return null;
    }

    const chapter = snapshot.chapters[chapterIndex];
    if (!chapter || !chapter.content) {
      return null;
    }

    const summarizedChapter = this.summarizeChapter(snapshot, chapter);

    return {
      sourceId: snapshot.sourceId,
      metadata: snapshot.metadata,
      updatedAt: snapshot.updatedAt,
      chapter: {
        ...summarizedChapter,
        content: chapter.content,
      },
      previousChapterId: snapshot.chapters[chapterIndex - 1]?.id ?? null,
      nextChapterId: snapshot.chapters[chapterIndex + 1]?.id ?? null,
      mediaAssets: this.listMediaAssets(snapshot, chapter),
    };
  }

  async cacheMediaAsset(
    snapshot: StoredNovelSnapshot,
    chapterId: string,
    mediaId: string,
  ): Promise<LibraryMediaAsset | null> {
    const chapter = snapshot.chapters.find((entry) => entry.id === chapterId);

    if (!chapter) {
      return null;
    }

    const sourceUrl = extractMediaUrls(chapter.content).find((value) => hashMediaUrl(value) === mediaId);

    if (!sourceUrl) {
      return null;
    }

    const cachedFilePath = this.findCachedAssetFile(snapshot.sourceId, snapshot.metadata.novelId, chapter.id, sourceUrl);

    if (!cachedFilePath) {
      const response = await this.#fetchImpl(sourceUrl);

      if (!response.ok) {
        throw new Error(`Media download failed with status ${response.status}.`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const extension = inferFileExtension(sourceUrl, response.headers.get('content-type'));
      const filePath = this.buildAssetFilePath(snapshot.sourceId, snapshot.metadata.novelId, chapter.id, sourceUrl, extension);

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
    }

    return this.listMediaAssets(snapshot, chapter).find((asset) => asset.id === mediaId) ?? null;
  }

  getCachedMediaFilePath(
    snapshot: StoredNovelSnapshot,
    chapterId: string,
    mediaId: string,
  ): string | null {
    const chapter = snapshot.chapters.find((entry) => entry.id === chapterId);

    if (!chapter) {
      return null;
    }

    const sourceUrl = extractMediaUrls(chapter.content).find((value) => hashMediaUrl(value) === mediaId);
    if (!sourceUrl) {
      return null;
    }

    return this.findCachedAssetFile(snapshot.sourceId, snapshot.metadata.novelId, chapter.id, sourceUrl);
  }

  private findCachedAssetFile(
    sourceId: string,
    novelId: string,
    chapterId: string,
    sourceUrl: string,
  ): string | null {
    const directory = path.join(this.#storageRoot, sourceId, novelId, chapterId);
    const mediaId = hashMediaUrl(sourceUrl);

    if (!fs.existsSync(directory)) {
      return null;
    }

    const fileName = fs
      .readdirSync(directory)
      .find((entry) => entry === `${mediaId}${path.extname(entry)}` || entry.startsWith(`${mediaId}.`));

    return fileName ? path.join(directory, fileName) : null;
  }

  private buildAssetFilePath(
    sourceId: string,
    novelId: string,
    chapterId: string,
    sourceUrl: string,
    extension: string,
  ): string {
    return path.join(
      this.#storageRoot,
      sourceId,
      novelId,
      chapterId,
      `${hashMediaUrl(sourceUrl)}${extension}`,
    );
  }
}

function summarizeMediaAssets(assets: LibraryMediaAsset[]): LibraryMediaSummary {
  return {
    total: assets.length,
    cached: assets.filter((asset) => asset.cached).length,
    pending: assets.filter((asset) => !asset.cached).length,
  };
}

function buildMediaPublicUrl(
  sourceId: string,
  novelId: string,
  chapterId: string,
  sourceUrl: string,
): string {
  const mediaId = hashMediaUrl(sourceUrl);

  return `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/media/${mediaId}/file`;
}

function hashMediaUrl(sourceUrl: string): string {
  return crypto.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16);
}

function extractMediaUrls(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const results: string[] = [];
  const seen = new Set<string>();
  const addMatch = (sourceUrl: string) => {
    const normalized = normalizeMediaUrl(sourceUrl);

    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    results.push(normalized);
  };

  for (const match of content.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const sourceUrl = match[1];
    if (sourceUrl) {
      addMatch(sourceUrl);
    }
  }

  for (const match of content.matchAll(IMAGE_URL_PATTERN)) {
    const sourceUrl = match[1];
    if (sourceUrl) {
      addMatch(sourceUrl);
    }
  }

  return results;
}

function normalizeMediaUrl(sourceUrl: string): string | null {
  const trimmed = sourceUrl.trim().replace(/[),.!?]+$/g, '');

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function inferFileExtension(sourceUrl: string, contentType: string | null): string {
  const pathname = safePathname(sourceUrl);
  const extension = path.extname(pathname).toLowerCase();

  if (extension) {
    return extension;
  }

  switch ((contentType ?? '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '.bin';
  }
}

function safePathname(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).pathname;
  } catch {
    return sourceUrl;
  }
}