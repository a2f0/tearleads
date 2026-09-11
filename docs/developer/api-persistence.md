# API Persistence

The API defaults to in-memory persistence for local development and tests.

## Database

Use `API_DATABASE` to select the database adapter:

- `memory` or unset outside production: in-memory PGlite with the API Drizzle
  migrations applied at startup.
- `postgres`: node-postgres with the API Postgres Drizzle migrations applied by
  the deployment migration command.
- `sqlite`: Bun's native SQLite driver with the API SQLite Drizzle migrations
  applied by the deployment migration command.
- `turso`: remote-only libSQL with the API SQLite Drizzle migrations applied by
  the deployment migration command.

Each dialect contains one generated `0000_greenfield_baseline` with all current
schema definitions. The deployment's `migrate` command initializes an empty
database from that baseline and records its application in Drizzle's journal.
Repeating initialization on the same current database is idempotent. There are
no historical schema upgrades, data backfills, or rollout content scans.

Production uses PlanetScale PostgreSQL; staging uses PostgreSQL on its server.
Both use independent AWS S3 buckets for encrypted blobs. Runtime database roles
and schema initialization credentials are separate in production.

Schema changes update the Drizzle definitions and regenerate both baseline
bundles. They require fresh server and client databases. Local database startup
checks the current table shape, and backup imports require format version 8.
Request validation and signed-history verification enforce the active protocol
throughout normal operation.

### Connection settings

When `NODE_ENV=production`, `API_DATABASE` must be set explicitly.

Postgres accepts either a connection URL:

```sh
API_DATABASE=postgres DATABASE_URL=postgres://user:password@localhost:5432/tearleads bun run --filter=@tearleads/api dev
```

or discrete env vars:

```sh
API_DATABASE=postgres \
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_USER=tearleads \
POSTGRES_PASSWORD=secret \
POSTGRES_DATABASE=tearleads \
bun run --filter=@tearleads/api dev
```

In development, `API_DATABASE=postgres` also supports local defaults when no
Postgres connection env vars are set:

- Linux: `/var/run/postgresql`, port `5432`, current OS user, database `tearleads_development`
- macOS: `localhost`, port `5432`, current OS user, database `tearleads_development`

Dev helpers:

```sh
sh scripts/postgres/setupPostgresDev.sh
sh scripts/postgres/runPostgresMigration.sh
API_DATABASE=postgres bun run --filter=@tearleads/api dev
```

To reset only the local dev database:

```sh
sh scripts/postgres/reset.sh
```

The reset script only drops `tearleads_development`.

SQLite uses an in-memory database by default outside production. Set
`API_SQLITE_PATH` or `SQLITE_PATH` to persist it to a file; one of them is
required in production. Development startup applies SQLite migrations in the
same process, so the in-memory default is initialized before the API serves:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=.data/api.sqlite bun run --filter=@tearleads/api dev
```

Migrate the persistent database before starting the API:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=.data/api.sqlite bun run --filter=@tearleads/api db:migrate
```

Turso requires a remote `libsql://` URL, auth token, and the UUID of the
database's primary instance. Retrieve the instance list from Turso's Platform
API and use the UUID of the entry whose `type` is `primary`. The adapter builds
Turso's primary-instance hostname from that UUID; generic libSQL endpoints,
local file URLs, and embedded replicas are rejected intentionally:

```sh
API_DATABASE=turso \
TURSO_DATABASE_URL=libsql://database-name.turso.io \
TURSO_AUTH_TOKEN=secret \
TURSO_PRIMARY_INSTANCE_ID=0be90471-6906-11ee-8553-eaa7715aeaf2 \
bun run --filter=@tearleads/api db:migrate
```

Start the API with the same variables after migration. Turso transactions are
opened explicitly in write mode. The adapter rejects TLS opt-out URLs and
enables and verifies SQLite foreign-key enforcement on every remote statement
session before application SQL runs. Because this configuration always reads
the remote primary, the API bypasses replica-watermark waiting and emits the
`0/0` LSN sentinel with `commitLsnMode: "untracked"`. Clients use that explicit
mode to replace a checkpoint from a previous backend without
weakening tracked-LSN validation when they later return to Postgres or SQLite.

The opt-in integration lane runs the multi-connection sync races against a
dedicated remote test database. It does not accept the production variable
names, which reduces the chance of accidentally testing against production:

```sh
TURSO_TEST_DATABASE_URL=libsql://test-database.turso.io \
TURSO_TEST_AUTH_TOKEN=secret \
TURSO_TEST_PRIMARY_INSTANCE_ID=0be90471-6906-11ee-8553-eaa7715aeaf2 \
bun run test:turso-concurrency
```

The lane applies migrations, checks lossless 64-bit read-model cursors, runs the
multi-connection sync races, and retains randomized test rows. The target must
be disposable or dedicated to integration tests.

API package tests run against both in-memory PGlite and SQLite:

```sh
bun run --filter=@tearleads/api test
```

The test runner prints elapsed time for each adapter.

## Blob Object Store

Use `BLOB_OBJECT_STORE` to select blob storage:

- `memory` or unset outside production: in-memory object store.
- `s3`: S3-compatible object store.

When `NODE_ENV=production`, `BLOB_OBJECT_STORE` must be set explicitly.

S3 env vars:

- `BLOB_OBJECT_STORE_S3_BUCKET`
- `BLOB_OBJECT_STORE_S3_REGION`
- `BLOB_OBJECT_STORE_S3_ENDPOINT` for S3-compatible services such as LocalStack
- `BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE`
- `BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID`
- `BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY`
- `BLOB_OBJECT_STORE_S3_KEY_PREFIX`

Blob keys are `organizations/<organizationId>/blob-stages/<stageId>`. Promotion
retains the stage key; GC aborts uploads and deletes objects using that stored key.
The optional S3 key prefix wraps it as
`<prefix>/organizations/<organizationId>/blob-stages/<stageId>`. The API and GC
must use the same bucket and prefix configuration.

LocalStack helper:

```sh
sh scripts/localstack/setupLocalS3.sh
set -a
. ./.secrets/dev.env
set +a
bun run --filter=@tearleads/api dev
```

To clear objects from the configured LocalStack bucket:

```sh
sh scripts/localstack/reset.sh
```
