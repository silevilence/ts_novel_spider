import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEpubEbook } from './ebook-epub';
import { makeEpubFixture } from './ebook-test-fixtures';

test('EPUB 2/3 respect spine, metadata, TOC and safe text structure', async () => {
  for (const version of [2, 3] as const) {
    const { preview } = await parseEpubEbook(await makeEpubFixture({ version }), 'sample.epub');
    assert.equal(preview.title, '本地电子书');
    assert.equal(preview.author, '作者甲');
    assert.deepEqual(preview.tags, ['奇幻']);
    assert.deepEqual(preview.chapters.map(ch => ch.title), ['第一章', '第二章']);
    assert.match(preview.chapters[0]!.content, /正文\*\*重点\*\*/);
    assert.match(preview.chapters[0]!.content, /\| 项目 \| 值 \|/);
    assert(!preview.chapters[0]!.content.includes('alert'));
    assert.match(preview.chapters[1]!.content, /后记/);
  }
});
test('EPUB missing TOC falls back; malformed, fixed-layout, missing body and zip traversal fail clearly', async () => {
  assert((await parseEpubEbook(await makeEpubFixture({ noToc: true }), 'sample.epub')).preview.warnings.length > 0);
  await assert.rejects(parseEpubEbook(Buffer.from('invalid'), 'x.epub'), /损坏/);
  for (const options of [{ fixed: true }, { missing: true }, { extra: { '../outside': 'bad' } }]) await assert.rejects(parseEpubEbook(await makeEpubFixture(options), 'x.epub'));
});
