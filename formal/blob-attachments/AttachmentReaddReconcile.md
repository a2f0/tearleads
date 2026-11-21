# Attachment re-add reconciliation

[`AttachmentReaddReconcile.tla`](./AttachmentReaddReconcile.tla) models a slot
this device removed from a synced document while its detach marker is still
pending, and the slot coming back. The marker's copy is bound, or never bound
because it replaced a bound copy offline; the slot's binding is then that
earlier copy's, as it is when the removal overtook a download of another
device's replacement. Another device re-adds the slot with the same bytes or
with other bytes: it binds first and pushes the content update that records
the slot in the same sync pass, so its binding can be listed here before
committed history has the slot. A pane on this database, or a pulled merge,
can record the slot again with no new binding, and a pane can stage a re-add
whose commit fails and rolls back. The detach pass checks, dispatches, and
settles in separate steps, after a pull or after a clean pass that skipped
it, and a restart can stop it between any two of them.

| Model action or predicate | Production seam |
| --- | --- |
| `Settle` / `RowAfter` | `transitionAttachmentRemovalMarker` and `attachmentMarkerRowEffect`, applied by `planAttachmentRemovalMarkerSettlement` |
| `From` / `OwnBindingOnly` / `DetachSighted` | `observeMarkerBinding`: the marker's own blob, or a binding `readReplacedBindingSightings` holds from before a completed pull |
| `View` / `SettleOnCommitted` | `settleAttachmentRemovalMarker` reads committed document history in the same immediate transaction as the row write, never a live document |
| `ReaddBind` / `ReaddPush` / `Pull` | another device's upload lane binds, then `syncDocumentState` pushes; this device's `syncDocumentState` pulls and counts it with `noteDocumentPullCompleted` |
| `Resurrect` | another pane's `commitDocumentMutation`, or a pulled update's `persistDocumentState`, recording the slot again |
| `Stage` / `Rollback` | a pane's staged attach or replace whose `commitDocumentMutation` fails |
| `Check` | `syncDetachedAttachmentBindings` lists bindings fresh and settles each marker before any detach |
| `Land` | `syncDetachedAttachmentBinding` sends a signed detach naming the listed binding; the server refuses an inactive one |
| `SettleAfter` / `RecheckAfterDetach` | `settleDetachedAttachmentMarker` settles again once the detach lands |
| `Restart` / `RestartRebinds` | `healLocalAttachmentDetachState` settles each marker at startup, before any binding list |
| `Upload` | the upload lane binds the held bytes the `rebinding` settle requeued |
| `Reclaim` | `reclaimDocumentOrphanBlobs` keeps bytes a held or pending row references |

The finite model bounds one slot, its marker copy, one other device's re-add,
one merge, and one restart. It abstracts the pane's live document: every pane
lists a marker for a slot its document lacks or a detached row its document
records, and the catch-up reload that lets the upload lane see a rebound slot
is the step between `SettleAfter` and `Upload`. It does not model a second
removal of a re-added slot, which starts a fresh marker.

Two windows remain outside it. `Pull` brings a re-add's content update once
its bind is listed, since the other device pushes it in the same sync pass; a
device lost between its bind and that push, for longer than one of this
device's passes, has its binding detached. And a merge of a concurrent edit
that records the slot again, pulled only after the detach landed and the
recheck dropped the copy, leaves the slot with no binding until a device that
holds the bytes binds them; the pass before this change detached and dropped
the same way.

`ReaddedSameStaysBound` allows one benign outcome. When another device binds
and pushes a same-bytes re-add between this device's detach landing and its
recheck, or before a restart that cannot tell whether a detach landed, this
device requeues its identical copy, and its upload replaces the other
binding. The slot keeps the same bytes and a binding; the other device
downloads the copy again.

Liveness assumes the pass, the push, the pull, the detach, the upload, and
the reclaim eventually run; it does not promise progress while permanently
offline. Negative controls detach whatever binding is active, never detach a
binding sighted before a pull, revive a copy at startup, skip the recheck
after the detach, and settle on a live document that holds a staged re-add.
The two-pane SQLite regressions in
[`attachmentReaddDetach.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/sync/attachmentReaddDetach.test.ts)
re-add the slot during the binding list (same copy and other bytes, with the
restoring pane open and reopened), bind another device's re-add before its
content update, detach a replaced or overtaken binding after a pull, restart
after a landed detach, realign a detached row the live document records,
re-add during the detach, and stage a replace that rolls back.
