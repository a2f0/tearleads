# Attachment re-add reconciliation

[`AttachmentReaddReconcile.tla`](./AttachmentReaddReconcile.tla) models a slot
this device removed from a synced document while its detach marker is still
pending, and another pane on the same database, or a pull from another device,
committing the slot again: with the same copy, or with other bytes that carry
their own binding. A pane can also stage a re-add whose commit fails and rolls
back. The detach pass checks, dispatches, and settles in separate steps, so a
re-add can land between any two of them.

| Model action or predicate | Production seam |
| --- | --- |
| `Settle` / `RowAfter` | `transitionAttachmentRemovalMarker` and `attachmentMarkerRowEffect`, applied by `planAttachmentRemovalMarkerSettlement` |
| `View` / `SettleOnCommitted` | `settleAttachmentRemovalMarker` reads committed document history in the same immediate transaction as the row write, never a live document |
| `ReaddSame` / `ReaddOther` | another pane's `commitDocumentMutation`, or a pulled update's `persistDocumentState`, recording the slot again |
| `Stage` / `Rollback` | a pane's staged attach or replace whose `commitDocumentMutation` fails |
| `Check` / `CheckBeforeDetach` | `syncDetachedAttachmentBindings` lists bindings fresh and settles each marker before any detach |
| `Land` | `syncDetachedAttachmentBinding` sends a signed detach naming the listed binding; the server refuses an inactive one |
| `SettleAfter` / `RecheckAfterDetach` | `settleDetachedAttachmentMarker` settles again once the detach lands |
| `Upload` | the upload lane binds the held bytes the `rebinding` settle requeued |
| `Reclaim` | `reclaimDocumentOrphanBlobs` keeps bytes a held or pending row references |

The finite model bounds one slot, its marker copy, and one other copy. It
abstracts the pane's live document: every pane lists a marker for a slot its
document lacks, and the catch-up reload that lets the upload lane see a rebound
slot is the step between `SettleAfter` and `Upload`. It does not model a second
removal of a re-added slot, which starts a fresh marker, or the startup settle,
which runs the same transition from `awaitingDetach` as `Check`.

Liveness assumes the pass, the detach, the upload, and the reclaim eventually
run; it does not promise progress while permanently offline. Negative controls
skip the settle before the detach, skip the recheck after it, and settle on a
live document that holds a staged re-add. The two-pane SQLite regressions in
[`attachmentReaddDetach.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/sync/attachmentReaddDetach.test.ts)
re-add the slot during the binding list (same copy and other bytes, with the
restoring pane open and reopened), during the detach, and as a staged replace
that rolls back.
