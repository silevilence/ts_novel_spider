interface MarkdownNode {
  type: string;
  identifier?: string;
  children?: MarkdownNode[];
  data?: { hName: string; hProperties: { id: string } };
}

/** Only our generated anchor definitions become elements; arbitrary raw HTML stays disabled. */
export function remarkEbookAnchors() {
  return (tree: MarkdownNode) => {
    function walk(node: MarkdownNode) {
      if (node.type === 'definition' && /^ebook-[a-f0-9-]{36}-[a-f0-9]{16}$/.test(node.identifier ?? '')) {
        node.type = 'paragraph';
        node.data = { hName: 'span', hProperties: { id: node.identifier! } };
        node.children = [];
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}

export function ebookLinkTarget(href: string): { chapterId: string; anchor: string } | null {
  const match = /^#(ebook-([a-f0-9-]{36})-[a-f0-9]{16})$/.exec(href);
  return match ? { chapterId: match[2]!, anchor: `user-content-${match[1]}` } : null;
}
