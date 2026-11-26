import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/document-sync/EmptyFrontierUnlink.tla";
const CONFIG = "formal/document-sync/EmptyFrontierUnlink.cfg";

export const EMPTY_FRONTIER_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "empty-frontier-unlink-unlocked",
    module: MODULE,
    config: CONFIG,
    constants: { LockedUnlink: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "Without the manifest-head lock a writer commits between the emptiness proof and the unlink commit, and the rotation orphans its update.",
  },
  {
    id: "empty-frontier-link-advances-epoch",
    module: MODULE,
    config: CONFIG,
    constants: { RequireEmptyFrontierOnLinkAdvance: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A link carries no rotation baseline, so accepting one that advances the content-key epoch strands committed updates from the new container's members (#2365 finding 28).",
  },
  {
    id: "empty-frontier-check-ignores-baselines",
    module: MODULE,
    config: CONFIG,
    constants: { FrontierCheck: '"uncovered"' },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A rotation baseline is itself a committed update sealed to its own epoch, so a later advance that checks only the uncovered frontier strands it.",
  },
  {
    id: "empty-frontier-short-baseline",
    module: MODULE,
    config: CONFIG,
    constants: { CheckBaselineCoversFrontier: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "An unlink whose rotation baseline falls short of the committed frontier strands every update the baseline does not cover.",
  },
  {
    id: "empty-frontier-baseline-skips-earlier-baseline",
    module: MODULE,
    config: CONFIG,
    constants: { BaselineFrontier: '"uncovered"' },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A baseline compared only with updates since the latest baseline lets the next rotation drop that earlier baseline's history.",
  },
  {
    id: "empty-frontier-partial-baseline-commit",
    module: MODULE,
    config: CONFIG,
    constants: { CommitWholeBaseline: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A baseline's coverage is read from all of its segments, so an unlink that commits only some of them rotates over updates the committed segments do not carry.",
  },
];
