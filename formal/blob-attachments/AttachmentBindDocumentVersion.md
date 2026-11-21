# Attachment bind document version

[`AttachmentBindDocumentVersion.tla`](./AttachmentBindDocumentVersion.tla)
models an upload into a slot that another device keeps editing. The uploader
checks that the signed document content still asks for its bytes, then binds.
The server cannot read that content, so the bind carries the document version
the check read, and the API refuses it while the document holds a committed
update that version lacks.

| Model action or predicate | Production seam |
| --- | --- |
| `Check` | `verifiedDocumentVersion` pulls, re-checks the slot, and returns the checked version, or abandons the bind |
| `Check` | `resolveAttachmentSourceUpload` encodes the version in the same step as a store pass's last slot check |
| `Bind` | `verifyAndLockBindSlot` verifies the signed bind and keeps the existing binding-generation precondition |
| `Bind` | `assertBindDocumentVersionCurrent` then runs `hasDocumentOpsBeyondVersion`, still under the document head lock `lockAttachmentAuthorizationForShare` took |
| `Bind` (refused) | `classifyBindRefusal` reads `attachment_document_changed` from the request the bind just sent |
| `Retry` / `RecheckOnRefresh` | `bindAtVerifiedDocumentVersion` asks for a re-checked version after a refusal |
| `Retry` / `PullOnRefusal` | `recordDocumentChangedRefusal` re-arms a store pass, which pulls before its next check |
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
that binding is reconciliation by a device that sees both, which this model
does not cover. `OtherBytesKept` shows that the uploader never replaces bytes
another device bound into the slot, through the existing
`expectedBindingId` precondition.

`UploadSettles` puts fairness only on the uploader's own pulls and binds,
following the [no-brick](../container-keying/NoBrickedDevice.md) standard: the
other device may stop writing at any point. Because every refusal consumes a
foreign edit committed inside one pull-then-bind window, the uploader binds or
abandons once edits stop. Production bounds the immediate retries, three
re-checks per upload call and three re-armed store passes, and then waits for
a later sync signal. The model abstracts that bound as an unbounded series of
the uploader's own steps.

The model also abstracts encryption, signatures, staging, and lost bind
responses ([PendingAttachmentDetach](./PendingAttachmentDetach.md) covers
those). It treats every foreign update as an edit, because the server compares
whole-document versions, so an unrelated edit refuses the bind as well.

Negative controls drop the server's version check, retry with a newer version
without re-checking the slot, and retry at the stale version without pulling.
The first two bind a removed slot, and the third never settles. The API
regressions in
[`bindDocumentVersion.test.ts`](../../packages/api/src/services/blobs/bindDocumentVersion.test.ts)
and
[`bindDocumentVersionRace.pg.test.ts`](../../packages/api/src/services/blobs/bindDocumentVersionRace.pg.test.ts)
cover both interleavings and a bind queued behind an update's head lock. The
CLI importer regression in
[`seedAttachmentRace.e2e.test.ts`](../../packages/cli/src/seedAttachmentRace.e2e.test.ts)
removes, restores, and renames the slot while the importer's bind is in
flight.
