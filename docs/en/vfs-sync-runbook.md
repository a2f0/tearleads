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

## 3) Blob Persistence Failures

For detailed S3 error handling and object-key mismatch scenarios, see `docs/en/vfs-blob-persistence.md`.

### Blob Persistence Failure Symptoms

- Stage returns `500 Failed to persist blob data`
- Read returns `500 Failed to read blob data`
- Delete returns `500 Failed to delete blob data`

### Common S3 Error Signals

| S3 Error Code | HTTP Status | Meaning |
|---------------|-------------|---------|
| `NoSuchKey` | 500 | Orphaned metadata - registry exists but object missing |
| `AccessDenied` | 500 | Storage access configuration error |
| `ServiceUnavailable` | 500 | Transient outage - safe to retry |
| `SlowDown` | 500 | Throttling - safe to retry with backoff |
| `InternalError` | 500 | S3 internal error - safe to retry |

### Blob Persistence Triage Steps

1. **Distinguish 404 vs 500**:
   - `404` = blob ID does not exist in registry (metadata layer)
   - `500` = blob ID exists in registry but storage operation failed (object layer)

2. **Orphaned metadata (blob in DB, missing in S3)**:
   - Check if S3 object was deleted out-of-band
   - Check if registry entry was created but S3 upload never completed
   - Resolution: Manual cleanup of orphaned registry entries

3. **Transient failures**:
   - Retry with same payload (deterministic key derivation ensures same S3 key)
   - Use exponential backoff for `SlowDown` errors
   - All operations are idempotent - safe to retry

4. **Access configuration errors**:
   - Verify IAM permissions for bucket access
   - Check `VFS_BLOB_S3_BUCKET` and `VFS_BLOB_S3_KEY_PREFIX` configuration

## 4) Guardrail Telemetry Reference

### Stage:Code Signatures

All guardrail violations emit a deterministic `stage:code` signature for monitoring:

| Signature | Trigger Condition |
|-----------|-------------------|
| `pull:pullPageInvariantViolation` | `hasMore=true` with empty items, or `nextCursor` doesn't match page tail |
| `pull:pullDuplicateOpReplay` | Same opId appears twice within one pull-until-settled cycle |
| `pull:pullCursorRegression` | New pull cursor moves backward relative to previous cursor |
| `pull:lastWriteIdRegression` | Pull response regresses `lastReconciledWriteIds` on any replica |
| `reconcile:reconcileCursorRegression` | Remote reconcile acknowledgement cursor moves backward |
| `reconcile:lastWriteIdRegression` | Reconcile response regresses `lastReconciledWriteIds` |
| `flush:staleWriteRecoveryExhausted` | Stale write recovery exceeds max retry attempts (2) |
| `hydrate:hydrateGuardrailViolation` | Error during state hydration (validation, malformed state) |

### Telemetry Assertion Helpers

Test suites should use standardized assertion helpers from `sync-client-test-support-observers.ts`:

- `expectPullPageInvariantViolation({ violations, hasMore, itemsLength })`
- `expectPullDuplicateOpReplayViolation({ violations, opId })`
- `expectPullCursorRegressionViolation({ violations, previousChangedAt, ... })`
- `expectReconcileCursorRegressionViolation({ violations, ... })`
- `expectLastWriteIdRegressionViolation({ violations, stage, replicaId, ... })`
- `expectStaleWriteRecoveryExhaustedViolation({ violations, attempts, maxAttempts })`
- `expectHydrateGuardrailViolation({ violations, messagePattern? })`
- `expectGuardrailSignature({ violations, signature })` - quick presence check
- `expectExactGuardrailSignatures({ violations, signatures })` - exhaustive validation

## 5) Operational Safety Rules

- Treat guardrail failures as hard-stop signals; do not silently bypass.
- Preserve deterministic error messages and stage/code signatures.
- Prefer idempotent retries with identical payloads; avoid mutation between retries unless advancing reconcile state.
- All errors must be actionable: include stage, code, and relevant details for diagnosis.
- No silent fallbacks: guardrail violations always throw errors after emitting telemetry.
