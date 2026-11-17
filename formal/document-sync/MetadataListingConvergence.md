# Metadata Listing Convergence Mapping

[`MetadataListingConvergence.tla`](./MetadataListingConvergence.tla) models how
a client recovers a peer's container metadata edit whose realtime hint it never
received. The client holds the metadata document at a recorded position, so a
clean pass skips the read. A hint is lost while the client is closed, offline,
or not yet subscribed, for instance when another device of the same identity
edits a folder this device has just created or registered.

Every write to a metadata document advances its container's timestamp, and so
do other touches, such as writes into the folder or moves (`OtherTouch`). Each
acknowledged connection owes one re-list of the container tree. A re-list that
shows the timestamp later than the recorded one owes the metadata document one
read before it records the new timestamp and lane watermark. The debt is held
in memory and in `container_metadata_revalidations`. A crash loses memory, the
socket and in-flight work. The recorded timestamp, the durable debt and the
local metadata version survive, and startup requeues the debt.

| Model action | Production seam |
| --- | --- |
| `PeerEdit` | a peer's accepted metadata write, which advances the container through `touchAcceptedSyncTargets` and `advancedTimestampExpression` and publishes a hint that reaches only connected, subscribed clients |
| `OtherTouch` | `touchContainers` for a write into the folder, or `touchContainerStructure` for a structural move |
| `Acknowledge` | `consumePendingContainerContentsReconnectRefresh` after the interest acknowledgement advances the connection generation |
| `BeginListing` | `refreshAllRemoteHydration` re-listing the root lane and every held lane from its start (`resetAllLaneWatermarks`) |
| `OweListedRead` | `remoteContainerChangedSince` in `updateExistingRemoteContainerState`, then `oweContainerMetadataRead` and `requestContainerMetadataRevalidation` |
| `RecordListedStamp` | the hydration write in `updateExistingRemoteContainerState` recording `serverUpdatedAt` and the lane watermark |
| `BeginRead` | `syncSingleContainerMetadata` snapshotting the signal sequence before its forced read |
| `ResumeRead` | a pass whose metadata record still holds a pull continuation (`currentMetadataPullContinuation`), reading up to an earlier pull's bound |
| `FinishRead` | `clearMetadataSyncQueueIfUnchanged` and `settleOwedContainerMetadataRead` after the pull |
| `Start` | `restoreOwedContainerMetadataReads` on a store's first sync pass |

`EvidenceRetained` requires that while the client is behind, something still
obliges a read. That is a durable debt, a timestamp the next re-list will see
as changed, or, while the process is up, a queued read, a read that covers the
latest version, or a re-list that has seen the change and not yet owed its
read. `Converges` requires that once edits stop, the client holds the server's
version. Weak fairness covers acknowledgement, startup, the re-list steps and
the read.

Five guards are parameters with registered negative controls:

- `StrictTimestamps = FALSE` lets an edit leave the stored timestamp unchanged,
  as a write in the same millisecond or from an instance whose clock trails
  would without `advancedTimestampExpression`, which advances every touched
  row by at least one millisecond, violating `EvidenceRetained`.
- `SettleResumedPull = TRUE` lets a pass that resumed an earlier pull settle a
  debt for an edit past that pull's bound, violating `EvidenceRetained`.
- `OweBeforeRecord = FALSE` records the listed timestamp before owing the read.
  A crash in between leaves no evidence, violating `EvidenceRetained`.
- `SettleOnlyIfUnchanged = FALSE` lets a read that began before a re-list owed
  a newer edit settle that debt with its older snapshot, violating
  `EvidenceRetained`.
- `RestoreOnStart = FALSE` keeps the durable debt but never requeues it. The
  recorded timestamp already hides the change from later re-lists, violating
  `Converges`.

The bounded configuration allows two peer edits, one other touch, one crash,
one disconnect and one resumed pull. TLC explores 389,155 generated states,
95,812 distinct states, and depth 25.

The model has one container and an exact recorded baseline at the start, as
after registration or a seeded create. It does not model the extra reads that
`OtherTouch` causes: each is one read that finds nothing new. It also leaves
out minimum commit positions and replica lag. The forced read uses the stored
commit position as its floor, as a hint-forced read does. Other things outside
the model are a hint arriving in a different order than its write, several
containers per lane, lane paging, and access changes.
