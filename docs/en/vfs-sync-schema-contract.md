# VFS Sync Schema Contract (Flattening Draft)

This document captures the sync-critical table dependencies that are currently
required by the VFS sync protocol. The goal is to make schema flattening
explicit and testable while avoiding accidental coupling to transitional tables.

## Scope

Included runtime paths:

- Sync feed query (`packages/sync/src/vfs/sync-engine.ts`)
- CRDT feed query (`packages/sync/src/vfs/sync-crdt-feed.ts`)
- CRDT push API route (`packages/api/src/routes/vfs/post-crdt-push.ts`)
- CRDT reconcile API route (`packages/api/src/routes/vfs/post-crdt-reconcile.ts`)
- CRDT sync API route (`packages/api/src/routes/vfs/get-crdt-sync.ts`)

The authoritative dependency inventory and SQL reference extraction utilities
are defined in:

- `packages/sync/src/vfs/sync-schema-contract.ts`
- `packages/sync/src/vfs/sync-schema-contract.test.ts`
- `extractPostgresTableNamesFromDrizzleSchema(...)`
- `deriveVfsFlatteningInventory(...)`

## Flattened Target Tables

The current flattened target contract is:

1. `user_groups`
2. `user_organizations`
3. `vfs_acl_entries`
4. `vfs_crdt_ops`
5. `vfs_links`
6. `vfs_registry`
7. `vfs_sync_changes`
8. `vfs_sync_client_state`

Any SQL references outside this set are treated as out-of-contract and should
fail the schema-contract guardrail tests.

In addition, sync-critical SQL is asserted to avoid explicit references to
transitional candidates via `findTransitionalTableReferences(...)`.

## Transitional VFS Table Candidates

From the generated Postgres schema (`packages/db/src/generated/postgresql/schema.ts`),
the flattening inventory currently reports these candidate VFS tables as outside
the sync-critical contract:

1. `vfs_shares`

`vfs_access` is retired from canonical runtime schema as of `v027`, but remains
on the SQL guardrail block-list to fail closed if legacy references are
reintroduced.

`vfs_shares`/`org_shares` ACL parity scaffolding is staged in `v028`/`v029`,
and `v030` backfills folder metadata into canonical `vfs_registry` columns.
Read paths now prefer `vfs_registry` folder metadata and fail over to
`vfs_folders`; write paths remain transitional until dual-write retirement work
is complete.
`v031` adds non-destructive pre-drop guardrails to verify canonical/legacy
folder parity before any future `vfs_folders` drop.
`v032` records explicit retirement checkpoint snapshots after parity checks to
support rollback-aware drop planning.
`v033` drops `vfs_folders` in API/Postgres migrations after guardrails pass.
`v034` finalizes retirement by removing checkpoint scaffolding and requiring
`vfs_folders` to remain absent on Postgres.
Local-client compatibility paths still retain `vfs_folders` in SQLite while
staged client cutover completes.

## Domain Mapping

1. `syncFeed`
   - `user_groups`, `user_organizations`: principal expansion
   - `vfs_acl_entries`: visibility/access ranking
   - `vfs_sync_changes`: incremental feed source
   - `vfs_links`: subtree scope filtering
   - `vfs_registry`: object metadata hydration
2. `crdtFeed`
   - `user_groups`, `user_organizations`: principal expansion
   - `vfs_acl_entries`: visibility filtering
   - `vfs_crdt_ops`: CRDT feed + replica clocks
   - `vfs_links`: subtree scope filtering
3. `crdtPush`
   - `vfs_registry`: ownership checks
   - `vfs_crdt_ops`: idempotent source checks + canonical inserts
4. `crdtReconcile`
   - `vfs_sync_client_state`: monotonic client cursor/write-id state

## Guardrail Strategy

`sync-schema-contract.test.ts` enforces two levels:

1. Query-builder contract checks (sync + CRDT feed SQL text)
2. API route source checks (push/pull/reconcile SQL references)

If a new query references a table outside the target set, tests fail until the
schema contract is intentionally updated.

For staged rollout and rollback procedures across `v024`/`v025`/`v026`, see
`docs/en/vfs-sync-migration-runbook.md`.
