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

## Who uploaded a change, and when

Until the history is [verified](#verifying-history), both come from the
server's record of signed uploads, read through the live document: nothing
here is taken from what a change says about itself. Offline, unsynced, and
unauthenticated documents have neither.

- **Who.** The timeline names the signed uploader of the selected change
  ([`documentHistoryWriter`](documentHistoryWriter.ts)), resolved from the
  document's compact edit-attribution segments by the change's exact
  operations. A change is credited only when every one of its operations was
  first delivered by an ordinary upload from one signing identity. Offline,
  unsynced, ambiguous, and rotation-baseline changes show no name. As
  everywhere else, this is the uploader, not proof of who typed the change.
- **When.** A change records its writing device's own time, and a change
  cannot have been made after the server stored it. So the time shown is the
  lesser of the two
  ([`documentHistoryUploadTime`](documentHistoryUploadTime.ts)): the device's
  time, unless it is later than the upload that delivered the change's first
  operation, in which case the upload's. Past a minute's difference the
  timeline says a device's clock was ahead. A document never records a time
  earlier than the newest one it holds, so one fast clock moves every later
  change forward; each is bounded by its own upload. A clock that runs behind
  cannot be told, a change no upload has delivered keeps its device's time,
  and steps are still ordered causally, not by these times.

The upload times come from the per-upload attribution ranges
([`useDocumentAttributionRanges`](../documents/useDocumentAttributionRanges.ts)),
read page by page at one attribution revision when History opens. After each
completed sync they are asked for again, and a one-range probe settles it:
the same revision and first update mean nothing was uploaded and what is held
stands, at the cost of one small request; otherwise the read goes on from the
probe in full pages. A range never changes once read, so the ranges held stay
in use while a refresh loads or fails, and the time on screen does not
flicker on each sync; another document or session never sees them. The
read's state machine keeps them
([`attributionReadMachine`](../documents/attributionReadMachine.ts)): a
read records its `prior` in the scope, either its first read or one after a
read settled, carrying the last result as `previous`. A document
with more ranges than the read allows (20,000, counted in ranges so a probe
does not move the limit) is treated as having none rather than some. Uploads
only add ranges, so that outcome stands for the document and session without
another request. A read that is superseded stops before its next page.

The ranges are read under the live document, which History opens with its
first ready history and keeps open while History reloads after a restore or
"Load newer edits", so a reload does not read them again
([`ExplorerDocumentHistoryPanel`](../../mini-apps/explorer/detail/history/ExplorerDocumentHistoryPanel.tsx)).
Until their first read settles, the timeline says the time is being checked
rather than show the device's own, which could be a day ahead. A Restore or
Save as copy confirmation names the time shown when it was opened, or none if
it opened before the time was known, and keeps that text while it is open
([`documentHistoryRestoreMachine`](documentHistoryRestoreMachine.ts),
[`documentHistoryCopyMachine`](documentHistoryCopyMachine.ts)). Once a read
has settled, loaded or failed, later refreshes in the same scope never
withhold the time again. The scope is the document, account, session, and
sign-in, while online. Another scope, such as a refreshed sign-in or coming
back online, starts with a first read of its own.

Once a check has [verified the history](#verifying-history) on this device,
its ranges take the place of both reads for as long as its verdict stands.

## Verifying history

The history History opens is this device's copy, and nothing has checked it.
"Verify history" checks it against the signed uploads the server holds,
through
[`documents.verifyHistory`](../../../../../docs/developer/client-sdk/document-history.md#verifying-history).
The check runs only when asked for: it reads the document's whole history
from the server and rebuilds it on the main thread.

[`useDocumentHistoryVerification`](useDocumentHistoryVerification.ts) drives
[`documentHistoryVerificationMachine`](documentHistoryVerificationMachine.ts).
The status line beside the action says which state it is in:

| State | What the user reads | What it means |
| --- | --- | --- |
| `idle` | "This is the history stored on this device. It has not been checked." | Nothing was asked. |
| `checking` | "Checking N of M uploads..." | A check is running. The action is disabled and busy. |
| `verified` | "Checked against the signed uploads the server holds. This device's copy matches." | Every operation the device and the server both hold is the same in both. It adds that the server holds newer edits, and how many uploads were set aside as void, when either is so. |
| `mismatch` | "This device's copy differs from the signed uploads." | Some operation differs. "View signed history" shows the history rebuilt from the signed uploads. |
| `unavailable` | One sentence for each reason, below. | No verdict was reached. |
| `failed` | "Couldn't check the history." | The check threw. "Try again" starts another. |

| `unavailable` reason | What the user reads |
| --- | --- |
| `offline` | "Can't check while offline." |
| `not_synced` | "Nothing has been uploaded yet." |
| `epoch_key_unreachable` | "An older key for this document can't be reached from this device, so older history can't be checked." |
| `rejected` | "The server's response failed a signature or integrity check." |
| `unsettled` | "This device couldn't finish reading the history. Try again later." |
| `too_large` | "This history is too large to check on this device." |
| `interrupted` | "The check was interrupted." A database that is not ready yet reads the same. |
| `capture_outdated` | "This document has newer edits than the history shown. Load them, then check again." |

`capture_outdated` is the app's own reason. A check reads the device's
history as it is when the check runs, and reports the version it compared.
When that is not the newest version of the capture on screen, an edit became
durable after the capture was taken, so the verdict is not applied to it. The
versions are compared as sets: their entries come in no set order.

What a verdict does and does not prove is in the SDK's
[trust limits](../../../../../docs/developer/client-sdk/document-history.md#trust-limits).

### What a verdict changes on screen

- **Who and when.** On `verified` the check's ranges replace the server's
  attribution in both resolvers above. They have the same shape, but this
  device built them from write headers it authenticated. On `mismatch` they
  do so only while the signed replay is on screen: a range is matched by peer
  and counter, and a mismatch says some operation both histories hold
  differs, so this device's copy keeps the server's attribution and shows no
  provenance.
- **Where each change is held.** The caption says where the server's signed
  history holds the selected change
  ([`documentHistoryProvenance`](documentHistoryProvenance.ts)), looking at
  every one of its operations:

  | Provenance | What the user reads | Meaning |
  | --- | --- | --- |
  | `direct` | "This change is in a signed upload." | An ordinary signed upload first carried every operation. |
  | `baseline` | "This change is only in a key-rotation snapshot, as its signer asserted." | The server holds them all, but at least one only in a rotation baseline. |
  | `partial` | "Only part of this change is in the server's history." | The server holds some of the operations and not others. |
  | `absent` | "This change is not in the server's history." | No range covers it: an edit not uploaded yet, or one the server no longer holds. The check cannot tell which. |

- **The device's copy stays on screen.** A `verified` history is the one
  already shown. Its stops are not the signed replay's: imports split changes
  differently, and edits not uploaded yet exist only here.

### Viewing the signed history

A `ready` history has a `source`. It is `local` for this device's capture.
"View signed history" puts the `mismatch` state's `signed` replay on screen
in its place (`signed-shown`), with the capture kept open as `local`. "Back
to this device's copy" returns to it (`local-shown`). Either way the history
opens on its newest stop, and the transport, the restore, and the copy work
as on any history. No stop of a signed replay counts as the current version,
so each can be restored.

Two histories are then open, so a replayed stop is accepted only from the
history on screen: a replay of one that finishes after the other took the
screen is dropped. Newer edits are still looked for on the device's capture.

### Who closes what

- History closes its own capture, on a reload and when it unmounts. It never
  closes a signed replay.
- The verification machine returns its closes as effects, which the hook runs
  on entering the next state. A signed replay is closed once: when its
  `mismatch` state is left (a new check, a new capture, or leaving History),
  or at once when the result that brought it is not taken.
- A signed replay must be off screen before it is closed. A new capture gets
  there by reloading History, which drops the replay first. A new check gets
  there because the signed view offers only the way back.

A check belongs to the capture it was asked about. "Load newer edits", a
restore, and a change of database or account each bring another capture: the
check in flight is stopped at its next page, and the verdict is forgotten.
Only the running check may report progress, settle, or fail, so a check that
was stopped cannot settle the next one.

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
  copy never points at the original's bytes. A file-backed version (an
  image, audio, video, PDF, or other uploaded file) is its attachment, so it
  offers no copy: the copy would be a file document with no file. A field
  that names an attachment slot (a contact's avatar photo) is left out of the
  copy too, so it never points at a photo it does not hold.
- **The folder must take a new document of that kind**
  ([`canSaveDocumentCopyByRules`](../../mini-apps/explorer/model/documentCopyRules.ts)).
  An ordinary folder does when it is writable, whether or not the document
  itself is. A system folder holds what the app puts there, so it takes a
  copy only when the rules of its own slot set `acceptsDocumentCopies`
  ([system containers](../systemContainers.ts)): only the viewer's own
  Contacts does, taking a contact version as it takes a new contact. The
  Trash, folders under it, a shared Contacts, Roster Profiles, Organization
  Metadata, and read-only folders take nothing, and a document with no folder
  has nowhere to save a copy. The rule looks the folder and its ancestors up
  itself, so no caller can skip the Trash. A system folder is known by its
  slot, so one whose rules are not loaded yet is refused rather than taken
  for an ordinary folder.
- **A contact version of Me is never copied.** Me is
  [one document](../../document-types/contact/README.md#personal-me-identity)
  per signing identity; a copy would be a second contact carrying the
  viewer's own `isSelf` field, user id, and key. A contact version waits for
  the Me read and is created under its admission, as a move or a purge is.
  Other kinds do not wait: the kind is the version's, so a Me alias that lists
  as a note is still refused once its version is a contact.
- **A contact's copy is not bound to an account.** Contacts finds a person's
  contact by user id, so a copy that kept the original's `userId` and key
  could be taken for it, and the key would be the past version's. The copy
  leaves both out, with `isSelf`: it keeps what the version says about the
  person, not which account they are.
- **Nor is a contact version that says it is the viewer.** Contacts that are
  not Me can carry `isSelf` too, such as the viewer's own roster profile or a
  contact left from another identity. A contact version whose `isSelf` field
  is set is refused whatever document it comes from. This is a second guard:
  a copy leaves `isSelf` out in any case (above), so the refusal only spares
  the viewer a copy of themselves that says nothing about who it is.
- **The folder is asked again when the copy is created.** The rules are read
  then, not when the copy was offered: the folder may have been trashed or
  lost write access while the confirmation was open or while a contact
  version waited for the Me read. If the copy stops being offered while the
  confirmation is open, the confirmation closes and says the version could
  not be saved.
- **A copy in flight outlives the timeline.** Its state is held above the
  timeline's actions, which unmount as History reloads. Once confirmed, the
  copy's document exists, so its outcome is reported on whichever stop is
  shown when it finishes, or on the next one shown if none is. A
  confirmation or an outcome raised on one stop goes when another is shown,
  and all of it is forgotten when the database or account changes: a copy
  that finishes then belongs to the scope before.
