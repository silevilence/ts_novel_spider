import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTextEbook } from './ebook-txt';

test('TXT preserves preface, repeated headings and trailing text across BOM/newlines', () => {
  const parsed = parseTextEbook(Buffer.from('\uFEFF前言\r\n\r\n第一章 开始\r第一段\r\n\r\n第二段\n第一章 开始\n结尾'), '书.txt');
  assert.deepEqual(parsed.chapters.map(ch => ch.title), ['序言', '第一章 开始', '第一章 开始']);
  assert.deepEqual(parsed.chapters.map(ch => ch.content), ['前言', '第一段\n\n第二段', '结尾']);
  assert.equal(new Set(parsed.chapters.map(ch => ch.id)).size, 3);
  assert.equal(parsed.encoding, 'utf-8');
});
test('TXT auto-detects GB18030, supports explicit decoding and rejects invalid input', () => {
  const bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  const parsed = parseTextEbook(bytes, '中文.txt');
  assert.equal(parsed.chapters[0]?.content, '中文');
  assert.equal(parsed.encoding, 'gb18030');
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parseTextEbook(bytes, '中文.txt', 'gb18030').warnings.length, 0);
  assert.throws(() => parseTextEbook(bytes, '中文.txt', 'utf-8'));
  for (const text of ['', ' \n', '\0data', '第一章']) assert.throws(() => parseTextEbook(Buffer.from(text), 'x.txt'));
});
