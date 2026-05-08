import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePathname, resolveAppRoute } from './app-routes';

test('normalizePathname keeps root and trims trailing slash', () => {
  assert.equal(normalizePathname('/'), '/');
  assert.equal(normalizePathname('/monitor/'), '/monitor');
  assert.equal(normalizePathname(' /settings/ '), '/settings');
});

test('resolveAppRoute matches known routes and falls back to control', () => {
  assert.equal(resolveAppRoute('/monitor').id, 'monitor');
  assert.equal(resolveAppRoute('/settings/').id, 'settings');
  assert.equal(resolveAppRoute('/unknown').id, 'control');
});