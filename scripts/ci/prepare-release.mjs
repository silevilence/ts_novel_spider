import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function appendGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;

  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${name}=${value}${os.EOL}`);
}

export function normalizeVersionTag(rawTag) {
  const trimmedTag = rawTag.trim();
  const match = /^v(?<version>\d+\.\d+\.\d+)$/i.exec(trimmedTag);

  if (!match?.groups?.version) {
    throw new Error(
      `Version tag "${rawTag}" is invalid. Expected the format v<major>.<minor>.<patch>, such as v1.1.0.`,
    );
  }

  return {
    originalTag: trimmedTag,
    normalizedTag: `v${match.groups.version}`,
    version: match.groups.version,
  };
}

export function extractReleaseNotes(changelogPath, version) {
  const changelogContent = fs.readFileSync(changelogPath, 'utf8');
  const lines = changelogContent.split(/\r?\n/);
  const normalizedVersion = version.toLowerCase();
  let releaseHeadingIndex = -1;

  for (const [index, line] of lines.entries()) {
    const headingMatch = /^##\s+v?(\d+\.\d+\.\d+)\s*$/i.exec(line.trim());

    if (headingMatch?.[1]?.toLowerCase() === normalizedVersion) {
      releaseHeadingIndex = index;
      break;
    }
  }

  if (releaseHeadingIndex === -1) {
    throw new Error(
      `Unable to find a changelog section for version ${version} in ${path.basename(changelogPath)}.`,
    );
  }

  let nextHeadingIndex = lines.length;

  for (let index = releaseHeadingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      nextHeadingIndex = index;
      break;
    }
  }

  const notes = lines.slice(releaseHeadingIndex + 1, nextHeadingIndex).join('\n').trim();

  if (!notes) {
    throw new Error(`The changelog section for version ${version} is empty.`);
  }

  return notes;
}

export function writeReleaseNotes(notes) {
  const releaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-release-'));
  const releaseNotesPath = path.join(releaseDirectory, 'release-notes.md');

  fs.writeFileSync(releaseNotesPath, `${notes}${os.EOL}`, 'utf8');

  return releaseNotesPath;
}

export function main() {
  const rawTag = process.argv[2];
  const changelogPath = path.resolve(process.argv[3] ?? 'changelog.md');

  if (!rawTag) {
    throw new Error('Missing version tag argument. Usage: node scripts/ci/prepare-release.mjs <tag> [changelog-path]');
  }

  if (!fs.existsSync(changelogPath)) {
    throw new Error(`Changelog file does not exist: ${changelogPath}`);
  }

  const { originalTag, normalizedTag, version } = normalizeVersionTag(rawTag);
  const releaseNotes = extractReleaseNotes(changelogPath, version);
  const releaseNotesPath = writeReleaseNotes(releaseNotes);

  appendGithubOutput('original_tag', originalTag);
  appendGithubOutput('normalized_tag', normalizedTag);
  appendGithubOutput('version', version);
  appendGithubOutput('release_notes_path', releaseNotesPath);

  process.stdout.write(
    JSON.stringify(
      {
        originalTag,
        normalizedTag,
        version,
        releaseNotesPath,
      },
      null,
      2,
    ),
  );
  process.stdout.write(os.EOL);
}

function isDirectExecution(entryPath = process.argv[1]) {
  if (!entryPath) {
    return false;
  }

  return import.meta.url === pathToFileURL(path.resolve(entryPath)).href;
}

if (isDirectExecution()) {
  main();
}