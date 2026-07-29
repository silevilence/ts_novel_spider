import fs from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';

import { ControlCenterService } from './core/control-center';
import { healthRouter } from './routes/health';
import { createControlCenterRouter } from './routes/control-center';
import { createLibraryRouter } from './routes/library';
import { createRefinedTranslationRouter } from './routes/refined-translation';
import { createOpdsRouter } from './routes/opds';

export interface ServerAppOptions {
  controlCenter?: ControlCenterService;
}

export function createServerApp(options: ServerAppOptions = {}): Express {
  const app = express();
  const webDistPath = path.resolve(process.cwd(), 'dist/web');
  const webIndexPath = path.join(webDistPath, 'index.html');
  const controlCenter = options.controlCenter ?? new ControlCenterService();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/control', createControlCenterRouter({ service: controlCenter }));
  app.use('/api/library', createLibraryRouter({ service: controlCenter }));
  app.use('/api/refined-translations', createRefinedTranslationRouter({ service: controlCenter }));
  app.use('/opds', createOpdsRouter({ service: controlCenter }));

  app.use(express.static(webDistPath));

  app.use((request, response, next) => {
    if (request.path.startsWith('/api') || request.path.startsWith('/opds')) {
      next();
      return;
    }

    if (!fs.existsSync(webIndexPath)) {
      response.status(503).json({
        message: 'Web client has not been built yet. Run npm run build:web or npm run dev:web.',
      });
      return;
    }

    response.sendFile(webIndexPath);
  });

  return app;
}
