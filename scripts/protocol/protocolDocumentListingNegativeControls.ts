import type { NegativeControl } from "./protocolNegativeControlTypes";

const DOCUMENT_LISTING_MODULE =
  "formal/document-sync/DocumentListingConvergence.tla";
const DOCUMENT_LISTING_CONFIG =
  "formal/document-sync/DocumentListingConvergence.cfg";

const SHARED_DATABASE_MODULE = "formal/document-sync/SharedDatabaseListing.tla";
const SHARED_DATABASE_CONFIG = "formal/document-sync/SharedDatabaseListing.cfg";

const LANE_POLLING_MODULE = "formal/document-sync/DocumentLanePolling.tla";
const LANE_POLLING_CONFIG = "formal/document-sync/DocumentLanePolling.cfg";

export const DOCUMENT_LISTING_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "document-lane-write-without-folder-touch",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { TouchFolderOnWrite: "FALSE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A catch-up lists only the document lanes whose container row a tree listing was served. A write that changes a lane without republishing its container, as a purge once did, leaves nothing to point at the lane when its hint is lost.",
  },
  {
    id: "document-lane-watermark-before-request",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { OweBeforeParentWatermark: "FALSE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A tree listing that saves its lane's watermark past a container's row before owing that container's document lane a listing loses the only evidence the lane moved when the process stops in between.",
  },
  {
    id: "document-lane-settled-by-older-listing",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { SettleOnlyIfUnchanged: "FALSE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A listing already in flight when a tree listing was served the container's row may have been answered before the write behind that row. It must not settle the request the row caused.",
  },
  {
    id: "document-lane-forgets-durable-request",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { ListDurableDebts: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A request written before a crash names a lane whose container row the next tree listing is not served again, because the watermark already passed it. A catch-up that lists only what its own crawl owed never lists that lane.",
  },
  {
    id: "shared-database-listing-reads-debts-only",
    module: SHARED_DATABASE_MODULE,
    config: SHARED_DATABASE_CONFIG,
    constants: { PullWhenSavedElsewhere: "FALSE" },
    expect: { kind: "invariant", name: "OpenCopyEvidenceRetained" },
    why: "Two tabs on one database share the lane watermark and the listing debt. A tab that reconnects after the other one listed the row, read the edit and settled the debt finds nothing owed, and its open copy stays the older one unless the catch-up also compares it with the saved record.",
  },
  {
    id: "document-listing-watermark-before-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { OweBeforeWatermark: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A listing that advances the lane watermark past a document's row before owing its read loses the only evidence of a lost hint when the process stops in between: no store probes the document on its own.",
  },
  {
    id: "document-listing-settles-lagging-read",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { SettleOnlyIfCovered: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A pull served by a replica that lags the listing can complete without the edit; settling the debt on it leaves an unread update that nothing will list again.",
  },
  {
    id: "document-listing-applies-before-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { OweBeforeApply: "FALSE" },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "Applying a listed row whose access head is newer drops the key bundle the record held. A debt checked only afterwards finds no head to compare, so an open store keeps the access context of the older head and nothing lists the row again.",
  },
  {
    id: "document-listing-settles-stale-read",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    // Without head moves, so the hinted edit is the only thing the read loses.
    constants: { MaxHeadMoves: "0", SettleOnlyIfUnchanged: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A read that started before a peer's hinted edit must not clear that hint with its older snapshot.",
  },
  {
    id: "document-listing-settles-debt-with-older-read",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { SettleOnlyIfUnchanged: "FALSE" },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "A read that started before the access head moved must not settle the debt a later listing owed for that move: its snapshot predates the head, and the watermark already passed the row.",
  },
  {
    id: "document-listing-drops-closed-store-hint",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { RememberClosedStoreHint: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A hint that names a document with no loaded store reaches nothing, and a covered store arms no probe when it loads, so the edit waits for the next connection's listing.",
  },
  {
    id: "document-listing-forgets-durable-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { RestoreOnOpen: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A debt written before a crash, or before the document's store opened, is never read if a loading store does not look for it, because the lane watermark already passed the row.",
  },
  {
    id: "document-listing-no-relist-after-ack",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { RelistOnAcknowledge: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "An edit whose hint was lost while disconnected or closed is found only by the listing that follows an acknowledged connection.",
  },
];
