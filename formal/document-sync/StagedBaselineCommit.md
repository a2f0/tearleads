# Staged Baseline Commit

[`StagedBaselineCommit.tla`](./StagedBaselineCommit.tla) models a
[rotation baseline](../../docs/glossary/keys.md#rotation-baseline) that is
uploaded ahead of time and committed by reference (#3238). A baseline is an
ordered group of segments that together carry a document's whole history under
a new [content-key](../../docs/glossary/keys.md#content-key) epoch. A writer,
the rotator, opens a stage, uploads every segment but the last one request at a
time in index order, and commits the group by sending the final segment inline
in the unlink or sync request that rotates. The commit inserts one row per
staged segment and then the final segment, in one transaction under the
document manifest-head write lock. A staged segment's row stores no payload:
the payload stays in the staged-segment table and the row reads it from there.

History is a count of operations. Update `n` carries the span `[n - 1, n)`, a
segment carries a span `[lo, hi)`, and a stage has reached the end of its last
segment. The server walks a staged segment against that reach, so every staged
segment starts where the one before it ended.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `OpenStage` / `OpenReplacesPriorStage` | `openDocumentBaselineStage`, which takes the document lifecycle lock, checks write access and billing (`requireStageWriter`), roots the stage in the stored document id, and replaces the caller's prior stage for the document |
| `StageSegment` | `stageDocumentBaselineSegment`, which locks the stage row, checks write access and billing again (`requireStageWriter`), takes only the stage's next index, verifies the segment and walks its spans against the stage frontier; `resignStagedBaselineSegmentHeader` makes the same checks, re-signs a staged header and changes no span |
| `StageUsable` / `RotatorSeesRefusal` | `judgeDocumentBaselineStage`, whose verdict the stage routes and the commit return as a coded refusal |
| `CommitGate` / `FinalIndexes` / `CommitRequiresNextIndex` | `lockStagedBaselineForCommit`, called from `assertSyncRotationBaselinesSound` and `assertAtomicRotationBaselineCoversCommittedFrontier` |
| `CommitRefusedStale` / `CoverageFromSpans` | `assertStagedBaselineCoversCommittedFrontier`, which compares the stage's walked spans and the final segment's own with `committedFrontierAfterBaselineCursor` |
| `Promote` / `PromoteAllOrNone` | `promoteStagedBaselineSegments` inside `appendDocumentUpdates`, which inserts the staged rows in index order ahead of the final segment and deletes the stage row |
| `Write` / `CommitUnderHeadLock` | the exclusive manifest-head locks in `lockDocumentLinkSetMutationFrontier` and `lockSyncDocumentWriteFrontier` |
| `Abandon` | `abandonDocumentBaselineStage` |
| `Sweep` / `SweepLocksStageRow` | `cleanupExpiredDocumentBaselineStages`, which deletes each expired stage row and then its segments in one transaction, stage after stage until none is left or its budget ends |
| `KeptAfterDelete` / `DeleteKeepsCommitted` | `deleteUncommittedBaselineSegments`, the one delete the sweep, abandon and replace-on-open share |
| `ReaderPage` / `ServeOnlyCommittedRows` | `loadDocumentUpdatePageRows`, which reads committed update rows and joins a staged segment's payload to its row |
| `RedirectStart` / `RedirectCandidates` / `GroupWhole` / `RedirectRequiresWholeGroup` | `findLatestWholeStoredBaselineGroup`, which finds the newest group whose rows are whole, and `readStoredBaselineGroupCoverage`, which reads what it covers from its spans; `resolveBaselineRedirectAfterSequence` and `loadLatestStoredDocumentBaselineGroup` call both |

## Properties

- `UncommittedNeverServed`: no page serves a segment that is staged and not
  committed.
- `CommittedGroupsAreWhole`: every committed group's rows sit together in
  index order from zero, only the last is the final segment, and their spans
  run gapless from zero.
- `EpochAdvanceCoversFrontier`: every rotation's baseline carried the whole
  committed frontier when it committed. `GatedCommitCoversFrontier` states the
  same for a commit between its gate and its inserts.
- `SweepKeepsCommittedSegments`: every committed row that reads its payload by
  reference still has it.
- `ReaderLosesNothing`: a reader that has paged to the end holds every
  committed operation, whichever baseline it was redirected to and whatever
  committed while it paged. `CommittedRowsStay` is the action property behind
  it: a commit only appends, so a newer baseline removes nothing of an older
  one.
- `RotatorEventuallyCommits`: a rotator that keeps going commits a baseline.

## Negative controls

Each control flips one rule, or the two named, and TLC must report the
violation:

- `staged-baseline-commit-unlocked` (`CommitUnderHeadLock = FALSE`): a writer
  commits between the gate and the inserts, and `EpochAdvanceCoversFrontier`
  fails.
- `staged-baseline-coverage-from-declared-vector`
  (`CoverageFromSpans = FALSE`): the final segment declares a vector past what
  the spans carry, the gate trusts it, and `EpochAdvanceCoversFrontier` fails.
- `staged-baseline-final-index-unchecked`
  (`CommitRequiresNextIndex = FALSE`): the final segment skips an index, and
  `CommittedGroupsAreWhole` fails.
- `staged-baseline-partial-promote` (`PromoteAllOrNone = FALSE`): a commit
  inserts only some staged rows, and `CommittedGroupsAreWhole` fails.
- `staged-baseline-sweep-ignores-stage-lock` (`SweepLocksStageRow = FALSE`):
  the stage expires after a commit locked it, the sweep deletes its segments
  without waiting, and `SweepKeepsCommittedSegments` fails when the commit
  inserts its rows.
- `staged-baseline-delete-ignores-committed`
  (`DeleteKeepsCommitted = FALSE`): a later stage opened under a committed
  baseline's id is abandoned, the delete removes that baseline's payloads, and
  `SweepKeepsCommittedSegments` fails.
- `staged-baseline-serves-staged-rows` (`ServeOnlyCommittedRows = FALSE`): a
  page reads the staged-segment table, and `UncommittedNeverServed` fails.
- `staged-baseline-redirect-partial-group` (`PromoteAllOrNone = FALSE` and
  `RedirectRequiresWholeGroup = FALSE`): a redirect to a group that is missing
  a segment starts a reader past operations it never receives, and
  `ReaderLosesNothing` fails. With only the first switch off the redirect
  skips the broken group and the reader still holds everything.
- `staged-baseline-open-keeps-prior-stage`
  (`OpenReplacesPriorStage = FALSE`): a rotator that restarted cannot open a
  second stage, and `RotatorEventuallyCommits` fails.
- `staged-baseline-rotator-retries-without-reproving`
  (`ReproveOnStaleRefusal = FALSE`): a rotator refused for stale coverage
  sends the same final segment again forever, and `RotatorEventuallyCommits`
  fails.

## The sweep and a commit

Both guards on the delete are needed, for different races.

The sweep deletes the stage row first, in the transaction that deletes its
segments, and a commit holds that row from its gate to its inserts. So the
sweep either runs before the commit, which then finds no stage and is
refused, or waits and finds the row gone. `Expire` may fire while a commit is
between gate and inserts: the commit judged the stage unexpired when it took
the lock, and it finishes.

A baseline id is the client's choice, and the staged-segment table is keyed by
it. `OpenStage` therefore takes any id, one that holds a committed baseline
included. Such a stage can stage and commit nothing, because a group's rows
are unique by baseline and index, but it can still be abandoned, replaced or
swept. `DeleteKeepsCommitted` is what keeps those deletes away from the
committed baseline's payloads. Production refuses to open a stage under an
id its document committed, but that is a read ahead of the insert, so the
model does not rely on it.

## Liveness assumptions

`RotatorEventuallyCommits` holds under weak fairness on the rotator's own
steps and on a started commit finishing. Writers, the reader, expiry and the
sweep are not forced. It rests on three bounds:

- Writers commit at most `MaxOps` updates. A writer that always commits
  another update before the rotator stages its tail starves the rotation, and
  a finite model cannot show that case.
- Expiries, abandons and rotator restarts together number at most `MaxFaults`.
  A stage that expires every time before its rotator commits never commits.
  Production extends a stage's expiry on every staged segment to keep an
  active upload alive; the model has no clock, so that rule is an assumption
  here. Only a request that passes the access and billing checks extends
  it, so a rotator that lost either is one whose stage expires.
- A rotator refused for stale coverage proves its history again and stages
  the tail after the segments it already staged (`Reprove`). That is the
  client SDK's part of the protocol, and it has no production seam in the
  table until the staged writer ships.

Without `OpenReplacesPriorStage` a restarted rotator would wait for the sweep
to remove the stage it forgot. The sweep is not forced, so the model counts
that as never committing.

## Bounds and what is left out

The registered configuration has three updates, two baseline ids, two
rotations and two faults. It explores 335,286 generated and 78,110 distinct
states.

- One rotator and one document. A stage's owner, document, epoch and
  content-key commitment always match its commit, so the refusals for a
  foreign or stale stage are not exercised; `judgeDocumentBaselineStage` and
  `lockStagedBaselineForCommit` carry them in production.
- The segments digest and the signed count are folded into
  `CommitRequiresNextIndex` and `PromoteAllOrNone`: the group that commits is
  the group that was staged, in order.
- A baseline has no processed cursor, so it must cover every committed
  update. [BaselineCursorCoverage](./BaselineCursorCoverage.md) models the
  cursor.
- Content keys are left out. Which updates a reader can decrypt, and which a
  baseline may stand for, is
  [BaselineDominance](./BaselineDominance.md)'s; here a reader applies every
  row it is served.
- Peer ownership of the staged spans is
  [PeerOwnership](./PeerOwnership.md)'s.
- A document purge, which deletes a document's stages and segments with its
  updates, is not modeled. An open takes the lifecycle lock a purge holds
  (`lockDocumentLifecycleInTransaction`), so no stage is opened for a
  document a purge removed.
- Access and billing are left out: the rotator can always write. Production
  checks both on every stage request and on the commit. A refusal changes
  nothing a stage holds, so to the model it is a step the rotator did not
  take, and a rotator that stays refused is one whose stage meets `Expire`.
- The bounds on a stage are left out: its bytes
  (`MAX_DOCUMENT_BASELINE_STAGE_BYTES`), its span rows
  (`MAX_DOCUMENT_BASELINE_STAGE_SPANS`), and a user's open stages
  (`MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER`). Each refuses a request and
  changes nothing. `RotatorEventuallyCommits` is about a history that fits
  them: one that does not is never staged whole.
- The document has one name. That a stage is rooted in the stored document
  id, whatever spelling a request used, is production's rule.
- A content record two segments share is refused when the second is staged
  and again at the commit; the model's segments are distinct by index.
