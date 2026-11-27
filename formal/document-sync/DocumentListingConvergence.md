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
owes a re-list of the client's lanes from their watermarks; which lanes that
catch-up lists, and why the others did not move, is
[DocumentLanePolling](./DocumentLanePolling.md)'s subject. On a device-first
host, a `document.update.created` hint also forces a listing of the document's
lane (`HintListsLane`), so even a hinted read served by a lagging replica is
followed by a listing that writes a durable debt.

The row also reports the document's access head. A peer's link change or
rotation (`HeadMove`) moves it without adding an update. The device holds the
access context of one head: the key bundle stored with its record, and an open
store's copy of it. A listing whose head is not the bundle's owes a read as
well, at the listed head. Applying a listed row with a newer head
(`ApplyListedRow`) drops the record's bundle, so the debt is written before the
row is applied, and a store that later loads a record with no bundle probes on
its own.

A completed pull records a processed cursor with the count of updates through
its bound. A listing whose count that cursor does not cover owes the document
one read, in `document_listing_revalidations` at the listed count, before the
watermark advances past the row; a lagging listing never lowers an existing
debt (`KeepHigherDebt`). A failed or superseded listing leaves the watermark
behind and retries (`FailListing`). A registered store is then asked to read; a
store that opens later reads the debt when its record loads, and also probes
when its record holds no key bundle (`ProbeWithoutBundle`) or its saved cursor
is withheld (`ProbeWithheldCursor`). A read settles the debt only once the
cursor its pull left covers the owed count and the head it saved is the owed
head or a later one, so a read served by a replica that lags the listing, in
either, leaves the debt in place. A hint that names the document while no
loaded store can take it is remembered until the store loads. A crash loses
memory, the socket, the open store and in-flight work. The watermark, the
durable debt, the cursor, the local copy and the record's key bundle survive.

| Model action | Production seam |
| --- | --- |
| `Init` | a create whose committed seed saves its cursor (`recordCommittedDocumentSeedProgress`), a completed pull (`recordDocumentSyncVerdicts`), or a freshly discovered record with no key bundle yet (`upsertDiscoveredDocuments`) |
| `PeerEdit` | a peer's accepted write, which the document row counts and `touchAcceptedSyncTargets` publishes; its hint reaches a store that is receiving runtimes through `handleDocumentRemoteEvents`, `observeDocumentListingHints` remembers the document for a store that has not loaded, and `enqueueReconciliationForEvents` forces a lane listing on a device-first host |
| `OtherTouch` | `finalizeAttachmentMutation` for a bind or detach |
| `HeadMove` | `recordDocumentLinkSetChange` for a peer's link change, or a rotation, either of which gives the listed row a new `currentAccessStateHash` |
| `WithholdCursor` | `isDocumentProcessedCursorWithheld` finding a saved cursor that the current judge or restored frontier withholds |
| `Acknowledge` | `flushPendingReconcileSignals` after the interest acknowledgement advances the connection generation, or on a projection opened after it |
| `Disconnect` | `setConnected` with false on the runtime event source |
| `BeginListing` | `reconcileAcknowledgedConnection` listing each owed lane from its watermark and verifying listed heads through `KeyingCheckpointRepository` |
| `OweListedRead` | `oweListedDocumentReadsBehindListing` in `applyListedContainerDocuments`, which `listBehindListing` answers from the cursor and from the head of the record's stored key bundle, then `requestRegisteredDocumentRemoteSyncs` asks each loaded store whose own record owes a read |
| `ApplyListedRow` | `upsertDiscoveredDocuments` after the debt is durable; `resolvePersistedDocumentRuntimeState` drops the key bundle of a record whose access epoch the row moved |
| `AdvanceWatermark` | `recordAppliedContainerDocumentListing` after the lane's rows are applied and owed |
| `FailListing` | a failed or paused listing stopped by `guardDocumentDiscoveryWrites`, leaving the watermark unadvanced and retrying through `reconcileMarkedContainers` |
| `FinishListing` | `applyListedContainerDocuments` completing after rows are owed, applied, and the lane watermark saved |
| `OpenStore` | `loadDocumentListingCoverage` when a store's record loads: it reads the debt (`findOwedDocumentListingRead`), checks `isDocumentProcessedCursorWithheld`, and asks `takeHint`; a record neither names is covered only while `hasPersistedRemoteDocumentSyncState` holds |
| `ProbeListing` | the initial document probe's listing (`createProbeLaneListing`): each lane from no watermark at least once a launch, whose rows `oweListedRecordReads` checks without lowering an existing debt, then `requestRemoteSyncsOfOwedRecords` asks each owed record's loaded store; it applies no row and saves no watermark |
| `BeginRead` | `findOwedListingReadBeforePull` reading the debt before the pull's request |
| `BeginLaggingRead` | the same pull (`requestRemoteDocumentSync`) answered by a replica that lags the listing, in its count and its access head |
| `FinishRead` | `clearConsumedRemoteUpdateSignal`, then `settleOwedListingReadAfterCompletedPull` and `settleCoveredDocumentListingRead`, whose `DocumentListingRevalidationRepository.settle` compares the cursor with the owed count and the saved manifest's epoch with the owed one; the pull's save stores the key bundle of the head it read |
| `Crash` | a reload or process exit; `stopReconciliationService` drops in-memory state, socket state, and in-flight work while durable SQLite state survives |
| `Start` | process restart reopening the scope before `loadDocumentListingCoverage` reloads durable debts and cursors |

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
that settles one saves the head it fetched. `WithheldCursorSettles` requires
that a withheld cursor is eventually replaced by a completed pull. Weak
fairness covers only the client's own steps (startup, opening the store, the
listing steps and the read) and the server's delivery of the interest
acknowledgement; no step of another device is needed for the client to settle.
The launch probe is not fair, so no property may rely on it: it adds evidence,
such as a head that moved while the client stayed connected, and its debts must
settle like any other.

Fourteen guards are parameters with registered negative controls:

- `OweBeforeWatermark = FALSE` advances the watermark past the row before owing
  the read. A crash in between leaves no evidence, violating
  `EvidenceRetained`.
- `OweBeforeApply = FALSE` applies the listed row before checking what it
  owes. The apply drops the bundle whose head the check compares, so an open
  store keeps the older head's context with no debt, violating
  `AccessHeadEvidenceRetained`.
- `SettleOnlyIfCovered = FALSE` lets a read a lagging replica served settle the
  debt. The watermark already passed the row, violating `EvidenceRetained`.
- `SettleOnlyIfHeadRead = FALSE` lets a read a lagging replica answered with
  the head from before the move settle the debt that move owed. Its revision is
  current, and its cursor may cover the count, violating
  `AccessHeadEvidenceRetained`.
- `SettleOnlyIfUnchanged = FALSE` (with `HintListsLane = FALSE`, no head moves,
  and no lagging reads) lets a read that began before a peer's hinted edit
  clear that hint with its older snapshot, violating `Converges`. A read that
  began before a head moved is refused by the head guard too, so with that
  guard also off, and no lagging replica, the same read settles a debt a later
  listing owed for the move, violating `AccessHeadEvidenceRetained`.
- `HintListsLane = FALSE` (with no head moves) drops the hint-forced lane
  listing. A hinted read served by a lagging replica then clears its signal
  with no durable debt written, violating `Converges`.
- `RememberClosedStoreHint = FALSE` (with `HintListsLane = FALSE` and no
  lagging reads, isolating a host that does not route hints to listings) drops
  a hint that names a document with no loaded store, violating `Converges`.
- `RestoreOnOpen = FALSE` keeps the durable debt but never reads it when the
  store opens. The watermark already passed the row, violating `Converges`.
- `RelistOnAcknowledge = FALSE` drops the re-list after an acknowledged
  connection, so an edit whose hint was lost is never found, violating
  `Converges`.
- `ProbeAsksOpenStore = FALSE`, checked with the probe configuration, has the
  launch probe owe a read without asking the open store to make it. A pull a
  lagging replica answered with the head from before a move leaves the record
  behind while the client stays connected; no re-list or load follows the
  probe's debt to ask for it, violating `DebtsSettle`.
- `KeepHigherDebt = FALSE`, checked with the probe configuration, lets a
  lagging probe listing overwrite a stronger durable debt with an older head.
  A lagging pull then settles the weakened debt while the newer head stays
  unread behind the watermark, violating `AccessHeadEvidenceRetained`.
- `ProbeWithoutBundle = FALSE`, checked with the probe configuration
  (`StartWithoutBundle = TRUE`), skips probing when opening a record that holds
  no key bundle, violating `AccessHeadEvidenceRetained`.
- `ProbeWithheldCursor = FALSE`, checked with the probe configuration
  (`MaxWithholds = 1`), skips probing when opening a record whose processed
  cursor became withheld between sessions, violating `WithheldCursorSettles`.
- `AdvanceOnFailedListing = TRUE`, checked with the probe configuration
  (`MaxListFailures = 1`), advances the lane watermark on a failed listing
  without owing reads, violating `EvidenceRetained`.

[`DocumentListingConvergence.cfg`](./DocumentListingConvergence.cfg) allows two
peer edits, one other touch, one head move, one crash, one disconnect and one
lagging read, with `HintListsLane = TRUE`. TLC explores 6,836,094 generated
states, 1,486,759 distinct states, and depth 38. It leaves the launch probe off
(`LaunchProbe = FALSE`), which no property may rely on.
[`DocumentListingConvergenceProbe.cfg`](./DocumentListingConvergenceProbe.cfg)
turns on the launch probe (`LaunchProbe = TRUE`), unpulled starts
(`StartWithoutBundle = TRUE`), one failed listing (`MaxListFailures = 1`), and
one withheld cursor (`MaxWithholds = 1`), with one peer edit, one head move,
one crash, and one lagging read: 2,820,800 generated states, 551,869 distinct
states, and depth 34.

The model has one document in one lane, held by one record, starting either
with every update and a key bundle held (as after a create or completed pull)
or with no key bundle yet (as after discovery, `StartWithoutBundle`).
Production keeps a debt per record: after an identity recovery or a relink two
records can name one document, each with its own cursor and bundle, and each
owes and settles its own read, so the model's record stands for each of them.
`OtherTouch` changes only the row, never the count or the head, so it owes no
read. `remoteVer + touches + headMoves` is the row's publication order;
[DiscoveryPublication.tla](./DiscoveryPublication.tla) checks that ordering. No
hint is assumed for a head move, so only a listing finds one: the head
invariant is a safety property, and a move made while the client stays
connected waits for the next acknowledged connection, as it did before listings
owed reads. Production owes a read when the listed head's hash is not the
bundle's, and settles it once the manifest its pull saved reaches the listed
epoch; each head of a document has its own epoch, and a move raises it. A pull
keeps the newer head when a lagging replica answers with an older one, and an
unpulled record refuses a pull below the epoch discovery already verified,
because the keying checkpoints (`KeyingCheckpointRepository`) refuse a manifest
older than one this device verified. It leaves the row's apply and the
watermark save unordered, where production applies first. It takes the launch
probe's snapshot and its check in one step (allowing a lagging replica
snapshot), where production checks the record when its listing returns, and
runs it at most once a launch, where production lists a lane again after a
failed listing or a restart of the reconciler; another listing only owes more
reads. Void updates and resumed pulls behave as in
[MetadataListingConvergence](./MetadataListingConvergence.md), which models the
same cursor. Outside the model: a lane the client cannot list, whose registered
documents are probed directly; a lane whose listing never shows its documents
(a roster profile container), whose stores no listing covers, decided by the
container: the server binds a roster profile only to a document in its profile
container and refuses a link set that moves a bound document out, so no listing
of another container omits one; a store with no listing authority or with no
completed pull that probes as
[RestartProbeConvergence](./RestartProbeConvergence.md) describes; and several
documents per lane and lane paging. A second runtime that shares the database,
whose listing consumes the row for both, is
[SharedDatabaseListing](./SharedDatabaseListing.md)'s subject.
