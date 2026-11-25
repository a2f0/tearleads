# Discovery Lane Resumption Mapping

[`DiscoveryLaneResumption.tla`](./DiscoveryLaneResumption.tla) models a device
listing the document lanes of the containers it learns at sign-in, while a
reload can stop it at any point. It is the restart half of discovery: the
publication model checks that a listing never skips a committed row, and
assumes the client keeps reading.

The sign-in boot learns every lane from the remote tree, and membership growth
queues them all. A batched listing pages the queued lanes from their cursors
(production takes up to four lanes per reconciler run; the model lists every
queued lane at once); the lanes then verify and apply one at a time.
Verification may defer a document whose signed head is not yet available: the
candidate is staged durably, and an in-memory timer retries the lane. A crash
loses the queue, the listing in flight, and the timers. The projection, the
cursor, the lane's settled mark, and the staged candidates survive. A later
start publishes the cached tree, which raises no hint for a lane the tree
already holds, so only the durable state can say that a lane still owes a
listing.

Two things list lanes at a later start. The catch-up after an acknowledged
connection lists every known lane, owed ones included. But a connect attempt
can end without an acknowledgement (in the screenshot probe the socket opens
on every boot after the identity restore and never declares its interest), and
a device may not connect at all. The resume lists the lanes the durable state
says are owed. It waits while an attempt is pending, so an acknowledgement
that arrives while the start waits lists each owed lane once, in its
catch-up; the resume lists them when the attempt ends without one or none
was pending. That is all the deferral promises: once the resume has run, a
connection that starts or is acknowledged later is a new catch-up and lists
every lane again, which the model allows.

Issue #3255 was this gap. The reload that follows an identity restore cut the
sign-in boot short after its one listing named every lane but before the
Contacts and organization lanes applied, and no later boot listed them again.
The seams of [`DiscoveryLaneResumption.tla`](./DiscoveryLaneResumption.tla):

| Model action or predicate | Production seam |
| --- | --- |
| `Init` | remote tree growth raising the remote-containers-added signal, which runs `enqueueKnownContainersForIdleBackfill` |
| `Start` | `publishHydration` in the local projection: the hydrated signal, then one `transitionOwedDiscoveryResume` step on its hydrated event, with an acknowledgement latched in `pendingConnectionAcknowledged` |
| `ResumeOwed` / `Owed` | the owed-discovery signal, which `connectReconciliationTriggers` maps to `resumeOwedDiscovery`, queueing `listOwedDocumentLaneContainerIds` at idle priority |
| `Connect` | `beginConnectAttempt`, which sets `serverEventsPendingConnectAttempt` |
| `Acknowledge` | `setConnected` advancing `serverEventsConnectionGeneration`; the connection-acknowledged signal runs `reconcileAcknowledgedConnection`, whose `sweepKnownContainers` lists every known lane |
| `AttemptEnds` | `endConnectAttempt` clearing the pending attempt; the runtime event of `transitionOwedDiscoveryResume` then resumes a waiting start |
| `Disconnect` | `setConnected` with false |
| `BeginListing` | `discoverContainerDocumentLanes` paging every lane through `listAllContainerDocumentLanes` |
| `ApplyLane` | `applyListedContainerDocuments`: `verifyDiscoveredDocuments`, the projection upserts, then `recordContainerDocumentListing` writing the cursor and the settled mark in one `recordLaneFetch` statement |
| `RetryLane` | the in-memory `onPendingDiscovery` retry of a lane holding staged candidates |
| `Crash` / `Restart` | a reload or process exit; `stopReconciliationService` on the old scope |

`UnappliedLaneIsOwed` requires durable evidence that a lane still owes a
listing for as long as its document is missing: no settled mark, or a staged
candidate. `SettledLaneIsApplied` requires that the settled mark means the
lane's documents are in the projection. `OwedListedOnce` requires that an
attempt's catch-up never re-lists lanes the same start's resume listed while
that attempt was pending. `Converges` requires every lane's document to reach
the projection once crashes stop, whether or not any connection is ever
acknowledged, and `LanesSettle` requires every lane to settle, so later
resumes list nothing. Weak fairness covers the device's own steps (the start,
the listing, each lane's apply, the retry timer, and the restart) and the
resolution of a pending attempt: it is acknowledged or it ends. Nothing makes
the device connect.

Four guards are parameters with registered negative controls:

- `ResumeOwedOnStart = FALSE` leaves the owed lanes to an acknowledgement.
  A crash between the listing and a lane's apply, followed by starts that
  never connect, leaves that lane unlisted forever, violating `Converges`.
- `DeferToAcknowledgement = FALSE` resumes the owed lanes at hydration even
  while an attempt is pending. Its acknowledgement's catch-up then lists them
  again, violating `OwedListedOnce`.
- `SettleWithApply = FALSE` writes the settled mark when the listing arrives.
  A crash before the lane applies leaves it settled without its document,
  violating `UnappliedLaneIsOwed`.
- `SettleOnlyWhenComplete = FALSE` settles a lane whose listing deferred a
  candidate, violating `SettledLaneIsApplied`. The staged candidate still owes
  the lane, so the device converges, but the mark no longer means what the
  start relies on.

The bounded configuration uses two lanes, at most two crashes, and at most one
deferral. TLC explores 5,808 generated states, 1,303 distinct states, and
depth 24.

[`DiscoveryPublication.tla`](./DiscoveryPublication.tla) covers what a single
listing returns. Here the server's documents are fixed: the account's content
exists before the device signs in. A peer's write after a lane settles reaches
it through a hint, a visit, or the next acknowledged connection's catch-up;
[`DocumentListingConvergence.tla`](./DocumentListingConvergence.tla) covers
those edits for documents the device holds.
Access changes and remote resets, which delete a lane's row and so owe it
again, are also outside the model. Head verification, tombstones, and the
order in which lanes apply are abstracted: any lane in the listing may apply
next. A connect attempt that a reconnect replaces is modelled as
`AttemptEnds` followed by `Connect`, so the resume runs between them and
`OwedListedOnce` does not cover the replacement: in the code the resume runs
while the replacement is pending, and that attempt's catch-up can list the
resumed lanes again.
