import type { NegativeControl } from "./protocolNegativeControlTypes";

const DISCOVERY_LANE_MODULE =
  "formal/document-sync/DiscoveryLaneResumption.tla";
const DISCOVERY_LANE_CONFIG =
  "formal/document-sync/DiscoveryLaneResumption.cfg";

export const DISCOVERY_LANE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "discovery-lane-start-ignores-owed",
    module: DISCOVERY_LANE_MODULE,
    config: DISCOVERY_LANE_CONFIG,
    constants: { ResumeOwedOnStart: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A start with a cached tree raises no hint for a lane the tree already holds, so a lane whose listing a reload cut short is never listed again unless the start resumes it.",
  },
  {
    id: "discovery-lane-settles-on-receipt",
    module: DISCOVERY_LANE_MODULE,
    config: DISCOVERY_LANE_CONFIG,
    constants: { SettleWithApply: "FALSE" },
    expect: { kind: "invariant", name: "UnappliedLaneIsOwed" },
    why: "Settling a lane when its listing arrives, before the lane verifies and applies, leaves a settled lane without its documents when a reload lands in between.",
  },
  {
    id: "discovery-lane-settles-deferred",
    module: DISCOVERY_LANE_MODULE,
    config: DISCOVERY_LANE_CONFIG,
    constants: { SettleOnlyWhenComplete: "FALSE" },
    expect: { kind: "invariant", name: "SettledLaneIsApplied" },
    why: "A listing that deferred a candidate has not applied the lane's documents, so its settled mark would claim a complete lane.",
  },
];
