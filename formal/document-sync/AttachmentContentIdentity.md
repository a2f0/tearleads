# Attachment content identity

[`AttachmentContentIdentity.tla`](./AttachmentContentIdentity.tla) models finding
10 of issue #2266. A valid old blob binding must not replace the attachment bytes
selected by the current authenticated document.

| Model action or predicate | Production seam |
| --- | --- |
| `BeginHydration` / `CheckContentDigest` | `hydrateDocumentAttachmentBlobs` compares `attachmentContentSha256` with the document attachment intent |
| `AdvanceView` | `addDocumentAttachments` records the content digest inside encrypted Loro content |
| `PersistView` | `saveDocument` advances the durable document frontier after local content changes |
| `CheckLiveIntent` | `commitHydratedAttachment` rechecks the current document before the guarded commit |
| `CompareStoredCopy` | `saveHydratedAttachment` compares the durable slot inside a SQLite transaction |
| `CheckStoredIntent` | `saveHydratedAttachment` checks the captured document `snapshotEndVersion` in the same transaction |
| `Cancel` / `RefreshRefusedCopy` / `RefusedCopyReloaded` | `refreshRefusedAttachmentSlot` reloads the durable winner after a refused compare-and-set |
| `StaleCopyCannotReplaceWinner` | `saveHydratedAttachment` rejects an outdated storage-key comparison even when document intent is unchanged |
| `CommitHydration` | `guardedTransaction` checks the synchronous guard before dispatching commit |
| `OtherFacadeInstalls` | `saveLocalAttachment` can install a competing copy while hydration is in flight |
| `OtherFacadeInstallsSameIntent` | `saveLocalAttachment` can install another copy of the same authenticated content |

The bounds contain two content identities, three storage copies, one slot, and
a delayed hydration. A refreshed slot cannot authorize a stale document view to
replace newer intent on its next attempt; the durable document frontier is
checked independently of the storage copy and the live in-memory intent.
The model checks both current-view intent and preservation of a newer durable
copy installed by another facade. Each guard has a registered negative control.
It abstracts authenticated document history, signature verification, collision
resistance, encryption, and storage keys unique to each replacement. Different
bindings carrying identical plaintext represent the same content identity.
Missing or mismatching bytes are availability failures: a document update can
arrive before its attachment upload. The model proves safety, not eventual
availability, network ordering, or garbage collection.

Pending upload rows persist the staging digest with the bytes and slot metadata.
`recoverDroppedAttachmentSlots` restores that local intent without reading the
byte file, including after the file becomes unavailable. This is the local
input boundary for the model; runtime crash-recovery tests cover the interrupted
write and unavailable-file cases.
