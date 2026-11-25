import type { NegativeControl } from "./protocolNegativeControlTypes";

const DOCUMENT_LISTING_MODULE =
  "formal/document-sync/DocumentListingConvergence.tla";
const DOCUMENT_LISTING_CONFIG =
  "formal/document-sync/DocumentListingConvergence.cfg";

export const DOCUMENT_LISTING_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
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
