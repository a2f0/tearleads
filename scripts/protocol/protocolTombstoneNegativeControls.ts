import type { NegativeControl } from "./protocolNegativeControls";

export const TOMBSTONE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "tombstone-purges-local-work",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { PreserveWork: "FALSE" },
    expect: { kind: "invariant", name: "LocalWorkSurvives" },
    why: "Erasing work on an unsigned hint loses queued rename, creation, and move intent.",
  },
  {
    id: "tombstone-omits-descendant-fences",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { FenceAllRemoved: "FALSE" },
    expect: { kind: "invariant", name: "LateProofNeverRestores" },
    why: "A cascade without descendant fences lets a pre-removal request resurrect a child.",
  },
  {
    id: "tombstone-trusts-unsigned-clock",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { IgnoreUnsignedClock: "FALSE" },
    expect: { kind: "invariant", name: "ObservedLiveProofCanRestore" },
    why: "An unsigned future clock blocks a fresh verified proof of a still-live container.",
  },
  {
    id: "tombstone-allows-late-restore",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { UseGeneration: "FALSE" },
    expect: { kind: "invariant", name: "LateProofNeverRestores" },
    why: "Ignoring generation changes accepts a proof fetched before a newer local removal.",
  },
];
