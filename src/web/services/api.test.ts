import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibraryExportDownloadUrl, cacheLibraryNovelMedia } from './api';

test('buildLibraryExportDownloadUrl encodes source, novel and format for export downloads', () => {
  assert.equal(
    buildLibraryExportDownloadUrl('syosetu 18', 'n1000/lib', 'markdown'),
    '/api/library/novels/syosetu%2018/n1000%2Flib/exports/markdown/download',
  );
});

test('cacheLibraryNovelMedia targets the batch cache endpoint', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), '/api/library/novels/syosetu%2018/n1000%2Flib/media/cache');
      assert.equal(init?.method, 'POST');

      return new Response(JSON.stringify({
        result: {
          total: 3,
          cached: 2,
          skipped: 1,
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const payload = await cacheLibraryNovelMedia('syosetu 18', 'n1000/lib');
    assert.deepEqual(payload.result, {
      total: 3,
      cached: 2,
      skipped: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});