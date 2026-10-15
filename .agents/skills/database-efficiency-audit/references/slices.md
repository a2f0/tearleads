# Audit Slices

Read only the selected slice section when preparing an auditor prompt. Keep
the other slices in the coverage queue described in [batching.md](batching.md).

API paths are under `packages/api/src` and client paths under
`packages/client-sdk/src` unless a full path is shown. API tables are defined
in `packages/api-shared/src/schema` and client tables in
`data/sqlite/*Schema.ts` and `data/sqlite/schema.ts`. Attach each slice's
live PlanetScale leads and baseline rows when dispatching it.

| Slice | Scope |
| --- | --- |
| `api-auth-and-registration` | `middleware/session.ts`, `middleware/userActivity.ts`, `workflows/signerPublicKey.ts`, `routes/auth`, `services/auth`, `workflows/auth`, `workflows/organizations/provision*` |
| `api-policy-reads` | `routes/principals`, `services/principals`, `workflows/principals`, `access/read/principal*` |
| `api-access-and-projections` | `access/`, `workflows/keyingReadAccess.ts`, `workflows/containers/writerProjection*`, `workflows/documents/writerProjection*`, `services/containers/writerProjection.ts`, `services/containers/kekLog.ts` |
| `api-write-transactions` | `services/documents`, `workflows/documents`, `workflows/containers/mutations`, `services/blobs`, `workflows/blobs` (not `gc`), `access/write`, principal policy commits in `workflows/principals` |
| `api-listings-and-sync-reads` | `services/containers` listing and paging, document sync pull and pagination in `services/documents`, `workflows/organizations/readModel*`, principal history pages, data usage |
| `api-background` | `workflows/blobs/gc`, `packages/api/scripts/blobGc.ts`, stage and session cleanup, retention and purge sweeps |
| `api-indexes` | every API index on both dialects, collating the other API slices |
| `client-sync-persistence` | `data/sync`, `data/documents`, `data/containers`, `data/blobs`, `workflows/container-contents`, `sync/`, the `local_intents` outbox |
| `client-principal-and-keying` | `data/principals`, `data/persistence`, `data/keyingProjectionVerification`, principal history stages, nodes, evidence, and retention |
| `client-indexes` | every client index and the schema ensure path, collating the other client slices |

## `api-auth-and-registration`

- Count the statements every authenticated request pays before its route
  runs: session validation, user and signer lookups, activity stamps. The
  `users` lookup by id for `fingerprint` and `signing_public_key` was the
  most frequent production pattern on 2026-10-15 and in the upload canary.
  Find every caller and whether one request repeats it.
- Registration is the largest single transaction (hundreds of statements;
  see `services/auth/registration.batching.test.ts`). Capture it, group its
  statements by table, and find per-row loops that a multi-row insert or a
  set-based read could replace without changing the order of locks.
- Login, refresh, and WebSocket ticket issue: statements per call.

## `api-policy-reads`

- Policy GET, history pages, and the principal state loaders: repeated
  reads of `principal_states`, `principal_state_payloads`,
  `principal_member_envelopes`, `principal_membership_projection`,
  `principal_epoch_keys`, and `principal_policy_*` within one request.
- Lookups by `(principal_type, principal_id)` issued once per principal
  where the request knows the set (organization plus its groups).
- Verification reads are preserved; a proposal may load a row once and
  pass it to every verifier, not skip a verifier.

## `api-access-and-projections`

- Manifest heads, manifests, verification markers, and the projection
  joins: repeated head lookups per object, per-ancestor recursive queries,
  and bundle loaders that read the same manifest rows twice.
- The recursive ancestor-path query: how often one request runs it, and
  whether one call could serve every object the request resolves.
- Writer projection and recite statement counts against their tests'
  ceilings.

## `api-write-transactions`

- Document create, sync push, link, unlink, purge; container create, move,
  rotate, delete; blob stage, part, and bind; principal policy commit.
  Capture each transaction's statements and transaction controls.
- Read-then-write pairs that one statement could do (`INSERT ... ON
  CONFLICT ... RETURNING`, `UPDATE ... RETURNING`), and per-row loops a
  multi-row statement could replace.
- Lock order: name each prelock (`prelockContainerMutationBatch` in
  `workflows/containers/mutations/shared/mutationRunner.ts`), `FOR UPDATE`
  read, and head row each transaction takes, and the concurrency test that
  pins it. A batching proposal must keep the order.
- Reads that run inside a transaction but do not need its snapshot or locks
  and could run before it, shortening lock hold time; prove the isolation
  argument.

## `api-listings-and-sync-reads`

- Container and document listings, the interest-set document query, sync
  pull pages, the organization read model, principal history pages, and
  data usage: statements per page and how they scale with page size.
- Per-row access checks inside a listing (`resolveReadableContainerAccessBatch`
  exists; find callers that still check one container at a time).
- `ORDER BY` and cursor predicates that no index serves on one dialect.

## `api-background`

- Blob GC, stage cleanup, session expiry, and retention sweeps: scans of
  growing tables, batch sizes, and per-row statements inside a sweep.
- Whether each sweep's predicate has an index on both dialects.

## `api-indexes`

- Inventory every API index on both dialects. For each: the queries that
  use it, uniqueness and constraint role, write paths that maintain it, and
  dialect parity.
- Evaluate every live PlanetScale recommendation (on 2026-10-15, 25
  `duplicate_index` left-prefix cases) under the rules in `planetscale.md`.
- Missing indexes: predicates and joins found by the other API slices
  with no usable leading index, proven by plan.
- Collate the other slices' index findings; propose a target index list
  with its count.

## `client-sync-persistence`

- Statements and worker round trips per SDK operation: applying a pulled
  page, recording pending writes, enqueuing and draining intents, discovery
  and tombstone bookkeeping, attachment and blob staging.
- Per-row statements a multi-row statement within the bind budget could
  replace; transaction controls per operation; schema ensures on hot paths.
- Reads repeated within one operation that the caller already holds.

## `client-principal-and-keying`

- Principal history stage, node, evidence, and retention persistence;
  keying checkpoints and projection verification caches: statements per
  recovery, per page, and per retention pass, and how they scale with
  history length.
- Retention passes that scan growing tables; existing plan tests in
  `data/persistence/*Retention*.test.ts` show the expected shape.

## `client-indexes`

- Inventory every client index. For each hot query from the client slices,
  run `EXPLAIN QUERY PLAN` and flag `SCAN` of a growing table and
  `USE TEMP B-TREE`.
- Indexes no production query uses, and indexes duplicated by a primary key
  or a wider index.
- The schema ensure path (`ensureSqlTables`, `assertRequiredColumns` in
  `data/sqlite/sqlTableSchema.ts`): statements per connection and whether
  any hot path repeats it.
- Collate the other client slices' findings; propose a target index list.
