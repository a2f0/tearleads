import type { NegativeControl } from "./protocolNegativeControls";

export const HISTORY_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "principal-history-write-cap-blocks-revocation",
    module: "formal/container-keying/PrincipalHistory.tla",
    config: "formal/container-keying/PrincipalHistory.cfg",
    constants: { CapWrites: "TRUE" },
    expect: { kind: "invariant", name: "RevocationAvailable" },
    why: "An authorized principal revocation must advance beyond the former history ceiling (#2442).",
  },
  {
    id: "principal-history-cold-recovery-cap",
    module: "formal/container-keying/PrincipalHistory.tla",
    config: "formal/container-keying/PrincipalHistory.cfg",
    constants: { CapReads: "TRUE" },
    expect: { kind: "invariant", name: "RecoveryCanProgress" },
    why: "Cache loss must not strand a previously accepted principal history (#2442).",
  },
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
