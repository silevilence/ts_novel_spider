import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractReleaseNotes, normalizeVersionTag, writeReleaseNotes } from './prepare-release.mjs';

test('normalizeVersionTag accepts uppercase and lowercase version prefixes', () => {
  assert.deepEqual(normalizeVersionTag('V1.2.3'), {
    originalTag: 'V1.2.3',
    normalizedTag: 'v1.2.3',
    version: '1.2.3',
  });

  assert.deepEqual(normalizeVersionTag('v0.2.0'), {
    originalTag: 'v0.2.0',
    normalizedTag: 'v0.2.0',
    version: '0.2.0',
  });
});

test('normalizeVersionTag rejects non-semver tags', () => {
  assert.throws(() => normalizeVersionTag('release-1.2.3'), /Expected the format v<major>.<minor>.<patch>/);
});

test('extractReleaseNotes returns the matching changelog section', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-release-test-'));
  const changelogPath = path.join(tempDirectory, 'CHANGELOG.md');

  fs.writeFileSync(
    changelogPath,
    ['# Change Log', '', '## V1.2.3', '', '- Added release automation.', '', '## V1.2.2', '', '- Previous release.'].join('\n'),
    'utf8',
  );

  assert.equal(extractReleaseNotes(changelogPath, '1.2.3'), '- Added release automation.');
});

test('writeReleaseNotes persists notes to a temporary markdown file', () => {
  const releaseNotesPath = writeReleaseNotes('Line one\n\nLine two');
  const persistedNotes = fs.readFileSync(releaseNotesPath, 'utf8');

  assert.match(releaseNotesPath, /release-notes\.md$/);
  assert.equal(persistedNotes, `Line one\n\nLine two${os.EOL}`);
});