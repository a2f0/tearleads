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

In addition, sync-critical SQL is asserted to avoid explicit references to
transitional candidates via `findTransitionalTableReferences(...)`.

## Transitional VFS Table Candidates

From the generated Postgres schema
(`packages/db/src/generated/postgresql/schema.ts`), the flattening inventory now
reports no transitional VFS runtime tables outside the sync-critical contract.

`vfs_access` is retired from canonical runtime schema as of `v027`, but remains
on the SQL guardrail block-list to fail closed if legacy references are
reintroduced.

`vfs_shares`/`org_shares` ACL parity scaffolding is staged in `v028`/`v029`,
and `v030` backfills folder metadata into canonical `vfs_registry` columns.
`v031` adds non-destructive pre-drop guardrails to verify canonical/legacy
folder parity before any future `vfs_folders` drop.
`v032` records explicit retirement checkpoint snapshots after parity checks to
support rollback-aware drop planning.
`v033` drops `vfs_folders` in API/Postgres migrations after guardrails pass.
`v034` finalizes retirement by removing checkpoint scaffolding and requiring
`vfs_folders` to remain absent on Postgres.
`v035` adds non-destructive share-retirement checkpoints with fail-closed ACL
parity + source-trace guardrails for `vfs_shares` and `org_shares`.
`v036` enforces share-retirement preconditions (checkpoint presence + parity
revalidation) before any future share-table drop candidate can run.
`v037` records explicit share drop-planning checkpoints after `v036` passes to
keep destructive sequencing auditable and rollback-aware.
`v038` records explicit dry-run drop candidates (without dropping tables) once
`v037` sequencing checkpoints are present and parity/source-trace guardrails are
still satisfied.
`v039` records pre-drop execution readiness checkpoints, including the required
read-surface deactivation marker and canonical ACL-first read-contract metadata
that future destructive share-table retirement must enforce.
`v040` records explicit drop-authorization checkpoints and marks
`is_drop_authorized = FALSE` unless
`read_surface_deactivation_confirmed = TRUE` and execution readiness is marked
ready.
`v041` records drop execution candidates (`DROP TABLE` statements) and marks
`is_executable = FALSE` when authorization guardrails are not yet satisfied.
`v042` executes destructive step-1 retirement for `vfs_shares` only when the
latest `vfs_share_retirement_drop_execution_candidates` step-1 row is
explicitly executable.
`v043` executes destructive step-2 retirement for `org_shares` only after
step-1 audit success and executable step-2 authorization/candidate refresh.
`v044` finalizes retirement by dropping transitional share-retirement
scaffolding tables once both destructive drop audits are durably recorded.
`v045` canonicalizes active legacy org-share ACL ids
(`org-share:<shareId>`) into source-attributed ids
(`org-share:<sourceOrgId>:<shareId>`) using fail-closed source inference.

Explorer folder metadata paths are canonical-only:

1. Folder reads resolve from `vfs_registry.encrypted_name` only.
2. Folder writes target `vfs_registry` only.
3. Runtime code must not read/write `vfs_folders`.

`vfs_folders` remains only as historical migration/test scaffolding and must not
be a runtime dependency.

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

For staged rollout and rollback procedures across `v024`/`v025`/`v026`, see
`docs/en/vfs-sync-migration-runbook.md`.

For the canonical-only reverse-compatibility cleanup plan, see
`docs/en/vfs-reverse-compat-cleanup-sweep.md`.
