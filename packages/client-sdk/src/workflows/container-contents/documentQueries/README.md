# Container Document Query Internals

`index.ts` is the public workflow facade for querying container document
projections.

- `types.ts` owns shared DTOs and internal helper contracts used by the
  facade.
- `sql.ts` builds the SQLite fragments used by paged container and document
  windows, and `hydrationSql.ts` the hydration-visibility filters.
- `rows.ts` maps SQLite rows into query DTOs and sync-state summaries.
- `../pendingWrites/index.ts` composes the identity-wide pending-write
  diagnostic; the rest of `../pendingWrites/` owns its source queries, Loro
  coverage check, and grouping.
- `documentSubtreeQueries.ts` owns the container-subtree traversal and the
  batched summary/runtime-target queries built on it.
- `documentStructure.ts`, with its types in `documentStructureTypes.ts`, holds
  the document-link mutations (add, remove, move, activate) that the
  container-contents facade exports.
- `orphanedDocumentSql.ts` and `pendingDownloads.ts` hold the orphan and
  pending-download queries the facade composes.

Keep the public query interface, persistence adapters, and runtime facade
wiring in `index.ts`.
