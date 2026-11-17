# Metadata Listing Convergence Mapping

[`MetadataListingConvergence.tla`](./MetadataListingConvergence.tla) models how
a client recovers a peer's container metadata edit whose realtime hint it never
received. A clean metadata document skips its read. A hint is lost while the
client is closed, offline, or not yet subscribed, for instance when another
device of the same identity edits a folder this device has just created or
registered.

The listing reports each container's metadata version: the version vector of
every update the server holds for the metadata document. A write to that
document, or any other write that touches the container (`OtherTouch`, such as
a write into the folder or a move), leaves the row past its lane watermark, so
the next delta listing returns it. Each acknowledged connection owes a re-list
of the client's lanes from their watermarks. A listing whose version the local
copy does not cover owes the document one read, in memory and in
`container_metadata_revalidations`, before the watermark advances past the row.
A crash loses memory, the socket and in-flight work. The watermark, the durable
debt and the local copy survive, and the store's first pass requeues the debt.

| Model action | Production seam |
| --- | --- |
| `PeerEdit` | a peer's accepted metadata write, which adds update spans (`metadataVersionExpression` reports them) and touches the container through `touchAcceptedSyncTargets`, publishing a hint that reaches only connected, subscribed clients |
| `OtherTouch` | `touchContainers` for a write into the folder, or `touchContainerStructure` for a move |
| `Acknowledge` | `consumePendingContainerContentsReconnectRefresh` after the interest acknowledgement advances the connection generation, or on a store opened after it |
| `BeginListing` | `refreshAllRemoteHydration` listing the root lane and every held lane from their watermarks |
| `OweListedRead` | `satisfiesVersionVector` in `oweMetadataReadIfBehind`, then `oweContainerMetadataRead` and `requestContainerMetadataRevalidation` |
| `AdvanceWatermark` | the page's `saveWatermark` after its rows are applied |
| `BeginRead` | `syncSingleContainerMetadata` snapshotting the signal sequence before its forced read |
| `ResumeRead` | a pass whose metadata record still holds a pull continuation (`currentMetadataPullContinuation`), reading up to an earlier pull's bound |
| `FinishRead` | `clearMetadataSyncQueueIfUnchanged` and `settleOwedContainerMetadataRead` after the pull |
| `Start` | `restoreOwedContainerMetadataReads` on a store's first sync pass |

`EvidenceRetained` requires that while the client is behind, something still
obliges a read: a durable debt, a row the next delta listing will return, or,
while the process is up, a queued read, a fresh read that covers the latest
version, or a re-list that has seen the row behind and not yet owed its read.
`Converges` requires that once edits stop, the client holds the server's
version. Weak fairness covers acknowledgement, startup, the listing steps and
the read.

Five guards are parameters with registered negative controls:

- `OweBeforeWatermark = FALSE` advances the watermark past the row before owing
  the read. A crash in between leaves no evidence, violating
  `EvidenceRetained`.
- `SettleOnlyIfUnchanged = FALSE` lets a read that began before a listing owed a
  newer edit settle that debt with its older snapshot, violating
  `EvidenceRetained`.
- `SettleResumedPull = TRUE` lets a pass that resumed an earlier pull settle a
  debt for an edit past that pull's bound, violating `EvidenceRetained`.
- `RestoreOnStart = FALSE` keeps the durable debt but never requeues it. The
  watermark already passed the row, violating `Converges`.
- `RelistOnAcknowledge = FALSE` drops the re-list after an acknowledged
  connection, so an edit whose hint was lost is never found, violating
  `Converges`.

The bounded configuration allows two peer edits, one other touch, one crash,
one disconnect and one resumed pull. TLC explores 216,116 generated states,
52,223 distinct states, and depth 25.

The model has one container, with the local copy holding the server's version
at the start, as after registration or a seeded create. `OtherTouch` changes
only the row, never the metadata version, so it owes no read; the comparison is
clock-free. The model assumes, as existing discovery does, that a write
leaves its row past the lane watermark; a trailing server clock can break that
for discovery and for this recovery alike. Also outside the model:
minimum commit positions and replica lag (the forced read uses the stored
commit position as its floor, as a hint-forced read does, and production
settles a debt only once the local copy covers the advertised version), several
containers per lane, lane paging, access changes, and updates a client
rejects, whose version it never covers.
