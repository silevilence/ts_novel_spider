import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReaderPosition, positionAtViewport, readerFingerprint } from './reader-position';

test('reader positions identify content and reject stale/corrupt positions', () => {
  const fingerprint = readerFingerprint('原文');
  const raw = JSON.stringify({ fingerprint, block: 2, fraction: 0.4 });
  assert.equal(parseReaderPosition(raw, fingerprint)?.block, 2);
  assert.equal(parseReaderPosition(raw, readerFingerprint('原文变化')), null);
  assert.equal(parseReaderPosition('{bad', fingerprint), null);
  for (const block of [-1, 1.5, '1']) assert.equal(parseReaderPosition(JSON.stringify({ fingerprint, block, fraction: 0.5 }), fingerprint), null);
});
test('reader anchor stores block-relative position rather than a fixed pixel offset', () => {
  assert.deepEqual(positionAtViewport([{ top: -400, height: 200 }, { top: -200, height: 700 }], 'v1'), { fingerprint: 'v1', block: 1, fraction: 0.4 });
  assert.deepEqual(positionAtViewport([], 'v1'), { fingerprint: 'v1', block: 0, fraction: 0 });
});
