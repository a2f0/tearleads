import type { NegativeControl } from "./protocolNegativeControlTypes";

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
    id: "acknowledgement-cas-retry",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { RetryCAS: "FALSE" },
    expect: { kind: "liveness", name: "HonestReceiptCompletes" },
    why: "A delayed authenticated receipt must reconcile safely with concurrent readers (#2485 finding 4).",
  },
  {
    id: "acknowledgement-uncovered-pin",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { DeferUncoveredPin: "FALSE" },
    expect: { kind: "invariant", name: "HonestReaderIsNotIncident" },
    why: "A pin admitted without scoped history must defer the receipt, not report tampering (#2485 finding 4).",
  },
  {
    id: "acknowledgement-deferred-retry",
    module: "formal/local-trust/PrincipalAcknowledgementRace.tla",
    config: "formal/local-trust/PrincipalAcknowledgementRace.cfg",
    constants: { RetryDeferredReceipt: "FALSE" },
    expect: { kind: "liveness", name: "HonestReceiptCompletes" },
    why: "An honest deferred receipt must complete once a scoped read covers its pin and the host retries (#2485 finding 4).",
  },
];
