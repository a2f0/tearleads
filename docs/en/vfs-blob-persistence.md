# VFS Blob Persistence Contract

## In-Repo Adapter Path

The runtime uses a direct S3 adapter in `packages/api/src/lib/vfsBlobStore.ts`.

- Write: `persistVfsBlobData` -> `PutObjectCommand`
- Read: `readVfsBlobData` -> `GetObjectCommand`
- Delete: `deleteVfsBlobData` -> `DeleteObjectCommand`

The API routes that call this adapter are:

- `packages/api/src/routes/vfs/post-blobs-stage.ts`
- `packages/api/src/routes/vfs/get-blobs-blobId.ts`
- `packages/api/src/routes/vfs/delete-blobs-blobId.ts`

## Explicit Assumptions

- This repo does not currently implement a presigned URL upload/download flow.
- Blob object keys are derived deterministically from metadata `blobId` and optional `VFS_BLOB_S3_KEY_PREFIX`.
- The adapter does not perform internal retries; storage failures are surfaced to callers.
- All blob access is authenticated via API routes; no direct S3 access is exposed to clients.

## Boundary Guarantees

- Metadata/object-key alignment uses `toStorageKey(blobId, keyPrefix)` for write/read/delete.
- Storage failures fail closed at route boundaries and do not silently downgrade behavior.
- Retry safety is caller-driven: repeating the same request reuses the same `blobId`-derived key.

## Error Handling Contract

The following S3 error scenarios are handled consistently:

| S3 Error Code | HTTP Status | Behavior |
|---------------|-------------|----------|
| `NoSuchKey` | 500 | Orphaned metadata - registry exists but object missing |
| `AccessDenied` | 500 | Storage access configuration error |
| `ServiceUnavailable` | 500 | Transient outage - safe to retry |
| `SlowDown` | 500 | Throttling - safe to retry with backoff |
| `InternalError` | 500 | S3 internal error - safe to retry |

All storage errors return 500 to the client with a generic error message. The distinction between "not found" (404) and "storage error" (500) is:

- **404**: Blob ID does not exist in the registry (metadata layer)
- **500**: Blob ID exists in registry but storage operation failed (object layer)

This distinction preserves the fail-closed guarantee: if metadata says the blob exists, any storage failure is treated as an error, not a "not found."

## Object-Key Mismatch Scenarios

### Orphaned Metadata (blob in DB, missing in S3)

- Occurs when: S3 object deleted out-of-band, or registry entry created but S3 upload failed
- Behavior: Read/delete returns 500 (not 404)
- Resolution: Manual cleanup of orphaned registry entries

### Orphaned Objects (blob in S3, missing in DB)

- Occurs when: Registry entry deleted but S3 delete failed
- Behavior: Object remains in S3 bucket
- Resolution: S3 lifecycle policy or manual sweep

## Transient Unavailability

The persistence layer is designed for retry safety:

1. **Deterministic key derivation**: Same `blobId` always produces the same S3 key
2. **No server-side retries**: Failures surface immediately to callers
3. **Idempotent operations**: PutObject with same key overwrites safely
4. **Caller-driven retry**: Clients can retry failed requests with same payload

## Test Coverage

Contract tests are in `packages/api/src/routes/vfs-blobs-persistence-contract.test.ts`:

- Object-key mismatch scenarios (orphaned metadata)
- S3-specific error code handling
- Transient storage unavailability with retry-safe behavior
- Metadata/object alignment boundary contract

## Operations

- For sync divergence and staged-blob visibility diagnosis, see `docs/en/vfs-sync-runbook.md`.

## Local Garage Bootstrap

For local VFS blob persistence with the same S3-compatible backend used in k8s:

```bash
sh scripts/garage/setupLocalGarage.sh
```

This starts Garage from `scripts/garage/docker-compose.yml`, initializes the `vfs-blobs` bucket, and writes blob-store env defaults into `packages/api/.env`.

To stop it:

```bash
sh scripts/garage/stopLocalGarage.sh
```
