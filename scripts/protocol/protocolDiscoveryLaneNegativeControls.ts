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
    why: "A start with a cached tree raises no hint for a lane the tree already holds, and its connect attempt may end without an acknowledgement, so a lane whose listing a reload cut short is never listed again unless the start resumes it.",
  },
  {
    id: "discovery-lane-resume-races-acknowledgement",
    module: DISCOVERY_LANE_MODULE,
    config: DISCOVERY_LANE_CONFIG,
    constants: { DeferToAcknowledgement: "FALSE" },
    expect: { kind: "invariant", name: "OwedListedOnce" },
    why: "The catch-up after an acknowledged connection lists every known lane, so a resume that lists the owed lanes while that attempt is pending lists each of them twice.",
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
  {
    id: "discovery-lane-unacknowledged-start-skips-tree-crawl",
    module: DISCOVERY_LANE_MODULE,
    config: DISCOVERY_LANE_CONFIG,
    constants: { CatchUpSettledOnUnacknowledgedStart: "FALSE" },
    expect: { kind: "invariant", name: "UnacknowledgedStartCoversMovedLanes" },
    why: "Issue #3291: without crawling the tree from its watermark on an unacknowledged start, a settled folder whose server row moved while the device was closed is left unowed and stale.",
  },
  {
    id: "discovery-lane-unacknowledged-session-never-polls",
    module: DISCOVERY_LANE_MODULE,
    config: DISCOVERY_LANE_CONFIG,
    constants: { PollWhileUnacknowledged: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "Issue #3291: a peer write committed after an unacknowledged start settles emits no hint and is never discovered without periodic watermarked catch-up while realtime stays unacknowledged.",
  },
];
