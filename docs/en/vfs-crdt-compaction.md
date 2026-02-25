# VFS CRDT Compaction and Re-materialization

## Problem

`vfs_crdt_ops` is append-only. For long-lived accounts and many replicas, replay cost and table growth increase over time.

We need a safe compaction strategy that:

- preserves correctness for active clients,
- supports persistent but intermittently-online sessions,
- allows stale clients to recover by re-materializing current state.

## Design

### 1. Hot Log + Re-materialization model

- Keep a **hot CRDT log window** in `vfs_crdt_ops` (default: 30 days).
- Compact anything older than a computed safe frontier.
- If a client returns after falling behind that frontier, it must re-materialize state from canonical item/ACL tables and then resume CRDT tail sync.

### 2. Active frontier from reconcile state

Compaction frontier is bounded by active CRDT client cursors in `vfs_sync_client_state`:

- CRDT clients are rows with `client_id` prefixed by `crdt:`.
- A client is **active** if `updated_at >= now - inactiveClientWindow` (default: 90 days).
- A client is **stale** otherwise and is excluded from frontier calculation.

Frontier formula:

- `hotRetentionFloor = latestCrdtOccurredAt - hotRetentionWindow`
- `activeCursorFloor = oldestActiveLastReconciledAt - cursorSafetyBuffer`
- `cutoffOccurredAt = min(hotRetentionFloor, activeCursorFloor)` when active clients exist
- `cutoffOccurredAt = hotRetentionFloor` when no active clients exist

Only rows with `occurred_at < cutoffOccurredAt` are compaction candidates.

### 3. Safety buffer

A cursor safety buffer (default: 6 hours) protects against edge races around reconnect, clock skew, and delayed reconcile writes.

### 4. Long-term session alignment

The key tuning relationship is:

- `inactiveClientWindow` should be at least as large as the expected persistent-session return window.

Example guidance:

- if clients commonly resume within 60 days, use `inactiveClientWindow >= 60d`.
- if product policy allows forced re-materialization after 30 days offline, use a smaller window and surface UX messaging.

## Current implementation slice

Implemented in API lib:

- `packages/api/src/lib/vfsCrdtCompaction.ts`
  - deterministic compaction planner,
  - active/stale client classification,
  - dry-run candidate estimation,
  - delete executor for rows older than computed cutoff.
- `packages/api/src/cli/vfsCrdtCompaction.ts`
  - dry-run and execute command surface,
  - bounded execution via `--max-delete-rows`,
  - emits structured JSON run metric event `vfs_crdt_compaction_run`.
- `scripts/postgres/runVfsCrdtCompaction.sh`
  - cron/worker wrapper around the CLI with env-driven options.

This is the planning/execution primitive; orchestration (scheduled job, metrics, and rollback controls) is the next slice.

### Stale cursor contract

- `GET /v1/vfs/crdt/vfs-sync` now returns `409` with `code=crdt_rematerialization_required` when the requested cursor is older than retained accessible CRDT history.
- Response includes:
  - `requestedCursor`
  - `oldestAvailableCursor`
- Clients should re-materialize from canonical sync state and then resume CRDT tail sync from the latest canonical baseline.

## Operational rollout

1. Run planner in dry-run mode and log:
   - `cutoffOccurredAt`, `estimatedRowsToDelete`, `activeClientCount`, `staleClientCount`.
2. Track stale-client re-materialization rate.
3. Enable delete execution in limited batches (for example `--max-delete-rows 1000`).
4. Add periodic scheduler once metrics stabilize.

## Scheduler wrapper usage

Run once (dry-run by default):

```sh
scripts/postgres/runVfsCrdtCompaction.sh
```

Run with execution + bounded batch:

```sh
VFS_CRDT_COMPACTION_EXECUTE=1 \
VFS_CRDT_COMPACTION_MAX_DELETE_ROWS=1000 \
scripts/postgres/runVfsCrdtCompaction.sh
```

Example cron (every 30 minutes):

```cron
*/30 * * * * cd /path/to/repo && VFS_CRDT_COMPACTION_EXECUTE=1 VFS_CRDT_COMPACTION_MAX_DELETE_ROWS=1000 scripts/postgres/runVfsCrdtCompaction.sh >> /var/log/vfs-crdt-compaction.log 2>&1
```

Validate metric shape from logs:

```sh
pnpm checkVfsCrdtCompactionMetrics --file /var/log/vfs-crdt-compaction.log --strict
```
