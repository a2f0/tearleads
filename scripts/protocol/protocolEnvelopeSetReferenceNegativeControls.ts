import type { NegativeControl } from "./protocolNegativeControlTypes";

export const ENVELOPE_SET_REFERENCE_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "envelope-set-reference-unchecked-root",
      module: "formal/container-keying/EnvelopeSetReference.tla",
      config: "formal/container-keying/EnvelopeSetReference.cfg",
      constants: { CheckRoot: "FALSE" },
      expect: { kind: "invariant", name: "StoredMatchesSigned" },
      why: "A set rebuilt from member envelope changes must match the signed root, or a faulty author's changes are stored for a state signed over another set (#2903 P17).",
    },
    {
      id: "envelope-set-reference-wire-replay-key",
      module: "formal/container-keying/EnvelopeSetReference.tla",
      config: "formal/container-keying/EnvelopeSetReference.cfg",
      constants: { HashRebuilt: "FALSE" },
      expect: { kind: "invariant", name: "OwnCommitNeverRefused" },
      why: "Replays must compare the rebuilt request, or a retry in the other envelope form is refused although it repeats a committed state (#2903 P17).",
    },
  ];
