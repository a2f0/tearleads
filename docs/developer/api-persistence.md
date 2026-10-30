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

Each dialect has one generated `0000_greenfield_baseline` migration
([`packages/api-shared/drizzle/`](../../packages/api-shared/drizzle/) for
Postgres, `drizzle-sqlite/` for SQLite and Turso) with all current schema
definitions. The deployment's `migrate` command initializes an empty database
from that baseline and records it in Drizzle's journal; repeating it on a
current database is idempotent. There are no incremental schema upgrades, data
backfills, or content scans.

Production and staging use PlanetScale PostgreSQL and independent Cloudflare R2
buckets for encrypted blobs. Runtime database roles and schema initialization
credentials are separate.

Schema changes update the Drizzle definitions and regenerate both baselines.
They require fresh server and client databases. Local database startup checks
the current table shape and refuses an obsolete one with a "reset the local
database" error, and backup imports require format version 13. Request
validation and signed-history verification enforce the active protocol
throughout normal operation.

### Signed-shape invariants

Signed-shape changes are flag days: stored rows in another shape are refused
outright (`assertExactKeys`), never migrated or dual-read, so deploying one
onto an existing database requires resetting every server and client database.
The stored shapes enforce:

- Principal wrapping-key epochs and principal-state versions are positive safe
  integers in signed states, references, wire validation, SDK records, and
  persistence. PostgreSQL stores them, including the manifest principal-head
  projections, as range-constrained `bigint`. Genesis starts at epoch 1 and
  each rotation advances exactly one epoch.
- Durable `principal_policy_commits` receipts bind exact compound policy
  requests to their original results.
- Signed artifacts (events, manifests, principal states) carry a canonical
  millisecond ISO-8601 `signedAt`; any other encoding fails verification.
- Content write headers carry `dependencyManifestHashes`; a header without that
  citation is refused on read and never re-served.
- Container manifests carry `systemSlot`.
- Container path references resolve against live `containers` rows; a path
  through a missing container fails with 409 `container_unavailable`.
- Document and blob content-key wraps authenticate the suite, object id,
  content-key epoch, and target as AES-GCM associated data.
- Signed write headers are the write-integrity mechanism (see
  [document write integrity](../document-rekey-and-audit-history.md#write-integrity));
  there is no server-side audit hash chain. `document_baselines` keeps only the
  baseline metadata its readers consume, and
  `access_events.dependency_manifest_hashes` is the only copy of an event's
  dependency citations.
- The client SDK's outbound write queue lives in `document_history_updates`
  (`update_id` plus the queue columns). A local database without `update_id`
  is refused at startup with the obsolete-schema error, and edits it had not
  synced are discarded with the reset.
- Login challenges are signed for the API origin
  (`tearleads.auth.challenge.v2`), and production requires `API_PUBLIC_ORIGIN`,
  so clients and the API release together.

Organization purge (`status = "purged"`) is terminal and not a reset: the
organization row survives, but every container, document, and blob mutation in
that organization is refused with `402 billing_inactive`, and a replacement
organization is provisioned under a fresh organization id. Purged ids are
therefore never recreated under the same `(kind, organization, id)` key, so
client checkpoints keyed that way cannot observe a false rollback.

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
retains the stage key; GC aborts uploads and deletes objects using that stored
key. Expiry cleanup deletes the key even after aborting a pending stage's
upload, since a bind may have assembled the object before marking the stage
complete. The optional S3 key prefix wraps it as
`<prefix>/organizations/<organizationId>/blob-stages/<stageId>`. The API and GC
must use the same bucket and prefix configuration.

Uploads use the multipart staging and attachment plane. Stage initiation
describes the parts the client sends first (byte length and base64 Content-MD5
of up to four, its upload concurrency), and the response returns each one's
upload source, so those parts need no authorization request. Immediately
before sending any other part, or renewing one whose URL failed, the client
calls authenticated
`POST /blobs/stages/multipart/{stageId}/parts/{partNumber}/upload` with its
upload ID, byte length, and base64 Content-MD5. The API checks the stage owner,
expiry, completion state, upload ID, and bounded part metadata, then signs only
the stored object key and requested part. The client sends a binary `File`
directly to S3/R2 with Content-MD5; the signature binds its length and checksum.
Parts are capped at 32 MiB. Part numbers are also bounded by the staged size
and S3/R2's 5 MiB nonfinal-part minimum, so small stages cannot authorize
thousands of stored parts. File bodies preserve binary data through the
Capacitor HTTP bridge. Storage requests carry no API authorization; browser
requests also omit cookies and referrers and reject redirects, and
physical-device enforcement of these fetch options is unverified.

Each part URL lasts at most 300 seconds, capped by the stage's remaining
lifetime. A file can take longer than five minutes: later chunks receive new
URLs just before sending, while the stage ID, upload ID, and earlier part ETags
stay the same. Refreshing a URL does not restart or invalidate earlier chunks.
A rejected or failed request can reauthorize and retry the same immutable part
once, with a short backoff for storage throttling or server errors.
Interrupted uploads retain resumable stage state and reconcile actual
stored parts through `ListParts`. URLs are never persisted as resume state.
The one-hour stage lifetime is separate: URLs do not extend it, and an expired
stage cannot be completed. An accepted request is not aborted by a client-side
five-minute timer.

Attachment binding completes the stage: before its transaction it assembles
parts 1..k of the stage's upload (the run covering exactly the declared length,
so a stray higher part is left out) and reads the assembled object once. That
one read, the store's completion readback, verifies the complete length and
SHA-256 and also parses the envelope header, which is judged only after the
digest matches. A bind retried after an earlier bind completed the stage reads
the object once itself. The first parts' upload sources are issued before the
stage row is written, so a signing failure aborts the fresh upload instead of
leaving a stage for expiry cleanup.
There is no separate completion request. Content-MD5 is a transport checksum,
not a replacement for that integrity check. Direct uploads remove the part
payloads from the Worker but retain this final verification read. A completed
or aborted multipart upload consumes its upload ID, so old part URLs cannot
replace a committed blob. Storage failures are reported separately from API
connectivity.

Memory/custom stores without signing support use an explicit API-byte
capability: initiation answers each first part with an `api` source, and the
client sends every part to the API byte route without authorizing it. A
signing store (S3/R2) answers that byte route with 409 before buffering its
body.

Downloads first call authenticated `GET /blobs/{blobId}/download`. The API
checks current read access and returns the encrypted length, SHA-256, and an
S3/R2 GET URL valid for 300 seconds. The client fetches those bytes directly
with the same storage fetch options, then verifies and decrypts them. Memory
storage returns an API-stream descriptor instead.

Expiry limits when a storage request can start; it does not abort an accepted
download after five minutes. A URL remains usable by anyone holding it until
expiry, even if application access is revoked during that window. Do not log
or persist signed URLs. Descriptor and object responses use
`Cache-Control: no-store`. The client refreshes a rejected URL once, including
browser network errors caused by R2's missing CORS headers on expired responses.
An interrupted body fails normally; retrying the download gets a new URL and
starts over. Automatic byte-range resumption is not implemented.
If direct storage requests still fail, the client falls back once to the
authenticated `GET /blobs/{blobId}/bytes` stream, which also serves native HTTP
bridges that cannot use the signed URL. The fallback checks current access
again and retains length, hash, and decryption checks. Storage failures alone
do not mark the API offline. Accepted streams are never silently restarted or
switched to the fallback after delivering bytes.

The S3 endpoint must be reachable from the client, not just the API. Private R2
blob buckets allow cross-origin GETs and PUTs from any origin to support web,
desktop, and mobile clients; valid signatures are still required. Deploy the
storage stack's CORS configuration before the API and clients that depend on
it. For other S3 providers, apply the equivalent GET/PUT rule in
[`scripts/localstack/blobTransferCors.json`](../../scripts/localstack/blobTransferCors.json).

LocalStack helper:

```sh
sh scripts/localstack/setupLocalS3.sh
set -a
. ./.secrets/staging/dev.env
set +a
bun run --filter=@tearleads/api dev
```

The helper configures blob transfer CORS and enables LocalStack signature
validation. LocalStack is a development emulator, not a test of production IAM
policy.

To clear objects from the configured LocalStack bucket:

```sh
sh scripts/localstack/reset.sh
```
