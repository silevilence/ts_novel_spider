import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { isServerEntrypointInvocation, resolveServerListenOptions } from './index';

test('resolveServerListenOptions defaults to a container-friendly host', () => {
  const options = resolveServerListenOptions({});

  assert.equal(options.port, 3000);
  assert.equal(options.host, '0.0.0.0');
});

test('resolveServerListenOptions respects explicit HOST and PORT values', () => {
  const options = resolveServerListenOptions({
    HOST: '127.0.0.1',
    PORT: '4312',
  });

  assert.equal(options.port, 4312);
  assert.equal(options.host, '127.0.0.1');
});

test('isServerEntrypointInvocation only matches the active entry file', () => {
  const currentFilePath = path.resolve('src/server/index.ts');

  assert.equal(isServerEntrypointInvocation(currentFilePath, currentFilePath), true);
  assert.equal(
    isServerEntrypointInvocation(path.resolve('src/server/index.test.ts'), currentFilePath),
    false,
  );
  assert.equal(isServerEntrypointInvocation(undefined, currentFilePath), false);
});