# VFS Rematerialization Flow

Status: implementation-aligned flow documentation (March 3, 2026).

## Why Rematerialization Exists

`vfs_crdt_ops` is compacted to keep CRDT replay bounded. When a client cursor falls behind the retained window, the server rejects CRDT pull and the client must rematerialize state, then retry.

Related background docs:

- `docs/en/vfs-crdt-compaction.md`
- `docs/en/vfs-sync-runbook.md`

## End-to-End Flow

### 1) Client Pull Starts

`VfsBackgroundSyncClient` runs pull/flush loops through `runWithRematerializationRecovery(...)`.

- Pull path: `pullUntilSettledLoop(...)`
- Flush path: `runFlushLoop(...)`

Both are wrapped with bounded rematerialization retries (`maxRematerializationAttempts`, default `1`).

### 2) Server Detects Stale Cursor

In `getCrdtSyncDirect(...)`, if the request includes a cursor:

1. Read compaction epoch + oldest-accessible-cursor cache.
2. On cache miss, compute oldest accessible cursor from visible CRDT ops for that user/root scope.
3. Compare requested cursor with oldest accessible cursor.
4. If requested cursor is older, reject with `ConnectError(Code.AlreadyExists)` and message:
   - `CRDT cursor is older than retained history; re-materialization required`

This maps to HTTP `409`.

### 3) Transport Normalizes Error

`VfsHttpCrdtSyncTransport` parses non-OK responses and throws typed
`VfsCrdtRematerializationRequiredError` when status is `409` and either:

- `code=crdt_rematerialization_required`, or
- `code=already_exists` with message mentioning rematerialization

If present, `requestedCursor` and `oldestAvailableCursor` are attached to the typed error.

### 4) Guardrail Telemetry Emits

Pull loop catches typed rematerialization errors and emits deterministic guardrail telemetry:

- stage: `pull`
- code: `pullRematerializationRequired`
- signature: `pull:pullRematerializationRequired`

Metric mapping includes:

- `vfs_sync_guardrail_violation_total{stage,code,signature}`
- `vfs_sync_rematerialization_required_total{code="crdt_rematerialization_required",signature="pull:pullRematerializationRequired"}`

### 5) Rematerialization Callback Runs

Recovery wrapper calls `rematerializeClientState(...)`, which invokes `onRematerializationRequired` if provided.

In current API-client wiring (`VfsApiNetworkFlusher`):

1. Call user-provided rematerialization handler first.
2. If user handler returns null/void and default transport is used, fallback fetches server snapshot:
   - `POST /connect/tearleads.v1.VfsService/GetCrdtSnapshot`
3. `404` snapshot response is treated as no snapshot (`null`), which means fallback to state reset behavior.

### 6) Rematerialized State Is Applied

`applyRematerializedState(...)` enforces invariants, then atomically updates in-memory sync stores:

- Replace replay snapshot (`acl`, `links`, replay cursor)
- Replace container clocks
- Replace reconcile state (cursor + replica write IDs) if provided
- Recompute `nextLocalWriteId` so it stays ahead of reconcile/pending writes

If callback returns `null`, the client applies an empty replay/reconcile/container state and retries from clean CRDT baseline.

### 7) Retry or Fail Closed

- If rematerialization succeeds, the original pull/flush loop is retried.
- If stale-cursor errors continue beyond `maxRematerializationAttempts`, the typed error is rethrown.
- No silent bypass: failures remain hard-stop protocol signals.

### 8) App-Level Bootstrap Hook (Current Client)

In `VfsOrchestratorContext`, rematerialization callback also calls
`rematerializeRemoteVfsStateIfNeeded()` before returning `null`.

That helper:

- only runs when local VFS registry is empty,
- rebuilds local SQLite VFS state by replaying canonical sync + CRDT feeds,
- bulk rewrites local VFS tables in a guarded transaction.

After this hook returns, CRDT client rematerialization logic continues (including server snapshot fallback when enabled).

## Reference Paths

- Server stale-cursor gate: `packages/api/src/connect/services/vfsDirectSync.ts`
- Oldest cursor cache/epoch: `packages/api/src/lib/vfsCrdtRedisCache.ts`
- Snapshot loader: `packages/api/src/lib/vfsCrdtSnapshots.ts`
- Transport rematerialization parsing: `packages/vfs-sync/src/vfs/transport/sync-http-transport.ts`
- Client recovery wrapper: `packages/vfs-sync/src/vfs/client/syncClientRematerialization.ts`
- Pull guardrail emission: `packages/vfs-sync/src/vfs/client/sync-client-sync-loop.ts`
- API-client fallback handler: `packages/api-client/src/vfsNetworkFlusher.ts`
- App callback bootstrap: `packages/client/src/contexts/VfsOrchestratorContext.tsx`
- Local DB rebuild helper: `packages/client/src/lib/vfsRematerialization.ts`
