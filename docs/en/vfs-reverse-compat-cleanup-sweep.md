# VFS Reverse-Compatibility Cleanup Sweep

## Goal

Run a canonical-only cleanup across VFS sync/sharing paths and remove reverse
compatibility branches that are no longer needed before production.

## Operating Assumption

- The system is not in production.
- Existing in-flight test data can be migrated forward.
- We prefer fail-closed behavior over compatibility fallback behavior.

## Sweep Scope

1. Share ACL identifier cleanup (`org-share:<sourceOrgId>:<shareId>` only)
1. Share-route query cleanup (no legacy share-id parsing/fallback reads)
1. Explorer/read-path cleanup (remove `vfs_folders` fallback behavior)
1. Write-path cleanup (remove dual-write compatibility scaffolding)
1. Client local schema cleanup (remove compatibility migration assumptions)
1. Contract/doc cleanup (retire outdated transitional wording/checks)
1. Explorer share-query cleanup (`vfs_acl_entries` canonical source only)
1. Runtime schema-generation cleanup (exclude retired VFS tables from runtime outputs)

## Canonical Invariants

1. Active org-share ACL ids must be canonical: `org-share:%:%`.
1. No route should parse or resolve legacy org-share ACL ids.
1. No runtime route should reference retired tables (`vfs_shares`,
   `org_shares`, `vfs_access`, `vfs_folders`, blob transitional tables).
1. Migration and contract tests must fail if compatibility branches are
   reintroduced.

## Execution Plan

### Slice A: API Share Routes

- [x] Cut share CRUD/listing/auth to canonical `vfs_acl_entries`.
- [x] Add `v045` migration to canonicalize active legacy org-share ACL ids.
- [x] Remove org-share legacy fallback from auth context resolution.
- [x] Remove remaining legacy org-share parsing assumptions in route tests.

### Slice B: Explorer/Folder Metadata

- [x] Remove `COALESCE(vfs_registry..., vfs_folders...)` fallback reads.
- [x] Remove folder metadata dual-write to `vfs_folders`.
- [x] Remove folder fallback integration tests and replace with canonical-only
      assertions.

### Slice C: Client/Local Compatibility

- [x] Remove shared test-seeding dual-write assumptions (`db-test-utils`
      `ensureVfsRoot`/`seedFolder` now write canonical `vfs_registry` only).
- [x] Remove outdated local migration compatibility wording in
      `packages/client/src/db/migrations/v019.ts`.
- [x] Remove client DB integration write/read assumptions tied to `vfs_folders`
      (`packages/client/src/db/vfs-folder.integration.test.ts` now uses
      canonical `vfs_registry` only).
- [x] Remove legacy-adapter/classic-test assumptions tied to `vfs_folders`
      (`packages/classic/src/lib/vfsClassicAdapter.integration.test.ts` now
      seeds canonical folder metadata via `vfs_registry` only).
- [x] Remove `vfs_folders` table creation from general-purpose SQLite test
      migration harnesses where runtime-path tests no longer need it
      (`vfs-test-migrations`, `classic-test-migrations`,
      `contacts-test-migrations`, `trashTestMigrations`).
- [x] Remove non-migration client runtime/test references to `vfsFolders`
      (`packages/client/src/db/schema/index.ts`,
      `packages/client/src/db/adapters/utils.test.ts`).
- [x] Remove legacy share-table schema exports from client runtime DB surface
      (`packages/client/src/db/schema/index.ts` no longer re-exports
      `vfsShares`/`orgShares`).
- [x] Collapse migration notes/guardrail wording that only existed to support
      fallback read-path framing.

### Slice D: Contract + Docs

- [x] Update schema contract doc to remove compatibility/fallback language.
- [x] Update migration runbook to remove post-finalization checks for dropped
      scaffolding snapshots as live requirements.
- [x] Add explicit canonical-only guardrail tests for share/explorer SQL
      surfaces.
- [x] Remove residual explorer integration-test setup assumptions that inserted
      `vfs_folders` rows purely for fallback behavior checks.
- [x] Add explicit client runtime source guardrail test to block reintroduction
      of `vfs_folders`/`vfsFolders` outside migration paths.
- [x] Extend client runtime guardrail to also block retired share/access table
      references (`vfs_shares`, `org_shares`, `vfs_access`) and schema symbols
      (`vfsShares`, `orgShares`, `vfsAccess`) outside migration paths.

### Slice E: Explorer Share Query Canonicalization

- [x] Replace explorer shared-by/shared-with query source from `vfs_shares` to
      canonical `vfs_acl_entries` (`id LIKE 'share:%'`, `revoked_at IS NULL`).
- [x] Remove missing-table compatibility fallback handling from share-query
      runtime paths (fail fast on missing canonical schema).
- [x] Add canonical ACL integration assertions for share-id extraction and ACL
      access-level to share-permission mapping.
- [x] Add explicit guardrail checks that runtime share query paths do not
      reintroduce `vfs_shares`/`vfsShares`.

### Slice G: Runtime Schema Generation Canonicalization

- [x] Keep legacy VFS table definitions available for migration-history context
      in `allTables`, but filter retired share/folder/access tables out of
      runtime schema inventories (`postgresRuntimeTables`,
      `sqliteRuntimeTables`).
- [x] Regenerate canonical SQLite/Postgres schema outputs so retired runtime
      tables are no longer exported in generated runtime schema modules.
- [x] Update DB/runtime schema contract tests and documentation to assert zero
      transitional runtime VFS tables in generated schema inventories.

## Verification Standard per Slice

1. Add/adjust tests before code change.
1. Run focused package tests.
1. Run formatting/lint checks for touched files.
1. Commit checkpoint.
1. Update issue `#1220` with completed + next subtasks.

## Ownership

Primary tracker: issue `#1220`.
