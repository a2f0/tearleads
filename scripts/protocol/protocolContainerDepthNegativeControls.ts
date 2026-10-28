import type { NegativeControl } from "./protocolNegativeControls";

const MODULE = "formal/container-keying/ContainerDepth.tla";
const CONFIG = "formal/container-keying/ContainerDepth.cfg";

export const CONTAINER_DEPTH_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "container-create-exceeds-readable-depth",
    module: MODULE,
    config: CONFIG,
    constants: { GuardCreateDepth: "FALSE" },
    expect: { kind: "invariant", name: "HonestReadsAvailable" },
    why: "Creating below the maximum readable path strands the new container (#2365).",
  },
  {
    id: "container-move-exceeds-readable-depth",
    module: MODULE,
    config: CONFIG,
    constants: { GuardMoveDepth: "FALSE" },
    expect: { kind: "invariant", name: "HonestReadsAvailable" },
    why: "Moving a leaf below the maximum readable path strands it (#2365).",
  },
  {
    id: "container-move-strands-deep-descendant",
    module: MODULE,
    config: CONFIG,
    constants: { GuardSubtreeDepth: "FALSE" },
    expect: { kind: "invariant", name: "HonestReadsAvailable" },
    why: "A moved root can fit while a descendant becomes unreadable (#2365).",
  },
  {
    id: "container-reader-bound-below-commit-bound",
    module: MODULE,
    config: CONFIG,
    constants: { ClientReadMax: "2" },
    expect: { kind: "invariant", name: "HonestReadsAvailable" },
    why: "A reader that walks fewer containers than writers may commit cannot read the deepest honest path (#2365 H1).",
  },
  {
    id: "container-move-under-own-descendant",
    module: MODULE,
    config: CONFIG,
    constants: { GuardMoveCycle: "FALSE" },
    expect: { kind: "invariant", name: "PathsReachRoot" },
    why: "Moving a container under its own descendant detaches the cycle from the root.",
  },
];
