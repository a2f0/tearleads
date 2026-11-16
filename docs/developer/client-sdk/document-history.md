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
  segments.
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
- Leading rows with unchanged ids are patched cell by cell. From the first row
  that differs in identity, or needs a cell cleared, the remaining rows are
  removed and added again under their own ids, in the restored order.
- The document kind is not changed.

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

## Trust limits

The limits are those of the history itself.

- Times are
  [self-reported](../../document-rekey-and-audit-history.md#change-times) by
  each writing device.
- History that reached this device through a rotation baseline is what that
  baseline's writer
  [asserted](../../document-rekey-and-audit-history.md#declared-coverage-is-trusted-not-verified).
- Attachment bytes that were later detached are
  [not retained](../../attachment-retention.md): a view lists the attachment a
  version referenced, not necessarily bytes this device still has.
- Folder placement, sharing, and access changes are not part of a document's
  Loro history and are not replayed.
