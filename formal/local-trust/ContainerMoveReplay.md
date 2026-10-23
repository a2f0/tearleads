# Container move replay

[`ContainerMoveReplay.tla`](./ContainerMoveReplay.tla) models one folder's
queued move whose accepted result is lost. The server can accept a move while
the device loses the result, so the intent stays queued and a purge of its
subtree waits on it; a replay that ignored the server's head would sign a second
rotation to the same parent. The model checks that a replay settles a move the
server already holds without posting, that settling needs evidence from the
server, and that a lost result schedules its own replay, kept going through a
failed replay, instead of waiting for a reload.

| Model action or predicate | Production seam |
| --- | --- |
| `LocalMove` | `moveContainer` queues a container move intent (a new revision) and schedules the container-contents lane |
| `RemoteMove` | another writer's signed move, seen only through `getContainerWriterProjection` |
| `UnrelatedPass` | any other lane request, such as a local write, a server event, or `hasStartupContainerSyncWork` after a reload |
| `Replay`, `AdoptAppliedMove` | `replayRemoteContainerMove` verifies both writer projections; `buildMaterializedContainerMovePlan` returns `applied` when the verified source head's parent is the destination, and `appliedRemoteContainer` feeds `persistAcceptedMoveIntent` with no request |
| `Replay` (post) | `submitRemoteContainerMove` signs the move and submits it to the move endpoint |
| `Settle` | `persistAcceptedMoveIntent` persists the head and settles the intent revision it read (`moveIntentSettlement`) in one transaction |
| `LoseResult`, `RearmLostResult`, `accepted` | `onAccepted` marks the move applied before acknowledgement; a stale pass (`abandonAppliedMove`), `unacknowledgedAcceptedMove`, `unpersistedAcceptedMove`, and `failedMoveReplay` call `leaveAcceptedMoveQueued`, which reports and calls `arm` (`requestSyncAfter`) |
| `SettleOnLocalClaim` | a rejected design that settles on the local placement; `buildMaterializedContainerMovePlan` instead compares the destination with the verified head |
| `NoRedundantRotation` | `buildMaterializedContainerMovePlan` returns before signing when the verified head already sits under the destination |
| `SettleHasEvidence` | `persistAcceptedMoveIntent` runs only on the server's response or an `AppliedContainerMove` |
| `ReplayFails`, `ResumeAcceptedRetry` | a replay that fails before reaching the server leaves the intent failed or blocked, and `syncPendingContainerMoveIntents` calls `resume`, which `createAcceptedMoveRetry` honours only for an intent it armed |
| `AcceptedMovesSettle` | `leaveAcceptedMoveQueued` arms through `createAcceptedMoveRetry`, so no other pass is assumed |

Bounds are three parents, two local moves, one remote move, and one failed
replay. The four negative controls remove adoption, re-arming, resuming after a
failed replay, and the evidence rule; each must violate its named property.
A move the server never accepted waits for another pass after a failed
replay, so the liveness property covers accepted moves only. Production re-arms
one intent at most three times (`createAcceptedMoveRetry`, after 1, 5, and 30
seconds); the model's replay settles on the first re-armed pass unless the one
remote move intervenes, so the cap is not modelled. A failure that repeats past
the cap reports each time and then waits for an unrelated pass.

Cryptography is abstracted: a verified head is the server's placement, and the
SDK refuses a head that fails verification before either branch. A remote
move between acceptance and the result is allowed, so a settled intent can
briefly disagree with the server until hydration reconciles it, as production
does. The model does not cover depth refusal (`abandonTooDeepMove`), carried
descendant rekeys, or recitation; adoption skips the recitation an accepted
move schedules, which is best-effort and carries no correctness dependency.
