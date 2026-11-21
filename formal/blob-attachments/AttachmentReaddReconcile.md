# Attachment re-add reconciliation

[`AttachmentReaddReconcile.tla`](./AttachmentReaddReconcile.tla) models a slot
this device removed from a synced document while its detach marker is still
pending, and the slot coming back. Another device re-adds it with the same
bytes or with other bytes: it binds its own blob first and sends the content
update that records the slot afterwards, so its binding can be listed here
before committed history has the slot. A concurrent merge can also record the
slot again with no new binding, and a pane can stage a re-add whose commit
fails and rolls back. The detach pass checks, dispatches, and settles in
separate steps, so the slot can come back between any two of them.

| Model action or predicate | Production seam |
| --- | --- |
| `Settle` / `RowAfter` | `transitionAttachmentRemovalMarker` and `attachmentMarkerRowEffect`, applied by `planAttachmentRemovalMarkerSettlement` |
| `From` / `OwnBindingOnly` | `observeMarkerBinding` owns only the listed binding of the marker's own blob |
| `View` / `SettleOnCommitted` | `settleAttachmentRemovalMarker` reads committed document history in the same immediate transaction as the row write, never a live document |
| `ReaddBind` / `ReaddCommit` | another device's upload lane binds its blob, then its content update reaches this database through `persistDocumentState` |
| `Resurrect` | a merged update through `persistDocumentState` that records the slot again |
| `Stage` / `Rollback` | a pane's staged attach or replace whose `commitDocumentMutation` fails |
| `Check` | `syncDetachedAttachmentBindings` lists bindings fresh and settles each marker before any detach |
| `Land` | `syncDetachedAttachmentBinding` sends a signed detach naming the listed binding; the server refuses an inactive one |
| `SettleAfter` / `RecheckAfterDetach` | `settleDetachedAttachmentMarker` settles again once the detach lands |
| `Upload` | the upload lane binds the held bytes the `rebinding` settle requeued |
| `Reclaim` | `reclaimDocumentOrphanBlobs` keeps bytes a held or pending row references |

The finite model bounds one slot, its marker copy, one other device's re-add,
and one merge. It abstracts the pane's live document: every pane lists a
marker for a slot its document lacks, and the catch-up reload that stops a
re-added slot from being listed again, and lets the upload lane see a rebound
one, is the step between `SettleAfter` and `Upload`. It does not model a
second removal of a re-added slot, which starts a fresh marker, or the startup
settle, which runs the same transition from `awaitingDetach` as `Check`.

`ReaddedSameStaysBound` allows one benign outcome. When another device binds
and commits a same-bytes re-add in the instant between this device's detach
landing and its recheck, the recheck, which follows its own detach without
listing again, requeues this device's identical copy, and its upload replaces
the other binding. The slot keeps the same bytes and a binding; the other
device downloads the copy again.

Liveness assumes the pass, the detach, the upload, the reclaim, and another
device's content update eventually run; it does not promise progress while
permanently offline. Negative controls detach whatever binding is active, skip
the recheck after the detach, and settle on a live document that holds a
staged re-add. The two-pane SQLite regressions in
[`attachmentReaddDetach.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/sync/attachmentReaddDetach.test.ts)
re-add the slot during the binding list (same copy and other bytes, with the
restoring pane open and reopened), bind another device's re-add before its
content update, re-add during the detach, and stage a replace that rolls back.
