# Discovery Lane Resumption Mapping

[`DiscoveryLaneResumption.tla`](./DiscoveryLaneResumption.tla) models a device
listing the document lanes of the containers it learns at sign-in, while a
reload can stop it at any point and peers can commit later writes after a lane
settles. It is the restart and unacknowledged-session half of discovery: the
publication model checks that a listing never skips a committed row, and
assumes the client keeps reading.

The sign-in boot learns every lane from the remote tree (version 1), and
membership growth queues them all. A batched listing pages the queued lanes
from their cursors (production takes up to four lanes per reconciler run; the
model lists every queued lane at once); the lanes then verify and apply one at
a time. Verification may defer a document whose signed head is not yet
available: the candidate is staged durably, and an in-memory timer retries the
lane. A crash loses the queue, the listing in flight, and the timers. The
projection, the cursor, the lane's settled mark, the tree watermark, durable
revalidation requests, and staged candidates survive. A later start publishes
the cached tree, which raises no hint for a lane the tree already holds.

Peers can also write new documents or edits after a lane settles. When the
socket holds an acknowledged connection, a realtime hint queues the lane;
otherwise the hint is lost and the server's container row sits past the
device's tree watermark. Two paths catch up on a later start. The catch-up
after an acknowledged connection crawls the tree and lists every owed lane (and
[DocumentLanePolling](./DocumentLanePolling.md) covers the crawl-vouching
optimization; here the acknowledged path lists every lane, which is more). But
a connect attempt can end without an acknowledgement, and a device may not
connect at all. On an unacknowledged start, the resume runs a watermarked tree
crawl (`crawlTreeForCatchUp`) so settled lanes whose server row moved record a
durable `document_lane_revalidations` request, and lists every owed lane. It
waits while a connect attempt is pending, so an acknowledgement that arrives
while the start waits lists each owed lane once, in its catch-up; the resume
runs when the attempt ends without one or none was pending. Once the resume has
run, while the device stays online without an acknowledged connection or
connect attempt in flight, periodic watermarked catch-up
(`transitionUnacknowledgedCatchUp`) discovers peer writes made after startup.
A later acknowledged connection is a new catch-up and may list any lane again.

Issue #3255 was the cut-short sign-in gap; issue #3291 was the settled-lane
staleness gap when a start or ongoing session has no acknowledged realtime
connection. The seams of
[`DiscoveryLaneResumption.tla`](./DiscoveryLaneResumption.tla):

| Model action or predicate | Production seam |
| --- | --- |
| `Init` | remote tree growth raising the remote-containers-added signal, which runs `enqueueKnownContainersForIdleBackfill` |
| `Start` | `publishHydration` in the local projection: the hydrated signal, then one `transitionOwedDiscoveryResume` step on its hydrated event, with an acknowledgement latched in `pendingConnectionAcknowledged` |
| `ResumeOwed` / `Owed` | the owed-discovery signal, which `connectReconciliationTriggers` maps to `resumeOwedDiscovery`, running `crawlTreeForCatchUp` and listing `listOwedDocumentLaneContainerIds` |
| `PollUnacknowledged` | periodic unacknowledged catch-up scheduled by `transitionUnacknowledgedCatchUp` when online with no acknowledged connection (including across flapping reconnect attempts) |
| `PeerWrite` | a peer document create or update calling `touchContainers` to move the container row past the tree watermark and publishing a best-effort realtime hint |
| `Connect` | `beginConnectAttempt`, which sets `serverEventsPendingConnectAttempt` |
| `Acknowledge` | `setConnected` advancing `serverEventsConnectionGeneration`; the connection-acknowledged signal runs `reconcileAcknowledgedConnection`, whose `sweepKnownContainers` lists every owed lane |
| `AttemptEnds` | `endConnectAttempt` clearing the pending attempt, or the app's acknowledgement deadline doing so; the runtime event of `transitionOwedDiscoveryResume`, decided by `transitionConnectAttemptWait`, then resumes a waiting start |
| `Disconnect` | `setConnected` with false |
| `BeginListing` | `discoverContainerDocumentLanes` paging every lane through `listAllContainerDocumentLanes` |
| `ApplyLane` | `applyListedContainerDocuments`: `verifyDiscoveredDocuments`, the projection upserts, then `recordContainerDocumentListing` writing the cursor, settling `document_lane_revalidations`, and setting the settled mark |
| `RetryLane` | the in-memory `onPendingDiscovery` retry of a lane holding staged candidates |
| `Crash` / `Restart` | a reload or process exit; `stopReconciliationService` on the old scope |

`UnappliedLaneIsOwed` requires durable evidence that a lane still owes a
listing whenever the projection lags the version observed by the tree crawl.
`SettledLaneIsApplied` requires that a settled lane without a pending
revalidation holds every version its tree crawl observed. `OwedListedOnce`
requires that an attempt's catch-up never re-lists lanes the same start's
resume listed while that attempt was pending.
`UnacknowledgedStartCoversMovedLanes` requires an unacknowledged start's resume
to crawl the tree so settled lanes whose server row moved are owed immediately.
`Converges` requires every lane's latest server version to reach the projection
once crashes and peer writes stop, whether or not any connection is ever
acknowledged, and `LanesSettle` requires every lane to settle. Weak fairness
covers the device's own steps (including periodic unacknowledged catch-up) and
the resolution of a pending attempt. Nothing makes the device connect.

Six guards are parameters with registered negative controls:

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
- `CatchUpSettledOnUnacknowledgedStart = FALSE` skips the watermarked tree
  crawl during an unacknowledged start's resume, leaving a settled folder whose
  server row moved while closed unowed, violating
  `UnacknowledgedStartCoversMovedLanes`.
- `PollWhileUnacknowledged = FALSE` disables periodic watermarked catch-up
  while unacknowledged after startup, leaving a peer write made after an
  unacknowledged start undiscovered when no connection is ever acknowledged,
  violating `Converges`.

The bounded configuration uses two lanes, at most one crash, at most one
deferral, and at most one peer write. TLC explores 40,546 generated states,
8,451 distinct states, and depth 23.

[`DiscoveryPublication.tla`](./DiscoveryPublication.tla) covers what a single
listing returns, and
[`DocumentListingConvergence.tla`](./DocumentListingConvergence.tla) covers
document content edits for documents the device already holds. Access changes
and remote resets, which delete a lane's row and so owe it again, are outside
the model. Head verification, tombstones, and the order in which lanes apply
are abstracted: any lane in the listing may apply next. A connect attempt that
a reconnect replaces is modelled as `AttemptEnds` followed by `Connect`, so the
resume runs between them and `OwedListedOnce` does not cover the replacement.
