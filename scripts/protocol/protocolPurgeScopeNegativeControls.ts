import type { NegativeControl } from "./protocolNegativeControls";

export const PURGE_SCOPE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "subtree-purge-skips-candidate-scope",
    module: "formal/local-trust/SubtreePurgeScope.tla",
    config: "formal/local-trust/SubtreePurgeScope.cfg",
    constants: { CheckCandidatePath: "FALSE" },
    expect: { kind: "invariant", name: "DeletionStaysInScope" },
    why: "Subtree purge must preserve selected-root scope and pending placement work (#2485 finding 1).",
  },
  {
    id: "subtree-purge-skips-request-scope",
    module: "formal/local-trust/SubtreePurgeScope.tla",
    config: "formal/local-trust/SubtreePurgeScope.cfg",
    constants: { CheckRequestPath: "FALSE" },
    expect: { kind: "invariant", name: "DeletionStaysInScope" },
    why: "Subtree purge must preserve selected-root scope and pending placement work (#2485 finding 1).",
  },
  {
    id: "subtree-purge-skips-server-scope",
    module: "formal/local-trust/SubtreePurgeScope.tla",
    config: "formal/local-trust/SubtreePurgeScope.cfg",
    constants: { CheckServerPath: "FALSE" },
    expect: { kind: "invariant", name: "DeletionStaysInScope" },
    why: "Subtree purge must preserve selected-root scope and pending placement work (#2485 finding 1).",
  },
  {
    id: "subtree-purge-skips-pending-scope",
    module: "formal/local-trust/SubtreePurgeScope.tla",
    config: "formal/local-trust/SubtreePurgeScope.cfg",
    constants: { CheckPendingMove: "FALSE" },
    expect: { kind: "invariant", name: "PendingMoveSurvives" },
    why: "Subtree purge must preserve selected-root scope and pending placement work (#2485 finding 1).",
  },
  {
    id: "subtree-purge-skips-root-restore",
    module: "formal/local-trust/SubtreePurgeScope.tla",
    config: "formal/local-trust/SubtreePurgeScope.cfg",
    constants: { CheckRootPendingMove: "FALSE" },
    expect: { kind: "invariant", name: "PendingMoveSurvives" },
    why: "A pending restore of the selected root must preserve every candidate, including local-only content (#2485 finding 1).",
  },
];
