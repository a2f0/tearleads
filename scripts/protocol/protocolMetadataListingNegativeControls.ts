import type { NegativeControl } from "./protocolNegativeControlTypes";

const METADATA_LISTING_MODULE =
  "formal/document-sync/MetadataListingConvergence.tla";
const METADATA_LISTING_CONFIG =
  "formal/document-sync/MetadataListingConvergence.cfg";

export const METADATA_LISTING_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
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
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A read that started before a listing owed a newer edit must not settle that debt with its older snapshot.",
  },
  {
    id: "metadata-listing-resumed-pull-settles",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { SettleResumedPull: "TRUE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A pass that resumes an earlier paginated pull stops at that pull's upper bound and must not settle a debt for a newer edit.",
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
