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

## Restoring

"Restore this version" renders under the live document's provider. It is
offered only when that document can be written, and it writes through
`restoreContent` after a confirmation
([`documentHistoryRestoreMachine`](documentHistoryRestoreMachine.ts)). The
restore is a new step of history, not a rewind; see
[restoring a version](../../../../../docs/developer/client-sdk/document-history.md#restoring-a-version).
