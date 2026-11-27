# Catch-Up Coordination Mapping

[`CatchUpCoordination.tla`](./CatchUpCoordination.tla) models the catch-up
state machine (`catchUpMachine.ts`) that coordinates unforced document-lane
listings around the tree crawl an acknowledged connection owes.
[DocumentLanePolling](./DocumentLanePolling.md) shows which lanes the crawl
owes listings to; this model checks the deferral, superseding, overdue bound,
and fallback-vouching rules that run beside it.

When an interest declaration is acknowledged, the catch-up enters
`awaitingCrawl` and defers unforced listings of lanes that were already known
at the acknowledgement, unless the user opens a container (`opened`) or its
lane was already owed (`alreadyOwed`). Once the crawl settles, the catch-up
moves to `awaitingTurn` until its sweep takes its turn among sweeps
(`turnTaken`). If a sweep ahead in line is stuck, a bounded timer moves the
catch-up to `overdue` (`turnOverdue`), ending deferral immediately so no lane
waits forever. An acknowledgement arriving during `awaitingCrawl` shares the
wait and clears the set of lanes listed since; an acknowledgement arriving
during `awaitingTurn` or `overdue` supersedes the earlier wait with a new one,
and any late `turnTaken` naming the superseded wait is ignored.

When a crawl does not complete, the sweep falls back to listing every known
lane except those cleanly listed since the latest acknowledgement
(`listedSinceContainerIds`). Each listing captures the catch-up wait,
acknowledgement count (`acknowledgements`), and per-container
`pendingGenerations` before its request. A listing that leaves a candidate
pending, or whose pending retry timer fires (`pendingDiscovery`), removes the
container from `listedSinceContainerIds` and bumps its `pendingGenerations`
entry, so an older concurrent listing batch that completes later cannot re-add
the lane and cause the fallback to swallow its retry.

| Model action | Production seam |
| --- | --- |
| `Acknowledged` | `transitionCatchUp` on an acknowledged event via `dispatchCatchUp`, sharing the wait during crawl wait or superseding turn wait and overdue states |
| `CrawlSettled` | `transitionCatchUp` on crawl settlement once `whenCrawlSettles` resolves for the active wait |
| `TurnOverdue` | `transitionCatchUp` on turn-overdue timeout when the bounded turn wait expires |
| `OpenedOrAlreadyOwed` | `transitionCatchUp` on opened or already-owed events, adding the container to `listedNowContainerIds` so `defersToCatchUp` returns false |
| `BeginListing` | `reconcileMarkedContainers` snapshotting `acknowledgements` and `pendingGenerations` before calling `listContainerDocumentLanesFromApi` |
| `PendingDiscovery` | `schedulePendingDiscovery` dispatching a pending-discovery event, removing the container from `listedSinceContainerIds` and raising `pendingGenerations` |
| `FinishListing` | `transitionCatchUp` on a listed event, recording the lane in `listedSinceContainerIds` only when wait, `acknowledgements`, and `pendingGenerations` still match |
| `TurnTaken` | `transitionCatchUp` on turn-taken once the catch-up's sweep takes its turn and `listedSinceAcknowledgement` reads the vouched set |
| `StaleTurnTaken` | `transitionCatchUp` ignoring a turn-taken event whose wait was superseded by a newer acknowledgement |

`VouchIsFresh` requires that any lane vouched for the incomplete-crawl fallback
(`listedSince`) was cleanly listed after the latest acknowledgement with no
outstanding pending discovery retry. `ActiveWaitSurvivesStaleTurn` requires
that a late `turnTaken` from a superseded wait never drops the active wait back
to `idle`. `DeferralEnds` requires that deferral always ends, even if a sweep
ahead in line never releases its turn (`TurnOverdue` bounds the wait).

Four guards are parameters with registered negative controls:

- `CheckAckOnListed = FALSE` accepts a `listed` event from a listing started
  before a second acknowledgement that the wait shared, letting a pre-ack
  listing vouch for the fallback and violating `VouchIsFresh`.
- `CheckPendingGenOnListed = FALSE` accepts a `listed` event from an older
  concurrent listing batch started before `pendingDiscovery`, re-adding the
  lane while a pending retry is still outstanding and violating `VouchIsFresh`.
- `OverdueEndsDeferral = FALSE` keeps deferring unforced listings after
  `turnOverdue` moves the catch-up to `overdue`, leaving a lane deferred
  forever when a sweep ahead is stuck and violating `DeferralEnds`.
- `CheckWaitOnTurnTaken = FALSE` lets a superseded wait's late `turnTaken`
  reset the active catch-up to `idle`, violating `ActiveWaitSurvivesStaleTurn`.

[`CatchUpCoordination.cfg`](./CatchUpCoordination.cfg) allows two
acknowledgements, one pending-discovery invalidation, and two listings. TLC
explores 3,294 generated states, 833 distinct states, and depth 12.

The model tracks one known container lane. A lane discovered after the
acknowledgement is absent from `knownContainerIds`, so `defersToCatchUp`
always returns false for it. Stopping the reconciliation service (`stopped`)
clears the state to `IDLE_CATCH_UP` and cancels every active wait.
