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
- [ ] Remove remaining legacy-adapter/classic-test assumptions tied to
      `vfs_folders`.
- [ ] Collapse migration notes that only existed to support fallback read paths.

### Slice D: Contract + Docs

- [ ] Update schema contract doc to remove compatibility/fallback language.
- [ ] Update migration runbook to remove post-finalization checks for dropped
      scaffolding snapshots as live requirements.
- [ ] Add explicit canonical-only guardrail tests for share/explorer SQL
      surfaces.

## Verification Standard per Slice

1. Add/adjust tests before code change.
1. Run focused package tests.
1. Run formatting/lint checks for touched files.
1. Commit checkpoint.
1. Update issue `#1220` with completed + next subtasks.

## Ownership

Primary tracker: issue `#1220`.
