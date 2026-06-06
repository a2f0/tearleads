# Container Document Query Internals

`../documentQueries.ts` is the public workflow facade for querying container
document projections.

- `types.ts` owns shared DTOs and internal helper contracts used by the
  facade.
- `sql.ts` builds the SQLite fragments used by paged container and document
  windows.
- `rows.ts` maps SQLite rows into query DTOs and sync-state summaries.

Keep the public query interface, persistence adapters, and runtime facade
wiring in `../documentQueries.ts`.
