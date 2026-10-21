import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { ControlCenterService } from '../core/control-center';
import { SqliteNovelRepository } from '../core/novel-repository';
import { SystemPreferencesService } from '../core/system-preferences';
import { createRefinedTranslationRouter } from './refined-translation';
import { closeServer, waitForServerListening } from './library-test-helpers';

test('refined API creates with reusable results and synchronizes the latest source snapshot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'refined-sync-api-'));
  const repository = new SqliteNovelRepository(':memory:');
  const service = new ControlCenterService({ repository, spiders: [], systemPreferences: new SystemPreferencesService({ storageFilePath: path.join(directory, 'preferences.json') }), offlineAssetStoragePath: path.join(directory, 'assets'), exportStoragePath: path.join(directory, 'exports') });
  const app = express();
  app.use(express.json());
  app.use('/api/refined-translations', createRefinedTranslationRouter({ service }));
  const server = app.listen(0, '127.0.0.1');
  try {
    const baseUrl = await waitForServerListening(server);
    const novelId = repository.createManualNovel('原书').metadata.novelId;
    const chapter = repository.saveManualChapter(novelId, { title: '一', content: '原文' }).chapter;
    const post = (url: string, body: object) => fetch(`${baseUrl}/api/refined-translations${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const input = { sourceId: 'manual', novelId, sourceLang: 'ja', targetLang: 'zh-CN' };
    const donorResponse = await post('/tasks', input);
    assert.equal(donorResponse.status, 201);
    const donor = await donorResponse.json() as { task: { id: string } };
    repository.updateRefinedTranslationSegment(donor.task.id, chapter.id, 0, '译文', 'translated');
    const importedResponse = await post('/tasks', { ...input, reuseTaskId: donor.task.id });
    assert.equal(importedResponse.status, 201);
    const imported = await importedResponse.json() as { task: { id: string } };
    assert.equal(repository.listRefinedTranslationSegments(imported.task.id, chapter.id)[0]?.translatedText, '译文');
    repository.saveManualChapter(novelId, { chapterId: chapter.id, title: '一', content: '新增\n\n原文' });
    const synced = await post(`/tasks/${imported.task.id}/sync-source`, { reuseTaskId: donor.task.id });
    assert.equal(synced.status, 200);
    const payload = await synced.json() as { summary: { updatedChapters: number; preservedSegments: number; pendingSegments: number } };
    assert.equal(payload.summary.updatedChapters, 1);
    assert.equal(payload.summary.preservedSegments, 1);
    assert.equal(payload.summary.pendingSegments, 1);
    assert.equal((await post(`/tasks/${imported.task.id}/sync-source`, { reuseTaskId: 'missing' })).status, 422);
    assert.equal((await post('/tasks', { ...input, targetLang: 'en', reuseTaskId: donor.task.id })).status, 422);
    assert.equal((await post('/tasks/missing/sync-source', {})).status, 422);
    const limitTask = await post('/tasks', { ...input, modelConfig: { maxParagraphRevisions: 1, maxReviewRounds: 3 } });
    assert.equal(limitTask.status, 201);
    const limitPayload = await limitTask.json() as { task: { id: string; modelConfig: { maxParagraphRevisions: number } } };
    assert.equal(limitPayload.task.modelConfig.maxParagraphRevisions, 1);
    assert.equal((await post('/tasks', { ...input, modelConfig: { maxParagraphRevisions: 0, maxReviewRounds: 3 } })).status, 422);
    assert.equal((await post('/tasks', { ...input, modelConfig: { maxParagraphRevisions: 2, maxReviewRounds: 3 } })).status, 422);
    const task = repository.getRefinedTranslationTask(limitPayload.task.id)!;
    const invalidEdit = await fetch(`${baseUrl}/api/refined-translations/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelConfig: { ...task.modelConfig, maxParagraphRevisions: 10, maxReviewRounds: 3 } }) });
    assert.equal(invalidEdit.status, 422);
    assert.match((await invalidEdit.json() as { message: string }).message, /审核轮次/);
    const segment = repository.listRefinedTranslationSegments(task.id, chapter.id)[0]!;
    repository.saveParagraphRevisionState(task.id, segment.id, { count: 1, epoch: 0, lastCycle: '0:1', status: 'finalized', finalization: null });
    assert.equal((await post(`/tasks/${task.id}/chapters/${chapter.id}/segments/0/reopen`, {})).status, 200);
    assert.equal(repository.getParagraphRevisionState(task.id, segment.id).count, 0);
    assert.equal((await post(`/tasks/${task.id}/chapters/${chapter.id}/segments/999/reopen`, {})).status, 404);
    repository.updateRefinedTranslationTask(imported.task.id, { status: 'running' });
    assert.equal((await post(`/tasks/${imported.task.id}/sync-source`, {})).status, 422);
  } finally {
    await closeServer(server);
    service.close();
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
