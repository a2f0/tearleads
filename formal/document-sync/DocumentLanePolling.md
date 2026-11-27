# Document Lane Polling Mapping

[`DocumentLanePolling.tla`](./DocumentLanePolling.tla) models how a client
finds a change to a folder's document lane without listing every document lane
it knows after each acknowledged connection.
[DocumentListingConvergence](./DocumentListingConvergence.md) starts from a
listing of the lane and shows that the listing finds a peer's edit. This model
is the step before it: what makes the client list the lane at all.
[CatchUpCoordination](./CatchUpCoordination.md) models the catch-up state
machine's deferral, superseding, overdue turn bound, and fallback-vouching
rules around that crawl.

Every server write that changes what a container's document lane returns also
republishes the container's row: a content write, an attachment bind or
detach, a create, a link, an unlink and a purge each touch the containers the
document is linked into. The row then sits past the watermark of the lane that
serves it, which is the parent's child lane, or the root lane for a container
granted directly. After each acknowledged connection the container store
lists the root lane and every known folder's child lane from their
watermarks. A row it is served owes that container's document lane one
listing, in `document_lane_revalidations`, before the row is applied and
before the serving lane's watermark passes it. Tree listings outside a
catch-up (a hint's tree listing, a start's, or a retried crawl) owe the lane
the same way with no sweep behind them. The catch-up that follows the crawl
lists every lane a durable record says is owed, and nothing else.

A listing reads the request's revision before it is sent and settles only that
revision, and only when it succeeds and applies with no candidate left pending.
A listing already in flight when the row was served may have been answered
before the write behind it, so it leaves the newer request in place. A failed
or refused listing leaves the watermark behind and keeps the durable request
open. A hint reaches the client only while it is up and its interest is
acknowledged, and forces a listing of the lane. A crash loses memory, the
socket and in-flight work; both watermarks and the request survive.

| Model action | Production seam |
| --- | --- |
| `PeerWrite` | a write that changes the document lane and republishes the linked containers: `touchAcceptedSyncTargets`, `finalizeAttachmentMutation`, `recordDocumentLinkSetChange`, a create's `touchContainers`, and a purge's `publishDocumentPurge`; its hint reaches `enqueueReconciliationForEvents` |
| `OtherTouch` | `touchContainerStructure` for a grant or a rekey, or a metadata edit's `touchAcceptedSyncTargets` |
| `Crash` | a reload or process exit; `stopReconciliationService` drops in-memory state and in-flight work |
| `Start` | process restart reloading durable watermarks and owed requests from `findOwedDocumentLaneListings` |
| `Disconnect` | `setConnected` with false on the runtime event source |
| `Acknowledge` | `consumePendingContainerContentsReconnectRefresh` after the interest acknowledgement advances the connection generation |
| `BeginCrawl` | `fetchContainerParentLaneBatch` listing the lane that serves the container from its saved watermark |
| `CrawlOwe` | `oweServedDocumentLanes` in `applyContainerParentLanePage`, through the store host's `requestDocumentLaneListings` |
| `CrawlPass` | `checkpointPage` saving the serving lane's watermark with `markContainerParentLaneFetched` |
| `FinishCrawl` | the reconnect crawl settling: `crawlSettled` on the scope's `getOrCreateTreeCatchUp` port, which releases `whenCrawlSettles` |
| `OutsideTreeListing` | `applyContainerParentLanePage` outside a reconnect crawl (a hint's tree listing, a start's, or a retried crawl) calling `oweServedDocumentLanes` and `checkpointPage` with no catch-up sweep behind it |
| `SweepListing` | `requestAcknowledgedConnectionSweep` planning with `listOwedDocumentLaneContainerIds`; the listing reads the request with `findOwedDocumentLaneListings` before `listContainerDocumentLanesFromApi` |
| `HintListing` | `enqueueContainer` with a force, listed by `reconcileMarkedContainers` |
| `FailListing` | a failed or incomplete listing in `reconcileMarkedContainers` that leaves `settleOwedDocumentLaneListing` uncalled and retries on the lane (a refused or superseded lane likewise leaves the request open for the next catch-up or start) |
| `FinishListing` | `applyListedContainerDocuments` saving the lane's watermark, then `settleOwedDocumentLaneListing` for the request read before the listing |

`LaneEvidenceRetained` requires that while the document lane holds a change
the client has not listed, something still obliges a listing: a durable
request, a container row the next crawl will be served, an in-progress crawl
that saw the row and has not yet owed its listing, or, while the process is
up, a pending hint or a listing in flight that captured the change.
`Converges` requires that once writes, crashes and disconnects stop, the
client has listed every change to the lane. `DebtsSettle` requires that every
owed listing settles once an acknowledged connection's catch-up runs for it;
only a request written by an outside tree listing while already connected
waits for the next acknowledged connection. Weak fairness covers only the
client's own steps and the server's delivery of the interest acknowledgement.

Five guards are parameters with registered negative controls:

- `TouchFolderOnWrite = FALSE` lets a write change the document lane without
  republishing the container's row, as a purge did before it touched its
  container. With its hint lost, nothing ever points at the lane, violating
  `LaneEvidenceRetained`.
- `OweBeforeParentWatermark = FALSE` saves the serving lane's watermark past
  the row before owing the listing. A crash in between leaves no evidence,
  violating `LaneEvidenceRetained`.
- `SettleOnlyIfUnchanged = FALSE` lets a listing that began before a write
  settle the request that write caused, violating `LaneEvidenceRetained`.
- `ListDurableDebts = FALSE` lists only the lanes the catch-up's own crawl
  owed. A request written before a crash is then never listed, because the
  serving lane's watermark already passed the row, violating `Converges`.
- `SettleOnFailedListing = TRUE` settles the durable request when a listing
  fails without advancing the lane's watermark, violating
  `LaneEvidenceRetained`.

[`DocumentLanePolling.cfg`](./DocumentLanePolling.cfg) allows three writes to
the lane, one other touch of the container, two crashes, one disconnect, one
failed listing, and one outside tree listing. TLC explores 4,257,295 generated
states, 1,013,488 distinct states, and depth 33.

The model has one container and one lane that serves its row. The root lane
is also listed from no watermark, for the containers it holds now; that
listing owes nothing and saves no cursor, and is not modeled. A crawl that
did not complete vouches for nothing: the catch-up then falls back to listing
every known lane except those listed cleanly after the latest acknowledgement
with no candidate left pending (fenced per container by `pendingGenerations`
against older concurrent batches in `catchUpMachine.ts`, and checked in
[CatchUpCoordination](./CatchUpCoordination.md)) and not forced since. A start
whose connection is never acknowledged is outside the model
([DiscoveryLaneResumption](./DiscoveryLaneResumption.tla) covers the lanes
such a start resumes). The serialized publication order that makes "past the
watermark" mean "not yet served" is [DiscoveryPublication](./DiscoveryPublication.tla)'s
subject. A change to what a lane returns that publishes no row at all is
outside the model, and was outside the listing it replaces too: access gained
or lost through a principal policy changes each row's effective access level
without republishing the row, and a listing from a watermark returned nothing
for it before this change as well.

The model has one server that answers every listing from its current state.
Two things production does are assumptions here, not checked properties. A
document-lane listing is assumed to see everything the crawl's page saw: it
carries no publication floor, so a listing answered from an older snapshot
than the page that served the container's row would settle the request
without the change. Production reads one primary database with no query
cache. If replicas or a cache arrive, the request row would keep the
checkpoint of the page that served the row, and the listing would send it
as its floor, as a listing sent `afterParentPage` already does. And each
settling listing is assumed to be answered by its own request: production
passes the explicit `inFlight: "ownRequest"` option on
`listContainerDocumentLanesFromApi` so each settling listing carries unique
lane ids and never joins an earlier in-flight request (`"mayJoin"` is used
only by the initial probe in `createProbeLaneListing`, which moves no
watermark and settles no request).

The idle backfill a regain queues waits for the connect attempt in flight and
is raised behind the catch-up an acknowledgement owes, which takes its lanes
over; after an attempt that ends without one it lists them. It only adds
listings and is not modelled.
