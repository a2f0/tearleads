# Metadata Listing Convergence Mapping

[`MetadataListingConvergence.tla`](./MetadataListingConvergence.tla) models how
a client recovers a peer's container metadata edit whose realtime hint it never
received. A clean metadata document skips its read. A hint is lost while the
client is closed, offline, or not yet subscribed, for instance when another
device of the same identity edits a folder this device has just created or
registered.

The listing reports each container's metadata update count: how many updates
the server holds for the metadata document. Updates are deleted only with their
whole document, so the count only grows. A write to that document, or any other
write that touches the container (`OtherTouch`, such as a write into the folder
or a move), leaves the row past its lane watermark, so the next delta listing
returns it. Each acknowledged connection owes a re-list of the client's lanes
from their watermarks.

A completed pull records a processed cursor with the count of updates through
its bound, as the server counted them. That count includes every update the
client voided (`PeerVoidEdit`), which it judged but whose content it never
holds. The client stops sending the cursor (`WithholdCursor`) after a judge
change, a key conflict, or once its frontier no longer covers the cursor's
version. A listing whose count that cursor does not cover owes the document one
read, in memory and in `container_metadata_revalidations` at the listed count,
before the watermark advances past the row. A read settles the debt only once
the cursor its pull left covers the owed count. A crash loses memory, the
socket and in-flight work. The watermark, the durable debt, the cursor and the
local copy survive, and the store's first pass requeues the debt.

| Model action | Production seam |
| --- | --- |
| `PeerEdit` | a peer's accepted metadata write, which stores one update row (`metadataUpdateCountExpression` counts them) and touches the container through `touchAcceptedSyncTargets`, publishing a hint that reaches only connected, subscribed clients |
| `PeerVoidEdit` | the same write, of an update this client voids when its pull judges it (`recordDocumentSyncVerdicts`) |
| `OtherTouch` | `touchContainers` for a write into the folder, or `touchContainerStructure` for a move |
| `WithholdCursor` | `readSendableProcessedProgress` finding no cursor this client may send |
| `Acknowledge` | `consumePendingContainerContentsReconnectRefresh` after the interest acknowledgement advances the connection generation, or on a store opened after it |
| `BeginListing` | `refreshAllRemoteHydration` listing the root lane and every held lane from their watermarks |
| `OweListedRead` | `coversMetadataUpdateCount` in `oweMetadataReadIfBehind`, then `oweContainerMetadataRead` and `requestContainerMetadataRevalidation` |
| `AdvanceWatermark` | the page's `saveWatermark` after its rows are applied |
| `BeginRead` | `syncSingleContainerMetadata` snapshotting the signal sequence before its forced read |
| `ResumeRead` | a pass whose metadata record still holds a pull continuation (`currentMetadataPullContinuation`), reading up to an earlier pull's bound |
| `FinishRead` | `processedCursorTransition` advancing the cursor to the pull's bound and count, then `coversAdvertisedMetadataUpdates` in `keptContainerMetadataSignals`, `clearMetadataSyncQueueIfUnchanged` and `settleOwedContainerMetadataRead` |
| `Start` | `restoreOwedContainerMetadataReads` on a store's first sync pass |

`EvidenceRetained` requires that while the client is behind, something still
obliges a read: a durable debt, a row the next delta listing will return, or,
while the process is up, a queued read, a fresh read that covers the latest
version, or a re-list that has seen the row behind and not yet owed its read.
`Converges` requires that once edits stop, the client has processed every
update the server holds. `DebtsSettle` requires that every owed read is
eventually settled. `CursorWithinProcessed` checks that the cursor never counts
an update the client has not processed, so covering a listing by the cursor's
count never hides an edit. Weak fairness covers only the client's own steps
(startup, the listing steps and the read) and the server's delivery of the
interest acknowledgement; no step of another device is needed for the client to
settle, and withholding the cursor is never forced.

Six guards are parameters with registered negative controls:

- `OweBeforeWatermark = FALSE` advances the watermark past the row before owing
  the read. A crash in between leaves no evidence, violating
  `EvidenceRetained`.
- `CoverByProcessedCount = FALSE` covers a listed count by the updates whose
  content the local copy holds. A void update is never among them, so the read
  a listing owes never settles, violating `DebtsSettle`. The client still
  converges: each read finds nothing new.
- `SettleOnlyIfUnchanged = FALSE` lets a read that began before a peer's hinted
  edit clear that hint with its older snapshot. The owed count still keeps a
  durable debt open, but the watermark may already have passed the row, so
  nothing re-lists it until the next connection, violating `Converges`.
- `SettleResumedPull = TRUE` lets a pass that resumed an earlier pull clear a
  hint for an edit past that pull's bound, violating `Converges` for the same
  reason.
- `RestoreOnStart = FALSE` keeps the durable debt but never requeues it. The
  watermark already passed the row, violating `Converges`.
- `RelistOnAcknowledge = FALSE` drops the re-list after an acknowledged
  connection, so an edit whose hint was lost is never found, violating
  `Converges`.

[`MetadataListingConvergence.cfg`](./MetadataListingConvergence.cfg) allows two
peer edits, one other touch, one crash, one disconnect, one resumed pull and one
withheld cursor. TLC explores 841,971 generated states, 201,675 distinct states,
and depth 27.
[`MetadataListingConvergenceVoids.cfg`](./MetadataListingConvergenceVoids.cfg)
trades one peer edit for a void one and carries the `CoverByProcessedCount`
control: 1,683,749 generated states, 403,282 distinct states, and depth 27.

The model has one container, with the client holding every update the server
does at the start, as after registration or a create. `OtherTouch` changes only
the row, never the metadata count, so it owes no read; the comparison is
clock-free. `remoteVer + touches` is this row's publication order. A page saves
the position it captured, so a later commit remains above the watermark.
[DiscoveryPublication.tla](./DiscoveryPublication.tla) checks the underlying
ordering with two concurrent writers and a page size of one. A writer takes
the publication lock when allocating its position and releases it on commit
or abort. The registered negative control releases the serialization rule,
allowing an older position to commit behind an applied page. Outside the model:
minimum commit positions and replica lag (the forced read uses the stored
commit position as its floor, as a hint-forced read does, and a read served by
a lagging replica leaves a cursor below the owed count, so the debt stays),
several containers per lane, lane paging, and access changes.
