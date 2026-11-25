# Document Listing Convergence Mapping

[`DocumentListingConvergence.tla`](./DocumentListingConvergence.tla) models how
a client recovers a peer's edit to an ordinary document without probing every
document it holds on each restart and reconnect. A document whose container
lane the client lists is not probed when its store loads or its socket
reconnects. A hint is lost while the client is closed, offline, or not yet
subscribed, so something else must find the edit.

A lane's listing reports each document's update count: how many updates the
server holds for it. Updates are deleted only with their document, so the count
only grows. A write to the document, or any other write that touches it
(`OtherTouch`, such as an attachment bind or a move), leaves its row past the
lane's watermark, so the next delta listing returns it. Each acknowledged
connection owes a re-list of the client's lanes from their watermarks.

A completed pull records a processed cursor with the count of updates through
its bound. A listing whose count that cursor does not cover owes the document
one read, in `document_listing_revalidations` at the listed count, before the
watermark advances past the row. A registered store is then asked to read; a
store that opens later reads the debt when its record loads. A read settles the
debt only once the cursor its pull left covers the owed count, so a read served
by a replica that lags the listing leaves the debt in place. A hint that names
the document while no loaded store can take it is remembered until the store
loads. A crash loses memory, the socket, the open store and in-flight work.
The watermark, the durable debt, the cursor and the local copy survive.

| Model action | Production seam |
| --- | --- |
| `Init` | a create whose committed seed saves its cursor (`recordCommittedDocumentSeedProgress`), or a completed pull (`recordDocumentSyncVerdicts`) |
| `PeerEdit` | a peer's accepted write, which the document row counts and `touchAcceptedSyncTargets` publishes; its hint reaches a store that is receiving runtimes through `handleDocumentRemoteEvents`, and `observeDocumentListingHints` remembers the document for a store that has not loaded |
| `OtherTouch` | `finalizeAttachmentMutation` for a bind or detach, or `recordDocumentLinkSetChange` for a link change |
| `Acknowledge` | `flushPendingReconcileSignals` after the interest acknowledgement advances the connection generation, or on a projection opened after it |
| `BeginListing` | `reconcileAcknowledgedConnection` listing every known lane from its watermark |
| `OweListedRead` | `oweListedDocumentReadsBehindCursor` in `applyListedContainerDocuments`, then `requestRegisteredDocumentRemoteSyncs` |
| `AdvanceWatermark` | `saveAppliedContainerDocumentWatermark` after the lane's rows are applied and owed |
| `OpenStore` | `loadDocumentListingCoverage` when a store's record loads: it reads the debt (`findOwedDocumentListingRead`) and asks `takeHint`, and a record neither names is covered and arms no probe |
| `BeginRead` | `findOwedListingReadBeforePull` reading the debt before the pull's request |
| `BeginLaggingRead` | the same pull (`requestRemoteDocumentSync`) answered by a replica that lags the listing |
| `FinishRead` | `clearConsumedRemoteUpdateSignal`, then `settleOwedListingReadAfterPull` and `settleCoveredDocumentListingRead` |

`EvidenceRetained` requires that while the client is behind, something still
obliges a read: a durable debt, a row the next delta listing will return, or,
while the process is up, a pending signal, a remembered hint, a fresh read that
covers the latest count, or a re-list that has seen the row behind and not yet
owed its read. `Converges` requires that once edits stop, the client has
processed every update the server holds. `DebtsSettle` requires that every owed
read is eventually settled. Weak fairness covers only the client's own steps
(startup, opening the store, the listing steps and the read) and the server's
delivery of the interest acknowledgement; no step of another device is needed
for the client to settle.

Six guards are parameters with registered negative controls:

- `OweBeforeWatermark = FALSE` advances the watermark past the row before owing
  the read. A crash in between leaves no evidence, violating
  `EvidenceRetained`.
- `SettleOnlyIfCovered = FALSE` lets a read a lagging replica served settle the
  debt. The watermark already passed the row, violating `EvidenceRetained`.
- `SettleOnlyIfUnchanged = FALSE` lets a read that began before a peer's hinted
  edit clear that hint with its older snapshot, violating `Converges`.
- `RememberClosedStoreHint = FALSE` drops a hint that names a document with no
  loaded store. The row stays past the watermark, but nothing lists it until
  the next connection, violating `Converges`.
- `RestoreOnOpen = FALSE` keeps the durable debt but never reads it when the
  store opens. The watermark already passed the row, violating `Converges`.
- `RelistOnAcknowledge = FALSE` drops the re-list after an acknowledged
  connection, so an edit whose hint was lost is never found, violating
  `Converges`.

[`DocumentListingConvergence.cfg`](./DocumentListingConvergence.cfg) allows two
peer edits, one other touch, one crash, one disconnect and one lagging read.
TLC explores 316,546 generated states, 82,003 distinct states, and depth 24.

The model has one document in one lane, with the client holding every update at
the start. `OtherTouch` changes only the row, never the count, so it owes no
read. `remoteVer + touches` is the row's publication order;
[DiscoveryPublication.tla](./DiscoveryPublication.tla) checks that ordering.
A read that a hint forced is assumed to see the hinted write, as it was before
listings owed reads: the pull's floor is this device's last applied commit
position, not the hint's, and that gap is not part of this change. Void updates,
a withheld cursor and resumed pulls behave as in
[MetadataListingConvergence](./MetadataListingConvergence.md), which models the
same cursor. Outside the model: a lane the client cannot list, whose registered
documents are probed directly; a store with no listing authority or with no
completed pull, which probes as [RestartProbeConvergence](./RestartProbeConvergence.md)
describes; several documents per lane and lane paging; and a second tab that
shares the database, whose listing consumes the row for both.
