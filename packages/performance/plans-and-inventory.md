# PostgreSQL query plans and static inventory

Companion reference to [`packages/performance/README.md`](README.md) for the
`perf:plans` and `perf:inventory` commands.

## PostgreSQL query plans

```sh
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_plans_probe" \
  bun run perf:plans --capture .test_files/performance/<capture>.jsonl \
    [--limit 20] [--disable-seqscan]
```

Migrates the local scratch PostgreSQL database named by `DATABASE_URL` (must be
a loopback host without TLS), reads the top normalized `SELECT` queries from a
saved `perf:statements` or `perf:canaries --statements` JSONL capture, and runs
`EXPLAIN (GENERIC_PLAN, FORMAT JSON)` on each inside a rolled-back `BEGIN READ
ONLY` transaction.

- Pass `--limit <n>` (default 20, max 200) to bound how many distinct queries
  are explained.
- Pass `--disable-seqscan` to execute `SET LOCAL enable_seqscan = off` before
  explaining, testing whether an existing index can serve the query even on an
  empty scratch table.
- Flags `Seq Scan`, `Sort`, and `Materialize` plan nodes and saves JSON and
  Markdown reports under `.test_files/performance/plans-<run>.*`.

## Static inventory

```sh
bun run perf:inventory \
  [--canaries .test_files/performance/<canaries>.json] [--json]
```

Statically censuses the repository without booting a database:

- **API Postgres schema (`packages/api-shared/drizzle/*.sql`):** replays all
  SQL migrations in lexical order alongside Drizzle schema mappings
  (`packages/api-shared/src/schema`, `packages/loro/src/server`) to count
  tables, columns, and indexes, detect left-prefix duplicate indexes, and list
  unreferenced tables and columns in API production source.
- **Client SQLite schema:** parses `sqliteTable(` definitions across
  `packages/client-sdk/src/data/sqlite/schema` and
  `packages/app/src/document-projectors`, running the same left-prefix
  duplicate index and unreferenced table/column checks against SDK, app, and
  CLI production source.
- **OpenAPI surface (`docs/openapi.json`):** counts paths and operations by
  HTTP method, resolves 2xx JSON response schemas (`$ref`, `allOf`/`oneOf`/
  `anyOf`, array items), and flags response fields unreferenced in client, app,
  and CLI production source.
- **Canary budget ceilings:** inventories `expectProxiedApiRequestBudget`
  assertions in `packages/app/src` and, when `--canaries` is supplied, reports
  measured-vs-ceiling headroom drift from that saved report.

Reports are saved under `.test_files/performance/inventory-<run>.json` and
`.md`.
