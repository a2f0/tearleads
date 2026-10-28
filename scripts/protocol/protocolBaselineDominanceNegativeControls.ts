import type { NegativeControl } from "./protocolNegativeControls";

const BASELINE_DOMINANCE_MODULE = "formal/document-sync/BaselineDominance.tla";
const BASELINE_DOMINANCE_CONFIG = "formal/document-sync/BaselineDominance.cfg";

export const BASELINE_DOMINANCE_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "baseline-redirect-ignores-coverage",
      module: BASELINE_DOMINANCE_MODULE,
      config: BASELINE_DOMINANCE_CONFIG,
      constants: { CheckVectorCovers: "FALSE" },
      expect: { kind: "invariant", name: "NoDataLoss" },
      why: "A redirect that omits an older update its baseline vector does not cover leaves the reader without that update.",
    },
    {
      id: "baseline-redirect-unauthenticated",
      module: BASELINE_DOMINANCE_MODULE,
      config: BASELINE_DOMINANCE_CONFIG,
      constants: { RequireAuthenticatedBaseline: "FALSE" },
      expect: { kind: "invariant", name: "NoDataLoss" },
      why: "Nothing binds an unauthenticated baseline's declared vector to its contents, so redirecting through one can omit an update it does not carry.",
    },
    {
      id: "baseline-redirect-raw-mode",
      module: BASELINE_DOMINANCE_MODULE,
      config: BASELINE_DOMINANCE_CONFIG,
      constants: { RawModeServesAll: "FALSE" },
      expect: { kind: "invariant", name: "RawModeServesCompleteFrontier" },
      why: "Raw history recovery needs every retained update; a redirect there hides the history it asked for.",
    },
    {
      id: "baseline-redirect-drops-current-epoch",
      module: BASELINE_DOMINANCE_MODULE,
      config: BASELINE_DOMINANCE_CONFIG,
      constants: { RedirectKeepsCurrentEpoch: "FALSE" },
      expect: { kind: "invariant", name: "CurrentOrNewerUpdateIsServed" },
      why: "A redirect may drop only older-epoch updates; dropping every covered update also withholds current-epoch ones.",
    },
  ];
