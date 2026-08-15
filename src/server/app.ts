import fs from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';

import { ControlCenterService } from './core/control-center';
import { healthRouter } from './routes/health';
import { createControlCenterRouter } from './routes/control-center';
import { createLibraryRouter } from './routes/library';
import { createRefinedTranslationRouter } from './routes/refined-translation';
import { createOpdsRouter } from './routes/opds';
import { createBrowserCaptureRouter } from './routes/browser-capture';

export interface ServerAppOptions {
  controlCenter?: ControlCenterService;
  allowRemoteBrowserCapture?: boolean;
}

export function createServerApp(options: ServerAppOptions = {}): Express {
  const app = express();
  const webDistPath = path.resolve(process.cwd(), 'dist/web');
  const webIndexPath = path.join(webDistPath, 'index.html');
  const controlCenter = options.controlCenter ?? new ControlCenterService();

  // 手动章节会在 JSON 中携带 Base64 图片；单张 10MB 图片编码后约为 13.4MB。
  app.use(express.json({ limit: '64mb' }));
  app.use((request, response, next) => {
    const isBrowserChannel = request.path.startsWith('/api/browser') || request.path.startsWith('/api/control/browser');
    if (isBrowserChannel && !options.allowRemoteBrowserCapture && !isLoopbackHost(request.header('host'))) {
      response.status(403).json({ message: 'Browser capture pairing is restricted to the loopback host.' });
      return;
    }
    next();
  });
  app.use('/api/health', healthRouter);
  app.use('/api/control', createControlCenterRouter({ service: controlCenter }));
  app.use('/api/browser', createBrowserCaptureRouter(controlCenter.getBrowserCaptureService()));
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

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLocaleLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
