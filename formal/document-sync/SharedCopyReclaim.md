# Shared copy reclaim

[`SharedCopyReclaim.tla`](./SharedCopyReclaim.tla) models reclaiming a
hydrated attachment copy. Hydration stores a blob's bytes under one storage key
for every slot that holds the blob, so one local copy can back slots in several
documents. Deleting one slot's row must not delete bytes another slot still
holds: hydration skips a slot that already names a copy, so those bytes would
never be downloaded again.

| Model action or predicate | Production seam |
| --- | --- |
| `Hydrate` | `commitHydratedAttachment` writes the copy and commits the slot's row inside `runSerializedDocumentBlobMutation` |
| `Drop` | `deleteLocalAttachment` removes the row and queues its copy in one transaction; `discardDocumentRowsToShell` queues in its deletion transaction |
| `ResetToPending` | `clearRemoteSyncState` atomically clears remote identities and moves held copies to pending uploads with the same storage key |
| `ReloadIdentity` | `saveDocumentRecord` or `installDurableDocumentReload` adopts the local-only identity while the open store retains its attachment map |
| `RemoveLocalSlot` / `QueueLocalRemoval` | `applyStoredAttachmentRemoval` queues the key in the removal transaction; `installCommittedAttachmentRemoval` schedules `runDocumentOrphanMaintenance` without deleting bytes |
| `ColdReload` | `installPersistedAttachments` maps slots to copies from held rows only, so a reset slot's copy is known only through its pending upload |
| `ColdRemove` / `ResolvePendingRemoval` | `persistRemovedAttachment` resolves the removed slot's key from `pendingAttachments` when no held copy is mapped |
| `Restart` / `RemovalIsDurable` | `recoverDroppedAttachmentSlots` restores a slot that still has a pending upload, so a removal must delete that upload |
| `DropPending` / `QueueDroppedPending` | `deletePendingAttachment` queues the dropped upload's copy in the same transaction |
| `UnheldCopyQueued` | Every last-reference removal queues the copy for `reclaimQueuedBlobs` |
| `BeginReclaim` / `CheckReferences` | `reclaimQueuedBlobs` calls `isDocumentBlobStorageKeyReferenced`, and `acknowledgeDocumentOrphanBlobReclaim` keeps a copy some row still holds |
| `FinishReclaim` / `LockReclaim` | `runSerializedDocumentBlobMutation` holds the copy's lock from the reference check through `deleteBytes` |
| `HeldCopyPresent` | `hydrateDocumentAttachmentBlobs` skips a slot while `localStorageKeyBySlotId` names its copy |

The bounds are two slots in one organization and one shared copy, with durable
held/pending references and the open stores' identity/copy views. Reset converts
the organization's references atomically; individual stores can adopt their new
identity later. A store opened after reset sees a reset slot only through its
pending upload; removing that slot, or dropping an unavailable upload, must still
queue the copy. Four negative controls fail
`HeldCopyPresent`:

- deleting with a direct `deleteBytes`, without the reference check;
- a reclaim whose check and delete are not serialized with hydration, so a slot
  re-hydrated in between loses its bytes;
- direct byte deletion after removing a local-only slot whose shared copy
  became a pending upload during reset;
- a reclaim that checks held rows but ignores pending upload references.

Two more fail the reset lifecycle: a cold-store removal that cannot resolve a
pending-only slot's key violates `RemovalIsDurable` when startup recovery
restores it, and dropping a pending upload without queueing violates
`UnheldCopyQueued`.

`sharedAttachmentColdReset.test.ts` removes the reset slots from stores opened
after the reset, restarts without recovering the removed slot, drops pending
uploads and rolls back a staged key, all against SQLite and a byte store.
`sharedAttachmentReset.test.ts` exercises real store initialization, organization
reset, ordinary editing and slot removal against SQLite and a byte store. It
keeps the other document's pending source, then reclaims after its final reference
is removed. The no-reset smoke check preserves the other synced copy. The reset
safety assertion fails if removal deletes the bytes directly. These are runtime
regressions, not an automated implementation-to-model trace projection.

`UnheldCopyReclaimed` checks that a copy nobody holds is eventually deleted,
under weak fairness of the reclaim steps. The model abstracts the byte
content, which is identical for every slot because the key names the blob, and
the reclaim's retry schedule. Slot removal and queueing are atomic, including
`deleteLocalAttachment` and `deletePendingAttachment`. Failed byte deletion and
retry scheduling are covered by runtime reclaim tests.
