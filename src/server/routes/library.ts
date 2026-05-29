import { Router } from 'express';

import {
  type CrawlTaskSnapshot,
  ControlCenterService,
} from '../core/control-center';
import {
  isLibraryExportFormat,
  isLibraryExportTranslationMode,
  type LibraryExportFormat,
} from '../core/export-engine';
import type {
  LibraryAssistantResponse,
  LibraryKnowledgeGraphBuild,
  KnowledgeGraphBuildMode,
  LibraryKnowledgeGraphProfile,
  LibraryKnowledgeGraphProfileInput,
  LibraryKnowledgeGraphState,
} from '../core/library-intelligence';
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
import type { ReaderTypographyResolved } from '../core/system-preferences';

export interface LibraryNovelSummaryPayload {
  novels: LibraryNovelSummary[];
}

export interface LibraryNovelDetailPayload {
  novel: LibraryNovelDetail;
  activeTask: CrawlTaskSnapshot | null;
  knowledgeGraph: LibraryKnowledgeGraphState;
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

export interface LibraryKnowledgeGraphPayload {
  knowledgeGraph: LibraryKnowledgeGraphState;
}

export interface LibraryKnowledgeGraphBuildPayload {
  build: LibraryKnowledgeGraphBuild;
}

export interface LibraryKnowledgeGraphProfilePayload {
  profile: LibraryKnowledgeGraphProfile;
}

export interface LibraryAssistantPayload {
  reply: LibraryAssistantResponse;
}

export interface LibraryReaderTypographyPayload {
  typography: ReaderTypographyResolved;
}

export interface LibraryRouterOptions {
  service: ControlCenterService;
}

interface UpdateKnowledgeGraphProfileRequestBody {
  chatModel?: unknown;
  extractionModels?: unknown;
  embeddingModel?: unknown;
  rerankModel?: unknown;
  extractionConcurrency?: unknown;
  neo4j?: unknown;
}

interface BuildKnowledgeGraphRequestBody {
  mode?: unknown;
}

interface AskLibraryAssistantRequestBody {
  message?: unknown;
  chapterId?: unknown;
}

interface UpdateReaderTypographyRequestBody {
  fontSize?: unknown;
  fontSizePreset?: unknown;
  lineHeight?: unknown;
  paragraphSpacing?: unknown;
  fontFamilyPreset?: unknown;
  fontFamilyCustom?: unknown;
}

const READER_FONT_SIZE_DEFAULT = 1.03;
const READER_LINE_HEIGHT_DEFAULT = 1.9;
const READER_PARAGRAPH_SPACING_DEFAULT = 1;

function validateFontSizePreset(value: unknown): 'small' | 'medium' | 'large' {
  return value === 'small' || value === 'medium' || value === 'large' ? value : 'medium';
}

function validateFontFamilyPreset(value: unknown): 'sans' | 'serif' | 'monospace' | 'custom' {
  return value === 'sans' || value === 'serif' || value === 'monospace' || value === 'custom' ? value : 'sans';
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
      knowledgeGraph: service.getLibraryKnowledgeGraph(sourceId, novelId)!,
    };

    response.json(payload);
  });

  router.get('/novels/:sourceId/:novelId/graph', (request, response) => {
    const { sourceId, novelId } = request.params;
    const knowledgeGraph = service.getLibraryKnowledgeGraph(sourceId, novelId);

    if (!knowledgeGraph) {
      response.status(404).json({
        message: `Library novel ${sourceId}/${novelId} was not found.`,
      });
      return;
    }

    const payload: LibraryKnowledgeGraphPayload = {
      knowledgeGraph,
    };

    response.json(payload);
  });

  router.put('/novels/:sourceId/:novelId/graph/profile', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const profile = service.updateLibraryKnowledgeGraphProfile(
        sourceId,
        novelId,
        parseKnowledgeGraphProfileBody((request.body ?? {}) as UpdateKnowledgeGraphProfileRequestBody),
      );

      if (!profile) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      const payload: LibraryKnowledgeGraphProfilePayload = {
        profile,
      };

      response.json(payload);
    } catch (error) {
      response.status(error instanceof Error && /锁定/.test(error.message) ? 409 : 422).json({
        message: error instanceof Error ? error.message : 'Knowledge graph profile update failed.',
      });
    }
  });

  router.post('/novels/:sourceId/:novelId/graph/build', (request, response) => {
    const { sourceId, novelId } = request.params;
    const build = service.buildLibraryKnowledgeGraph(
      sourceId,
      novelId,
      parseBuildKnowledgeGraphBody((request.body ?? {}) as BuildKnowledgeGraphRequestBody),
    );

    if (!build) {
      response.status(404).json({
        message: `Library novel ${sourceId}/${novelId} was not found.`,
      });
      return;
    }

    const payload: LibraryKnowledgeGraphBuildPayload = {
      build,
    };

    response.status(202).json(payload);
  });

  router.post('/novels/:sourceId/:novelId/graph/pause', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const build = service.pauseLibraryKnowledgeGraph(sourceId, novelId);

      if (!build) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      const payload: LibraryKnowledgeGraphBuildPayload = {
        build,
      };

      response.status(202).json(payload);
    } catch (error) {
      response.status(409).json({
        message: error instanceof Error ? error.message : 'Knowledge graph pause failed.',
      });
    }
  });

  router.post('/novels/:sourceId/:novelId/graph/resume', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const build = service.resumeLibraryKnowledgeGraph(sourceId, novelId);

      if (!build) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      const payload: LibraryKnowledgeGraphBuildPayload = {
        build,
      };

      response.status(202).json(payload);
    } catch (error) {
      response.status(409).json({
        message: error instanceof Error ? error.message : 'Knowledge graph resume failed.',
      });
    }
  });

  router.post('/novels/:sourceId/:novelId/graph/retry-failed', async (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const body = (request.body ?? {}) as { modelOverrides?: Array<{ providerId: string; modelId: string }> };

      const result = await service.retryFailedKnowledgeGraphChunks(
        sourceId,
        novelId,
        body.modelOverrides ? { modelOverrides: body.modelOverrides } : undefined,
      );

      if (!result) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      response.status(200).json(result);
    } catch (error) {
      response.status(409).json({
        message: error instanceof Error ? error.message : 'Knowledge graph retry failed.',
      });
    }
  });

  router.delete('/novels/:sourceId/:novelId/graph', async (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const knowledgeGraph = await service.clearLibraryKnowledgeGraph(sourceId, novelId);

      if (!knowledgeGraph) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      const payload: LibraryKnowledgeGraphPayload = {
        knowledgeGraph,
      };

      response.json(payload);
    } catch (error) {
      response.status(error instanceof Error && /构建中/.test(error.message) ? 409 : 422).json({
        message: error instanceof Error ? error.message : 'Knowledge graph clear failed.',
      });
    }
  });

  router.post('/novels/:sourceId/:novelId/graph/sync-neo4j', async (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const result = await service.syncLibraryKnowledgeGraphToNeo4j(sourceId, novelId);
      response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Neo4j sync failed.';
      response.status(422).json({ message });
    }
  });

  router.post('/novels/:sourceId/:novelId/assistant/chat', async (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const body = (request.body ?? {}) as AskLibraryAssistantRequestBody;
      const reply = await service.askLibraryAssistant({
        sourceId,
        novelId,
        message: readStringField(body, 'message'),
        ...(typeof body.chapterId === 'string' && body.chapterId.trim().length > 0
          ? { chapterId: body.chapterId.trim() }
          : {}),
      });

      const payload: LibraryAssistantPayload = {
        reply,
      };

      response.json(payload);
    } catch (error) {
      response.status(error instanceof Error && /not found/i.test(error.message) ? 404 : 422).json({
        message: error instanceof Error ? error.message : 'Assistant chat failed.',
      });
    }
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

  router.get('/novels/:sourceId/:novelId/reader-typography', (request, response) => {
    const { sourceId, novelId } = request.params;
    const typography = service.getLibraryReaderTypography(sourceId, novelId);

    if (!typography) {
      response.status(404).json({
        message: `Library novel ${sourceId}/${novelId} was not found.`,
      });
      return;
    }

    const payload: LibraryReaderTypographyPayload = {
      typography,
    };

    response.json(payload);
  });

  router.put('/novels/:sourceId/:novelId/reader-typography', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const body = (request.body ?? {}) as UpdateReaderTypographyRequestBody;
      const typography = service.updateLibraryReaderTypography(sourceId, novelId, {
        fontSize: typeof body.fontSize === 'number' ? body.fontSize : READER_FONT_SIZE_DEFAULT,
        fontSizePreset: validateFontSizePreset(body.fontSizePreset),
        lineHeight: typeof body.lineHeight === 'number' ? body.lineHeight : READER_LINE_HEIGHT_DEFAULT,
        paragraphSpacing: typeof body.paragraphSpacing === 'number' ? body.paragraphSpacing : READER_PARAGRAPH_SPACING_DEFAULT,
        fontFamilyPreset: validateFontFamilyPreset(body.fontFamilyPreset),
        fontFamilyCustom: typeof body.fontFamilyCustom === 'string' ? body.fontFamilyCustom : '',
      });

      if (!typography) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      const payload: LibraryReaderTypographyPayload = {
        typography,
      };

      response.json(payload);
    } catch (error) {
      response.status(422).json({
        message: error instanceof Error ? error.message : 'Reader typography update failed.',
      });
    }
  });

  router.delete('/novels/:sourceId/:novelId/reader-typography', (request, response) => {
    const { sourceId, novelId } = request.params;
    const typography = service.deleteLibraryReaderTypography(sourceId, novelId);

    if (!typography) {
      response.status(404).json({
        message: `Library novel ${sourceId}/${novelId} was not found.`,
      });
      return;
    }

    const payload: LibraryReaderTypographyPayload = {
      typography,
    };

    response.json(payload);
  });

  router.post('/novels/:sourceId/:novelId/translate/start', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const modelOverride = typeof body.modelOverride === 'string' ? body.modelOverride : undefined;
      const fromScratch = body.fromScratch === true;
      const build = service.startLibraryTranslation(sourceId, novelId, modelOverride, fromScratch);

      response.status(202).json({
        translation: build,
      });
    } catch (error) {
      response.status(error instanceof Error && /not found/i.test(error.message) ? 404 : 422).json({
        message: error instanceof Error ? error.message : 'Translation start failed.',
      });
    }
  });

  router.post('/novels/:sourceId/:novelId/translate/cancel', (request, response) => {
    const { sourceId, novelId } = request.params;
    const build = service.cancelLibraryTranslation(sourceId, novelId);

    if (!build) {
      response.status(404).json({
        message: `No translation build for ${sourceId}/${novelId}.`,
      });
      return;
    }

    response.json({ translation: build });
  });

  router.get('/novels/:sourceId/:novelId/translate/build', (request, response) => {
    const { sourceId, novelId } = request.params;
    const build = service.getLibraryTranslationBuild(sourceId, novelId);

    if (!build) {
      response.status(404).json({
        message: `No translation build for ${sourceId}/${novelId}.`,
      });
      return;
    }

    response.json({
      translation: build,
    });
  });

  router.get('/novels/:sourceId/:novelId/translate/profile', (request, response) => {
    const { sourceId, novelId } = request.params;
    const profile = service.getLibraryTranslationProfile(sourceId, novelId);

    if (!profile) {
      response.status(404).json({
        message: `No translation profile for ${sourceId}/${novelId}.`,
      });
      return;
    }

    response.json({
      translation: profile,
    });
  });

  router.put('/novels/:sourceId/:novelId/translate/profile', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const profile = service.updateLibraryTranslationProfile(sourceId, novelId, (request.body ?? {}) as Record<string, unknown>);

      if (!profile) {
        response.status(404).json({
          message: `Library novel ${sourceId}/${novelId} was not found.`,
        });
        return;
      }

      response.json({
        translation: profile,
      });
    } catch (error) {
      response.status(error instanceof Error && /锁定/.test(error.message) ? 409 : 422).json({
        message: error instanceof Error ? error.message : 'Translation profile update failed.',
      });
    }
  });

  router.get('/novels/:sourceId/:novelId/translate/chapters/:chapterId', (request, response) => {
    const { sourceId, novelId, chapterId } = request.params;
    const sourceLang = typeof request.query.sourceLang === 'string' ? request.query.sourceLang : 'ja';
    const targetLang = typeof request.query.targetLang === 'string' ? request.query.targetLang : 'zh-CN';
    const detail = service.getLibraryTranslationChapter(sourceId, novelId, chapterId, sourceLang, targetLang);

    if (!detail) {
      response.status(404).json({
        message: `Translation for chapter ${sourceId}/${novelId}/${chapterId} was not found.`,
      });
      return;
    }

    response.json(detail);
  });

  router.get('/novels/:sourceId/:novelId/translate/terms', (request, response) => {
    const { sourceId, novelId } = request.params;
    const terms = service.listLibraryTranslationTerms(sourceId, novelId);

    response.json({
      terms,
    });
  });

  router.post('/novels/:sourceId/:novelId/translate/terms', (request, response) => {
    try {
      const { sourceId, novelId } = request.params;
      const body = request.body as Record<string, unknown>;
      const term = service.createLibraryTranslationTerm(sourceId, novelId, {
        sourceTerm: readStringField(body, 'sourceTerm'),
        ...(body.targetTerm !== undefined ? { targetTerm: typeof body.targetTerm === 'string' ? body.targetTerm : null } : {}),
        ...(body.entityType !== undefined ? { entityType: typeof body.entityType === 'string' ? body.entityType : null } : {}),
        ...(body.note !== undefined ? { note: typeof body.note === 'string' ? body.note : null } : {}),
        ...(body.priority !== undefined ? { priority: typeof body.priority === 'number' ? body.priority : 0 } : {}),
      });

      response.status(201).json({
        term,
      });
    } catch (error) {
      response.status(error instanceof Error && /not found/i.test(error.message) ? 404 : 422).json({
        message: error instanceof Error ? error.message : 'Term creation failed.',
      });
    }
  });

  router.put('/novels/:sourceId/:novelId/translate/terms/:termId', (request, response) => {
    try {
      const { sourceId, novelId, termId } = request.params;
      const body = request.body as Record<string, unknown>;
      const term = service.updateLibraryTranslationTerm(sourceId, novelId, termId, {
        ...(body.targetTerm !== undefined ? { targetTerm: typeof body.targetTerm === 'string' ? body.targetTerm : null } : {}),
        ...(body.entityType !== undefined ? { entityType: typeof body.entityType === 'string' ? body.entityType : null } : {}),
        ...(body.note !== undefined ? { note: typeof body.note === 'string' ? body.note : null } : {}),
        ...(typeof body.priority === 'number' ? { priority: body.priority } : {}),
      });

      if (!term) {
        response.status(404).json({
          message: `Translation term ${termId} was not found.`,
        });
        return;
      }

      response.json({
        term,
      });
    } catch (error) {
      response.status(422).json({
        message: error instanceof Error ? error.message : 'Term update failed.',
      });
    }
  });

  router.delete('/novels/:sourceId/:novelId/translate/terms/:termId', (request, response) => {
    const { sourceId, novelId, termId } = request.params;
    const deleted = service.deleteLibraryTranslationTerm(sourceId, novelId, termId);

    if (!deleted) {
      response.status(404).json({
        message: `Translation term ${termId} was not found.`,
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

      const modeRaw = typeof request.query.mode === 'string' ? request.query.mode : undefined;
      const mode = modeRaw && isLibraryExportTranslationMode(modeRaw) ? modeRaw : undefined;
      const sourceLang = typeof request.query.sourceLang === 'string' ? request.query.sourceLang : undefined;
      const targetLang = typeof request.query.targetLang === 'string' ? request.query.targetLang : undefined;

      const artifact = await service.exportLibraryNovel(sourceId, novelId, format, mode, sourceLang, targetLang);

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

function parseKnowledgeGraphProfileBody(body: UpdateKnowledgeGraphProfileRequestBody): LibraryKnowledgeGraphProfileInput {
  return {
    ...(body.chatModel !== undefined ? { chatModel: parseModelRoute(body.chatModel, 'chatModel') } : {}),
    ...(body.extractionModels !== undefined ? { extractionModels: parseExtractionModels(body.extractionModels) } : {}),
    ...(body.embeddingModel !== undefined ? { embeddingModel: parseModelRoute(body.embeddingModel, 'embeddingModel') } : {}),
    ...(body.rerankModel !== undefined ? { rerankModel: parseModelRoute(body.rerankModel, 'rerankModel') } : {}),
    ...(body.extractionConcurrency !== undefined ? { extractionConcurrency: parseExtractionConcurrency(body.extractionConcurrency) } : {}),
    ...(body.neo4j !== undefined ? { neo4j: parseNeo4jRoute(body.neo4j) } : {}),
  };
}

function parseBuildKnowledgeGraphBody(body: BuildKnowledgeGraphRequestBody): { mode?: KnowledgeGraphBuildMode } {
  if (body.mode === undefined) {
    return {};
  }

  if (body.mode === 'full' || body.mode === 'incremental' || body.mode === 'rebuild') {
    return { mode: body.mode };
  }

  throw new Error('mode must be one of full, incremental, or rebuild.');
}

function parseExtractionModels(value: unknown): Array<{ providerId?: string; modelId?: string; maxConcurrency?: number }> {
  if (!Array.isArray(value)) {
    throw new Error('extractionModels must be an array.');
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`extractionModels[${index}] must be an object.`);
    }

    const record = entry as Record<string, unknown>;
    return {
      ...(typeof record.providerId === 'string' ? { providerId: record.providerId.trim() } : {}),
      ...(typeof record.modelId === 'string' ? { modelId: record.modelId.trim() } : {}),
      ...(typeof record.maxConcurrency === 'number' && Number.isFinite(record.maxConcurrency)
        ? { maxConcurrency: Math.trunc(record.maxConcurrency) }
        : {}),
    };
  });
}

function parseExtractionConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('extractionConcurrency must be a finite number.');
  }

  return Math.trunc(value);
}

function parseModelRoute(
  value: unknown,
  field: string,
): { providerId?: string; modelId?: string } | null {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== 'object') {
    throw new Error(`${field} must be an object or null.`);
  }

  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.providerId === 'string' ? { providerId: record.providerId.trim() } : {}),
    ...(typeof record.modelId === 'string' ? { modelId: record.modelId.trim() } : {}),
  };
}

function parseNeo4jRoute(value: unknown): {
  enabled?: boolean;
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
} | null {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== 'object') {
    throw new Error('neo4j must be an object or null.');
  }

  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(typeof record.uri === 'string' ? { uri: record.uri } : {}),
    ...(typeof record.username === 'string' ? { username: record.username } : {}),
    ...(typeof record.password === 'string' ? { password: record.password } : {}),
    ...(typeof record.database === 'string' ? { database: record.database } : {}),
  };
}