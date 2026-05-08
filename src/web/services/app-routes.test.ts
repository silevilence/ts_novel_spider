import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLibraryNovelPath,
  buildLibraryReaderPath,
  normalizePathname,
  resolveAppLocation,
  resolveAppRoute,
} from './app-routes';

test('normalizePathname keeps root and trims trailing slash', () => {
  assert.equal(normalizePathname('/'), '/');
  assert.equal(normalizePathname('/monitor/'), '/monitor');
  assert.equal(normalizePathname(' /settings/ '), '/settings');
});

test('resolveAppRoute matches known routes and falls back to control', () => {
  assert.equal(resolveAppRoute('/monitor').id, 'monitor');
  assert.equal(resolveAppRoute('/settings/').id, 'settings');
  assert.equal(resolveAppRoute('/library').id, 'library');
  assert.equal(resolveAppRoute('/unknown').id, 'control');
});

test('resolveAppLocation parses library detail and reader routes', () => {
  const detailLocation = resolveAppLocation('/library/syosetu/n1000lib');
  assert.equal(detailLocation.route.id, 'library');
  assert.equal(detailLocation.view, 'detail');
  assert.equal(detailLocation.sourceId, 'syosetu');
  assert.equal(detailLocation.novelId, 'n1000lib');
  assert.equal(detailLocation.chapterId, null);

  const readerLocation = resolveAppLocation('/library/syosetu/n1000lib/read/chapter-1');
  assert.equal(readerLocation.view, 'reader');
  assert.equal(readerLocation.chapterId, 'chapter-1');
  assert.equal(buildLibraryNovelPath('syosetu', 'n1000lib'), '/library/syosetu/n1000lib');
  assert.equal(
    buildLibraryReaderPath('syosetu', 'n1000lib', 'chapter-1'),
    '/library/syosetu/n1000lib/read/chapter-1',
  );
});