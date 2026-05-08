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
  LibraryChapterDetail,
  LibraryMediaAsset,
  LibraryNovelDetail,
  LibraryNovelSummary,
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

export interface LibraryExportPayload {
  export: {
    format: LibraryExportFormat;
    fileName: string;
    generatedAt: string;
    size: number;
  };
}

export interface LibraryRouterOptions {
  service: ControlCenterService;
}

export function createLibraryRouter({ service }: LibraryRouterOptions): Router {
  const router = Router();

  router.get('/novels', (_request, response) => {
    const payload: LibraryNovelSummaryPayload = {
      novels: service.listLibraryNovels(),
    };

    response.json(payload);
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