# Shared copy reclaim

[`SharedCopyReclaim.tla`](./SharedCopyReclaim.tla) models issue #2365 finding
18 and issue #2485 finding 2. Hydration stores a blob's bytes under one storage
key for every slot that holds the blob, so one local copy can back slots in
several documents. Deleting
one slot's row must not delete bytes another slot still holds: hydration skips
a slot that already names a copy, so those bytes would never be downloaded again.

| Model action or predicate | Production seam |
| --- | --- |
| `Hydrate` | `commitHydratedAttachment` writes the copy and commits the slot's row inside `runSerializedDocumentBlobMutation` |
| `Drop` | `deleteLocalAttachment` serializes row removal and queueing; `discardDocumentRowsToShell` queues in its deletion transaction |
| `ResetToPending` | `clearRemoteSyncState` atomically clears remote identities and moves held copies to pending uploads with the same storage key |
| `ReloadIdentity` | `saveDocumentRecord` or `installDurableDocumentReload` adopts the local-only identity while the open store retains its attachment map |
| `RemoveLocalSlot` / `QueueLocalRemoval` | `applyStoredAttachmentRemoval` queues the key in the removal transaction; `installCommittedAttachmentRemoval` schedules `runDocumentOrphanMaintenance` without deleting bytes |
| `BeginReclaim` / `CheckReferences` | `reclaimQueuedBlobs` calls `isDocumentBlobStorageKeyReferenced`, and `acknowledgeDocumentOrphanBlobReclaim` keeps a copy some row still holds |
| `FinishReclaim` / `LockReclaim` | `runSerializedDocumentBlobMutation` holds the copy's lock from the reference check through `deleteBytes` |
| `HeldCopyPresent` | `hydrateDocumentAttachmentBlobs` skips a slot while `localStorageKeyBySlotId` names its copy |

The bounds are two slots in one organization and one shared copy, with durable
held/pending references and the open stores' identity/copy views. Reset converts
the organization's references atomically; individual stores can adopt their new
identity later. Four negative controls fail
`HeldCopyPresent`:

- deleting without the reference check, which is the direct `deleteBytes` the
  detach cleanup and discard used to make;
- a reclaim whose check and delete are not serialized with hydration, so a slot
  re-hydrated in between loses its bytes;
- direct byte deletion after removing a local-only slot whose shared copy
  became a pending upload during reset;
- a reclaim that checks held rows but ignores pending upload references.

`sharedAttachmentReset.test.ts` exercises real store initialization, organization
reset, ordinary editing and slot removal against SQLite and a byte store. It
keeps the other document's pending source, then reclaims after its final reference
is removed. The no-reset smoke check preserves the other synced copy. The reset
safety assertion fails with the former direct-delete follow-up. These are runtime
regressions, not an automated implementation-to-model trace projection.

`UnheldCopyReclaimed` checks that a queued copy nobody holds is eventually
deleted, under weak fairness of the reclaim steps. The model abstracts the byte
content, which is identical for every slot because the key names the blob, and
the reclaim's retry schedule. Slot removal and queueing are atomic in the reset
regression path. The older `deleteLocalAttachment` path serializes separate SQL
statements; a process crash between removal and queueing remains outside this
model. Failed byte deletion and retry scheduling are covered by runtime reclaim
tests. No legacy-format transition or migration is modeled.
