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
