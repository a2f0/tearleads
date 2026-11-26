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
  {
    id: "peer-ownership-no-dependency-check",
    module: MODULE,
    config: CONFIG,
    constants: { NoDependencyCheck: "TRUE" },
    expect: { kind: "invariant", name: "ReadersAgree" },
    why: "Without the dependency rule a member commits an update depending on a device's next counter: the device, holding that op unsent, accepts it while every other reader voids it (#3194).",
  },
  {
    id: "peer-ownership-undeclared-dependency",
    module: MODULE,
    config: CONFIG,
    constants: { NoDeclaredJudge: "TRUE" },
    expect: { kind: "invariant", name: "ReadersAgree" },
    why: "Unless readers compare an update's dependencies with those it declares, a member declares none, passes the dependency rule, and the device alone accepts its update (#3194).",
  },
  {
    id: "peer-ownership-no-relay",
    module: MODULE,
    config: CONFIG,
    constants: { NoRelay: "TRUE" },
    expect: { kind: "invariant", name: "NoDuplication" },
    why: "A device that forks at a frontier a stale recreation lowered writes committed operations again on a fresh peer, and a reader holds both copies once the owner's other device republishes the originals (#3263).",
  },
  {
    id: "peer-ownership-forgets-relayed",
    module: MODULE,
    config: CONFIG,
    constants: { ForgetRelayed: "TRUE" },
    expect: { kind: "invariant", name: "NoDuplication" },
    why: "A relay queues committed operations again, so a device whose relay lowers what it saw committed to its queue's start takes them for unsent at the next refusal and forks them onto a fresh peer (#3263).",
  },
  {
    id: "peer-ownership-forgets-queued-history",
    module: MODULE,
    config: CONFIG,
    constants: { ForgetQueuedHistory: "TRUE" },
    expect: { kind: "invariant", name: "NoDuplication" },
    why: "A queued full history (a rotation baseline or a republished history) starts every peer at counter 0, so a device that lets it lower what it saw committed forks at a frontier that fell and writes another device's committed operation again on a fresh peer (#3263).",
  },
];
