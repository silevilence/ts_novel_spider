import express, { Router } from 'express';
import { z } from 'zod';
import type { ControlCenterService } from '../core/control-center';
import { MAX_EBOOK_BYTES } from '../contracts/ebook';

const metadataSchema = z.object({ title: z.string().trim().min(1).max(500), author: z.string().max(2000), description: z.string().max(100000), tags: z.array(z.string().trim().min(1).max(200)).max(100) });

export function createEbookRouter(service: ControlCenterService): Router {
  const router = Router();
  const imports = service.getEbookImportService();
  router.get('/', (_request, response) => response.json({ imports: imports.summaries() }));
  router.post('/', express.raw({ type: 'application/octet-stream', limit: MAX_EBOOK_BYTES }), (request, response) => {
    try {
      if (typeof request.query.fileName !== 'string' || !Buffer.isBuffer(request.body)) return response.status(400).json({ message: '请上传 EPUB/TXT 文件。' });
      const result = imports.upload(request.query.fileName, request.body);
      if (!result.duplicate) imports.startParse(result.entry.id);
      response.status(202).json({ id: result.entry.id, duplicate: result.duplicate });
    } catch (error) { response.status(422).json({ message: (error as Error).message }); }
  });
  router.post('/:id/retry', (request, response) => {
    try {
      const input = z.object({ encoding: z.enum(['utf-8', 'gb18030']).optional() }).parse(request.body ?? {});
      imports.startParse(request.params.id, input.encoding);
      response.status(202).json({ accepted: true });
    } catch (error) { response.status(422).json({ message: (error as Error).message }); }
  });
  router.post('/:id/confirm', (request, response) => {
    try {
      const novelId = imports.confirm(request.params.id, metadataSchema.parse(request.body));
      response.json({ sourceId: 'manual', novelId });
    } catch (error) { response.status(422).json({ message: (error as Error).message }); }
  });
  return router;
}
