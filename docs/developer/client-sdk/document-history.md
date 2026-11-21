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
  have been made after it was stored.
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
document has no remote record, no updates, or a rotation baseline as its first
update.

The Continuity seed importer uses it before resuming uploads into a document an
earlier run created. The current fingerprint cannot show when it was written:
any writer can copy it into a later edit. The order is the server's commit
order, which this device trusts as it does for every sync page.

## Trust limits

The limits are those of the history itself.

- Times are
  [self-reported](../../document-rekey-and-audit-history.md#change-times) by
  each writing device. A stop's upload time bounds its time from above, for a
  change that has been uploaded; nothing bounds it from below.
- History that reached this device through a rotation baseline is what that
  baseline's writer
  [asserted](../../document-rekey-and-audit-history.md#declared-coverage-is-trusted-not-verified).
- Attachment bytes that were later detached are
  [not retained](../../attachment-retention.md): a view lists the attachment a
  version referenced, not necessarily bytes this device still has.
- Folder placement, sharing, and access changes are not part of a document's
  Loro history and are not replayed.
