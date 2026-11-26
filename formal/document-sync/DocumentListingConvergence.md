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
(`OtherTouch`, such as an attachment bind), leaves its row past the lane's
watermark, so the next delta listing returns it. Each acknowledged connection
owes a re-list of the client's lanes from their watermarks.

The row also reports the document's access head. A peer's link change or
rotation (`HeadMove`) moves it without adding an update. The device holds the
access context of one head: the key bundle stored with its record, and an open
store's copy of it. A listing whose head is not the bundle's owes a read as
well. Applying a listed row with a newer head (`ApplyListedRow`) drops the
record's bundle, so the debt is written before the row is applied, and a store
that later loads a record with no bundle probes on its own.

A completed pull records a processed cursor with the count of updates through
its bound. A listing whose count that cursor does not cover owes the document
one read, in `document_listing_revalidations` at the listed count, before the
watermark advances past the row. A registered store is then asked to read; a
store that opens later reads the debt when its record loads. A read settles the
debt only once the cursor its pull left covers the owed count, so a read served
by a replica that lags the listing leaves the debt in place. A hint that names
the document while no loaded store can take it is remembered until the store
loads. A crash loses memory, the socket, the open store and in-flight work.
The watermark, the durable debt, the cursor, the local copy and the record's
key bundle survive.

| Model action | Production seam |
| --- | --- |
| `Init` | a create whose committed seed saves its cursor (`recordCommittedDocumentSeedProgress`), or a completed pull (`recordDocumentSyncVerdicts`) |
| `PeerEdit` | a peer's accepted write, which the document row counts and `touchAcceptedSyncTargets` publishes; its hint reaches a store that is receiving runtimes through `handleDocumentRemoteEvents`, and `observeDocumentListingHints` remembers the document for a store that has not loaded |
| `OtherTouch` | `finalizeAttachmentMutation` for a bind or detach |
| `HeadMove` | `recordDocumentLinkSetChange` for a peer's link change, or a rotation, either of which gives the listed row a new `currentAccessStateHash` |
| `Acknowledge` | `flushPendingReconcileSignals` after the interest acknowledgement advances the connection generation, or on a projection opened after it |
| `BeginListing` | `reconcileAcknowledgedConnection` listing every known lane from its watermark |
| `OweListedRead` | `oweListedDocumentReadsBehindListing` in `applyListedContainerDocuments`, which `listBehindListing` answers from the cursor and from the head of the record's stored key bundle, then `requestRegisteredDocumentRemoteSyncs` |
| `ApplyListedRow` | `upsertDiscoveredDocuments` after the debt is durable; `resolvePersistedDocumentRuntimeState` drops the key bundle of a record whose access epoch the row moved |
| `AdvanceWatermark` | `recordAppliedContainerDocumentListing` after the lane's rows are applied and owed |
| `OpenStore` | `loadDocumentListingCoverage` when a store's record loads: it reads the debt (`findOwedDocumentListingRead`) and asks `takeHint`, and a record neither names is covered and arms no probe; a record with no key bundle fails `hasPersistedRemoteDocumentSyncState`, so nothing covers it |
| `BeginRead` | `findOwedListingReadBeforePull` reading the debt before the pull's request |
| `BeginLaggingRead` | the same pull (`requestRemoteDocumentSync`) answered by a replica that lags the listing |
| `FinishRead` | `clearConsumedRemoteUpdateSignal`, then `settleOwedListingReadAfterCompletedPull` and `settleCoveredDocumentListingRead`; the pull's save stores the key bundle of the head it read |

`EvidenceRetained` requires that while the client is behind, something still
obliges a read: a durable debt, a row the next delta listing will return, or,
while the process is up, a pending signal, a remembered hint, a fresh read that
covers the latest count, or a re-list that has seen the row behind and not yet
owed its read. `AccessHeadEvidenceRetained` requires the same while the
device's access context is not the server's head: a durable debt, a row the
next delta listing will return to a record that still holds a bundle to
compare, a store that will find no bundle when it loads, or, while the process
is up, a pending signal, a read that fetches the current head, or a re-list
that saw the head moved and has not yet owed its read. `Converges` requires
that once edits stop, the client has processed every update the server holds.
`DebtsSettle` requires that every owed read is eventually settled, and the read
that settles one saves the head it fetched. Weak fairness covers only the
client's own steps (startup, opening the store, the listing steps and the read)
and the server's delivery of the interest acknowledgement; no step of another
device is needed for the client to settle.

Seven guards are parameters with registered negative controls:

- `OweBeforeWatermark = FALSE` advances the watermark past the row before owing
  the read. A crash in between leaves no evidence, violating
  `EvidenceRetained`.
- `OweBeforeApply = FALSE` applies the listed row before checking what it
  owes. The apply drops the bundle whose head the check compares, so an open
  store keeps the older head's context with no debt, violating
  `AccessHeadEvidenceRetained`.
- `SettleOnlyIfCovered = FALSE` lets a read a lagging replica served settle the
  debt. The watermark already passed the row, violating `EvidenceRetained`.
- `SettleOnlyIfUnchanged = FALSE` lets a read that began before a peer's hinted
  edit clear that hint with its older snapshot, violating `Converges` (checked
  with no head move). The same read also settles a debt a later listing owed
  for a head that moved after it began, violating
  `AccessHeadEvidenceRetained`.
- `RememberClosedStoreHint = FALSE` drops a hint that names a document with no
  loaded store. The row stays past the watermark, but nothing lists it until
  the next connection, violating `Converges`.
- `RestoreOnOpen = FALSE` keeps the durable debt but never reads it when the
  store opens. The watermark already passed the row, violating `Converges`.
- `RelistOnAcknowledge = FALSE` drops the re-list after an acknowledged
  connection, so an edit whose hint was lost is never found, violating
  `Converges`.

[`DocumentListingConvergence.cfg`](./DocumentListingConvergence.cfg) allows two
peer edits, one other touch, one head move, one crash, one disconnect and one
lagging read. TLC explores 3,803,073 generated states, 863,939 distinct states,
and depth 31.

The model has one document in one lane, with the client holding every update
and the current access head at the start. `OtherTouch` changes only the row,
never the count or the head, so it owes no read. `remoteVer + touches +
headMoves` is the row's publication order;
[DiscoveryPublication.tla](./DiscoveryPublication.tla) checks that ordering.
No hint is assumed for a head move, so only a listing finds one: the head
invariant is a safety property, and a move made while the client stays
connected waits for the next acknowledged connection, as it did before
listings owed reads. Production compares head hashes for inequality; the model
orders heads only to say which listed row is newer than the record. It leaves
the row's apply and the watermark save unordered, where production applies
first. A read that a hint forced is assumed to see the hinted write, as it was
before listings owed reads: the pull's floor is this device's last applied
commit position, not the hint's, and that gap is not part of this change. The
head a lagging replica returns is likewise assumed current. Void updates,
a withheld cursor and resumed pulls behave as in
[MetadataListingConvergence](./MetadataListingConvergence.md), which models the
same cursor. Outside the model: a lane the client cannot list, whose registered
documents are probed directly; a store with no listing authority or with no
completed pull, which probes as [RestartProbeConvergence](./RestartProbeConvergence.md)
describes; and several documents per lane and lane paging. A second runtime
that shares the database, whose listing consumes the row for both, is
[SharedDatabaseListing](./SharedDatabaseListing.md)'s subject.
