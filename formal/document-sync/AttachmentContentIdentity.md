# Attachment content identity

[`AttachmentContentIdentity.tla`](./AttachmentContentIdentity.tla) models finding
10 of issue #2266. A valid old blob binding must not replace the attachment bytes
selected by the current authenticated document.

| Model action or predicate | Production seam |
| --- | --- |
| `BeginHydration` / `CheckContentDigest` | `hydrateDocumentAttachmentBlobs` compares `attachmentContentSha256` with the document attachment intent |
| `AdvanceView` | `addDocumentAttachments` records the content digest inside encrypted Loro content |
| `CheckLiveIntent` | `commitHydratedAttachment` rechecks the current document before the guarded commit |
| `CompareStoredCopy` | `saveHydratedAttachment` compares the durable slot inside a SQLite transaction |
| `CommitHydration` | `guardedTransaction` checks the synchronous guard before dispatching commit |
| `OtherFacadeInstalls` | `saveLocalAttachment` can install a competing copy while hydration is in flight |

The bounds contain two content identities, one slot, and a delayed hydration.
The model checks both current-view intent and preservation of a newer durable
copy installed by another facade. Each guard has a registered negative control.
It abstracts authenticated document history, signature verification, collision
resistance, encryption, and storage keys unique to each replacement. Different
bindings carrying identical plaintext represent the same content identity.
Missing or mismatching bytes are availability failures: a document update can
arrive before its attachment upload. The model proves safety, not eventual
availability, network ordering, or garbage collection.
