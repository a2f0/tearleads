# Shared Database Listing Mapping

[`SharedDatabaseListing.tla`](./SharedDatabaseListing.tla) models two runtimes
that share one local database, such as two browser tabs, each holding the same
ordinary document open. [DocumentListingConvergence](./DocumentListingConvergence.md)
shows that one runtime finds a peer's edit through its lane's listing. This
model adds what sharing the database changes.

The runtimes share what is durable: the lane's watermark, the read a listing
owes the document (`document_listing_revalidations`), and the saved record with
its processed cursor. Each keeps its own copy of the open document in memory,
its own socket and its own pending work. So a listing by one runtime consumes
the row for both, and that runtime's pull settles the debt for both. The other
runtime's copy is still the older one, and no listing names the document to it
again.

A catch-up after an acknowledged connection therefore ends by asking a store
for one pull in two cases: the shared debt is still unsettled, or the saved
record holds content the store's copy lacks. The pull cites the version of
the store's own copy. The shared cursor was recorded with a version that copy
does not cover, so it is not sent, and the server returns every update the
copy lacks.

| Model action | Production seam |
| --- | --- |
| `PeerEdit` | a peer's accepted write; `enqueueReconciliationForEvents` forces a listing of the hinted lane and names the document for a pull in each runtime whose socket received the hint |
| `Disconnect` / `Acknowledge` | the runtime's own server-events connection; `flushPendingReconcileSignals` raises the acknowledged-connection signal after the interest acknowledgement |
| `HintListing` / `CatchUpListing` | `applyListedContainerDocuments`: `oweListedDocumentReadsBehindListing` against the saved cursor, then `recordAppliedContainerDocumentListing`, both on the shared database |
| `CatchUpAsk` | `requestOwedDocumentReads` at the end of `reconcileAcknowledgedConnection`: `listOwedDocumentListingReads` for the shared debts, then `requestRemoteSyncsOfRecordsSavedElsewhere`, which compares each registered store's document in memory (`describeLoadedDocumentRecord`) with the frontier its record has on disk |
| `BeginRead` | `findOwedListingReadBeforePull`, then `requestRemoteDocumentSync`; `readProcessedCursorForSync` withholds a cursor recorded with a version the store's record does not cover |
| `FinishRead` | `finalizeDocumentSync` saving the record, then `settleCoveredDocumentListingRead` |

`OpenCopyEvidenceRetained` requires that while a connected runtime's copy is
behind the server, something of that runtime's own still obliges a read: a
pending request, a read in flight that captured the server's count, or a
catch-up that has not asked yet. A disconnected runtime owes a catch-up at its
next acknowledgement. `Converges` requires that once edits and disconnects
stop, every runtime's copy holds every update, and `DebtsSettle` that every
owed read is eventually settled. Weak fairness covers each runtime's own steps
and the server's acknowledgement.

One guard is a parameter with a registered negative control:

- `PullWhenSavedElsewhere = FALSE` ends a catch-up by reading the debt table
  alone. A runtime that reconnects after the other one listed the row, read
  the edit and settled the debt keeps its older copy with nothing left to
  oblige a read, violating `OpenCopyEvidenceRetained`.

[`SharedDatabaseListing.cfg`](./SharedDatabaseListing.cfg) allows two
runtimes, two peer edits and two disconnects. TLC explores 361,706 generated
states, 67,397 distinct states, and depth 22.

A listing owes the read and advances the watermark in one step here; the order
of those two writes, crashes, lagging replicas and access heads are
[DocumentListingConvergence](./DocumentListingConvergence.md)'s subject. A
save never moves the record's frontier back: every save merges its frontier
with the durable one (`mergeMutationFrontiers`). A runtime that starts reads
the saved record, so a restart is not modeled. Outside the model: a local edit
one runtime has saved and not yet submitted, which the other runtime's pull
cannot fetch; it arrives with the hint for its accepted write, or when that
store next saves.
