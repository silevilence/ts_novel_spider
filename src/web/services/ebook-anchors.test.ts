import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { remarkEbookAnchors, ebookLinkTarget } from './ebook-anchors';

test('generated EPUB anchors survive sanitization without enabling raw HTML', () => {
  const id = 'ebook-00000000-0000-0000-0000-000000000000-1234567890abcdef';
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkEbookAnchors], rehypePlugins: [rehypeSanitize],
    children: `[${id}]: #\n\n[注释](#${id})\n\n<script>alert(1)</script>`,
  }));
  assert.match(html, new RegExp(`id="user-content-${id}"`));
  assert(!html.includes('<script>'));
  assert.equal(ebookLinkTarget(`#${id}`)?.chapterId, '00000000-0000-0000-0000-000000000000');
  assert.equal(ebookLinkTarget('javascript:alert(1)'), null);
});
