# API Persistence

The API defaults to in-memory persistence for local development and tests.

## Database

Use `API_DATABASE` to select the database adapter:

- `memory` or unset outside production: in-memory PGlite with the API Drizzle migrations applied at startup.
- `postgres`: node-postgres with the API Drizzle migrations applied at startup.
- `sqlite`: Bun's native SQLite driver with the API SQLite Drizzle migrations applied at startup.

Each dialect keeps a single greenfield baseline migration. Pre-reset databases
are not upgraded; reset and provision a fresh database instead.

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

SQLite uses an in-memory database by default. Set `API_SQLITE_PATH` or
`SQLITE_PATH` to persist it to a file:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=.data/api.sqlite bun run --filter=@tearleads/api dev
```

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
