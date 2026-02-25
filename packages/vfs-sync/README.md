# @tearleads/vfs-sync

VFS sync protocol primitives, client sync runtime, and related UI exports.

This package is used by both API and client code:

- API imports protocol/query helpers from `@tearleads/vfs-sync/vfs`.
- Client can import transport and background sync client from `@tearleads/vfs-sync/vfs`.
- Client UI currently imports window/page components from `@tearleads/vfs-sync`.

## What This Package Is

`@tearleads/vfs-sync` is the shared sync layer for VFS state. It provides:

- Cursor parsing/encoding
- Query builders + row mappers for sync feeds
- CRDT feed/reconcile helpers
- Background sync client runtime with guardrails
- HTTP transport for sync endpoints
- Blob stage/attach protocol helpers (state/semantics)
- Schema-contract guardrail utilities

## What This Package Is Not

- It is not the API database pool/connection layer.
- It is not the client's SQLite adapter/storage engine.
- It is not only a horizontal-scaling utility.

Horizontal scaling benefits are a side effect of protocol/state design, not the sole purpose.

## Package Surface

Top-level exports:

- `@tearleads/vfs-sync`
  - `SyncWindow`
  - `Sync`

Protocol/runtime exports:

- `@tearleads/vfs-sync/vfs`
  - Sync feed query helpers (`buildVfsSyncQuery`, `parseVfsSyncQuery`, `mapVfsSyncRows`)
  - CRDT feed helpers (`buildVfsCrdtSyncQuery`, `parseVfsCrdtSyncQuery`, `mapVfsCrdtSyncRows`)
  - Reconcile helpers (sync + CRDT)
  - `VfsBackgroundSyncClient`
  - `VfsHttpCrdtSyncTransport`
  - Blob/ACL/in-memory harness helpers
  - Schema contract utilities

## Runtime Architecture

### Server side (API)

API routes import helpers from `@tearleads/vfs-sync/vfs`, then execute SQL via Postgres.

Current route patterns:

- Sync feed: `GET /v1/vfs/vfs-sync`
- Sync reconcile: `POST /v1/vfs/vfs-sync/reconcile`
- CRDT feed: `GET /v1/vfs/crdt/vfs-sync`
- CRDT push: `POST /v1/vfs/crdt/push`
- CRDT reconcile: `POST /v1/vfs/crdt/reconcile`
- Blob stage/attach/abandon:
  - `POST /v1/vfs/blobs/stage`
  - `POST /v1/vfs/blobs/stage/:stagingId/attach`
  - `POST /v1/vfs/blobs/stage/:stagingId/abandon`

### Consumer side (client)

Client runtime can use:

- `VfsHttpCrdtSyncTransport` for API communication
- `VfsBackgroundSyncClient` for queued local ops, pull/push/reconcile loops, and durable sync state semantics

The transport currently uses:

- `POST /v1/vfs/crdt/push`
- `GET /v1/vfs/crdt/vfs-sync`
- `POST /v1/vfs/crdt/reconcile`

## Protocol Notes

### Sync feed model

- Cursor is opaque, versioned, base64url payload.
- Ordering invariant is strict (timestamp + id) to prevent replay/skip across pages.
- ACL visibility and principal expansion are applied in feed SQL builders.

### CRDT model

- Operation types: `acl_add`, `acl_remove`, `link_add`, `link_remove`.
- Pull responses include `lastReconciledWriteIds` for stale-write recovery.
- Reconcile is monotonic: cursor/write IDs must not regress.

### Blob model

- Blobs are handled through stage -> attach/abandon workflow.
- `vfs-sync` provides protocol/state helpers and constraints around this flow.
- Raw blob storage bytes/object-store implementation are outside this package's core transport/query responsibilities.

## Guardrails and Safety

The package enforces fail-closed behavior for malformed protocol data:

- Invalid cursors rejected
- Non-monotonic feed rows rejected
- Invalid CRDT link payloads rejected
- Reconcile regression rejected
- Non-JSON HTTP transport payloads rejected

Schema-contract utilities and tests assert sync-critical SQL/table dependencies and check generated Postgres/SQLite schema compatibility.

## How It Relates to SQLite

- Runtime sync feed execution in API uses Postgres.
- SQLite references in this package are for schema-contract compatibility checks, not runtime sync query execution.
- App local persistence adapters/workers are outside this package and consumed by higher-level runtime packages.

## Minimal Consumer Example

```ts
import {
  VfsBackgroundSyncClient,
  VfsHttpCrdtSyncTransport
} from '@tearleads/vfs-sync/vfs';

const transport = new VfsHttpCrdtSyncTransport({
  baseUrl: 'https://api.example.com',
  apiPrefix: '/v1',
  getAuthToken: async () => localStorage.getItem('accessToken')
});

const syncClient = new VfsBackgroundSyncClient(
  'user-123',
  'desktop',
  transport,
  {
    pullLimit: 100,
    maxRematerializationAttempts: 1,
    onRematerializationRequired: async ({ error }) => {
      console.warn(
        'CRDT rematerialization required',
        error.requestedCursor,
        error.oldestAvailableCursor
      );

      // Return canonical replay/reconcile/container-clock state if available.
      // Returning null/void clears CRDT replay state before retrying.
      return null;
    }
  }
);

syncClient.queueLocalOperation({
  opType: 'acl_add',
  itemId: 'item-1',
  principalType: 'user',
  principalId: 'user-456',
  accessLevel: 'read'
});

await syncClient.flush();
```

## Development

This package is source-consumed via Vite aliases and does not require a standalone build.

```bash
# Unit/integration tests
pnpm --filter @tearleads/vfs-sync test

# Coverage
pnpm --filter @tearleads/vfs-sync test:coverage
```
