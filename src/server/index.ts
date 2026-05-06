import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { healthRouter } from './routes/health';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const webDistPath = path.resolve(process.cwd(), 'dist/web');
const webIndexPath = path.join(webDistPath, 'index.html');

app.use(express.json());
app.use('/api/health', healthRouter);
app.use(express.static(webDistPath));

app.use((request, response, next) => {
  if (request.path.startsWith('/api')) {
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

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});