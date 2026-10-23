# Pending attachment detach

[`PendingAttachmentDetach.tla`](./PendingAttachmentDetach.tla) models a bind
that commits before its response reaches the client or local settlement
finishes. Removing the slot must preserve a detached row and expose it to the
current store's detach pass, as well as after a restart.

| Model action or predicate | Production seam |
| --- | --- |
| `UploadCommitted` | `bindBlobAttachment` may commit a binding before its response arrives |
| `Settle` | `persistSettledAttachment` replaces the pending upload with a held row |
| `Remove` / `KeepPendingMarker` | `applyStoredAttachmentRemoval` preserves the pending upload identity in a detached projection row |
| `Remove` / `InstallPendingMarker` | `installCommittedAttachmentRemoval` installs the key into the open store's attachment map |
| `Crash` / `Reload` | `installPersistedAttachments` rebuilds the attachment map from durable rows |
| `Detach` | `syncDetachedAttachmentBindings` lists bindings and invokes `detachDocumentAttachment` for an active binding |
| `Drop` | `deleteLocalAttachmentRecord` drops the marker after detach or an empty remote listing |
| `Reclaim` | `reclaimDocumentOrphanBlobs` retains bytes while a pending or projection row references them |

The finite model bounds one slot and one copy with a persisted upload identity.
It explores removal both before and after a remote commit, ordinary settlement,
and restarts between steps. It abstracts signatures, shared-copy locking,
network failures as stuttering, and document identity changes; the latter are
covered by the generation and persistence CAS tests. It bounds removal
after a bind attempt has finished or the process has exited;
an outstanding network request committing across removal is outside this model.
The separate SharedCopyReclaim model covers references from other slots.

Liveness assumes eventual successful sync: reload is weakly fair and detach
is strongly fair across repeated crashes. It does not promise progress while
permanently offline. Negative controls independently omit the durable marker
and the open-store map update. The SQLite regression in
`pendingAttachmentDetach.test.ts` retains the marker and bytes across a failed
listing, sends a signed detach for a committed binding, and cleans up after an
absent binding. Both paths run with and without restarting the store.
