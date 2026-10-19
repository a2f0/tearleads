# Container move replay

[`ContainerMoveReplay.tla`](./ContainerMoveReplay.tla) models one folder's
queued move through #2556's lost results. The server can accept a move while
the device loses the result, so the intent stays queued, a purge of its
subtree waits on it, and a later replay used to sign a second rotation to the
same parent. The model checks that a replay settles a move the server already
holds without posting, that settling needs evidence from the server, and that a
lost result schedules its own replay instead of waiting for a reload.

| Model action or predicate | Production seam |
| --- | --- |
| `LocalMove` | `moveContainer` queues a container move intent (a new revision) and schedules the container-contents lane |
| `RemoteMove` | another writer's signed move, seen only through `getContainerWriterProjection` |
| `UnrelatedPass` | any other lane request, such as a local write, a server event, or `hasStartupContainerSyncWork` after a reload |
| `Replay`, `AdoptAppliedMove` | `replayRemoteContainerMove` verifies both writer projections; `buildMaterializedContainerMovePlan` returns `applied` when the verified source head's parent is the destination, and `appliedRemoteContainer` feeds `persistAcceptedMoveIntent` with no request |
| `Replay` (post) | `submitRemoteContainerMove` signs the move and submits it to the move endpoint |
| `Settle` | `persistAcceptedMoveIntent` persists the head and settles the intent revision it read (`moveIntentSettlement`) in one transaction |
| `LoseResult`, `RearmLostResult` | a stale pass (`onStaleAcceptance`, `abandonAppliedMove`), `unpersistedAcceptedMove`, and `failedMoveReplay` call `leaveAcceptedMoveQueued`, which reports and calls `requestRetry` (`requestSyncAfter`) |
| `SettleOnLocalClaim` | the option #2556 rejected; `buildMaterializedContainerMovePlan` instead compares the destination with the verified head, never with the local placement |
| `NoRedundantRotation` | `buildMaterializedContainerMovePlan` returns before signing when the verified head already sits under the destination |
| `SettleHasEvidence` | `persistAcceptedMoveIntent` runs only on the server's response or an `AppliedContainerMove` |
| `QueuedMovesSettle` | `leaveAcceptedMoveQueued` re-arms through `createAcceptedMoveRetry`, so no other pass is assumed |

Bounds are three parents, two local moves, and one remote move. The three
negative controls remove adoption, re-arming, and the evidence rule; each must
violate its named property. Production re-arms one intent at most three times
(`createAcceptedMoveRetry`, after 1, 5, and 30 seconds); the model's replay
settles on the first re-armed pass unless the one remote move intervenes, so
the cap is not modelled. A failure that repeats past the cap reports each time
and then waits for an unrelated pass.

Cryptography is abstracted: a verified head is the server's placement, and the
SDK refuses a head that fails verification before either branch. A remote
move between acceptance and the result is allowed, so a settled intent can
briefly disagree with the server until hydration reconciles it, as production
does. The model does not cover depth refusal (`abandonTooDeepMove`), carried
descendant rekeys, or recitation; adoption skips the recitation an accepted
move schedules, which is best-effort and carries no correctness dependency.
