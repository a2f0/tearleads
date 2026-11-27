import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/document-sync/StagedBaselineCommit.tla";
const CONFIG = "formal/document-sync/StagedBaselineCommit.cfg";

export const STAGED_BASELINE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "staged-baseline-commit-unlocked",
    module: MODULE,
    config: CONFIG,
    constants: { CommitUnderHeadLock: "FALSE" },
    expect: { kind: "invariant", name: "EpochAdvanceCoversFrontier" },
    why: "Without the manifest-head lock a writer commits between the commit's coverage gate and its inserts, and the rotation strands that update.",
  },
  {
    id: "staged-baseline-coverage-from-declared-vector",
    module: MODULE,
    config: CONFIG,
    constants: { CoverageFromSpans: "FALSE" },
    expect: { kind: "invariant", name: "EpochAdvanceCoversFrontier" },
    why: "A final segment can declare a vector past what the staged and final spans carry, so a gate that trusts it rotates over updates no segment holds.",
  },
  {
    id: "staged-baseline-final-index-unchecked",
    module: MODULE,
    config: CONFIG,
    constants: { CommitRequiresNextIndex: "FALSE" },
    expect: { kind: "invariant", name: "CommittedGroupsAreWhole" },
    why: "A final segment whose index is not the stage's next index commits a group with an index missing.",
  },
  {
    id: "staged-baseline-partial-promote",
    module: MODULE,
    config: CONFIG,
    constants: { PromoteAllOrNone: "FALSE" },
    expect: { kind: "invariant", name: "CommittedGroupsAreWhole" },
    why: "A commit that inserts only some of the staged segments leaves a group that was never written as one.",
  },
  {
    id: "staged-baseline-sweep-ignores-stage-lock",
    module: MODULE,
    config: CONFIG,
    constants: { SweepLocksStageRow: "FALSE" },
    expect: { kind: "invariant", name: "SweepKeepsCommittedSegments" },
    why: "A sweep that does not wait for the stage row deletes the segments of a stage that expired after a commit locked it, and the commit's rows then read payloads that are gone.",
  },
  {
    id: "staged-baseline-delete-ignores-committed",
    module: MODULE,
    config: CONFIG,
    constants: { DeleteKeepsCommitted: "FALSE" },
    expect: { kind: "invariant", name: "SweepKeepsCommittedSegments" },
    why: "A later stage opened under a committed baseline's id is deleted by baseline id, so a delete that does not skip committed segments removes that baseline's payloads.",
  },
  {
    id: "staged-baseline-serves-staged-rows",
    module: MODULE,
    config: CONFIG,
    constants: { ServeOnlyCommittedRows: "FALSE" },
    expect: { kind: "invariant", name: "UncommittedNeverServed" },
    why: "A page that reads the staged-segment table on its own serves a segment no commit placed in the document.",
  },
  {
    id: "staged-baseline-redirect-partial-group",
    module: MODULE,
    config: CONFIG,
    constants: {
      PromoteAllOrNone: "FALSE",
      RedirectRequiresWholeGroup: "FALSE",
    },
    expect: { kind: "invariant", name: "ReaderLosesNothing" },
    why: "A group that is missing a segment cannot stand for the history before it, so a redirect that takes the latest sealed group without checking it is whole starts a reader past operations it never receives.",
  },
  {
    id: "staged-baseline-open-keeps-prior-stage",
    module: MODULE,
    config: CONFIG,
    constants: { OpenReplacesPriorStage: "FALSE" },
    expect: { kind: "liveness", name: "RotatorEventuallyCommits" },
    why: "A user has one open stage per document, so a rotator that restarted and forgot its stage can open another only if opening replaces the old one.",
  },
  {
    id: "staged-baseline-rotator-retries-without-reproving",
    module: MODULE,
    config: CONFIG,
    constants: { ReproveOnStaleRefusal: "FALSE" },
    expect: { kind: "liveness", name: "RotatorEventuallyCommits" },
    why: "A rotator that answers a stale-coverage refusal by sending the same final segment again never covers the update that refused it.",
  },
];
