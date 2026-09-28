import type { NegativeControl } from "./protocolNegativeControls";

export const HISTORY_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "manifest-history-cold-read-bound",
    module: "formal/container-keying/ManifestHistory.tla",
    config: "formal/container-keying/ManifestHistory.cfg",
    constants: { IterativeVerification: "FALSE" },
    expect: { kind: "invariant", name: "HonestReadsAvailable" },
    why: "A warm accepted history must remain readable after cache eviction.",
  },
  {
    id: "manifest-history-mutation-cap-blocks-revocation",
    module: "formal/container-keying/ManifestHistory.tla",
    config: "formal/container-keying/ManifestHistory.cfg",
    constants: { CapMutations: "TRUE" },
    expect: { kind: "invariant", name: "RevocationAvailable" },
    why: "Limiting accepted history length cannot refuse an otherwise authorized revocation.",
  },
];
