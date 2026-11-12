# @tearleads/api-shared

The API's persistence layer: the Drizzle schema, its generated migrations,
and the database adapters. Both the [API](../api/README.md) and
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

[`src/adapters`](src/adapters/) holds the PGlite (memory) and Postgres
adapters, request-scoped transactions, and the statement counters behind the
API's request-cost reporting. [API persistence](../../docs/developer/api-persistence.md)
describes each adapter, its environment variables, and the stored-shape
invariants.

## Schema changes

The schema evolves through append-only migrations in [`drizzle/`](drizzle/),
starting from `0000_greenfield_baseline`. Never edit, rename, or delete a
migration once it is on `main`: deployed databases have applied it, and
`migrate` refuses a journal that no longer matches what a database applied. A
correction is a new migration.

After editing [`src/schema`](src/schema/), generate the next migration and
commit it with the schema change:

```sh
cd packages/api-shared
bun run db:generate --name <change>
```

For a data backfill or SQL that drizzle-kit cannot infer, generate an empty
migration and write its SQL:

```sh
bun run db:generate --custom --name <backfill>
```

Write each migration so the previous Worker still works against it (see
[schema migrations](../../docs/developer/api-persistence.md#schema-migrations)).
If `main` gains a migration while your branch has one, delete yours (its SQL
file, snapshot, and journal entry), merge, and generate it again, so it sorts
last. `bun run lint:api-migrations` and the drift test in
[`src/migrationDrift.test.ts`](src/migrationDrift.test.ts) catch both mistakes.
Update the table-count pins in
[`src/schemaBootstrap.test.ts`](src/schemaBootstrap.test.ts) and
[`packages/api-cli/src/compiledMigrations.test.ts`][file-1] when tables are
added or removed. The [operations CLI](../api-cli/README.md#migrate) applies
pending migrations to a deployed tier.

[`scripts/dropOwnedObjects.ts`](scripts/dropOwnedObjects.ts) drops every object
the connected login owns. It
runs only during an authorized teardown of a whole tier.

## Tests

```sh
bun run --cwd packages/api-shared test
```

[file-1]: ../api-cli/src/compiledMigrations.test.ts
