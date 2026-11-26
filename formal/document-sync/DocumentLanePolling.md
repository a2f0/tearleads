# Document Lane Polling Mapping

[`DocumentLanePolling.tla`](./DocumentLanePolling.tla) models how a client
finds a change to a folder's document lane without listing every document lane
it knows after each acknowledged connection.
[DocumentListingConvergence](./DocumentListingConvergence.md) starts from a
listing of the lane and shows that the listing finds a peer's edit. This model
is the step before it: what makes the client list the lane at all.

Every server write that changes what a container's document lane returns also
republishes the container's row: a content write, an attachment bind or
detach, a create, a link, an unlink and a purge each touch the containers the
document is linked into. The row then sits past the watermark of the lane that
serves it, which is the parent's child lane, or the root lane for a container
granted directly. After each acknowledged connection the container store
lists the root lane and every known folder's child lane from their
watermarks. A row it is served owes that container's document lane one
listing, in `document_lane_revalidations`, before the row is applied and
before the serving lane's watermark passes it. The catch-up that follows the
crawl lists every lane a durable record says is owed, and nothing else.

A listing reads the request's revision before it is sent and settles only that
revision, and only when it applied with no candidate left pending. A listing
already in flight when the row was served may have been answered before the
write behind it, so it leaves the newer request in place. A hint reaches the
client only while it is up and its interest is acknowledged, and forces a
listing of the lane. A crash loses memory, the socket and in-flight work; both
watermarks and the request survive.

| Model action | Production seam |
| --- | --- |
| `PeerWrite` | a write that changes the document lane and republishes the linked containers: `touchAcceptedSyncTargets`, `finalizeAttachmentMutation`, `recordDocumentLinkSetChange`, a create's `touchContainers`, and a purge's `publishDocumentPurge`; its hint reaches `enqueueReconciliationForEvents` |
| `OtherTouch` | `touchContainerStructure` for a grant or a rekey, or a metadata edit's `touchAcceptedSyncTargets` |
| `Acknowledge` | `consumePendingContainerContentsReconnectRefresh` after the interest acknowledgement advances the connection generation |
| `BeginCrawl` | `fetchContainerParentLaneBatch` listing the lane that serves the container from its saved watermark |
| `CrawlOwe` | `oweServedDocumentLanes` in `applyContainerParentLanePage`, through the store host's `requestDocumentLaneListings` |
| `CrawlPass` | `checkpointPage` saving the serving lane's watermark with `markContainerParentLaneFetched` |
| `FinishCrawl` | the reconnect crawl settling: `crawlSettled` on the scope's `getOrCreateTreeCatchUp` port, which releases `whenCrawlSettles` |
| `SweepListing` | `requestAcknowledgedConnectionSweep` planning with `listOwedDocumentLaneContainerIds`; the listing reads the request with `findOwedDocumentLaneListings` before `listContainerDocumentsFromWatermarks` |
| `HintListing` | `enqueueContainer` with a force, listed by `reconcileMarkedContainers` |
| `FinishListing` | `applyListedContainerDocuments` saving the lane's watermark, then `settleOwedDocumentLaneListing` for the request read before the listing |

`LaneEvidenceRetained` requires that while the document lane holds a change
the client has not listed, something still obliges a listing: a durable
request, a container row the next crawl will be served, or, while the process
is up, a pending hint or a listing in flight that captured the change.
`Converges` requires that once writes, crashes and disconnects stop, the
client has listed every change to the lane, and `DebtsSettle` that every owed
listing is eventually settled. Weak fairness covers only the client's own
steps and the server's delivery of the interest acknowledgement.

Four guards are parameters with registered negative controls:

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

[`DocumentLanePolling.cfg`](./DocumentLanePolling.cfg) allows two writes to
the lane, one other touch of the container, one crash and one disconnect. TLC
explores 65,800 generated states, 18,636 distinct states, and depth 25.

The model has one container and one lane that serves its row. The root lane
is also listed from no watermark, for the containers it holds now; that
listing owes nothing and saves no cursor, and is not modeled. A crawl that
did not complete vouches for nothing: the catch-up then lists every known
lane, as it did before lanes were owed listings, which is also outside the
model, as is a start whose connection is never acknowledged
([DiscoveryLaneResumption](./DiscoveryLaneResumption.tla) covers the lanes
such a start resumes). The serialized publication order that makes "past the
watermark" mean "not yet served" is [DiscoveryPublication](./DiscoveryPublication.tla)'s
subject. A change to what a lane returns that publishes no row at all is
outside the model, and was outside the listing it replaces too: access gained
or lost through a principal policy changes each row's effective access level
without republishing the row, and a listing from a watermark returned nothing
for it before this change as well.
