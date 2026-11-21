# Document history

Explorer's History view replays a document: a timeline of every change, and
the document as it was at the selected one. It is reached from the History
action beside Get Info, at
`/containers/<container>/documents/<document>/history`.

## How a past version is rendered

The document type renders the past version itself, so every type gets history
without type-specific code.

1. [`useDocumentHistory`](useDocumentHistory.ts) opens a capture of the
   document's durable history through `documents.openHistory` and drives
   [`documentHistoryMachine`](documentHistoryMachine.ts): the selected stop,
   the stop on screen, playback, and whether newer edits exist.
2. The host puts the stop's view in `DocumentHistoryViewContext`
   ([`historicalDocumentView`](historicalDocumentView.ts)) around the document
   type's app.
3. [`DocumentsProvider`](../documents/DocumentsProvider.tsx) still opens the
   live store, then serves its children a read-only store over that view
   ([`historicalDocumentStore`](historicalDocumentStore.ts)). The store is
   updated in place, so stepping re-renders the document instead of
   remounting it.

The live document is never rewound: it keeps editing and syncing underneath,
and a nested document under the past version sees its own live state.

## Behavior to know

- **Replay runs outside rendering.** A distant stop of a large document takes
  tens of milliseconds. The view on screen lags the selected stop and is marked
  `aria-busy` until it catches up; the change summary and the restore are
  withheld until then.
- **A capture does not move.** When the document gains edits the capture does
  not hold, the timeline offers to load them. A save notification alone is not
  trusted, because opening a document also saves it: a fresh capture is
  compared first.
- **History waits for the database.** Before it is ready there is nothing to
  read, so the view stays loading rather than report a document as having no
  history.
- **Attachments.** A past attachment shows its bytes only while the live
  document still holds the same bytes in the same slot; detached bytes are
  [not retained](../../../../../docs/attachment-retention.md).
- **One step per second.** A writer's edits within a second of each other
  share a step ([change times](../../../../../docs/document-rekey-and-audit-history.md#change-times)).

## Who uploaded a change

The timeline names the signed uploader of the selected change
([`documentHistoryWriter`](documentHistoryWriter.ts)), resolved from the live
document's edit-attribution segments by the change's exact operations. A
change is credited only when every one of its operations was first delivered
by an ordinary upload from one signing identity. Offline, unsynced,
ambiguous, and rotation-baseline changes show no name. As everywhere else,
this is the uploader, not proof of who typed the change, and the time beside it
is the writing device's own.

## Restoring

"Restore this version" renders under the live document's provider. It is
offered only when that document can be written, and it writes through
`restoreContent` after a confirmation
([`documentHistoryRestoreMachine`](documentHistoryRestoreMachine.ts)). The
restore is a new step of history, not a rewind; see
[restoring a version](../../../../../docs/developer/client-sdk/document-history.md#restoring-a-version).

- **Read-only follows the document, not the route.** Whether History is
  read-only is decided from the folder the document is in now. A stale or
  bookmarked route that names another folder cannot unlock a document that has
  since moved to the Trash.
- **A queued restore is admitted again when it runs.** The write waits behind
  others, and by then the user may have left, the document may have become
  read-only, or the database, account, or keys may have changed. Any of those
  refuses it.

## Saving a version as a copy

"Save as copy" creates a new document in the folder the document is in now,
starting as the version on screen: its kind, text, structured fields, and
rows ([`saveDocumentVersionCopy`](saveDocumentVersionCopy.ts)). It asks first
([`documentHistoryCopyMachine`](documentHistoryCopyMachine.ts)) and then
offers to open the copy. The document being viewed is never written, so the
copy does not need it to be writable and is offered on the newest stop too.

- **A copy is a document of its own.** It is born through the same path as any
  other new document, so it shares no history or identity with the original,
  and its history starts at one step. Each row is born under a new id, in the
  version's order.
- **Attachments are not copied.** As with a restore, a detached attachment's
  bytes are [not retained](../../../../../docs/attachment-retention.md), and a
  copy never points at the original's bytes.
- **The folder must take a new document of that kind**
  ([`canSaveDocumentCopyByRules`](../../mini-apps/explorer/model/containerRules.ts)):
  writable, accepting the version's kind, and open to creation. The viewer's
  own Contacts takes a contact version, as it takes a new contact; the Trash,
  folders under it, and read-only folders take nothing, and a document with no
  folder has nowhere to save a copy.
- **A contact version of Me is never copied.** Me is
  [one document](../../document-types/contact/README.md#personal-me-identity)
  per signing identity; a copy would be a second contact carrying the
  viewer's own `isSelf` field, user id, and key. A contact version waits for
  the Me read and is created under its admission, as a move or a purge is.
  Other kinds do not wait: the kind is the version's, so a Me alias that lists
  as a note is still refused once its version is a contact.
- **The folder is asked again when the copy is confirmed.** It may have been
  trashed or lost write access while the confirmation was open.
