# Stage promotion and server reclamation

[`StagePromotion.tla`](./StagePromotion.tla) models the server's blob
lifecycle across the database and the object store, which share no
transaction (#2672). A client opens a stage, a multipart upload under the
stage's own storage key, and uploads parts. Attachment binding completes the
upload before its transaction, verifies the assembled object against the
declared digest, and marks the stage complete. Then, in one transaction
holding the stage row, it promotes the stage into a blob row that keeps the
stage key and binds it to a document. A bind may instead attach an existing
blob. Detach, replacement and document purge mark a blob dereferenced once
nothing binds it. The hourly sweep reclaims dereferenced blobs, deletes their
objects afterwards, and cleans up expired stages.

| Model action or predicate | Production seam |
| --- | --- |
| `OpenStage` | `initiateMultipartBlobStage` checks current organization access (`requireBlobStageOrganizationAccess`), opens the upload and persists the stage with a one-hour `expiresAt` |
| `Expire` / `BindLoad` | `prevalidateMultipartBlobStage` loads the stage through `loadOwnedActiveBlobStage`, which refuses another owner and an expired stage |
| `BindAssemble` | `completeOwnedMultipartStage` completes the upload; once the upload is consumed, `recoverAssembledMultipartStage` re-verifies whatever object survives at the key |
| `BindVerify` / `CheckAssembledHash` | `assertCompletedMultipartObjectMatches` deletes and refuses an object whose length or digest differs; `markMultipartStageComplete` is a plain update outside any transaction |
| `BindLock` / `PromoteRequiresUnexpired` | `promoteStagedBlobIfPresent` locks the stage with `loadOwnedActiveBlobStage` (`lockForUpdate`) and requires it complete and unexpired |
| `BindPromote` / `DeleteStageOnPromote` / `CheckRegistryOnPromote` | `promoteStagedBlobIfPresent` refuses an id already in `blobAuditObjects` or `blobs`, inserts the blob row with the stage key and deletes the stage row; `registerAttachmentBlobs` records the id; `detachActiveSlotBinding` and `finalizeAttachmentMutation` release the replaced blob |
| `BindExisting` / `ReviveOnBind` | `ensureBlobExists` locks the blob row; `assertExistingBlobSourceAuthority` checks source authority; `reviveBlobIfDereferenced` clears the dereferenced mark |
| `Detach` / `MarkIfUnbound` | `runDetachBlobAttachmentWorkflow`; `markBlobDereferencedIfInactive` marks the blob under its row lock when no active binding remains |
| `Purge` / `PurgeLocksBlobs` | `resolveOrphanedBlobIds` takes `lockBlobMutationRows` before deciding which blobs no other document binds; `deleteDocumentAttachmentRows` deletes the bindings and marks those blobs |
| `Reclaim` / `GcRechecksReference` | `reclaimOneBlob` locks the blob, revives it when `isBlobActivelyReferenced`, refuses a registry row whose key differs, and otherwise deletes the blob row and its bindings and marks the registry row pruned |
| `DeletePrunedObject` | `drainPendingBlobObjectDeletions` deletes the object at the registry row's key, then `recordBlobObjectDeleted` |
| `CleanupClaim` / `ExpiryLocksStageRow` | `expireBlobStagesForCleanup` claims a batch of expired stages with one update; for each stage row a promotion holds, the update waits and finds nothing once it commits. Each claimed stage is one cleanup-claim step, since the update locks its rows independently and no stage's claim depends on another's |
| `CleanupStorage` / `DeleteObjectAfterAbort` / `CleanupRow` | `cleanupExpiredBlobStages` deletes a complete stage's object, or aborts a pending stage's upload (the S3 adapter treats a missing upload as aborted) and deletes its key, then deletes the stage rows |
| `Fairness` | `runBlobMaintenance` runs reclamation and stage cleanup from the Worker's hourly cron |

## Properties

- `BlobsHoldDeclaredBytes`: every blob row's object exists and holds the bytes
  the stage declared.
- `SweepKeepsBoundBlobs`: the sweep never deletes a blob a document still
  binds.
- `UnboundBlobsAreMarked`: a live blob nothing binds is marked, so the sweep
  will find it.
- `NoOrphanObjects`: every stored object has a stage row, a blob row, or a
  pending deletion that will remove it.
- `ExpiredStagesAreCleared`, `DereferencedBlobsAreSettled` and
  `PrunedObjectsAreDeleted`: with the sweep running and started binds and
  purges finishing, expired stages are removed, dereferenced blobs are revived
  or reclaimed, and reclaimed objects are deleted. Clients need not act.

The bounds are two stages, two blob ids and two documents. The registered run
explores 545,610 generated and 100,441 distinct states.

## The cleanup leak this model found

Bind-time completion and the stage's row flip are separate writes. A bind that
loaded a live stage can complete the upload after the stage expires. If
cleanup claims the stage before the flip, it reads the stage as pending and
aborts an upload that no longer exists. The adapter treats the missing upload
as aborted, and cleanup deletes the row. The assembled object then remained
in the bucket with no record pointing at it. A bind that stopped between
completion and the flip, and was never retried, left the same orphan.

`cleanupExpiredBlobStages` now also deletes a pending stage's key after the
abort. That is safe because a claimed stage can no longer be promoted. The
control `stage-cleanup-leaves-assembled-object` restores the old behavior and
reports `NoOrphanObjects`. `multipartStageExpiryCleanup.test.ts` reproduces
the leak through the real S3 adapter and fails without the fix.

## Negative controls

Each control in
[`protocolStagePromotionNegativeControls.ts`](../../scripts/protocol/protocolStagePromotionNegativeControls.ts)
removes one production guard:

- `CheckAssembledHash = FALSE` violates `BlobsHoldDeclaredBytes`: mismatched
  parts are promoted.
- `PromoteRequiresUnexpired = FALSE` violates `BlobsHoldDeclaredBytes`: a
  stage cleanup claimed is promoted, and cleanup deletes its object.
- `ExpiryLocksStageRow = FALSE` violates `BlobsHoldDeclaredBytes`: the stage
  expires while a promotion holds it, cleanup reads it as complete, and deletes
  the promoted blob's object.
- `DeleteStageOnPromote = FALSE` violates `BlobsHoldDeclaredBytes`: the stage
  outlives its promotion, expires, and cleanup deletes the blob's object.
- `CheckRegistryOnPromote = FALSE` violates `DereferencedBlobsAreSettled`: a
  reclaimed id is promoted again, and its registry row names the old key, so
  the sweep can never reclaim the new generation.
- `ReviveOnBind = FALSE` together with `GcRechecksReference = FALSE` violates
  `SweepKeepsBoundBlobs`. Either guard alone is enough: TLC finds no violation
  with only one of them removed.
- `PurgeLocksBlobs = FALSE` violates `UnboundBlobsAreMarked`: a purge decides a
  shared blob is still bound, a concurrent detach sees the purged document's
  binding and leaves the blob unmarked, and the purge then removes that
  binding.
- `DeleteObjectAfterAbort = FALSE` violates `NoOrphanObjects`, as described
  above.

## Boundary

A member removed from the organization keeps their own unbound stage until it
expires: part uploads recheck ownership and expiry, not membership, and binding
needs current write access. The hourly cleanup removes the stage, so this
residual is accepted. Organization purge tears down every row and object for
the organization and is not modeled. Source authority for an existing blob is
covered by [BlobSourceAuthority](./BlobSourceAuthority.md); the client side of
detaching a pending attachment is covered by
[PendingAttachmentDetach](./PendingAttachmentDetach.md). The model treats each
database transaction as one step and orders them by the row locks production
takes. A storage call that fails is retried by the next sweep and appears here
as a step not yet taken. The grace period before reclamation is a timing
choice and is not modeled; every guard above holds without it.
