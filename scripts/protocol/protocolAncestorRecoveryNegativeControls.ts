import type { NegativeControl } from "./protocolNegativeControlTypes";

const ANCESTOR_RECOVERY_MODULE = "formal/container-keying/AncestorRecovery.tla";
const ANCESTOR_RECOVERY_CONFIG = "formal/container-keying/AncestorRecovery.cfg";

export const ANCESTOR_RECOVERY_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "ancestor-read-requires-current-parent",
    module: ANCESTOR_RECOVERY_MODULE,
    config: ANCESTOR_RECOVERY_CONFIG,
    constants: { StrictReadParentPin: "TRUE" },
    expect: { kind: "invariant", name: "HonestReadsAvailable" },
    why: "Accepting only the parent's current epoch for reads makes the first root rotation refuse every honest descendant read.",
  },
  {
    id: "ancestor-read-trusts-epoch-range",
    module: ANCESTOR_RECOVERY_MODULE,
    config: ANCESTOR_RECOVERY_CONFIG,
    constants: { CheckSignedLineage: "FALSE" },
    expect: { kind: "invariant", name: "UnknownEpochRefused" },
    why: "Without the signed-lineage check a read accepts a root epoch the server invented because it falls inside a numeric range.",
  },
  {
    id: "ancestor-write-over-stale-pin",
    module: ANCESTOR_RECOVERY_MODULE,
    config: ANCESTOR_RECOVERY_CONFIG,
    constants: { CheckWriteCurrency: "FALSE" },
    expect: { kind: "invariant", name: "StaleWritesRefused" },
    why: "Without the write currency rule a write commits over a path whose child or grandchild still pins a retired parent epoch.",
  },
  {
    id: "ancestor-writer-cannot-repair",
    module: ANCESTOR_RECOVERY_MODULE,
    config: ANCESTOR_RECOVERY_CONFIG,
    constants: { WriterRepairs: "FALSE" },
    expect: { kind: "liveness", name: "WriterEventuallyWrites" },
    why: "A writer that cannot re-key its own stale path after a root rotation can never write again without another device acting first.",
  },
];
