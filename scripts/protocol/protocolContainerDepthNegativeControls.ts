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
];
