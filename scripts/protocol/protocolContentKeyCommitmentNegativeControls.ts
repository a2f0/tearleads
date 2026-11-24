import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/document-sync/ContentKeyCommitment.tla";
const CONFIG = "formal/document-sync/ContentKeyCommitment.cfg";

export const CONTENT_KEY_COMMITMENT_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "content-key-commitment-reader-unchecked",
      module: MODULE,
      config: CONFIG,
      constants: { ReaderChecksCommitment: "FALSE" },
      expect: { kind: "invariant", name: "VerdictsAreCanonical" },
      why: "A reader that judges under whatever key it holds voids an honest update the committed key accepts (#3194).",
    },
    {
      id: "content-key-commitment-aead-failure-holds",
      module: MODULE,
      config: CONFIG,
      constants: { VoidOnAeadFailure: "FALSE" },
      expect: { kind: "liveness", name: "DeviceEventuallyJudges" },
      why: "An AES-GCM failure under the committed key that fails the pass holds every reader for good (#3194).",
    },
    {
      id: "content-key-commitment-server-unchecked",
      module: MODULE,
      config: CONFIG,
      constants: { ServerChecksCommitment: "FALSE" },
      expect: { kind: "invariant", name: "EpochCommitmentUniform" },
      why: "An API that stores an update committing to another key than its epoch's leaves every reader holding the epoch's key unable to judge it (#3194).",
    },
    {
      id: "content-key-commitment-cursor-past-unavailable",
      module: MODULE,
      config: CONFIG,
      constants: { CursorPastUnavailable: "TRUE" },
      expect: { kind: "invariant", name: "VerdictsAreCanonical" },
      why: "A cursor moved past an update the reader could not judge records a verdict no committed key gave (#3194).",
    },
  ];
