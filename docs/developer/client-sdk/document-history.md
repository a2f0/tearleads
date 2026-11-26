# Document history

`documents.openHistory(localId)` resolves to a `DocumentHistory`: a read-only
replay of the document's durable local history, or `null` while the database is
not ready or the document has no history yet. Every device holds a document's
complete operation log, so this needs no network. Hosts that hold a workflow
runtime can call the documents facade's `openDocumentHistory` directly.

## Reading a replay

- `stops` lists every change, oldest first. Each `DocumentHistoryStop` names
  the Loro `peerId` and counter range that made it and `committedAt`, the Unix
  milliseconds the writing device recorded (`null` when it recorded none).
  Resolve a stop's writer by matching `peerId` and its counters against the
  [edit-attribution](../../document-rekey-and-audit-history.md#signed-write-headers)
  segments. The per-upload ranges (`loadDocumentAttributionRanges`) also carry
  `createdAt`, when the server stored each upload: the range that covers a
  stop's `startCounter` bounds `committedAt` from above, since a change cannot
  have been made after it was stored. A stop that only a void update's range
  would cover has none, and so no such bound (see
  [edit attribution](../../advisory-op-spans.md#edit-attribution)).
- `viewAt(index)` returns the document after `stops[0..index]` as a
  `DocumentHistoryView`: the content fields of a `DocumentSnapshot` (`text`,
  `structuredFields`, `rows`, `attachments`, `documentKind`, `title`,
  `fieldValidationIssues`). `-1` is the empty document before the first change.
- `changeAt(index)` returns a `DocumentHistoryChange`: what that stop changed
  against the one before it. Text is reported as the single region that
  differs, in UTF-16 units; fields, row cells, and attachment slots are listed
  by key. `isEmptyDocumentHistoryChange` tells a step with no visible effect.
- `versionAt(index)` returns the `DocumentHistoryVersion` that heads the stop.
- `close()` releases the replay's WASM document. Always call it.

## Restoring a version

`DocumentStore.restoreContent(content, options?)` writes a past version's
`text`, `structuredFields`, and `rows` back into the live document. Pass a
`DocumentHistoryView`, or any `DocumentRestoreContent`. It resolves `true` when
the document durably holds that content, including when it already matched, and
`false` when the restore was refused or did not persist.

- Nothing is rewound. The restore is one ordinary local write made of new
  operations, so it syncs, merges with concurrent edits, and appears in the
  history as its own stop. The version it replaced stays there to go back to.
- It passes the same admission as any other edit: the document must be ready
  and writable, and `options.stillCurrent` is checked at
  [queue execution](./public-api.md#host-controlled-mutation-admission).
- Attachments are left as they are. A detached attachment's bytes are not
  retained, so its reference is never restored.
- It is always its own stop, even in the same second as the edit before it:
  the restore closes the changes before it and commits under a message of its
  own, so the change merge interval never folds it into the version it
  replaced.
- Rows are restored so that concurrent restores merge safely. A row that still
  exists is patched cell by cell under its own id, a row the version did not
  have is removed, and a row the document no longer has comes back as a new
  row with a new id, at the end. Two devices restoring the same version at
  once each add their own copy rather than two rows sharing an id. Row order
  is not restored, because a row cannot be moved.
- The document kind is not changed.

## Copying a version

A copy needs no call of its own. Open a new document with a
`DocumentHistoryView` as its birth: `documents.open` (or a container's
`openDocument`) with a fresh `localId`, the view's `documentKind` as
`initialDocumentKind`, its `text` as `initialText`, its `structuredFields` as
`initialStructuredFields`, and each row's `fields` as `initialRows`. Leave
fields and rows out for a note: a store refuses to open one with fields, and
would write its rows without saying so.

- The new document shares nothing with the one it was copied from: no
  history, no identity, and no row ids. Its rows keep the version's order.
- Attachments are not carried over. A view lists the attachments a version
  referenced, not bytes this device still has.
- The host decides where a copy may go. The SDK applies document creation's
  own checks, not the host's folder rules.
- The host also decides which fields a copy carries. A field that names an
  attachment slot, or that a host uses to find one particular document, does
  not belong in a second document.

## What a replay is

The replay is a capture of what was durable when it was opened. It is loaded
into a scratch document, so the open document store keeps editing and syncing;
open another replay to see later edits.

Stops play by recorded time, then Lamport time, then peer, and a change never
plays before one it depends on. Every `viewAt` is therefore a version the
document really had, even when a clock was wrong. A writer's consecutive
commits share one stop only within the
[change merge interval](../../document-rekey-and-audit-history.md#change-times).

Replaying a distant stop of a large document can take tens of milliseconds:
call `viewAt` outside rendering.

## Founding update

`documents.readFoundingUpdate(localId)` resolves to a `DocumentFoundingUpdate`:
the first update the server committed for a synced document, replayed alone.
A seeded create commits its update in the create transaction, so this is the
content the document was created with, and no later edit changes it.

- `content` is a `DocumentHistoryView` of that update alone.
- `seedTag` is the seed fingerprint the update wrote, if any.
- `writerUserId` is the signer of the update, verified like any pulled write
  header.

It needs the network: it pulls the first raw-history page from a null version,
verifies it like any sync page, and replays only the first update in a scratch
document. It persists nothing and leaves open stores untouched. It resolves to
`null` while the database is not ready or the device is offline, and when the
document has no remote record, no updates, or a rotation baseline segment as
its first update.

The Continuity seed importer uses it before resuming uploads into a document an
earlier run created. The current fingerprint cannot show when it was written:
any writer can copy it into a later edit. The order is the server's commit
order, which this device trusts as it does for every sync page.

## Verifying history

`documents.verifyHistory(localId, options?)` checks the document's durable
local history against the signed updates the server retains. It resolves to a
`DocumentHistoryVerification`, or to `null` while the database is not ready.
Hosts that hold a workflow runtime can call the documents facade's
`verifyDocumentHistory` directly.

It needs the network. It pulls the document's whole
[raw history](../../raw-document-history-recovery.md#read-only-consumers) from
a null version, a page at a time. For every update it checks what a sync pass
checks: the ciphertext and metadata hashes the write header signed, the
header's signature, that its signer was authorized, and the content key's
commitment. It judges each page in server order, rebuilds the accepted
updates in a scratch document, and compares the rebuild with the local
history.

| `status` | Meaning |
| --- | --- |
| `verified` | Every operation both histories hold is the same operation, with the same commit time, in both. |
| `mismatch` | Some operation both hold differs. `signed` is a `DocumentHistory` over the rebuild, to show in place of the local replay. The caller must `close()` it. |
| `unavailable` | No verdict was reached, for `reason`. |

The comparison covers the operations both histories hold. An edit this device
has not sent is outside it. So is an update the device has not pulled, which
`serverAhead` reports.

`verified` and `mismatch` also carry:

- `localVersion`: the version of the durable history that was compared, as
  `versionAt` reports one, with its entries in no set order. A replay ends at
  this version only if it was opened from the same durable history, so
  compare it with `versionAt(stops.length - 1)` before applying a result to
  an open replay.
- `ranges`: `DocumentHistoryVerifiedRange` items, in the shape of
  [edit-attribution](../../advisory-op-spans.md#edit-attribution) ranges but
  built on this device from verified write headers. Each credits a run of one
  peer's counters to the first accepted update that carried it.
  `authorityKind` is `direct` when that update was an ordinary signed upload,
  and `baseline` when only a rotation baseline carried the operations. An
  operation no range covers is not in the server's history: this device has
  not sent it, or the server no longer serves it. The result does not say
  which.
- `serverAhead`: the server's history holds operations the local one does
  not.
- `voidUpdateCount`: served updates left out of the rebuild as
  [void](../../glossary/content.md#void-update).

| `reason` | Cause |
| --- | --- |
| `offline` | The device is offline, or has no keys or signed-in author. |
| `not_synced` | The document has no remote record, or the server holds no update of it. |
| `epoch_key_unreachable` | An older content key cannot be reached from this device. The result carries `contentKeyEpoch` and the `DocumentRawHistoryUnavailableError`. |
| `rejected` | A served page failed a signature or integrity check or served a rotation baseline that breaks its [group rules](../../document-link-and-sync-protocol.md#reader-checks), or the server repeated a page cursor. |
| `unsettled` | This device could not finish reading: a Loro runtime failure, an update the judge held behind one or deferred past its rebuild budget, or a document already reading suspect updates one a page. |
| `too_large` | The server holds more than 20,000 updates of the document ([limits](../../limits.md#loro-runtime)). |
| `interrupted` | `options.signal` aborted, the session's scope changed, or a request, or material a check needed, did not arrive. |

`options.signal` stops a verification between pages. `options.onProgress`
receives `updatesRead` and `updatesTotal` after each page. Every outcome
above is returned, never thrown; a failure that is none of them, such as a
database error, is thrown.

Verification reads beside the open document store, never through it. It
takes no sync lane and no write chain, so editing and sync go on while it
waits for the server. It records no void, attempt, cursor, or sync failure.
The only rows it writes are
[read-window](../../glossary/sync.md#loro-read-window) rows: its own, one a
page, each removed before the next page is requested. As with every window,
while one is open no other window of the same process counts a death. A
process that dies while verifying leaves one such row: it counts toward no
update and no rotation, and the document's next sync pass removes it.

A void this device recorded while importing is judged again from the raw
history, because the device may have reached it from a rotation baseline. A
void the payload alone decides, and one this device's runtime failed for
good, stay void.

It is on-demand work, not a background check:

- It makes one request for every 64 updates or 48 MiB of history, and
  downloads every rotation baseline ever committed. Each is a group of update
  segments that carries the whole history again as of its rotation.
- The judging, the rebuild, and the final comparison run on the main thread,
  a page at a time.
- Memory holds the local history, the rebuild, and one page, beside the live
  document and any open replay.
- The judge keeps its 32 MiB rebuild budget for each page. A void whose
  import changed the scratch document costs a rebuild of the history so far,
  so past that size a page with such a void, and an update after it, ends
  `unsettled` every time.

## Trust limits

A replay shows this device's copy of the history. Until it is verified it is
unchecked: history that reached the device through a rotation baseline is
what that baseline's writer
[asserted](../../document-rekey-and-audit-history.md#declared-coverage-is-trusted-not-verified).

`verified` means this device's copy is, operation for operation and commit
time for commit time, what a fresh reader builds from the signed updates the
server serves, each authenticated on this device. A device that started from
a forged baseline gets `mismatch`, as long as the server still serves the
genuine updates and the device can reach their keys.

It does not mean any of these:

- That the server served everything. A server can leave updates out. One
  this device holds then has no range, the same as an edit it has not sent;
  one it never held is not missed at all.
- That operations only a rotation baseline carried are genuine. Their range
  says `baseline`: they are what the baseline's signer asserted.
- That a time is true. Change times and `signedAt` are
  [self-reported](../../document-rekey-and-audit-history.md#change-times) by
  the writing device, and `createdAt` is the server's own, unsigned. A stop's
  upload time bounds its time from above, for a change that has been
  uploaded; nothing bounds it from below.
- Who typed a change. A range names the member whose device signed the
  upload, and an upload can carry another member's operations.
- That each peer's operations came from its owner. Only the server enforces
  [peer ownership](../../advisory-op-spans.md#peer-ownership).
- That another reader leaves out the same updates. A void is this reader's
  own judgement, under its Loro decoder.

Two limits are the history's own, verified or not:

- Attachment bytes that were later detached are
  [not retained](../../attachment-retention.md): a view lists the attachment a
  version referenced, not necessarily bytes this device still has.
- Folder placement, sharing, and access changes are not part of a document's
  Loro history and are not replayed.
