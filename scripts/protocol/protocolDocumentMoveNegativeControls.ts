import type { NegativeControl } from "./protocolNegativeControls";

export const DOCUMENT_MOVE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "move-publishes-intermediate-links",
    module: "formal/local-trust/DocumentMovePlacement.tla",
    config: "formal/local-trust/DocumentMovePlacement.cfg",
    constants: { ProtectPending: "FALSE" },
    expect: { kind: "invariant", name: "StablePlacement" },
    why: "Intermediate remote links and discovery must preserve the pending local move.",
  },
  {
    id: "move-accepts-old-discovery",
    module: "formal/local-trust/DocumentMovePlacement.tla",
    config: "formal/local-trust/DocumentMovePlacement.cfg",
    constants: { CheckEpoch: "FALSE" },
    expect: { kind: "invariant", name: "StablePlacement" },
    why: "A discovery response captured before settlement must not restore old links afterward.",
  },
  {
    id: "move-settles-superseded-intent",
    module: "formal/local-trust/DocumentMovePlacement.tla",
    config: "formal/local-trust/DocumentMovePlacement.cfg",
    constants: { CheckRevision: "FALSE" },
    expect: { kind: "invariant", name: "StablePlacement" },
    why: "A superseded replay cannot settle a newer move or overwrite its placement.",
  },
  {
    id: "move-publishes-old-local-read",
    module: "formal/local-trust/DocumentMovePlacement.tla",
    config: "formal/local-trust/DocumentMovePlacement.cfg",
    constants: { CheckReadPlacement: "FALSE" },
    expect: { kind: "invariant", name: "StableView" },
    why: "A local read that captured the old placement must not publish after a move.",
  },
];
