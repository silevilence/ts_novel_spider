import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNovelTarget } from './novel-target';

test('recognizes supported catalogs, information pages and chapter URLs locally', () => {
  for (const [host, source] of [['ncode.syosetu.com', 'syosetu'], ['novel18.syosetu.com', 'syosetu18']]) {
    for (const path of ['/N1234AB', '/N1234AB/', '/N1234AB/12/', '/novelview/infotop/ncode/N1234AB/']) {
      assert.deepEqual(resolveNovelTarget('other', `https://${host}${path}?p=2#top`), { sourceId: source, novelId: 'n1234ab', fromUrl: true });
    }
  }
  for (const path of ['/works/123', '/works/123/', '/works/123/episodes/456']) {
    assert.deepEqual(resolveNovelTarget('syosetu', `https://kakuyomu.jp${path}?x=1#top`), { sourceId: 'kakuyomu', novelId: '123', fromUrl: true });
  }
  assert.deepEqual(resolveNovelTarget('syosetu18', ' N1234AB '), { sourceId: 'syosetu18', novelId: 'n1234ab', fromUrl: false });
  assert.equal(resolveNovelTarget('mock-html', 'demo').novelId, 'demo');
});

test('rejects malformed, unrelated and spoofed URLs and invalid known-source IDs', () => {
  for (const url of ['https://ncode.syosetu.com.evil.test/n1234ab/', 'https://evil.test/works/123', 'https://kakuyomu.jp/users/123', 'https://ncode.syosetu.com/', 'javascript:alert(1)', 'https://user@kakuyomu.jp/works/123', 'https://kakuyomu.jp:444/works/123', 'http:/', 'kakuyomu.jp/works/123']) {
    assert.throws(() => resolveNovelTarget('syosetu', url));
  }
  assert.throws(() => resolveNovelTarget('syosetu', '123'));
  assert.throws(() => resolveNovelTarget('kakuyomu', 'n123ab'));
});
