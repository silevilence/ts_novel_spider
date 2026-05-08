import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibraryExportDownloadUrl } from './api';

test('buildLibraryExportDownloadUrl encodes source, novel and format for export downloads', () => {
  assert.equal(
    buildLibraryExportDownloadUrl('syosetu 18', 'n1000/lib', 'markdown'),
    '/api/library/novels/syosetu%2018/n1000%2Flib/exports/markdown/download',
  );
});