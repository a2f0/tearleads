import type { NegativeControl } from "./protocolNegativeControlTypes";

const METADATA_LISTING_MODULE =
  "formal/document-sync/MetadataListingConvergence.tla";
const METADATA_LISTING_CONFIG =
  "formal/document-sync/MetadataListingConvergence.cfg";
const METADATA_LISTING_VOIDS_CONFIG =
  "formal/document-sync/MetadataListingConvergenceVoids.cfg";

export const METADATA_LISTING_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "discovery-publication-without-lock",
    module: "formal/document-sync/DiscoveryPublication.tla",
    config: "formal/document-sync/DiscoveryPublication.cfg",
    constants: { SerializePublication: "FALSE" },
    expect: { kind: "invariant", name: "NeverSkip" },
    why: "A writer can commit its smaller position after the client has paged past another writer's larger position.",
  },
  {
    id: "metadata-listing-watermark-before-debt",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { OweBeforeWatermark: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A listing that advances the lane watermark past a row before owing its metadata read loses the only evidence of a lost hint when the process stops in between.",
  },
  {
    id: "metadata-listing-settles-stale-read",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { SettleOnlyIfUnchanged: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A read that started before a peer's hinted edit must not clear that hint with its older snapshot: the lane watermark may already have passed the row, and nothing re-lists it until the next connection.",
  },
  {
    id: "metadata-listing-resumed-pull-settles",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { SettleResumedPull: "TRUE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A pass that resumes an earlier paginated pull stops at that pull's upper bound and must not clear a hint for a newer edit.",
  },
  {
    id: "metadata-listing-covers-by-content",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_VOIDS_CONFIG,
    constants: { CoverByProcessedCount: "FALSE" },
    expect: { kind: "liveness", name: "DebtsSettle" },
    why: "A listing covered only by the updates whose content the client holds never counts a void update, so the read it owes can never settle and is owed again on every listing.",
  },
  {
    id: "metadata-listing-forgets-durable-debt",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { RestoreOnStart: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A debt written before a crash is never read if the store's first pass does not requeue it, because the lane watermark already passed the row.",
  },
  {
    id: "metadata-listing-no-relist-after-ack",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { RelistOnAcknowledge: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "An edit whose hint was lost while disconnected or closed is found only by the re-list that follows an acknowledged connection.",
  },
];
