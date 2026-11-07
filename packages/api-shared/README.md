# @tearleads/api-shared

The API's persistence layer: the Drizzle schema, the generated baseline
migrations, and the database adapters. Both the [API](../api/README.md) and
the [operations CLI](../api-cli/README.md) build on it, and those two packages
never import each other. It stays below them and depends only on
`@tearleads/crypto`, `@tearleads/loro`, and database drivers.

## Entry points

| Entry point | Use for |
| --- | --- |
| `@tearleads/api-shared` | Database types and lifecycle (`db`, `initializeApiDatabase`, `closeApiDatabase`) |
| `@tearleads/api-shared/postgres` | The database adapter, selected by `API_DATABASE` |
| `@tearleads/api-shared/postgres-transport` | The Workers Postgres transport, without initializing a database |
| `@tearleads/api-shared/schema` | Drizzle table definitions |

[`src/adapters`](src/adapters/) holds the PGlite (memory), Postgres, SQLite, and
Turso
adapters, request-scoped transactions, and the statement counters behind the
API's request-cost reporting. [API persistence](../../docs/developer/api-persistence.md)
describes each adapter, its environment variables, and the stored-shape
invariants.

## Schema changes

Each dialect has one generated `0000_greenfield_baseline` migration:
[`drizzle/`](drizzle/)
for Postgres and [`drizzle-sqlite/`](drizzle-sqlite/) for SQLite and Turso.
There are no
incremental upgrades. After editing [`src/schema`](src/schema/), replace both
baselines
rather than generating a second migration beside them: remove each migration
directory, metadata included, and generate it again under the baseline name.
Update the table-count pins in
[`src/schemaBootstrap.test.ts`](src/schemaBootstrap.test.ts) and
[`packages/api-cli/src/compiledMigrations.test.ts`][file-1] when tables are
added or
removed.

```sh
cd packages/api-shared
rm -rf drizzle drizzle-sqlite
bun run db:generate --name greenfield_baseline
bun run db:generate:sqlite --name greenfield_baseline
```

A schema change requires fresh server and client databases. The
[operations CLI](../api-cli/README.md#migrate) applies the baseline to a
deployed tier.

[`scripts/dropOwnedObjects.ts`](scripts/dropOwnedObjects.ts) drops every object
the connected login owns. It
runs only during an authorized teardown of a whole tier.

## Tests

```sh
bun run --cwd packages/api-shared test
```

[file-1]: ../api-cli/src/compiledMigrations.test.ts
