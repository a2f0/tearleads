import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/document-sync/PeerOwnership.tla";
const CONFIG = "formal/document-sync/PeerOwnership.cfg";

export const PEER_OWNERSHIP_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "peer-ownership-skipped",
    module: MODULE,
    config: CONFIG,
    constants: { NoOwnership: "TRUE" },
    expect: { kind: "invariant", name: "NoPreemption" },
    why: "Without the owner rule a member who read a device's peer commits its next counter before the device's own update lands (#3194).",
  },
  {
    id: "peer-ownership-refuses-reassertion",
    module: MODULE,
    config: CONFIG,
    constants: { RefuseForeignSpans: "TRUE" },
    expect: { kind: "invariant", name: "ReassertionsNeverRefused" },
    why: "Refusing a span within the committed frontier on another user's peer refuses an honest lagging delta or rotation baseline that re-asserts operations it pulled (#3194).",
  },
  {
    id: "peer-ownership-no-rebase",
    module: MODULE,
    config: CONFIG,
    constants: { NoRebase: "TRUE" },
    expect: { kind: "liveness", name: "HonestWorkEventuallyCommitted" },
    why: "A device whose peer a recreation claimed is refused on every retry unless it moves its unsent operations to a fresh peer (#3194).",
  },
  {
    id: "peer-ownership-public-peers",
    module: MODULE,
    config: CONFIG,
    constants: { PublicPeers: "TRUE" },
    expect: { kind: "invariant", name: "HonestUpdatesAccepted" },
    why: "A peer named before its first commit lets a squatter claim the device's first counters, so the device's update is a re-assertion every reader voids (#3194).",
  },
];
