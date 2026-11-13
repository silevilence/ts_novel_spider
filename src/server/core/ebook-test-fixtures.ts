import JSZip from 'jszip';

/** Generated entirely locally; deliberately reverse file and reading orders. */
export async function makeEpubFixture(options: { version?: 2 | 3; noToc?: boolean; fixed?: boolean; missing?: boolean; extra?: Record<string, Buffer | string> } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  const version = options.version ?? 3;
  zip.file('OPS/book.opf', `<package version="${version}.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>本地电子书</dc:title><dc:creator>作者甲</dc:creator><dc:subject>奇幻</dc:subject>${options.fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="a" href="a.xhtml"/><item id="b" href="parts/b.xhtml"/><item id="toc" href="${version === 2 ? 'toc.ncx' : 'nav.xhtml'}" ${version === 3 ? 'properties="nav"' : ''}/></manifest><spine toc="toc"><itemref idref="b"/><itemref idref="a"/></spine></package>`);
  if (!options.noToc) zip.file(version === 2 ? 'OPS/toc.ncx' : 'OPS/nav.xhtml', version === 2
    ? '<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="parts/b.xhtml"/></navPoint><navPoint><navLabel><text>第二章</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>'
    : '<html><body><nav><ol><li><a href="parts/b.xhtml">第一章</a><ol><li><a href="a.xhtml">第二章</a></li></ol></li></ol></nav></body></html>');
  zip.file('OPS/a.xhtml', '<html><body><h1>结尾</h1><p id="note">后记<a href="parts/b.xhtml#ref">返回</a></p></body></html>');
  if (!options.missing) zip.file('OPS/parts/b.xhtml', '<html><body><h1>开始</h1><p id="ref">正文<strong>重点</strong><a href="../a.xhtml#note">注释</a></p><img src="../images/pic.png"/><table><tr><th>项目</th><th>值</th></tr><tr><td>A</td><td>1</td></tr></table><script>alert(1)</script></body></html>');
  zip.file('OPS/images/pic.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4UGFDEmIY1TCqYfhqAAD8vaQQiVjx+AAAAABJRU5ErkJggg==', 'base64'));
  for (const [name, data] of Object.entries(options.extra ?? {})) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
