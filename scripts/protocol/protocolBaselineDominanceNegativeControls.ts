import type { NegativeControl } from "./protocolNegativeControlTypes";

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
      id: "baseline-redirect-partial-group",
      module: BASELINE_DOMINANCE_MODULE,
      config: BASELINE_DOMINANCE_CONFIG,
      constants: { RequireWholeBaseline: "FALSE" },
      expect: { kind: "invariant", name: "NoDataLoss" },
      why: "A baseline is a group of segments whose spans reach its coverage together. Redirecting through a group that is missing a segment omits an update whose operations only that segment carries.",
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
