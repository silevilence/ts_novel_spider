import { Router } from 'express';

import {
  type CrawlTaskSnapshot,
  ControlCenterService,
} from '../core/control-center';
import {
  isLibraryExportFormat,
  type LibraryExportFormat,
} from '../core/export-engine';
import type {
  LibraryBookmark,
  LibraryChapterDetail,
  LibraryNovelAlias,
  LibraryMediaCacheBatchResult,
  LibraryMediaAsset,
  LibraryNovelDetail,
  LibraryNovelSummary,
  LibraryReadingProgress,
} from '../core/offline-library';

export interface LibraryNovelSummaryPayload {
  novels: LibraryNovelSummary[];
}

export interface LibraryNovelDetailPayload {
  novel: LibraryNovelDetail;
  activeTask: CrawlTaskSnapshot | null;
}

export interface LibraryChapterDetailPayload {
  chapter: LibraryChapterDetail;
}

export interface LibraryMediaPayload {
  media: LibraryMediaAsset;
}

export interface LibraryMediaBatchPayload {
  result: LibraryMediaCacheBatchResult;
}

export interface LibraryExportPayload {
  export: {
    format: LibraryExportFormat;
    fileName: string;
    generatedAt: string;
    size: number;
  };
}

export interface LibraryAliasPayload {
  alias: LibraryNovelAlias;
}

export interface LibraryBookmarkPayload {
  bookmark: LibraryBookmark;
}

export interface LibraryReadingProgressPayload {
  progress: LibraryReadingProgress;
}

export interface LibraryRouterOptions {
  service: ControlCenterService;
}

export function createLibraryRouter({ service }: LibraryRouterOptions): Router {
  const router = Router();

  router.get('/novels', (request, response) => {
    try {
      const query = typeof request.query.q === 'string' ? request.query.q : undefined;
      const payload: LibraryNovelSummaryPayload = {
        novels: service.listLibraryNovels(query),
      };

      response.json(payload);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Library search failed.',
      });
    }
  });

  router.get('/novels/:sourceId/:novelId', (request, response) => {
    const { sourceId, novelId } = request.params;
    const novel = service.getLibraryNovel(sourceId, novelId);

    if (!novel) {
      response.status(404).json({
        message: `Library novel ${sourceId}/${novelId} was not found.`,
      });
      return;
    }

    const payload: LibraryNovelDetailPayload = {
      novel,
      activeTask: service.getLibraryActiveTask(sourceId, novelId),
    };

    response.json(payload);
  });

  router.get('/novels/:sourceId/:novelId/chapters/:chapterId', (request, response) => {
    const { sourceId, novelId, chapterId } = request.params;
    const chapter = service.getLibraryChapter(sourceId, novelId, chapterId);

    if (!chapter) {
      response.status(404).json({
        message: `Library chapter ${sourceId}/${novelId}/${chapterId} was not found.`,
      });
      return;
    }

    const payload: LibraryChapterDetailPayload = {
      chapter,
    };

    response.json(payload);
  });

  router.post('/novels/:sourceId/:novelId/aliases', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const alias = readStringField(request.body, 'alias');
      const createdAlias = service.createLibraryAlias(sourceId, novelId, alias);

      const payload: LibraryAliasPayload = {
        alias: createdAlias,
      };

      response.status(201).json(payload);
    } catch (error) {
      response.status(error instanceof Error && /not found/i.test(error.message) ? 404 : 422).json({
        message: error instanceof Error ? error.message : 'Alias creation failed.',
      });
    }
  });

  router.put('/novels/:sourceId/:novelId/aliases/:aliasId', (request, response) => {
    try {
      const { sourceId, novelId, aliasId } = request.params;
      const alias = readStringField(request.body, 'alias');
      const updatedAlias = service.updateLibraryAlias(sourceId, novelId, aliasId, alias);

      if (!updatedAlias) {
        response.status(404).json({
          message: `Library alias ${sourceId}/${novelId}/${aliasId} was not found.`,
        });
        return;
      }

      const payload: LibraryAliasPayload = {
        alias: updatedAlias,
      };

      response.json(payload);
    } catch (error) {
      response.status(422).json({
        message: error instanceof Error ? error.message : 'Alias update failed.',
      });
    }
  });

  router.delete('/novels/:sourceId/:novelId/aliases/:aliasId', (request, response) => {
    const { sourceId, novelId, aliasId } = request.params;
    const deleted = service.deleteLibraryAlias(sourceId, novelId, aliasId);

    if (!deleted) {
      response.status(404).json({
        message: `Library alias ${sourceId}/${novelId}/${aliasId} was not found.`,
      });
      return;
    }

    response.status(204).end();
  });

  router.put('/novels/:sourceId/:novelId/progress', (request, response) => {
    const { sourceId, novelId } = request.params;
    const chapterId = readStringField(request.body, 'chapterId');
    const progress = service.updateLibraryReadingProgress(sourceId, novelId, chapterId);

    if (!progress) {
      response.status(404).json({
        message: `Library progress target ${sourceId}/${novelId}/${chapterId} was not found.`,
      });
      return;
    }

    const payload: LibraryReadingProgressPayload = {
      progress,
    };

    response.json(payload);
  });

  router.post('/novels/:sourceId/:novelId/bookmarks', (request, response) => {
    const { sourceId, novelId } = request.params;
    const chapterId = readStringField(request.body, 'chapterId');
    const note = readOptionalStringField(request.body, 'note');
    const bookmark = service.createLibraryBookmark(sourceId, novelId, chapterId, note);

    if (!bookmark) {
      response.status(404).json({
        message: `Library bookmark target ${sourceId}/${novelId}/${chapterId} was not found.`,
      });
      return;
    }

    const payload: LibraryBookmarkPayload = {
      bookmark,
    };

    response.status(201).json(payload);
  });

  router.put('/novels/:sourceId/:novelId/bookmarks/:bookmarkId', (request, response) => {
    const { sourceId, novelId, bookmarkId } = request.params;
    const note = readOptionalStringField(request.body, 'note');
    const bookmark = service.updateLibraryBookmark(sourceId, novelId, bookmarkId, note);

    if (!bookmark) {
      response.status(404).json({
        message: `Library bookmark ${sourceId}/${novelId}/${bookmarkId} was not found.`,
      });
      return;
    }

    const payload: LibraryBookmarkPayload = {
      bookmark,
    };

    response.json(payload);
  });

  router.delete('/novels/:sourceId/:novelId/bookmarks/:bookmarkId', (request, response) => {
    const { sourceId, novelId, bookmarkId } = request.params;
    const deleted = service.deleteLibraryBookmark(sourceId, novelId, bookmarkId);

    if (!deleted) {
      response.status(404).json({
        message: `Library bookmark ${sourceId}/${novelId}/${bookmarkId} was not found.`,
      });
      return;
    }

    response.status(204).end();
  });

  router.post('/novels/:sourceId/:novelId/chapters/:chapterId/media/:mediaId/cache', async (request, response) => {
    try {
      const { sourceId, novelId, chapterId, mediaId } = request.params;
      const media = await service.cacheLibraryChapterMedia(sourceId, novelId, chapterId, mediaId);

      if (!media) {
        response.status(404).json({
          message: `Library media ${sourceId}/${novelId}/${chapterId}/${mediaId} was not found.`,
        });
        return;
      }

      const payload: LibraryMediaPayload = {
        media,
      };

      response.json(payload);
    } catch (error) {
      response.status(502).json({
        message: error instanceof Error ? error.message : 'Media cache failed.',
      });
    }
  });

  router.post('/novels/:sourceId/:novelId/media/cache', async (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const result = await service.cacheLibraryNovelMedia(sourceId, novelId);

      if (!result) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      const payload: LibraryMediaBatchPayload = {
        result,
      };

      response.json(payload);
    } catch (error) {
      response.status(502).json({
        message: error instanceof Error ? error.message : 'Media batch cache failed.',
      });
    }
  });

  router.get('/novels/:sourceId/:novelId/chapters/:chapterId/media/:mediaId/file', (request, response) => {
    const { sourceId, novelId, chapterId, mediaId } = request.params;
    const filePath = service.getLibraryMediaFilePath(sourceId, novelId, chapterId, mediaId);

    if (!filePath) {
      response.status(404).json({
        message: `Cached media ${sourceId}/${novelId}/${chapterId}/${mediaId} was not found.`,
      });
      return;
    }

    response.sendFile(filePath);
  });

  router.get('/novels/:sourceId/:novelId/exports/:format/download', async (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const format = request.params.format;

      if (!format || !isLibraryExportFormat(format)) {
        response.status(400).json({
          message: `Unsupported library export format: ${format ?? 'unknown'}.`,
        });
        return;
      }

      const artifact = await service.exportLibraryNovel(sourceId, novelId, format);

      if (!artifact) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      response.setHeader('Content-Type', artifact.contentType);
      response.setHeader('X-Library-Export-Generated-At', artifact.generatedAt);
      response.setHeader('X-Library-Export-Size', String(artifact.size));
      response.download(artifact.filePath, artifact.fileName);
    } catch (error) {
      response.status(422).json({
        message: error instanceof Error ? error.message : 'Library export failed.',
      });
    }
  });

  return router;
}

function readStringField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object' || !(field in body)) {
    throw new Error(`Request body must include ${field}.`);
  }

  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalStringField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object' || !(field in body)) {
    return '';
  }

  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string.`);
  }

  return value.trim();
}