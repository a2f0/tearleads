import type { NegativeControl } from "./protocolNegativeControlTypes";

const METADATA_LISTING_MODULE =
  "formal/document-sync/MetadataListingConvergence.tla";
const METADATA_LISTING_CONFIG =
  "formal/document-sync/MetadataListingConvergence.cfg";

export const METADATA_LISTING_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "metadata-listing-timestamp-stalls",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { StrictTimestamps: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "An edit stamped in the same millisecond, or by an instance whose clock trails, leaves the listed timestamp where the client recorded it, so a lost hint has no evidence left.",
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
    id: "metadata-listing-records-before-owing",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { OweBeforeRecord: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A re-list that records the listed timestamp before it owes the read loses the only evidence of a lost metadata hint when the process stops in between.",
  },
  {
    id: "metadata-listing-settles-stale-read",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { SettleOnlyIfUnchanged: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A read that started before a re-list owed a newer edit must not settle that debt with its older snapshot.",
  },
  {
    id: "metadata-listing-forgets-durable-debt",
    module: METADATA_LISTING_MODULE,
    config: METADATA_LISTING_CONFIG,
    constants: { RestoreOnStart: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A debt written before a crash is never read if startup does not requeue it, because the recorded timestamp already hides the change from the next re-list.",
  },
];
