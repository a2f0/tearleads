# Attachment bind document version

[`AttachmentBindDocumentVersion.tla`](./AttachmentBindDocumentVersion.tla)
models an upload into a slot that another device keeps editing. The uploader
checks that the signed document content still asks for its bytes, then binds.
The server cannot read that content, so the bind carries the document version
the check read, and the API refuses it while the document holds a committed
update that version lacks. The bind also carries the uploader's processed
cursor, and the API weighs only updates committed after it, so an update
whose declared span no client can ever hold (an overclaim every reader voids)
stops refusing binds once the uploader has judged it.

| Model action or predicate | Production seam |
| --- | --- |
| `Check` | `verifiedDocumentVersion` pulls, re-checks the slot, and returns the checked version, or abandons the bind |
| `Check` | `resolveAttachmentSourceUpload` encodes the version in the same step as a store pass's last slot check |
| `Bind` | `verifyAndLockBindSlot` verifies the signed bind and keeps the existing binding-generation precondition |
| `Bind` | `assertAttachmentDocumentVersionCurrent` then runs `hasDocumentOpsBeyondVersion`, still under the document head lock `lockAttachmentAuthorizationForShare` took |
| `Uncovered` | `hasDocumentOpsBeyondVersion` weighs only spans committed after `readProcessedThroughSequence` resolves the bind's `processedThroughUpdateId` |
| `SentCursor` | `bindAtVerifiedDocumentVersion` sends the cursor `readProcessedCursorForVersion` returns for each version it binds at: one whose recorded version that version covers (`readProcessedCursorCoveredBy`) |
| `BackgroundPull` | `recordDocumentSyncVerdicts` advances the cursor when a sync pass's pull completes |
| `Overclaim` | `appendDocumentUpdates` stores the declared span of an update a reader then voids (`validateDocumentSyncUpdateImports`) |
| `Bind` (refused) | `classifyBindRefusal` reads `attachment_document_changed` from the request the bind just sent |
| `Retry` / `RecheckOnRefresh` | `bindAtVerifiedDocumentVersion` asks for a re-checked version after a refusal |
| `Retry` / `PullOnRefusal` | `pendingAttachmentDocumentVersion` pulls in the same store pass through `pullRemoteDocumentForAttachments` before its re-check |
| `Retry` / `PullOnRefusal` | `recordDocumentChangedRefusal` re-arms a store pass when an upload call used up its re-checks |
| `Retry` / `PullOnRefusal` | `bindAtVerifiedDocumentVersion` ends in one closed `DocumentVersionBindEnd` (bound, abandoned, document changed, or failed); only an abandoned or document-changed end re-arms, so a later bind that fails otherwise is reported |
| `Remove` / `Restore` / `Replace` / `Unrelated` | `appendDocumentUpdates` commits another device's update under `lockSyncDocumentWriteFrontier` |
| `OtherBind` | `bindBlobAttachment` commits the replacing device's own bytes |

The finite model bounds one slot, one uploader, and `MaxEdits` foreign edits.
A committed document version is the number of edits; the uploader's version
covers a prefix of them. `boundSlot` is a ghost recording what the committed
document asked for when the binding committed.

`FixtureBindingWasRequested` holds whenever an edit commits before the bind:
the bind's check runs under the document head lock that every update write
takes first, so the check and the insert are one step. An edit that commits
after the bind is never refused for it, and can remove the slot. Detaching
that binding is reconciliation by a device that sees both, which
[AttachmentRemovedSlotDetach](./AttachmentRemovedSlotDetach.md) models.
`OtherBytesKept` shows that the uploader never replaces bytes
another device bound into the slot, through the existing
`expectedBindingId` precondition.

`UploadSettles` puts fairness only on the uploader's own pulls and binds,
following the [no-brick](../container-keying/NoBrickedDevice.md) standard: the
other device may stop writing at any point. Because every refusal consumes a
foreign edit committed inside one pull-then-bind window, the uploader binds or
abandons once edits stop. Production bounds the immediate retries: three
re-checks per upload call, each after a pull in the same pass, then three
re-armed store passes in a row, and then it waits for a later sync signal. The
model abstracts that bound as an unbounded series of the uploader's own steps.

The model counts committed updates, while the API compares the span each
update declares. The API stores those spans but cannot check them against the
ciphertext. An honest client declares the span of the ops it encrypted, and a
pull covers it. A dishonest writer can declare a span its payload does not
carry (`Overclaim`): every reader voids that update
([VoidUpdateProgress](../document-sync/VoidUpdateProgress.md)), so no
client's version ever covers it. Without the cursor the API would refuse
every later bind on the document, and `UploadSettles` fails
(`bind-ignores-cursor`). With it, the API skips every update at or before the
cursor the bind carries, because the uploader already imported or voided each
of them.

The cursor is safe to send only with a version that holds every update it
judged. The SDK reads it with the bind's version (`SentCursor`), so a cursor
recorded after the slot check, standing for updates that version lacks, is
not sent; sending it anyway binds a slot a skipped edit removed
(`bind-cursor-ahead-of-version`). An unknown cursor resolves to no cursor,
which only refuses more. The cursor protects the uploader's own race, not the
document: a writer can always bind at a current version, so a cursor it
claims falsely gains it nothing.

An update the Loro runtime fails on is held, not voided, for up to
`MAX_LORO_RUNTIME_ATTEMPTS` process lifetimes; the cursor stays before it, so
binds behind it are refused until it settles. That bound, not the cursor,
limits how long one crafted update can stall binds on a document.

The model also abstracts encryption, signatures, staging, and lost bind
responses ([PendingAttachmentDetach](./PendingAttachmentDetach.md) covers
those). It treats every foreign update as an edit, because the server compares
whole-document versions, so an unrelated edit refuses the bind as well.

Negative controls drop the server's version check, retry with a newer version
without re-checking the slot, retry at the stale version without pulling,
ignore the cursor, and send a cursor recorded after the slot check. The
first two and the last bind a removed slot, and the other two never settle.
The API regressions in
[`bindDocumentVersion.test.ts`](../../packages/api/src/services/blobs/bindDocumentVersion.test.ts)
and
[`bindDocumentVersionRace.pg.test.ts`](../../packages/api/src/services/blobs/bindDocumentVersionRace.pg.test.ts)
cover both interleavings and a bind queued behind an update's head lock, and
[`bindDocumentVersionVoidUpdate.test.ts`](../../packages/api/src/services/blobs/bindDocumentVersionVoidUpdate.test.ts)
refuses a bind and a detach behind an overclaim without a cursor or with one
the document does not hold, still refuses an honest edit committed after the
cursor, and accepts both once the cursor passes the overclaim. The
[`falseSpanAttachment`](../../packages/bob-and-alice/src/scenarios/falseSpanAttachment.test.ts)
scenario has a real reader void a real false-span update and then bind an
attachment to the document. The
CLI importer regression in
[`seedAttachmentRace.e2e.test.ts`](../../packages/cli/src/seedAttachmentRace.e2e.test.ts)
removes, restores, and renames the slot while the importer's bind is in
flight, and
[`seedBusyDocument.e2e.test.ts`](../../packages/cli/src/seedBusyDocument.e2e.test.ts)
lands an unrelated edit there, which the import pulls past and binds. The
document store regressions in
[`attachmentDocumentChanged.integration.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/attachmentUpload/attachmentDocumentChanged.integration.test.ts)
bind in the pass that was refused, keep binding while refusals outlast one
upload call, stop once a server that keeps refusing uses up the budget, and
give a reloaded upload its full budget when the store tears down mid-pull.
[`attachmentPeerEdit.integration.test.ts`](../../packages/client-sdk/src/stores/documents/documentStore/attachmentUpload/attachmentPeerEdit.integration.test.ts)
pulls a second device's real update inside the bind window: a removal of the
slot being replaced sends no second bind and drops the upload, and an
unrelated edit retries at a version that covers the peer's ops.
