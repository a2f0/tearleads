# Attachment removed-slot detach

[`AttachmentRemovedSlotDetach.tla`](./AttachmentRemovedSlotDetach.tla)
models a slot removed on one device before an importer's bind of it commits,
with the removal pushed after the bind. The bind is valid when it commits, so
[AttachmentBindDocumentVersion](./AttachmentBindDocumentVersion.md) does not
refuse it, and the remover never held the bytes, so it has no removal marker
([AttachmentReaddReconcile](./AttachmentReaddReconcile.md)). Any device that
saw the slot recorded and later reads it removed detaches the binding the
server still lists. The API accepts that detach only at a version that holds
every committed op and every op of the version the binding was bound at.

| Model action or predicate | Production seam |
| --- | --- |
| `ImporterBind` | `assertAttachmentDocumentVersionCurrent` checks the bind's version, and `storeVerifiedAttachmentBindingInTransaction` stores it with the binding as `bindDocumentVersion` |
| `Observe` | `observeRecordedAttachmentSlots` records each slot a published snapshot holds, so only a slot this client parsed can count as removed |
| `ObserveSynced` | `captureSyncedDocumentView` reads the live document only while `pendingBaseVersion` covers it and no local write is queued, before the pass lists pending updates; `canSyncDetachedAttachmentBindings` then requires none |
| `ObserveSynced` | `listRecordedAttachmentSlotIds` reads the view's slots from the content map's keys, so an entry this client cannot parse still counts as recorded |
| `ObserveSynced` | `listRemovedAttachmentSlots` names the seen slots the view lacks that the store neither holds nor uploads, and `listDocumentAttachments` lists their bindings |
| `Detach` | `detachRemovedSlotBindings` sends `detachAttachmentBinding` with the view's version |
| `Detach` | `assertAttachmentDocumentVersionCurrent` runs `hasDocumentOpsBeyondVersion` under the document head lock `lockAttachmentAuthorizationForShare` took |
| `SentCursor` | `readProcessedCursorForVersion` gives the detach the processed cursor whose recorded version the view's version covers, and `readProcessedThroughSequence` resolves it for `hasDocumentOpsBeyondVersion` |
| `Overclaim` / `Held` | `appendDocumentUpdates` stores the declared span of an update every reader voids (`validateDocumentSyncUpdateImports`), so no client version holds its ops |
| `Detach` | `assertDetachCoversBindVersion` runs `documentVersionCovers` against the binding's stored version |
| `Detach` (refused) | `isAttachmentDocumentChanged` reads the refusal, and `planRemovedSlotDetach` waits for a newer view before sending that binding's detach again |
| `Detach` (refused) | `isRemovedSlotDetachWaiting` keeps a waiting slot out of `listRemovedAttachmentSlots`, so a pass with no marker lists bindings again only once the view moves; a refused marker detach (`AttachmentDetachOutcome`) waits without holding up the markers after it |
| `Detach` | only a store that `canWriteDocument` lists removed slots: a reader leaves the binding to a writer |
| `Push` / `Restore` | `appendDocumentUpdates` commits each device's update under `lockSyncDocumentWriteFrontier` |
| `RestoreBind` | `bindBlobAttachment` commits the restoring device's own bytes before its content update |

The finite model treats a document version as a set of ops and the slot as
whatever the newest of a removal and two restores says. `ObserveSynced` reads
exactly the committed document, as a store pass does once nothing it made is
unsent. `ObserveUnsynced` is the remover reading its own unsent removal.
`detachedNamed` is a ghost recording a detach that committed while the
committed document still asked for the slot.

`DetachOnlyRemovedSlot` holds because the detach checks run under the
document head lock that every update write takes first. A detach whose
version lacks a committed op is refused, so a committed restore keeps the
binding it adopted. `RestoreKeepsBinding` holds because a restore with other
bytes binds at a version holding its own unsent re-add, and a detach must
cover that version: until the re-add commits and the detaching device reads
it, the binding stays. The API now enforces what the removal marker's
replaced-binding sighting
([AttachmentReaddReconcile](./AttachmentReaddReconcile.md)) waits for on the
client.

A dishonest writer may commit an update whose declared span names ops no
client holds (`Overclaim`). Every reader voids it, so no view ever covers it,
and a detach checked against every committed op would be refused forever.
The detach therefore carries the observer's processed cursor, recorded with
the view it read, and the API weighs only ops committed after it: the
observer imported or voided everything up to there. A cursor recorded after
the view would skip a restore the view lacks, so the client sends only the
cursor whose recorded version the view's version covers.

`RemovedSlotEventuallyUnbound` puts fairness only on the observing device's
own reads and detaches, following the
[no-brick](../container-keying/NoBrickedDevice.md) standard: the importer,
the remover, and a restoring device may stop at any point. It is
conditional on the importer's bind version being committed. An importer that
bound with an op it never pushes leaves a binding no device can detach; that
binding is harmless, and its bytes stay reachable only through it. Production
also asks for one pull after a refusal and then waits for a newer view, so a
binding the API keeps refusing costs one request per document version.

The model abstracts encryption, signatures, listing pages, and lost
responses. It leaves out the window
[AttachmentReaddReconcile](./AttachmentReaddReconcile.md) already names: a
content update that records the slot again with the same bytes and no bind of
its own, such as a merge or a restore of earlier content, committed after a
detach landed. Neither the server nor the detaching device can see it coming.
A device still holding the bytes under an open removal marker binds them
again once its listing shows the binding gone (the marker's `rebinding`
settle); otherwise the slot has no binding until a device that holds the
bytes binds them. Before this change every device that held the bytes
detached as soon as it read the removal, so the window is not new. What is
new is that a device that never held them detaches too, as #3134 asks: where
no device held the bytes, the binding used to stay, and with it the bytes
such a late re-record could still reach. The observation also lives in
memory, so a device that restarts between seeing
the slot and reading it removed does not detach; another device that saw both
still can.

Negative controls drop each API check and the client's synced-view rule,
stop devices that never held the bytes from detaching, ignore the cursor,
and send a cursor recorded after the view. Without the version check a
detach lands after a committed restore; without the bind-version cover it
removes a restore bound ahead of its content; detaching from a view holding
the remover's unsent removal unbinds a slot the committed document still
asks for; without the new path, or without the cursor once a writer
overclaims, the binding is never removed; and a cursor ahead of the view
skips a committed restore. The
API regressions in
[`detachDocumentVersion.test.ts`](../../packages/api/src/services/blobs/detachDocumentVersion.test.ts)
refuse a detach behind a committed edit and one that lacks the binding's
unsent op. The store regressions in
[`removedSlotDetach.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/sync/removedSlotDetach.test.ts)
detach a never-held slot's binding at the view's version, leave a slot the
client never parsed, wait after a refusal without listing again, and let a
held copy's waiting marker pass to the next;
[`syncedDocumentView.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/sync/syncedDocumentView.test.ts)
refuses to cite a document holding an edit not yet enqueued and keeps an
unparsed entry recorded. The CLI
regression
[`seedOfflineRemoval.e2e.test.ts`](../../packages/cli/src/seedOfflineRemoval.e2e.test.ts)
removes the slot offline, lets the importer bind, and ends with no binding,
while a concurrent restore with personal bytes keeps its own.
