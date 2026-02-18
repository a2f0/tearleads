# VFS Sync Schema Contract

This document captures the sync-critical table dependencies that are currently
required by the VFS sync protocol. The goal is to make canonical schema
dependencies explicit and testable.

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
- `extractSqliteTableNamesFromDrizzleSchema(...)`
- `deriveVfsFlatteningInventory(...)`

## Flattened Target Tables

The current flattened target contract is:

- `user_groups`
- `user_organizations`
- `vfs_acl_entries`
- `vfs_crdt_ops`
- `vfs_links`
- `vfs_registry`
- `vfs_sync_changes`
- `vfs_sync_client_state`

Any SQL references outside this set are treated as out-of-contract and should
fail the schema-contract guardrail tests.

From the generated Postgres schema
(`packages/db/src/generated/postgresql/schema.ts`), the inventory reports no
missing tables from the sync-critical contract.

The API migration plan is greenfield-first: a single canonical migration
(`v021`) creates sync/CRDT state in one pass for clean-state deployments.

Explorer folder metadata paths are canonical-only and resolve through
`vfs_registry`.

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
3. Legacy share-surface regression checks to prevent dependency reintroduction

If a new query references a table outside the target set, tests fail until the
schema contract is intentionally updated.

Legacy reverse-compat rollout runbooks were removed with the one-shot greenfield
migration strategy.
