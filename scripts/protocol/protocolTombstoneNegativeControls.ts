import type { NegativeControl } from "./protocolNegativeControls";

export const TOMBSTONE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "tombstone-purges-local-work",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { PreserveWork: "FALSE" },
    expect: { kind: "invariant", name: "LocalWorkSurvives" },
    why: "Unsigned listing removals must preserve work and allow verified recovery without racing newer observations (#2365 finding 8).",
  },
  {
    id: "tombstone-fences-descendants",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { FenceOnlyNamed: "FALSE" },
    expect: { kind: "invariant", name: "ChildHasNoInheritedFence" },
    why: "Unsigned listing removals must preserve work and allow verified recovery without racing newer observations (#2365 finding 8).",
  },
  {
    id: "tombstone-trusts-unsigned-clock",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { IgnoreUnsignedClock: "FALSE" },
    expect: { kind: "invariant", name: "ObservedLiveProofCanRestore" },
    why: "Unsigned listing removals must preserve work and allow verified recovery without racing newer observations (#2365 finding 8).",
  },
  {
    id: "tombstone-allows-late-restore",
    module: "formal/container-keying/ContainerTombstoneRecovery.tla",
    config: "formal/container-keying/ContainerTombstoneRecovery.cfg",
    constants: { UseGeneration: "FALSE" },
    expect: { kind: "action", name: "LateProofNeverRestores" },
    why: "Unsigned listing removals must preserve work and allow verified recovery without racing newer observations (#2365 finding 8).",
  },
];
