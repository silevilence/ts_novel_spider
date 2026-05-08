import Database from 'better-sqlite3';

import type {
  ChapterContent,
  ChapterIndexEntry,
  NovelMetadata,
  StoredChapterRecord,
  StoredNovelSnapshot,
} from './spider';

interface NovelRow {
  source_id: string;
  novel_id: string;
  title: string;
  author: string;
  description: string;
  tags_json: string;
  chapter_count: number;
  info_page_url: string;
  updated_at: string;
}

export interface StoredNovelLibraryRow {
  sourceId: string;
  metadata: NovelMetadata;
  updatedAt: string;
  downloadedChapters: number;
  failedChapters: number;
  indexedChapters: number;
  latestDownloadedAt: string | null;
}

interface ChapterRow {
  source_id: string;
  novel_id: string;
  chapter_id: string;
  chapter_index: number;
  title: string;
  volume_title: string | null;
  url: string;
  content: string | null;
  status: 'indexed' | 'downloaded' | 'failed';
  error_message: string | null;
  downloaded_at: string | null;
  updated_at: string;
}

export class SqliteNovelRepository {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.migrate();
  }

  close(): void {
    this.#database.close();
  }

  getSnapshot(sourceId: string, novelId: string): StoredNovelSnapshot | null {
    const novelRow = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, title, author, description, tags_json, chapter_count, info_page_url, updated_at
          FROM novels
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as NovelRow | undefined;

    if (!novelRow) {
      return null;
    }

    const chapterRows = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, chapter_id, chapter_index, title, volume_title, url, content, status, error_message, downloaded_at, updated_at
          FROM chapters
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC
        `,
      )
      .all(sourceId, novelId) as ChapterRow[];

    return {
      sourceId,
      metadata: mapNovelRow(novelRow),
      chapters: chapterRows.map(mapChapterRow),
      updatedAt: novelRow.updated_at,
    };
  }

  listNovels(): StoredNovelLibraryRow[] {
    const rows = this.#database
      .prepare(
        `
          SELECT
            n.source_id,
            n.novel_id,
            n.title,
            n.author,
            n.description,
            n.tags_json,
            n.chapter_count,
            n.info_page_url,
            n.updated_at,
            COALESCE(SUM(CASE WHEN c.status = 'downloaded' THEN 1 ELSE 0 END), 0) AS downloaded_chapters,
            COALESCE(SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_chapters,
            COALESCE(SUM(CASE WHEN c.status = 'indexed' THEN 1 ELSE 0 END), 0) AS indexed_chapters,
            MAX(c.downloaded_at) AS latest_downloaded_at
          FROM novels n
          LEFT JOIN chapters c
            ON c.source_id = n.source_id
           AND c.novel_id = n.novel_id
          GROUP BY
            n.source_id,
            n.novel_id,
            n.title,
            n.author,
            n.description,
            n.tags_json,
            n.chapter_count,
            n.info_page_url,
            n.updated_at
          ORDER BY n.updated_at DESC, n.title COLLATE NOCASE ASC
        `,
      )
      .all() as Array<NovelRow & {
      downloaded_chapters: number;
      failed_chapters: number;
      indexed_chapters: number;
      latest_downloaded_at: string | null;
    }>;

    return rows.map((row) => ({
      sourceId: row.source_id,
      metadata: mapNovelRow(row),
      updatedAt: row.updated_at,
      downloadedChapters: row.downloaded_chapters,
      failedChapters: row.failed_chapters,
      indexedChapters: row.indexed_chapters,
      latestDownloadedAt: row.latest_downloaded_at,
    }));
  }

  getChapter(sourceId: string, novelId: string, chapterId: string): StoredChapterRecord | null {
    const chapterRow = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, chapter_id, chapter_index, title, volume_title, url, content, status, error_message, downloaded_at, updated_at
          FROM chapters
          WHERE source_id = ? AND novel_id = ? AND chapter_id = ?
        `,
      )
      .get(sourceId, novelId, chapterId) as ChapterRow | undefined;

    return chapterRow ? mapChapterRow(chapterRow) : null;
  }

  saveMetadata(sourceId: string, metadata: NovelMetadata): void {
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO novels (source_id, novel_id, title, author, description, tags_json, chapter_count, info_page_url, updated_at)
          VALUES (@source_id, @novel_id, @title, @author, @description, @tags_json, @chapter_count, @info_page_url, @updated_at)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            description = excluded.description,
            tags_json = excluded.tags_json,
            chapter_count = excluded.chapter_count,
            info_page_url = excluded.info_page_url,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        source_id: sourceId,
        novel_id: metadata.novelId,
        title: metadata.title,
        author: metadata.author,
        description: metadata.description,
        tags_json: JSON.stringify(metadata.tags),
        chapter_count: metadata.chapterCount,
        info_page_url: metadata.infoPageUrl,
        updated_at: timestamp,
      });
  }

  saveChapterIndex(sourceId: string, novelId: string, chapters: ChapterIndexEntry[]): void {
    const timestamp = new Date().toISOString();
    const statement = this.#database.prepare(
      `
        INSERT INTO chapters (
          source_id,
          novel_id,
          chapter_id,
          chapter_index,
          title,
          volume_title,
          url,
          content,
          status,
          error_message,
          downloaded_at,
          updated_at
        )
        VALUES (
          @source_id,
          @novel_id,
          @chapter_id,
          @chapter_index,
          @title,
          @volume_title,
          @url,
          NULL,
          'indexed',
          NULL,
          NULL,
          @updated_at
        )
        ON CONFLICT(source_id, novel_id, chapter_id) DO UPDATE SET
          chapter_index = excluded.chapter_index,
          title = excluded.title,
          volume_title = excluded.volume_title,
          url = excluded.url,
          updated_at = excluded.updated_at
      `,
    );

    const transaction = this.#database.transaction((entries: ChapterIndexEntry[]) => {
      for (const chapter of entries) {
        statement.run({
          source_id: sourceId,
          novel_id: novelId,
          chapter_id: chapter.id,
          chapter_index: chapter.index,
          title: chapter.title,
          volume_title: chapter.volumeTitle ?? null,
          url: chapter.url,
          updated_at: timestamp,
        });
      }
    });

    transaction(chapters);
  }

  saveChapterContent(sourceId: string, novelId: string, chapter: ChapterContent): void {
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          UPDATE chapters
          SET
            chapter_index = @chapter_index,
            title = @title,
            volume_title = @volume_title,
            url = @url,
            content = @content,
            status = 'downloaded',
            error_message = NULL,
            downloaded_at = @downloaded_at,
            updated_at = @updated_at
          WHERE source_id = @source_id AND novel_id = @novel_id AND chapter_id = @chapter_id
        `,
      )
      .run({
        source_id: sourceId,
        novel_id: novelId,
        chapter_id: chapter.chapterId,
        chapter_index: chapter.index,
        title: chapter.title,
        volume_title: chapter.volumeTitle ?? null,
        url: chapter.url,
        content: chapter.content,
        downloaded_at: timestamp,
        updated_at: timestamp,
      });
  }

  markChapterFailure(sourceId: string, novelId: string, chapterId: string, error: Error): void {
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          UPDATE chapters
          SET
            status = 'failed',
            error_message = @error_message,
            updated_at = @updated_at
          WHERE source_id = @source_id AND novel_id = @novel_id AND chapter_id = @chapter_id
        `,
      )
      .run({
        source_id: sourceId,
        novel_id: novelId,
        chapter_id: chapterId,
        error_message: error.message,
        updated_at: timestamp,
      });
  }

  private migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS novels (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        chapter_count INTEGER NOT NULL,
        info_page_url TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id)
      );

      CREATE TABLE IF NOT EXISTS chapters (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        volume_title TEXT,
        url TEXT NOT NULL,
        content TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id, chapter_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id)
      );
    `);
  }
}

function mapNovelRow(row: NovelRow): NovelMetadata {
  return {
    novelId: row.novel_id,
    title: row.title,
    author: row.author,
    description: row.description,
    tags: JSON.parse(row.tags_json) as string[],
    chapterCount: row.chapter_count,
    infoPageUrl: row.info_page_url,
  };
}

function mapChapterRow(row: ChapterRow): StoredChapterRecord {
  return {
    id: row.chapter_id,
    index: row.chapter_index,
    title: row.title,
    url: row.url,
    content: row.content,
    status: row.status,
    errorMessage: row.error_message,
    downloadedAt: row.downloaded_at,
    updatedAt: row.updated_at,
    ...(row.volume_title ? { volumeTitle: row.volume_title } : {}),
  };
}