import type { NegativeControl } from "./protocolNegativeControls";

export const ACKNOWLEDGEMENT_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "acknowledgement-lost-predecessor",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { CapturePredecessor: "FALSE" },
    expect: { kind: "invariant", name: "HonestReaderIsNotIncident" },
    why: "A delayed authenticated receipt must reconcile safely with concurrent readers (#2485 finding 4).",
  },
  {
    id: "acknowledgement-fork",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { RequireReceiptAncestry: "FALSE" },
    expect: { kind: "invariant", name: "ReceiptIsOnCurrentBranch" },
    why: "A delayed authenticated receipt must reconcile safely with concurrent readers (#2485 finding 4).",
  },
  {
    id: "acknowledgement-regression",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { PreserveProgress: "FALSE" },
    expect: { kind: "invariant", name: "ProgressIsMonotonic" },
    why: "A delayed authenticated receipt must reconcile safely with concurrent readers (#2485 finding 4).",
  },
  {
    id: "acknowledgement-cas-incident",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { RetryCAS: "FALSE" },
    expect: { kind: "invariant", name: "HonestReaderIsNotIncident" },
    why: "A delayed authenticated receipt must reconcile safely with concurrent readers (#2485 finding 4).",
  },
];
