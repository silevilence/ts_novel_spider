import { Router } from 'express';

import type { ControlCenterService } from '../core/control-center';
import { OpdsFeedService } from '../core/opds-feed';

export interface OpdsRouterOptions {
  service: ControlCenterService;
}

const ATOM_ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const OPDS2_MEDIA_TYPE = 'application/opds+json';
const EPUB_MEDIA_TYPE = 'application/epub+zip';
const ALLOWED_ARTIFACT_FILE_NAMES = new Set(['original.epub', 'translated.epub', 'bilingual.epub']);

export function createOpdsRouter({ service }: OpdsRouterOptions): Router {
  const router = Router();
  const feedService = new OpdsFeedService();

  // ── OPDS 1.2 (Atom XML) ──

  router.get('/v1', (_request, response) => {
    try {
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const xml = feedService.buildAtomRootFeed(novels);
      response.setHeader('Content-Type', ATOM_ACQUISITION_TYPE);
      response.send(xml);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  router.get('/v1/:sourceId/:novelId', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const novel = novels.find((n) => n.sourceId === sourceId && n.novelId === novelId);

      if (!novel) {
        response.status(404).json({
          message: `OPDS novel ${sourceId}/${novelId} was not found or not visible.`,
        });
        return;
      }

      const availability = service.getOpdsNovelArtifactAvailability(sourceId, novelId);
      const xml = feedService.buildAtomNovelFeed(novel, availability);
      response.setHeader('Content-Type', ATOM_ACQUISITION_TYPE);
      response.send(xml);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  // ── OPDS 2.0 (JSON-LD) ──

  router.get('/v2', (_request, response) => {
    try {
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const json = feedService.buildOpds2RootFeed(novels);
      response.setHeader('Content-Type', OPDS2_MEDIA_TYPE);
      response.send(json);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  router.get('/v2/:sourceId/:novelId', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const novels = service.listVisibleOpdsNovelsWithMetadata();
      const novel = novels.find((n) => n.sourceId === sourceId && n.novelId === novelId);

      if (!novel) {
        response.status(404).json({
          message: `OPDS novel ${sourceId}/${novelId} was not found or not visible.`,
        });
        return;
      }

      const availability = service.getOpdsNovelArtifactAvailability(sourceId, novelId);
      const json = feedService.buildOpds2NovelPublication(novel, availability);
      response.setHeader('Content-Type', OPDS2_MEDIA_TYPE);
      response.send(json);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'OPDS feed generation failed.',
      });
    }
  });

  // ── 制品下载 ──

  router.get('/artifacts/:sourceId/:novelId/:fileName', (request, response) => {
    try {
      const { sourceId, novelId, fileName } = request.params;

      if (!ALLOWED_ARTIFACT_FILE_NAMES.has(fileName)) {
        response.status(404).json({
          message: `Artifact ${fileName} is not a valid OPDS artifact file name.`,
        });
        return;
      }

      const filePath = service.getOpdsArtifactFilePath(sourceId, novelId, fileName);
      if (!filePath) {
        response.status(404).json({
          message: `Artifact ${sourceId}/${novelId}/${fileName} was not found.`,
        });
        return;
      }

      response.setHeader('Content-Type', EPUB_MEDIA_TYPE);
      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.sendFile(filePath);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'Artifact download failed.',
      });
    }
  });

  return router;
}
