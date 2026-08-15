import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import {
  buildTaskSubmissionInput,
  resolveRetryTaskTarget,
} from './control-center-model';

test('buildTaskSubmissionInput uses the provided target source and novel ids', () => {
  assert.deepEqual(
    buildTaskSubmissionInput(
      {
        sourceId: 'syosetu18',
        novelId: 'n3057hq',
      },
      {
        chapterIds: ['74', '75'],
        forceRefetch: false,
        chapterConcurrency: 4,
        chapterRetryCount: 1,
      },
    ),
    {
      sourceId: 'syosetu18',
      novelId: 'n3057hq',
      chapterIds: ['74', '75'],
      forceRefetch: false,
      chapterConcurrency: 4,
      chapterRetryCount: 1,
    },
  );
});

test('resolveRetryTaskTarget always retries against the current task target', () => {
  const task: ApiTaskSnapshot = {
    id: 'task-1',
    sourceId: 'syosetu18',
    novelId: 'n3057hq',
    kind: 'direct',
    status: 'completed',
    runId: 'run-1',
    createdAt: '2026-05-10T00:00:00.000Z',
    startedAt: '2026-05-10T00:00:00.000Z',
    completedAt: '2026-05-10T00:10:00.000Z',
    errorMessage: null,
    options: {
      chapterIds: [],
      chapterConcurrency: 4,
      chapterRetryCount: 1,
      forceRefetch: false,
    },
    progress: {
      catalogChapters: 83,
      queuedChapters: 83,
      completedChapters: 0,
      failedChapters: 83,
      percent: 100,
    },
    metadata: null,
    chapters: [],
    failures: [
      {
        chapterId: '74',
        title: '第七十四話',
        attempts: 2,
        errorMessage: 'failed',
      },
      {
        chapterId: '75',
        title: '第七十五話',
        attempts: 2,
        errorMessage: 'failed',
      },
    ],
    snapshotSummary: null,
    events: [],
  };

  assert.deepEqual(resolveRetryTaskTarget(task), {
    sourceId: 'syosetu18',
    novelId: 'n3057hq',
    kind: 'direct',
    chapterIds: ['74', '75'],
  });
});
