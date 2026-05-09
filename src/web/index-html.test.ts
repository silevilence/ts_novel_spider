import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

test('web shell references the favicon asset', () => {
  const indexHtmlPath = path.join(webRoot, 'index.html');
  const faviconPath = path.join(webRoot, 'favicon.svg');

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const favicon = fs.readFileSync(faviconPath, 'utf8');

  assert.match(indexHtml, /<meta name="theme-color" content="#081726"\s*\/?>/);
  assert.match(indexHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"\s*\/?>/);
  assert.match(favicon, /<svg[\s\S]*viewBox="0 0 64 64"/);
  assert.match(favicon, /TS Novel Spider favicon/);
  assert.match(favicon, /open book/i);
});