import crypto from 'node:crypto';
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
  aliases: StoredNovelAliasRow[];
  readingProgress: StoredReadingProgressRow | null;
  bookmarkCount: number;
}

export interface StoredNovelAliasRow {
  id: string;
  alias: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredReadingProgressRow {
  currentChapterId: string;
  currentChapterIndex: number;
  currentUpdatedAt: string;
  highestChapterId: string;
  highestChapterIndex: number;
  highestUpdatedAt: string;
}

export interface StoredBookmarkRow {
  id: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  volumeTitle: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTaskHistoryRow {
  taskId: string;
  sourceId: string;
  novelId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  snapshotJson: string;
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

interface TaskHistoryRow {
  task_id: string;
  source_id: string;
  novel_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  snapshot_json: string;
}

interface NovelAliasRow {
  alias_id: string;
  source_id: string;
  novel_id: string;
  alias_value: string;
  normalized_alias: string;
  created_at: string;
  updated_at: string;
}

interface ReadingProgressRow {
  source_id: string;
  novel_id: string;
  current_chapter_id: string;
  current_chapter_index: number;
  current_updated_at: string;
  highest_chapter_id: string;
  highest_chapter_index: number;
  highest_updated_at: string;
}

interface BookmarkRow {
  bookmark_id: string;
  source_id: string;
  novel_id: string;
  chapter_id: string;
  chapter_index: number;
  chapter_title: string;
  volume_title: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export class SqliteNovelRepository {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('foreign_keys = ON');
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

    const aliasMap = this.buildAliasMap();
    const progressMap = this.buildReadingProgressMap();
    const bookmarkCountMap = this.buildBookmarkCountMap();

    return rows.map((row) => ({
      sourceId: row.source_id,
      metadata: mapNovelRow(row),
      updatedAt: row.updated_at,
      downloadedChapters: row.downloaded_chapters,
      failedChapters: row.failed_chapters,
      indexedChapters: row.indexed_chapters,
      latestDownloadedAt: row.latest_downloaded_at,
      aliases: aliasMap.get(buildNovelKey(row.source_id, row.novel_id)) ?? [],
      readingProgress: progressMap.get(buildNovelKey(row.source_id, row.novel_id)) ?? null,
      bookmarkCount: bookmarkCountMap.get(buildNovelKey(row.source_id, row.novel_id)) ?? 0,
    }));
  }

  listNovelAliases(sourceId: string, novelId: string): StoredNovelAliasRow[] {
    return this.#database
      .prepare(
        `
          SELECT alias_id, source_id, novel_id, alias_value, normalized_alias, created_at, updated_at
          FROM novel_aliases
          WHERE source_id = ? AND novel_id = ?
          ORDER BY updated_at DESC, alias_value COLLATE NOCASE ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapNovelAliasRow(row as NovelAliasRow));
  }

  createNovelAlias(sourceId: string, novelId: string, alias: string): StoredNovelAliasRow {
    this.assertNovelExists(sourceId, novelId);

    const normalizedAlias = normalizeSearchValue(alias);
    if (!normalizedAlias) {
      throw new Error('Alias must not be empty.');
    }

    const aliasValue = alias.trim();
    const aliasId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO novel_aliases (
            alias_id,
            source_id,
            novel_id,
            alias_value,
            normalized_alias,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(aliasId, sourceId, novelId, aliasValue, normalizedAlias, timestamp, timestamp);

    const createdAlias = this.listNovelAliases(sourceId, novelId).find((entry) => entry.id === aliasId);
    if (!createdAlias) {
      throw new Error(`Failed to load alias ${aliasId} after creation.`);
    }

    return createdAlias;
  }

  updateNovelAlias(sourceId: string, novelId: string, aliasId: string, alias: string): StoredNovelAliasRow | null {
    const normalizedAlias = normalizeSearchValue(alias);
    if (!normalizedAlias) {
      throw new Error('Alias must not be empty.');
    }

    const aliasValue = alias.trim();
    const timestamp = new Date().toISOString();
    const result = this.#database
      .prepare(
        `
          UPDATE novel_aliases
          SET alias_value = ?, normalized_alias = ?, updated_at = ?
          WHERE alias_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(aliasValue, normalizedAlias, timestamp, aliasId, sourceId, novelId);

    if (result.changes === 0) {
      return null;
    }

    return this.listNovelAliases(sourceId, novelId).find((entry) => entry.id === aliasId) ?? null;
  }

  deleteNovelAlias(sourceId: string, novelId: string, aliasId: string): boolean {
    const result = this.#database
      .prepare(
        `
          DELETE FROM novel_aliases
          WHERE alias_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(aliasId, sourceId, novelId);

    return result.changes > 0;
  }

  getReadingProgress(sourceId: string, novelId: string): StoredReadingProgressRow | null {
    const row = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            current_chapter_id,
            current_chapter_index,
            current_updated_at,
            highest_chapter_id,
            highest_chapter_index,
            highest_updated_at
          FROM reading_progress
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as ReadingProgressRow | undefined;

    return row ? mapReadingProgressRow(row) : null;
  }

  updateReadingProgress(sourceId: string, novelId: string, chapterId: string): StoredReadingProgressRow | null {
    const chapter = this.getChapter(sourceId, novelId, chapterId);
    if (!chapter) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const existing = this.getReadingProgress(sourceId, novelId);
    const highestChapter = existing && existing.highestChapterIndex > chapter.index
      ? {
          id: existing.highestChapterId,
          index: existing.highestChapterIndex,
          updatedAt: existing.highestUpdatedAt,
        }
      : {
          id: chapter.id,
          index: chapter.index,
          updatedAt: timestamp,
        };

    this.#database
      .prepare(
        `
          INSERT INTO reading_progress (
            source_id,
            novel_id,
            current_chapter_id,
            current_chapter_index,
            current_updated_at,
            highest_chapter_id,
            highest_chapter_index,
            highest_updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, novel_id) DO UPDATE SET
            current_chapter_id = excluded.current_chapter_id,
            current_chapter_index = excluded.current_chapter_index,
            current_updated_at = excluded.current_updated_at,
            highest_chapter_id = excluded.highest_chapter_id,
            highest_chapter_index = excluded.highest_chapter_index,
            highest_updated_at = excluded.highest_updated_at
        `,
      )
      .run(
        sourceId,
        novelId,
        chapter.id,
        chapter.index,
        timestamp,
        highestChapter.id,
        highestChapter.index,
        highestChapter.updatedAt,
      );

    return this.getReadingProgress(sourceId, novelId);
  }

  listBookmarks(sourceId: string, novelId: string): StoredBookmarkRow[] {
    return this.#database
      .prepare(
        `
          SELECT
            bookmark_id,
            source_id,
            novel_id,
            chapter_id,
            chapter_index,
            chapter_title,
            volume_title,
            note,
            created_at,
            updated_at
          FROM bookmarks
          WHERE source_id = ? AND novel_id = ?
          ORDER BY chapter_index ASC, created_at ASC
        `,
      )
      .all(sourceId, novelId)
      .map((row) => mapBookmarkRow(row as BookmarkRow));
  }

  createBookmark(sourceId: string, novelId: string, chapterId: string, note: string): StoredBookmarkRow | null {
    const chapter = this.getChapter(sourceId, novelId, chapterId);
    if (!chapter) {
      return null;
    }

    const bookmarkId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const normalizedNote = note.trim();

    this.#database
      .prepare(
        `
          INSERT INTO bookmarks (
            bookmark_id,
            source_id,
            novel_id,
            chapter_id,
            chapter_index,
            chapter_title,
            volume_title,
            note,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        bookmarkId,
        sourceId,
        novelId,
        chapter.id,
        chapter.index,
        chapter.title,
        chapter.volumeTitle ?? null,
        normalizedNote,
        timestamp,
        timestamp,
      );

    return this.listBookmarks(sourceId, novelId).find((entry) => entry.id === bookmarkId) ?? null;
  }

  updateBookmark(sourceId: string, novelId: string, bookmarkId: string, note: string): StoredBookmarkRow | null {
    const timestamp = new Date().toISOString();
    const result = this.#database
      .prepare(
        `
          UPDATE bookmarks
          SET note = ?, updated_at = ?
          WHERE bookmark_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(note.trim(), timestamp, bookmarkId, sourceId, novelId);

    if (result.changes === 0) {
      return null;
    }

    return this.listBookmarks(sourceId, novelId).find((entry) => entry.id === bookmarkId) ?? null;
  }

  deleteBookmark(sourceId: string, novelId: string, bookmarkId: string): boolean {
    const result = this.#database
      .prepare(
        `
          DELETE FROM bookmarks
          WHERE bookmark_id = ? AND source_id = ? AND novel_id = ?
        `,
      )
      .run(bookmarkId, sourceId, novelId);

    return result.changes > 0;
  }

  listTaskSnapshots(limit = 20): StoredTaskHistoryRow[] {
    const rows = this.#database
      .prepare(
        `
          SELECT task_id, source_id, novel_id, status, created_at, updated_at, snapshot_json
          FROM task_history
          ORDER BY created_at DESC, updated_at DESC
          LIMIT ?
        `,
      )
      .all(limit) as TaskHistoryRow[];

    return rows.map((row) => ({
      taskId: row.task_id,
      sourceId: row.source_id,
      novelId: row.novel_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      snapshotJson: row.snapshot_json,
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

  saveTaskSnapshot(
    task: {
      id: string;
      sourceId: string;
      novelId: string;
      status: string;
      createdAt: string;
    },
    snapshot: unknown,
    limit = 100,
  ): void {
    const updatedAt = new Date().toISOString();

    this.#database
      .prepare(
        `
          INSERT INTO task_history (task_id, source_id, novel_id, status, created_at, updated_at, snapshot_json)
          VALUES (@task_id, @source_id, @novel_id, @status, @created_at, @updated_at, @snapshot_json)
          ON CONFLICT(task_id) DO UPDATE SET
            source_id = excluded.source_id,
            novel_id = excluded.novel_id,
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            snapshot_json = excluded.snapshot_json
        `,
      )
      .run({
        task_id: task.id,
        source_id: task.sourceId,
        novel_id: task.novelId,
        status: task.status,
        created_at: task.createdAt,
        updated_at: updatedAt,
        snapshot_json: JSON.stringify(snapshot),
      });

    this.#database
      .prepare(
        `
          DELETE FROM task_history
          WHERE task_id NOT IN (
            SELECT task_id
            FROM task_history
            ORDER BY created_at DESC, updated_at DESC
            LIMIT ?
          )
        `,
      )
      .run(limit);
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

      CREATE TABLE IF NOT EXISTS task_history (
        task_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS novel_aliases (
        alias_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_id, novel_id, normalized_alias),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS reading_progress (
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        current_chapter_id TEXT NOT NULL,
        current_chapter_index INTEGER NOT NULL,
        current_updated_at TEXT NOT NULL,
        highest_chapter_id TEXT NOT NULL,
        highest_chapter_index INTEGER NOT NULL,
        highest_updated_at TEXT NOT NULL,
        PRIMARY KEY (source_id, novel_id),
        FOREIGN KEY (source_id, novel_id) REFERENCES novels(source_id, novel_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        bookmark_id TEXT NOT NULL PRIMARY KEY,
        source_id TEXT NOT NULL,
        novel_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        volume_title TEXT,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id, novel_id, chapter_id) REFERENCES chapters(source_id, novel_id, chapter_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_novel_aliases_lookup
        ON novel_aliases(source_id, novel_id, normalized_alias);

      CREATE INDEX IF NOT EXISTS idx_bookmarks_lookup
        ON bookmarks(source_id, novel_id, chapter_index, created_at);
    `);
  }

  private assertNovelExists(sourceId: string, novelId: string): void {
    const row = this.#database
      .prepare(
        `
          SELECT 1
          FROM novels
          WHERE source_id = ? AND novel_id = ?
        `,
      )
      .get(sourceId, novelId) as { 1: number } | undefined;

    if (!row) {
      throw new Error(`Library novel ${sourceId}/${novelId} was not found.`);
    }
  }

  private buildAliasMap(): Map<string, StoredNovelAliasRow[]> {
    const rows = this.#database
      .prepare(
        `
          SELECT alias_id, source_id, novel_id, alias_value, normalized_alias, created_at, updated_at
          FROM novel_aliases
          ORDER BY updated_at DESC, alias_value COLLATE NOCASE ASC
        `,
      )
      .all() as NovelAliasRow[];

    const aliasMap = new Map<string, StoredNovelAliasRow[]>();

    for (const row of rows) {
      const key = buildNovelKey(row.source_id, row.novel_id);
      const existing = aliasMap.get(key) ?? [];
      existing.push(mapNovelAliasRow(row));
      aliasMap.set(key, existing);
    }

    return aliasMap;
  }

  private buildReadingProgressMap(): Map<string, StoredReadingProgressRow> {
    const rows = this.#database
      .prepare(
        `
          SELECT
            source_id,
            novel_id,
            current_chapter_id,
            current_chapter_index,
            current_updated_at,
            highest_chapter_id,
            highest_chapter_index,
            highest_updated_at
          FROM reading_progress
        `,
      )
      .all() as ReadingProgressRow[];

    return new Map(rows.map((row) => [buildNovelKey(row.source_id, row.novel_id), mapReadingProgressRow(row)]));
  }

  private buildBookmarkCountMap(): Map<string, number> {
    const rows = this.#database
      .prepare(
        `
          SELECT source_id, novel_id, COUNT(*) AS bookmark_count
          FROM bookmarks
          GROUP BY source_id, novel_id
        `,
      )
      .all() as Array<{ source_id: string; novel_id: string; bookmark_count: number }>;

    return new Map(rows.map((row) => [buildNovelKey(row.source_id, row.novel_id), row.bookmark_count]));
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

function mapNovelAliasRow(row: NovelAliasRow): StoredNovelAliasRow {
  return {
    id: row.alias_id,
    alias: row.alias_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReadingProgressRow(row: ReadingProgressRow): StoredReadingProgressRow {
  return {
    currentChapterId: row.current_chapter_id,
    currentChapterIndex: row.current_chapter_index,
    currentUpdatedAt: row.current_updated_at,
    highestChapterId: row.highest_chapter_id,
    highestChapterIndex: row.highest_chapter_index,
    highestUpdatedAt: row.highest_updated_at,
  };
}

function mapBookmarkRow(row: BookmarkRow): StoredBookmarkRow {
  return {
    id: row.bookmark_id,
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    chapterTitle: row.chapter_title,
    volumeTitle: row.volume_title,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildNovelKey(sourceId: string, novelId: string): string {
  return `${sourceId}\u0000${novelId}`;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}