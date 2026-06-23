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

const ROOT_FEED_TITLE = 'TS Novel Spider 书库';
const ROOT_FEED_SUBTITLE = '本地书库 OPDS 目录';
const ROOT_FEED_AUTHOR = 'TS Novel Spider';
const ROOT_FEED_ICON_PATH = '/favicon.svg';
const OPDS_V1_ROOT_PATH = '/opds/v1.opds';
const ATOM_NAVIGATION_TYPE = 'application/atom+xml;profile=opds-catalog';
const ATOM_ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const EPUB_MEDIA_TYPE = 'application/epub+zip';
const OPDS2_MEDIA_TYPE = 'application/opds+json';

export class OpdsFeedService {
  /** OPDS 1.2 根目录 feed（Atom XML） */
  buildAtomRootFeed(novels: OpdsNovelFeedEntry[], baseUrl?: string): string {
    const updated = this.computeFeedUpdated(novels);
    const entries = novels.map((novel) => this.buildAtomRootEntry(novel, baseUrl)).join('\n');
    const rootFeedUrl = this.buildOpdsV1RootUrl(baseUrl);
    const rootFeedId = rootFeedUrl ?? 'urn:opds:root';
    const rootAuthorUrl = this.buildRootAuthorUrl(baseUrl);
    const rootIconUrl = this.buildIconUrl(baseUrl) ?? ROOT_FEED_ICON_PATH;

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dcterms="http://purl.org/dc/terms/">
  <id>${this.escapeXml(rootFeedId)}</id>
  <title>${this.escapeXml(ROOT_FEED_TITLE)}</title>
  <subtitle>${this.escapeXml(ROOT_FEED_SUBTITLE)}</subtitle>
  <author>
    <name>${this.escapeXml(ROOT_FEED_AUTHOR)}</name>
    ${rootAuthorUrl ? `<uri>${this.escapeXml(rootAuthorUrl)}</uri>` : ''}
  </author>
  <icon>${this.escapeXml(rootIconUrl)}</icon>
  <updated>${this.escapeXml(updated)}</updated>
  <link rel="alternate" type="text/html" title="Web Page" href="/library"/>
  <link rel="self" href="${this.escapeXml(OPDS_V1_ROOT_PATH)}" type="${ATOM_NAVIGATION_TYPE}" title="This Page"/>
  <link rel="start" href="${this.escapeXml(OPDS_V1_ROOT_PATH)}" type="${ATOM_NAVIGATION_TYPE}" title="Start Page"/>
${entries}
</feed>`;
  }

  /** OPDS 1.2 单书 feed（Atom XML） */
  buildAtomNovelFeed(novel: OpdsNovelFeedEntry, availability: OpdsArtifactAvailability, baseUrl?: string): string {
    const updated = novel.epubCompiledAt ?? novel.contentUpdatedAt ?? new Date().toISOString();
    const versions = this.collectAvailableVersions(availability);
    const entries = versions.map((version) => this.buildAtomVersionEntry(novel, version)).join('\n');
    const novelFeedUrl = this.buildOpdsV1NovelUrl(novel.sourceId, novel.novelId, baseUrl);
    const novelFeedId = novelFeedUrl ?? `urn:opds:novel:${novel.sourceId}:${novel.novelId}`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${this.escapeXml(novelFeedId)}</id>
  <title>${this.escapeXml(novel.title)}</title>
  <updated>${this.escapeXml(updated)}</updated>
  <link rel="self" href="${this.escapeXml(this.buildOpdsV1NovelPath(novel.sourceId, novel.novelId))}" type="${ATOM_ACQUISITION_TYPE}"/>
  <link rel="start" href="${this.escapeXml(OPDS_V1_ROOT_PATH)}" type="${ATOM_NAVIGATION_TYPE}"/>
  <link rel="up" href="${this.escapeXml(OPDS_V1_ROOT_PATH)}" type="${ATOM_NAVIGATION_TYPE}"/>
${entries}
</feed>`;
  }

  /** OPDS 2.0 根目录 feed（JSON-LD） */
  buildOpds2RootFeed(
    novels: OpdsNovelFeedEntry[],
    availabilityByNovel?: ReadonlyMap<string, OpdsArtifactAvailability>,
  ): string {
    const updated = this.computeFeedUpdated(novels);
    const publications = novels.map((novel) => this.buildOpds2PublicationSummary(
      novel,
      availabilityByNovel?.get(this.buildNovelKey(novel.sourceId, novel.novelId)),
    ));

    return JSON.stringify({
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata: {
        title: ROOT_FEED_TITLE,
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

  private buildAtomRootEntry(novel: OpdsNovelFeedEntry, baseUrl?: string): string {
    const updated = novel.contentUpdatedAt ?? new Date().toISOString();
    return `  <entry>
    <id>urn:opds:novel:${this.escapeXml(novel.sourceId)}:${this.escapeXml(novel.novelId)}</id>
    <title>${this.escapeXml(novel.title)}</title>
    <author><name>${this.escapeXml(novel.author)}</name></author>
    <content type="text">${this.escapeXml(novel.description)}</content>
    <updated>${this.escapeXml(updated)}</updated>
    <link rel="subsection" href="${this.escapeXml(this.buildOpdsV1NovelPath(novel.sourceId, novel.novelId))}" type="${ATOM_NAVIGATION_TYPE}"/>
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

  private buildOpds2PublicationSummary(
    novel: OpdsNovelFeedEntry,
    availability?: OpdsArtifactAvailability,
  ): Record<string, unknown> {
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

    const links: Array<Record<string, unknown>> = [
      {
        rel: 'self',
        href: `/opds/v2/${novel.sourceId}/${novel.novelId}`,
        type: OPDS2_MEDIA_TYPE,
      },
    ];

    if (availability) {
      const acquisitionLinks = this.collectAvailableVersions(availability).map((version) => ({
        rel: 'http://opds-spec.org/acquisition',
        href: `/opds/artifacts/${novel.sourceId}/${novel.novelId}/${version}.epub`,
        type: EPUB_MEDIA_TYPE,
        title: OPDS_VERSION_LABELS[version],
      }));
      links.push(...acquisitionLinks);
    }

    return {
      metadata,
      links,
    };
  }

  private collectAvailableVersions(availability: OpdsArtifactAvailability): Array<keyof OpdsArtifactAvailability> {
    const versions: Array<keyof OpdsArtifactAvailability> = [];
    if (availability.original) versions.push('original');
    if (availability.translated) versions.push('translated');
    if (availability.bilingual) versions.push('bilingual');
    return versions;
  }

  private buildOpdsV1NovelPath(sourceId: string, novelId: string): string {
    return `/opds/v1/${sourceId}/${novelId}.opds`;
  }

  private buildNovelKey(sourceId: string, novelId: string): string {
    return `${sourceId}:${novelId}`;
  }

  private buildOpdsV1RootUrl(baseUrl?: string): string | null {
    return this.buildAbsoluteUrl(OPDS_V1_ROOT_PATH, baseUrl);
  }

  private buildOpdsV1NovelUrl(sourceId: string, novelId: string, baseUrl?: string): string | null {
    return this.buildAbsoluteUrl(this.buildOpdsV1NovelPath(sourceId, novelId), baseUrl);
  }

  private buildRootAuthorUrl(baseUrl?: string): string | null {
    if (!baseUrl) {
      return null;
    }

    try {
      return new URL('/', baseUrl).toString();
    } catch {
      return null;
    }
  }

  private buildIconUrl(baseUrl?: string): string | null {
    return this.buildAbsoluteUrl(ROOT_FEED_ICON_PATH, baseUrl);
  }

  private buildAbsoluteUrl(path: string, baseUrl?: string): string | null {
    if (!baseUrl) {
      return null;
    }

    try {
      return new URL(path, baseUrl).toString();
    } catch {
      return null;
    }
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
