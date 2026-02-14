# VFS Sync Flattening Migration Runbook

This runbook covers staged rollout verification for the flattening migration chain:

1. `v024` (backfill legacy staged rows into `vfs_registry + vfs_links`)
1. `v025` (drop `vfs_blob_staging` and `vfs_blob_refs`)
1. `v026` (drop `vfs_blob_objects` after canonical blob parity check)
1. `v027` (drop `vfs_access` after canonical user ACL parity check)
1. `v028` (backfill/verify `vfs_shares -> vfs_acl_entries` parity)
1. `v029` (backfill/verify `org_shares -> vfs_acl_entries` parity)
1. `v030` (backfill/verify `vfs_folders -> vfs_registry` metadata parity)

## Ordering Guardrails

1. Deploy runtime code that writes flattened blob/ACL state before running destructive drops.
1. Run migrations in strict order without skipping (`v024` -> `v025` -> `v026` -> `v027` -> `v028` -> `v029` -> `v030`).
1. Treat any migration guardrail exception as fail-closed and stop rollout.
1. Do not continue to a destructive migration when parity checks return non-zero rows.

## Preflight

1. Confirm backup/snapshot is available for the target database.
1. Confirm application version includes:
   - `packages/api/src/migrations/v024.ts`
   - `packages/api/src/migrations/v025.ts`
   - `packages/api/src/migrations/v026.ts`
   - `packages/api/src/migrations/v027.ts`
   - `packages/api/src/migrations/v028.ts`
   - `packages/api/src/migrations/v029.ts`
   - `packages/api/src/migrations/v030.ts`
1. Confirm branch includes the schema retirement commit for `vfs_blob_objects` in canonical schema generation.
1. Record baseline counts:

```sql
SELECT COUNT(*) AS legacy_blob_objects FROM vfs_blob_objects;
SELECT COUNT(*) AS legacy_blob_staging FROM vfs_blob_staging;
SELECT COUNT(*) AS legacy_blob_refs FROM vfs_blob_refs;
SELECT COUNT(*) AS canonical_blob_registry
FROM vfs_registry
WHERE object_type = 'blob';
SELECT COUNT(*) AS canonical_blob_stage_registry
FROM vfs_registry
WHERE object_type = 'blobStage';
SELECT COUNT(*) AS legacy_vfs_access FROM vfs_access;
SELECT COUNT(*) AS canonical_active_user_acl
FROM vfs_acl_entries
WHERE principal_type = 'user'
  AND revoked_at IS NULL;
SELECT COUNT(*) AS legacy_vfs_shares FROM vfs_shares;
SELECT COUNT(*) AS legacy_org_shares FROM org_shares;
SELECT COUNT(*) AS canonical_active_org_acl
FROM vfs_acl_entries
WHERE principal_type = 'organization'
  AND revoked_at IS NULL;
SELECT COUNT(*) AS legacy_vfs_folders FROM vfs_folders;
```

## Migration Execution

1. Run normal API migration entrypoint (same mechanism used in production deploy).
1. Verify schema version reaches `30`.

```sql
SELECT MAX(version) AS schema_version FROM schema_migrations;
```

1. If schema version is below `30`, stop and inspect migration logs.

## Post-Migration Parity Checks

Run all checks and require zero violating rows.

1. Legacy staging/ref/object tables should be absent.

```sql
SELECT to_regclass('public.vfs_blob_staging') AS blob_staging_table;
SELECT to_regclass('public.vfs_blob_refs') AS blob_refs_table;
SELECT to_regclass('public.vfs_blob_objects') AS blob_objects_table;
SELECT to_regclass('public.vfs_access') AS vfs_access_table;
```

1. Share/ACL parity should hold for active principals.

```sql
SELECT COUNT(*) AS missing_vfs_share_acl_rows
FROM vfs_shares s
LEFT JOIN vfs_acl_entries acl
  ON acl.item_id = s.item_id
 AND acl.principal_type = s.share_type
 AND acl.principal_id = s.target_id
 AND acl.revoked_at IS NULL
WHERE acl.id IS NULL;

SELECT COUNT(*) AS missing_org_share_acl_rows
FROM org_shares os
LEFT JOIN vfs_acl_entries acl
  ON acl.item_id = os.item_id
 AND acl.principal_type = 'organization'
 AND acl.principal_id = os.target_org_id
 AND acl.revoked_at IS NULL
WHERE acl.id IS NULL;
```

1. Every flattened blob-stage row should have canonical `blobStage` type.

```sql
SELECT COUNT(*) AS invalid_blob_stage_registry_rows
FROM vfs_registry r
WHERE r.object_type = 'blobStage'
  AND NOT EXISTS (
    SELECT 1
    FROM vfs_links l
    WHERE l.id = r.id
      AND l.parent_id = r.id
  );
```

1. Every blob-stage link child should resolve to canonical blob object.

```sql
SELECT COUNT(*) AS missing_blob_children
FROM vfs_links l
LEFT JOIN vfs_registry blob
  ON blob.id = l.child_id
WHERE l.parent_id = l.id
  AND l.wrapped_session_key LIKE 'blob-stage:%'
  AND (blob.id IS NULL OR blob.object_type <> 'blob');
```

1. Ensure no cursor regressions in client state from reconcile writes.

```sql
SELECT user_id, client_id, last_reconciled_at, last_reconciled_change_id
FROM vfs_sync_client_state
ORDER BY updated_at DESC
LIMIT 100;
```

1. Folder metadata parity should hold between legacy and canonical columns.

```sql
SELECT COUNT(*) AS folder_metadata_mismatches
FROM vfs_folders f
INNER JOIN vfs_registry r
  ON r.id = f.id
WHERE r.encrypted_name IS DISTINCT FROM f.encrypted_name
   OR r.icon IS DISTINCT FROM f.icon
   OR r.view_mode IS DISTINCT FROM f.view_mode
   OR r.default_sort IS DISTINCT FROM f.default_sort
   OR r.sort_direction IS DISTINCT FROM f.sort_direction;
```

## Runtime Health Checks

1. Execute synthetic API requests after migration:
   - `POST /v1/vfs/blobs/stage`
   - `POST /v1/vfs/blobs/stage/:id/attach`
   - `POST /v1/vfs/blobs/stage/:id/abandon`
   - `GET /v1/vfs/crdt/sync`
   - `POST /v1/vfs/crdt/reconcile`
1. Confirm no SQL errors referencing dropped tables (`vfs_blob_staging`, `vfs_blob_refs`, `vfs_blob_objects`, `vfs_access`).
1. Confirm guardrail violations are not emitted for cursor/write-id regression in the same rollout window.

## Rollback Triggers

Rollback/incident response should trigger immediately if any condition occurs:

1. Migration fails with guardrail exception from `v024` through `v030`.
1. Any post-migration parity query returns non-zero violation counts.
1. API logs show attempts to query dropped legacy blob tables.
1. Reconcile/pull endpoints begin returning cursor regression or write-id regression failures.

## Rollback Actions

1. Freeze write traffic where possible.
1. Restore database from pre-migration snapshot.
1. Re-deploy last known-good application version.
1. Re-run preflight parity checks before a second migration attempt.
