# Shared copy reclaim

[`SharedCopyReclaim.tla`](./SharedCopyReclaim.tla) models issue #2365 finding
18. Hydration stores a blob's bytes under one storage key for every slot that
holds the blob, so one local copy can back slots in several documents. Deleting
one slot's row must not delete bytes another slot still holds: hydration skips
a slot that already names a copy, so those bytes would never be downloaded again.

| Model action or predicate | Production seam |
| --- | --- |
| `Hydrate` | `commitHydratedAttachment` writes the copy and commits the slot's row inside `runSerializedDocumentBlobMutation` |
| `Drop` | `deleteLocalAttachment` and `discardDocumentRowsToShell` call `queueDocumentAttachmentStorageKeys` in the transaction that deletes the row |
| `BeginReclaim` / `CheckReferences` | `reclaimQueuedBlobs` calls `isDocumentBlobStorageKeyReferenced`, and `acknowledgeDocumentOrphanBlobReclaim` keeps a copy some row still holds |
| `FinishReclaim` / `LockReclaim` | `runSerializedDocumentBlobMutation` holds the copy's lock from the reference check through `deleteBytes` |
| `HeldCopyPresent` | `hydrateDocumentAttachmentBlobs` skips a slot while `localStorageKeyBySlotId` names its copy |

The bounds are two slots and one shared copy. Two negative controls fail
`HeldCopyPresent`:

- deleting without the reference check, which is the direct `deleteBytes` the
  detach cleanup and discard used to make;
- a reclaim whose check and delete are not serialized with hydration, so a slot
  re-hydrated in between loses its bytes.

`UnheldCopyReclaimed` checks that a queued copy nobody holds is eventually
deleted, under weak fairness of the reclaim steps. The model abstracts the byte
content, which is identical for every slot because the key names the blob, and
the reclaim's retry schedule.
