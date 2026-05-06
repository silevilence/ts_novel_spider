import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MockHtmlSpiderAdapter } from '../adapters/spider/mock-html-spider-adapter';
import { createServerApp } from '../app';
import { ControlCenterService } from '../core/control-center';
import { SqliteNovelRepository } from '../core/novel-repository';

function createTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-novel-spider-routes-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  const controlCenter = new ControlCenterService({
    repository,
    spiders: [
      {
        descriptor: {
          sourceId: 'mock-html',
          label: 'Mock HTML Demo',
          description: 'Route test source',
          defaultNovelId: 'demo',
        },
        spider: new MockHtmlSpiderAdapter({
          metadataHtml: `
            <article>
              <h1 data-testid="title">路由测试小说</h1>
              <div data-testid="author">测试作者</div>
              <div data-testid="description">测试描述</div>
              <ul data-testid="tags"><li>测试</li></ul>
              <div data-testid="chapter-count">2</div>
            </article>
          `,
          catalogHtml: `
            <ol data-testid="catalog">
              <li data-chapter-id="chapter-1"><a href="/demo/1">第 1 章</a></li>
              <li data-chapter-id="chapter-2"><a href="/demo/2">第 2 章</a></li>
            </ol>
          `,
          chapterHtmlById: {
            'chapter-1': `<article><h1 data-testid="chapter-title">第 1 章</h1><section data-testid="content"><p>a</p></section></article>`,
            'chapter-2': `<article><h1 data-testid="chapter-title">第 2 章</h1><section data-testid="content"><p>b</p></section></article>`,
          },
        }),
      },
    ],
  });
  const app = createServerApp({ controlCenter });

  return {
    app,
    controlCenter,
    cleanup: () => {
      controlCenter.close();
      repository.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('control-center routes expose sources, preview and task lifecycle', async () => {
  const { app, cleanup } = createTestServer();
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const sourcesResponse = await fetch(`${baseUrl}/api/control/sources`);
    const sourcesPayload = (await sourcesResponse.json()) as { sources: Array<{ sourceId: string }> };
    assert.equal(sourcesResponse.status, 200);
    assert.deepEqual(sourcesPayload.sources.map((source) => source.sourceId), ['mock-html']);

    const previewResponse = await fetch(
      `${baseUrl}/api/control/preview?sourceId=mock-html&novelId=demo`,
    );
    const previewPayload = (await previewResponse.json()) as { metadata: { title: string } };
    assert.equal(previewResponse.status, 200);
    assert.equal(previewPayload.metadata.title, '路由测试小说');

    const createTaskResponse = await fetch(`${baseUrl}/api/control/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceId: 'mock-html',
        novelId: 'demo',
      }),
    });
    const createTaskPayload = (await createTaskResponse.json()) as { task: { id: string } };
    assert.equal(createTaskResponse.status, 202);

    const completedTask = await waitForCompletedTask(baseUrl, createTaskPayload.task.id);
    assert.equal(completedTask.status, 'completed');
    assert.equal(completedTask.chapters.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    cleanup();
  }
});

async function waitForCompletedTask(baseUrl: string, taskId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/control/tasks/${taskId}`);
    const payload = (await response.json()) as {
      task: {
        status: string;
        chapters: unknown[];
      };
    };

    if (payload.task.status === 'completed' || payload.task.status === 'failed') {
      return payload.task;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Task ${taskId} did not finish in time.`);
}