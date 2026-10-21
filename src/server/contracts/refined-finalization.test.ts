import assert from 'node:assert/strict';
import test from 'node:test';
import { paragraphRevisionLimit, revisionLimitsError } from './refined-finalization';

test('legacy defaults and API/form validation share effective paragraph limits', () => {
  assert.equal(paragraphRevisionLimit(undefined, 5), 3);
  assert.equal(paragraphRevisionLimit(undefined, 1), 1);
  assert.equal(paragraphRevisionLimit(2, 5), 2);
  assert.equal(revisionLimitsError(1, 3), null);
  assert.ok(revisionLimitsError(2, 3));
  for (const limit of [0, -1, 21, 1.5, NaN, Infinity]) assert.ok(revisionLimitsError(limit, 10));
});
