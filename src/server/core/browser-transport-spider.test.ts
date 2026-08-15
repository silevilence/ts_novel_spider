import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BrowserCaptureService, type BrowserHtmlRequest } from './browser-capture';
import { BrowserTransportSpiderAdapter } from './browser-transport-spider';
import { SqliteNovelRepository } from './novel-repository';
import { BaseHtmlSpiderAdapter, type ChapterContent, type ChapterIndexEntry, type NovelMetadata, type SpiderRunContext } from './spider';
import { SyosetuSpiderAdapter } from '../adapters/spider/syosetu-spider-adapter';

class ParsingProbeAdapter extends BaseHtmlSpiderAdapter {
  readonly sourceId = 'probe';
  constructor(
    private readonly fetchHtml: (request: BrowserHtmlRequest) => Promise<string>,
    private readonly onChapter: () => number,
    private readonly onMetadata: () => number = () => 2,
  ) { super(); }
  buildInfoPageUrl(novelId: string): string { return `https://example.test/${novelId}`; }
  async fetchMetadata(context: SpiderRunContext): Promise<NovelMetadata> {
    await this.fetchHtml({ url: this.buildInfoPageUrl(context.novelId) });
    if (this.onMetadata() === 1) throw new Error('元数据选择器未命中');
    return { novelId: context.novelId, title: 'Probe', author: '', description: '', tags: [], chapterCount: 1, infoPageUrl: this.buildInfoPageUrl(context.novelId) };
  }
  async fetchChapterIndex(): Promise<ChapterIndexEntry[]> { return []; }
  async fetchChapter(_context: SpiderRunContext, chapter: ChapterIndexEntry): Promise<ChapterContent> {
    await this.fetchHtml({ url: chapter.url });
    const attempt = this.onChapter();
    if (attempt === 1) throw new Error('正文选择器未命中');
    return { chapterId: chapter.id, index: chapter.index, title: chapter.title, url: chapter.url, content: 'ok' };
  }
}

test('browser parser failure waits for user continue and retries the same chapter', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-parser-wait-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    const capture = new BrowserCaptureService({ store: repository });
    const paired = capture.exchangePairingToken(capture.createPairingToken().token, 'parser test');
    let connectionId = '';
    const connection = capture.connectPeer(paired.key, {
      send(message) {
        if (message.type === 'capture_request') capture.receivePeerMessage(connectionId, {
          type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>page</html>',
        });
      },
      close() {},
    });
    connectionId = connection.id;
    let chapterAttempts = 0;
    const spider = new BrowserTransportSpiderAdapter(
      capture,
      (fetchHtml) => new ParsingProbeAdapter(fetchHtml, () => ++chapterAttempts),
      { taskId: 'parser-task', sourceId: 'probe', novelId: 'novel' },
    );
    const states: string[] = [];
    capture.onTransportState((event) => states.push(event.state));
    const pending = spider.fetchChapters(
      { novelId: 'novel' },
      [{ id: 'chapter-1', index: 1, title: 'One', url: 'https://example.test/one' }],
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(states, ['waiting_user']);
    capture.controlTask('parser-task', 'continue');
    const results = await pending;
    assert.equal('content' in (results[0] ?? {}), true);
    assert.equal(chapterAttempts, 2);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('browser metadata parse failure also waits for user continue', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-metadata-wait-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    const capture = new BrowserCaptureService({ store: repository });
    const paired = capture.exchangePairingToken(capture.createPairingToken().token, 'metadata test');
    let connectionId = '';
    const connection = capture.connectPeer(paired.key, {
      send(message) {
        if (message.type === 'capture_request') capture.receivePeerMessage(connectionId, {
          type: 'capture_result', requestId: message.requestId, url: message.url, html: '<html>metadata</html>',
        });
      },
      close() {},
    });
    connectionId = connection.id;
    let metadataAttempts = 0;
    const spider = new BrowserTransportSpiderAdapter(
      capture,
      (fetchHtml) => new ParsingProbeAdapter(fetchHtml, () => 2, () => ++metadataAttempts),
      { taskId: 'metadata-task', sourceId: 'probe', novelId: 'novel' },
    );
    const pending = spider.fetchMetadata({ novelId: 'novel' });
    await new Promise((resolve) => setImmediate(resolve));
    capture.controlTask('metadata-task', 'continue');
    assert.equal((await pending).title, 'Probe');
    assert.equal(metadataAttempts, 2);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Syosetu browser transport requests the info page before the distinct catalog URL', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-syosetu-urls-'));
  const repository = new SqliteNovelRepository(path.join(tempDir, 'novels.db'));
  try {
    const capture = new BrowserCaptureService({ store: repository });
    const paired = capture.exchangePairingToken(capture.createPairingToken().token, 'Syosetu URL test');
    const requests: Array<{ phase: string; url: string }> = [];
    const metadataHtml = '<h1 class="p-infotop-title"><a>作品</a></h1><dl class="p-infotop-data"><dt>作者名</dt><dd>作者</dd></dl><span class="p-infotop-type__allep">全1エピソード</span>';
    let metadataRequest: { requestId: string; url: string } | null = null;
    let connectionId = '';
    const connection = capture.connectPeer(paired.key, {
      send(message) {
        if (message.type !== 'capture_request') return;
        requests.push({ phase: message.phase, url: message.url });
        if (message.phase === 'metadata') {
          metadataRequest = { requestId: message.requestId, url: message.url };
          queueMicrotask(() => capture.receivePeerMessage(connectionId, {
            type: 'capture_signal', requestId: message.requestId, signal: 'permission_required', message: 'Grant site access.',
          }));
          return;
        }
        const html = '<div class="p-eplist__sublist"><dd class="p-eplist__subtitle"><a href="/n1234ab/1/">第一話</a></dd></div>';
        queueMicrotask(() => capture.receivePeerMessage(connectionId, {
          type: 'capture_result', requestId: message.requestId, url: message.url, html,
        }));
      },
      close() {},
    });
    connectionId = connection.id;
    const spider = new BrowserTransportSpiderAdapter(
      capture,
      (fetchHtml) => new SyosetuSpiderAdapter({ fetchHtml }),
      { taskId: null, sourceId: 'syosetu', novelId: 'n1234ab' },
    );

    const metadataPending = spider.fetchMetadata({ novelId: 'n1234ab' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(metadataRequest);
    capture.receivePeerMessage(connectionId, {
      type: 'capture_result', requestId: metadataRequest.requestId, url: metadataRequest.url, html: metadataHtml,
    });
    const metadata = await metadataPending;
    await spider.fetchChapterIndex({ novelId: 'n1234ab' }, metadata);

    assert.deepEqual(requests, [
      { phase: 'metadata', url: 'https://ncode.syosetu.com/novelview/infotop/ncode/n1234ab/' },
      { phase: 'catalog', url: 'https://ncode.syosetu.com/n1234ab/' },
    ]);
  } finally {
    repository.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
