export interface OpdsNovelFeedEntry {
  sourceId: string;
  novelId: string;
  title: string;
  author: string;
  description: string;
  tags: string[];
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface OpdsArtifactAvailability {
  original: boolean;
  translated: boolean;
  bilingual: boolean;
}

const OPDS_VERSION_LABELS: Record<keyof OpdsArtifactAvailability, string> = {
  original: '原文',
  translated: '译文',
  bilingual: '双语对照',
};

const ATOM_ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const EPUB_MEDIA_TYPE = 'application/epub+zip';
const OPDS2_MEDIA_TYPE = 'application/opds+json';

export class OpdsFeedService {
  /** OPDS 1.2 根目录 feed（Atom XML） */
  buildAtomRootFeed(novels: OpdsNovelFeedEntry[]): string {
    const updated = this.computeFeedUpdated(novels);
    const entries = novels.map((novel) => this.buildAtomRootEntry(novel)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:opds:root</id>
  <title>TS Novel Spider 书库</title>
  <updated>${this.escapeXml(updated)}</updated>
  <link rel="self" href="/opds/v1" type="${ATOM_ACQUISITION_TYPE}"/>
  <link rel="start" href="/opds/v1" type="${ATOM_ACQUISITION_TYPE}"/>
${entries}
</feed>`;
  }

  /** OPDS 1.2 单书 feed（Atom XML） */
  buildAtomNovelFeed(novel: OpdsNovelFeedEntry, availability: OpdsArtifactAvailability): string {
    const updated = novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString();
    const versions = this.collectAvailableVersions(availability);
    const entries = versions.map((version) => this.buildAtomVersionEntry(novel, version)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}</id>
  <title>${this.escapeXml(novel.title)}</title>
  <updated>${this.escapeXml(updated)}</updated>
  <link rel="self" href="/opds/v1/${this.escapeXml(novel.sourceId)}/${this.escapeXml(novel.novelId)}" type="${ATOM_ACQUISITION_TYPE}"/>
  <link rel="up" href="/opds/v1" type="${ATOM_ACQUISITION_TYPE}"/>
${entries}
</feed>`;
  }

  /** OPDS 2.0 根目录 feed（JSON-LD） */
  buildOpds2RootFeed(novels: OpdsNovelFeedEntry[]): string {
    const updated = this.computeFeedUpdated(novels);
    const publications = novels.map((novel) => this.buildOpds2PublicationSummary(novel));

    return JSON.stringify({
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata: {
        title: 'TS Novel Spider 书库',
        updated,
      },
      links: [
        { rel: 'self', href: '/opds/v2', type: OPDS2_MEDIA_TYPE },
        { rel: 'start', href: '/opds/v2', type: OPDS2_MEDIA_TYPE },
      ],
      publications,
    }, null, 2);
  }

  /** OPDS 2.0 单书 publication（JSON-LD） */
  buildOpds2NovelPublication(novel: OpdsNovelFeedEntry, availability: OpdsArtifactAvailability): string {
    const versions = this.collectAvailableVersions(availability);
    const acquisitionLinks = versions.map((version) => ({
      rel: 'http://opds-spec.org/acquisition',
      href: `/opds/artifacts/${novel.sourceId}/${novel.novelId}/${version}.epub`,
      type: EPUB_MEDIA_TYPE,
      title: OPDS_VERSION_LABELS[version],
    }));

    const metadata: Record<string, unknown> = {
      title: novel.title,
      author: novel.author,
      description: novel.description,
      identifier: `urn:opds:novel:${novel.sourceId}:${novel.novelId}`,
      modified: novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString(),
    };

    if (novel.tags.length > 0) {
      metadata.tags = novel.tags;
    }

    return JSON.stringify({
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata,
      links: [
        { rel: 'self', href: `/opds/v2/${novel.sourceId}/${novel.novelId}`, type: OPDS2_MEDIA_TYPE },
        ...acquisitionLinks,
      ],
      images: [],
    }, null, 2);
  }

  private buildAtomRootEntry(novel: OpdsNovelFeedEntry): string {
    const updated = novel.contentUpdatedAt ?? new Date().toISOString();
    return `  <entry>
    <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}</id>
    <title>${this.escapeXml(novel.title)}</title>
    <author><name>${this.escapeXml(novel.author)}</name></author>
    <summary>${this.escapeXml(novel.description)}</summary>
    <updated>${this.escapeXml(updated)}</updated>
    <link rel="http://opds-spec.org/acquisition" href="/opds/v1/${this.escapeXml(novel.sourceId)}/${this.escapeXml(novel.novelId)}" type="${ATOM_ACQUISITION_TYPE}"/>
  </entry>`;
  }

  private buildAtomVersionEntry(novel: OpdsNovelFeedEntry, version: keyof OpdsArtifactAvailability): string {
    const versionLabel = OPDS_VERSION_LABELS[version];
    const updated = novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString();
    return `  <entry>
    <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}:${version}</id>
    <title>${this.escapeXml(novel.title)}（${this.escapeXml(versionLabel)}）</title>
    <updated>${this.escapeXml(updated)}</updated>
    <link rel="http://opds-spec.org/acquisition" href="/opds/artifacts/${this.escapeXml(novel.sourceId)}/${this.escapeXml(novel.novelId)}/${version}.epub" type="${EPUB_MEDIA_TYPE}"/>
  </entry>`;
  }

  private buildOpds2PublicationSummary(novel: OpdsNovelFeedEntry): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      title: novel.title,
      author: novel.author,
      description: novel.description,
      identifier: `urn:opds:novel:${novel.sourceId}:${novel.novelId}`,
      modified: novel.contentUpdatedAt ?? new Date().toISOString(),
    };

    if (novel.tags.length > 0) {
      metadata.tags = novel.tags;
    }

    return {
      metadata,
      links: [
        {
          rel: 'http://opds-spec.org/acquisition',
          href: `/opds/v2/${novel.sourceId}/${novel.novelId}`,
          type: OPDS2_MEDIA_TYPE,
        },
      ],
    };
  }

  private collectAvailableVersions(availability: OpdsArtifactAvailability): Array<keyof OpdsArtifactAvailability> {
    const versions: Array<keyof OpdsArtifactAvailability> = [];
    if (availability.original) versions.push('original');
    if (availability.translated) versions.push('translated');
    if (availability.bilingual) versions.push('bilingual');
    return versions;
  }

  private computeFeedUpdated(novels: OpdsNovelFeedEntry[]): string {
    const timestamps = novels
      .map((n) => n.contentUpdatedAt)
      .filter((t): t is string => t !== null)
      .sort()
      .reverse();
    return timestamps[0] ?? new Date().toISOString();
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
