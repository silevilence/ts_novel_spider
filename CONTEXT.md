# Knowledge Graph Context

## Glossary

**GraphRAG Summary Asset** — A durable, queryable high-level representation of part of a novel's knowledge graph that always identifies the chapters, entities, and relations from which it was formed.

**Chapter Cluster Summary** — A GraphRAG Summary Asset describing a consecutive span of chapters. It is the preferred high-level entry point for narrative progression.

**Subgraph Summary** — A GraphRAG Summary Asset centered on one entity and its direct relationships. It is the preferred entry point for focused character, place, organization, or concept questions.

**Community Summary** — A GraphRAG Summary Asset describing a connected set of mutually related entities. It is the preferred entry point for whole-novel questions about themes, factions, or relationship arcs.

**Evidence** — A chapter-level passage or relation record that substantiates a retrieved claim. Every answer context must be able to descend from a summary asset to evidence.

**Local Retrieval** — Retrieval for a focused question. It prioritizes the active chapter, nearby evidence, and an entity-centered subgraph.

**Global Retrieval** — Retrieval for a whole-novel question. It prioritizes community and chapter-cluster summaries before descending to evidence.

**Entity Linking** — Matching the user's wording to known entities, including their aliases, before graph traversal.

**Graph Path** — A scored sequence of one or more relations connecting linked entities. A path is limited to the hops appropriate to the retrieval mode and remains traceable to its evidence.

## Novel Types

**Crawled Novel** (抓取小说) — A novel whose metadata, chapter index, and content are obtained from a source site through a `SpiderAdapter`. It is identified by the source site plus the site's own novel id, may participate in automatic scheduling updates, and is never edited manually.

**Manual Novel** (手动小说) — A novel created and maintained entirely by the user inside the library: metadata is entered by hand, and chapter content is authored in Markdown. It is never shown in the crawl workbench, never participates in automatic scheduling updates, and always has a fresh identifier that cannot collide with crawled novels.

**Volume** (卷) — The upper level of the two-level chapter hierarchy. A crawled novel's volumes come from the site's structure; a manual novel's volumes are created by the user.

**Chapter** (章) — The lower level of the two-level chapter hierarchy and the atomic unit of content. Every chapter belongs to exactly one volume, or to an implicit root volume when no volume is named.

**Manual Asset** (手动素材) — A file uploaded by the user into a manual novel's chapter content (currently images only). Assets are stored per novel under `data/manual-assets/{novelId}/` and are referenced from Markdown as `manual://{assetId}`. They are uploaded atomically when the chapter is saved and are purged together with the novel's directory on permanent deletion.

**Library Trash** (书库回收站) — A soft-delete state for novels, independent of the refined-translation trash. A novel in the trash exits automatic scheduling and OPDS distribution, stays viewable but not editable, and is permanently deleted 15 days after entering the trash (with confirmation), wiping all associated data.

**Stale Translation** (待重译) — A translation-unit-level dirty mark applied when a novel's metadata or a chapter's content changes. Stale units are not translated automatically; they join the translation targets the next time the user triggers "continue translation", alongside newly added chapters. Unchanged translated units are left untouched.

**Chapter Refetch** (章节更新) — Re-fetching a single crawled chapter's content from its source. The remote is authoritative: on change, content and title are replaced, a new version is recorded, and the chapter is marked stale for translation; on no change, nothing is written. A failed fetch keeps the existing content. Manual novels do not have refetch, only version history.

**Markdown Content** (Markdown 正文) — The chapter body format shared by all novels. Crawled chapters store plain text, which is a legal Markdown subset; manual chapters are authored in Markdown. Rendering and export treat every chapter body as Markdown (GFM tables included); processing layers (translation segmentation, RAG retrieval, graph extraction) keep working on the text while translation segmentation treats an entire table as one unit. Assets uploaded into manual chapters are referenced as `manual://{assetId}` and are recognized by image extraction.

**Metadata Sync** (元数据同步) — Re-fetching a crawled novel's metadata from its source and presenting the old-versus-new differences in a modal. Each changed field (title, author, description, tags) is chosen individually: keep-old or take-new, with tags also supporting a merge mode with per-tag selection. Unchanged fields are shown as unchanged. Applying writes the chosen fields immediately, records version history for fields actually adopted, and marks the affected translation units stale.

**Draft** (草稿) — The unsaved state of an editable field or chapter body while the user is editing. A draft becomes a version only through a successful save whose content differs from the last saved version. Leaving with unsaved changes discards the draft; a save that fails keeps the draft intact for retry.

**Version** (版本) — A saved snapshot of a novel's metadata or of a single chapter's content. Version numbering starts at 0 (the initial content, shown without any change count); each subsequent successful save that differs from the current version produces the next version. Versions are immutable snapshots, not diffs, and support viewing and restoring.

**Manual Chapter Management** (章节管理) — For manual novels, the ability to create, rename, delete, reorder, and move chapters and volumes from the chapter directory. Chapters may live outside any volume (an "unfiled" group). Reordering or moving recomputes the global chapter index. Deleting a volume deletes its chapters with strong confirmation.
