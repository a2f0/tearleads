# Epoch Advances Without a Covering Baseline

[`EmptyFrontierUnlink.tla`](./EmptyFrontierUnlink.tla) models the acceptance
gates for the two content-key epoch advances that carry no rotation baseline: a
document unlink submitted without one, and a link that advances the epoch. A
rotation strands every committed update that no baseline sealed to the new epoch
covers. A document with an empty committed frontier cannot produce a baseline at
all — a zero-span full-history snapshot encodes no replayable history — so the
server accepts a baseline-less unlink only after proving the committed frontier
is empty inside the mutation transaction, under the document manifest-head write
lock that sync writers also take exclusively. A link never carries a baseline,
so it may advance the epoch only under the same emptiness proof.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginBaselinelessUnlink` / `CommitBaselinelessUnlink` | `assertBaselinelessUnlinkHasEmptyCommittedFrontier` inside `mutateDocumentLinkSetWithExecutor` |
| `CheckCoveringUnlink` / `RejectCoveringUnlink` / `CommitCoveringUnlink` | `assertAtomicRotationBaselineCoversCommittedFrontier` + `appendAtomicRotationBaseline` |
| `BaselineAccepted` | the frontier comparison in `assertAtomicRotationBaselineCoversCommittedFrontier` |
| `BeginLinkAdvance` / `LinkAdvancesEpoch` / `RejectLinkAdvance` | `assertLinkKeepsCommittedContentKeyEpoch` inside `advanceDocumentLinkSet` |
| `FrontierEmpty` | `hasCommittedDocumentUpdate`, the emptiness proof both gates share |
| `WriterMayCommit` | the exclusive manifest-head locks in `lockDocumentLinkSetMutationFrontier` and `lockSyncDocumentWriteFrontier` |
| the client never sending an empty baseline (boundary assumption) | `buildDocumentRotationBaseline` returning null for a zero-span snapshot |

The checked configuration sets `LockedUnlink = TRUE`, matching production, and
the invariants require that no rotation ever orphans a committed update and
that the emptiness observation stays true through the commit window. Setting
`LockedUnlink = FALSE` (a writer allowed to commit between the emptiness proof
and the unlink commit) makes TLC report the `NoDataLoss` violation
immediately — the lock discipline is load-bearing, not incidental. The
negative-control check asserts this on every run.
`RequireEmptyFrontierOnLinkAdvance = FALSE` lets a link advance the epoch over
committed updates, and TLC reports the same violation.

A rotation baseline covers history only under the epoch it is sealed to, and it
is itself a committed update, so both gates ask whether any update is
committed, not whether one is uncovered. `FrontierCheck = "uncovered"` is a
server that checked only the uncovered frontier; after a covering unlink TLC
finds a link advance that strands the baseline, and the negative control
`empty-frontier-check-ignores-baselines` asserts it.
`CoveringUnlinkCoversFrontier` requires that, under the lock, the frontier a
covering baseline was checked against is still the frontier at its commit.

A client's baseline covers the frontier it held, which may fall short of the
committed one. `CheckCoveringUnlink` chooses any covered frontier up to the
committed one, and the server refuses a short one (`RejectCoveringUnlink`), so
the baseline is not honest by construction. `CheckBaselineCoversFrontier =
FALSE` accepts a short baseline, and the rotation strands the updates it does
not cover: the negative control `empty-frontier-short-baseline` asserts the
`NoDataLoss` violation.

A link's emptiness check and its commit are separate steps under the same
manifest-head lock as an unlink, so `LockedUnlink = FALSE` also lets a writer
commit between them. The bounds stay small (`MaxUpdates = 3`); the run
explores 78 distinct states because the model tracks only the uncovered-update
count, whether any update is committed, the covered frontier, and the
transaction phase.
