# VFS Sync Runbook

## Scope

Use this runbook to diagnose:

- Sync-state divergence between client runtime and server CRDT state
- Staged-blob attach failures caused by reconcile visibility checkpoints

## 1) Sync-State Divergence

### Divergence Symptoms

- Client repeatedly fails sync with deterministic guardrail errors
- Client state no longer converges after retries
- Pending queue never drains

### Common Guardrail Signals

- `pull:pullPageInvariantViolation`
  - Example error: `hasMore=true with an empty pull page`
- `pull:pullCursorRegression`
  - Example error: `transport returned regressing sync cursor`
- `pull:pullDuplicateOpReplay`
  - Example error: `transport replayed opId ... during pull pagination`
- `reconcile:reconcileCursorRegression`
  - Example error: `transport reconcile regressed sync cursor`
- `reconcile:lastWriteIdRegression`
  - Example error: `regressed lastReconciledWriteIds ...`
- `flush:staleWriteRecoveryExhausted`
  - Example error: `stale write-id recovery exceeded max retry attempts without forward progress`

### Divergence Triage Steps

1. Capture `client.exportState()` before retrying.
2. Retry once and capture `client.exportState()` again.
3. If state changed on a failed attempt, treat as a bug (fail-closed invariant break).
4. Compare cursor + `lastReconciledWriteIds` with server snapshot ordering.
5. If mismatch persists, restart via hydrate from last known-good exported state and re-run sync.

## 2) Staged-Blob Visibility Failures

### Visibility Failure Symptoms

- Attach returns `409 Client reconcile state is behind required visibility`
- Attach returns deterministic `500 Failed to attach staged blob` on malformed metadata/state

### Visibility Failure Triage Steps

1. Validate staged row status is still `blob-stage:staged` and not expired.
2. Validate attach payload includes coherent checkpoint tuple:
   - `clientId`
   - `requiredCursor`
   - `requiredLastReconciledWriteIds`
3. Validate persisted reconcile state for `crdt:<clientId>`:
   - cursor dominates required cursor
   - each required replica writeId is present and dominated
4. Validate reconcile payload shape in DB is object map (`replicaId -> positive integer`).
5. Retry attach with identical payload only after reconcile state is advanced.

## 3) Operational Safety Rules

- Treat guardrail failures as hard-stop signals; do not silently bypass.
- Preserve deterministic error messages and stage/code signatures.
- Prefer idempotent retries with identical payloads; avoid mutation between retries unless advancing reconcile state.
