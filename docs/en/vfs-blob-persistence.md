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

## Boundary Guarantees

- Metadata/object-key alignment uses `toStorageKey(blobId, keyPrefix)` for write/read/delete.
- Storage failures fail closed at route boundaries and do not silently downgrade behavior.
- Retry safety is caller-driven: repeating the same request reuses the same `blobId`-derived key.
