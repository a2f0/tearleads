# Epoch Advances Without a Covering Baseline

[`EmptyFrontierUnlink.tla`](./EmptyFrontierUnlink.tla) models the acceptance
gates for the two content-key epoch advances that carry no
[rotation baseline](../../docs/glossary/keys.md#rotation-baseline): a document unlink
submitted without one, and a link that advances the epoch. A rotation strands
every committed update that no baseline sealed to the new epoch covers. A
document with an empty committed frontier has nothing for a baseline to cover,
and its client sends none: an empty history is sent as a baseline, one empty
segment, only with a processed cursor, which a document never written lacks.
The server accepts a
baseline-less unlink only after proving the committed frontier is empty inside
the mutation transaction, under the document manifest-head write
lock that sync writers also take exclusively. A link never carries a baseline,
so it may advance the epoch only under the same emptiness proof.

A baseline is an ordered group of updates, its segments, committed whole with
the unlink. The model still counts it as one thing that covers a frontier:
what it covers is what its segments' spans reach together, and the group
commits in the unlink's transaction or not at all. Only the production
mapping changed when a baseline stopped being one snapshot record, plus one
switch for the commit being whole.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginBaselinelessUnlink` / `CommitBaselinelessUnlink` | `assertBaselinelessUnlinkHasEmptyCommittedFrontier` inside `mutateDocumentLinkSetWithExecutor` |
| `CheckCoveringUnlink` / `RejectCoveringUnlink` / `CommitCoveringUnlink` | `assertAtomicRotationBaselineCoversCommittedFrontier` + `appendAtomicRotationBaseline`, which refuses a group it did not insert whole |
| `BaselineAccepted` | the frontier comparison in `assertAtomicRotationBaselineCoversCommittedFrontier`, against the coverage `requireOutgoingBaselineGroup` reads from the segments' spans |
| `BeginLinkAdvance` / `LinkAdvancesEpoch` / `RejectLinkAdvance` | `assertLinkKeepsCommittedContentKeyEpoch` inside `advanceDocumentLinkSet` |
| `FrontierEmpty` | `hasCommittedDocumentUpdate`, the emptiness proof both gates share |
| `WriterMayCommit` | the exclusive manifest-head locks in `lockDocumentLinkSetMutationFrontier` and `lockSyncDocumentWriteFrontier` |
| the client sending an empty baseline only with a processed cursor (boundary assumption) | `buildDocumentRotationBaseline` returning null for a history with no operations and no cursor; the server refuses an empty one without a cursor in `judgeDocumentBaselineGroup`, and an empty segment anywhere else in `assertOutgoingSpanOrEmptyBaseline` |

The checked configuration sets `LockedUnlink = TRUE`, matching production, and
the invariants require that no rotation ever orphans a committed update and
that the emptiness observation stays true through the commit window. Setting
`LockedUnlink = FALSE` (a writer allowed to commit between the emptiness proof
and the unlink commit) makes TLC report the `NoDataLoss` violation
immediately — the lock discipline is load-bearing, not incidental. The
negative-control check asserts this on every run.
`RequireEmptyFrontierOnLinkAdvance = FALSE` lets a link advance the epoch over
committed updates, and TLC reports the same violation.

A rotation baseline covers history only under the epoch it is sealed to, and
its segments are themselves committed updates, so both gates ask whether any
update is committed, not whether one is uncovered.
`FrontierCheck = "uncovered"` is a
server that checked only the uncovered frontier; after a covering unlink TLC
finds a link advance that strands the baseline, and the negative control
`empty-frontier-check-ignores-baselines` asserts it.
`CoveringUnlinkCoversFrontier` requires that, under the lock, the frontier a
covering baseline was checked against is still the frontier at its commit.

A client's baseline covers the frontier it held, which may fall short of the
committed one. `total` counts every committed update, earlier rotation
baselines included, since those are sealed to the epoch the next rotation
retires. `CheckCoveringUnlink` chooses any covered frontier up to `total`, and
the server refuses a short one (`RejectCoveringUnlink`), so the baseline is not
honest by construction. `CheckBaselineCoversFrontier = FALSE` accepts a short
baseline, and the rotation strands the updates it does not cover: the negative
control `empty-frontier-short-baseline` asserts the `NoDataLoss` violation.
`BaselineFrontier = "uncovered"` is a server that compared the baseline only
with the frontier since the latest baseline. Right after one rotation it
accepts an empty baseline for the next, which strands the first baseline: the
control `empty-frontier-baseline-skips-earlier-baseline` asserts it across two
consecutive rotations.

The gate reads a baseline's coverage from all of its segments, so the unlink
is sound only when all of them commit. `CommitWholeBaseline = FALSE` is a
server that could commit some of a checked group's segments and not others:
the rotation covers less than the gate checked, and the control
`empty-frontier-partial-baseline-commit` asserts the `NoDataLoss` violation.

The committed frontier a covering baseline must cover is the one after the
baseline's signed processed cursor: its author imported or voided every update
up to the cursor, so the baseline stands for those (#3135).
[BaselineCursorCoverage](./BaselineCursorCoverage.md) models that cursor;
here `total` counts the updates after it. A document whose every update its
author voided has an empty history. Its baseline is one empty segment
signing the cursor, so `total` is zero and the covering unlink commits
(#3194). The baseline-less gate would refuse that document while any update
is committed, since new members would lack the old key for those rows.

A link's emptiness check and its commit are separate steps under the same
manifest-head lock as an unlink, so `LockedUnlink = FALSE` also lets a writer
commit between them. The bounds stay small (`MaxUpdates = 3` committed
updates, baselines included); the run explores 52 distinct states because the
model tracks only update counts, whether any update is committed, the covered
frontier, and the transaction phase.
