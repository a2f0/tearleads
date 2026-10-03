# Pending container create adoption

[`ContainerCreateAdoption.tla`](./ContainerCreateAdoption.tla) models
finding 26 of #2365 and its follow-ups in #2420. A container create committed,
its response was lost, and a listing carries the container. The pending intent
must be adopted only through the signed epoch-1 create. While it was pending,
the user may have moved the folder locally and another writer may have moved
it remotely. A foreign create under the same id must not stop the rest of the
lane's pass.

| Model action or predicate | Production seam |
| --- | --- |
| `Hydrate` / `hydrated` | `hasRemoteContainerMetadataState` routes the intent to `syncListedContainerCreate` |
| `listedScope` / `DiscoverContainer` / `VerifyContainerAdoption` | a listing with remote metadata reaches `syncListedContainerCreate` |
| `AdoptContainerCreate` | `assertContainerCreateAdoptable` walks the verified projection to its create with `verifiedContainerCreateManifest` and checks signer and organization |
| `LocalMove` / `desired` / `queuedTo` / `queuedFrom` | before hydration `saveContainerCreateIntent` re-queues the intent; after it the folder looks remote, and `saveContainerMoveIntent` queues a move that keeps its first previous parent |
| `RemoteMove` / `remoteParent` | `verifyAdoptableProjection` reads the verified head's `parentContainerId` |
| `OwedMove` / `CiteVerifiedHead` / `PreviousParent` | `owedCreateMove` queues a move only to a parent other than the created and current ones, citing `supersededMovePreviousParentId` |
| `SettledMove` / `KeepQueuedMove` | `rebaseQueuedMove` keeps a queued move's destination and cites `supersededMovePreviousParentId` |
| `RefuseForeignCreate` / `ParkForeignCreates` / `parked` | `ForeignContainerCreateError` is recorded as `CONTAINER_CREATE_ADOPTION_REFUSED`, which `syncListedContainerCreate` leaves blocked without a read |
| `SiblingSync` / `LaneHalted` | `syncPendingContainerCreateIntents` continues with the next intent |
| `WriteIntoFolder` / `HoldPendingWrites` / `wroteUnadopted` | `runContainerContentsStoreSyncIteration` passes `isCreatePending` to container and document move replay and skips the folder's metadata sync; `syncPendingContainerCreateIntents` holds child creates and `isContainerCreatePending` holds document creates |

The configuration has three parents and two scopes: the device's own create
and a foreign one. The create committed under the first parent. TLC explores
hydration at any point, local moves before and after it, remote moves while
the intent is pending, and both listings.

It checks five properties:

- adoption preserves the verified intended scope;
- the settled move cites the parent the folder sits under now;
- settlement places the folder where the user last put it, or keeps a remote
  move when the user never moved it;
- no folder move, document move, child or document create, or metadata
  edit is written into the folder while its create is pending;
- a later intent in the same pass eventually syncs, under fairness for
  adoption, refusal and that intent.

Five negative controls remove signed-create verification, current-parent
citation, keeping a queued move, parking, and holding writes into a pending
folder. Without the queued-move rule,
the owed move both cites a parent that never committed and takes over the
queued destination; TLC reports the stale citation first.

Remote deletes are not held, and the model has no delete action. Settlement
compares the desired parent with the created one, so a local move away and
back while another writer moved the folder keeps the remote move. The model
does not prove cryptography or the move replay itself. It also leaves out
settlement's compare-and-set against a revision re-queued mid-pass, which
persistence tests cover. A failed read that is not a foreign create is modeled
as taking no step: it is recorded and retried on a later pass.
