# Subtree purge scope

[`SubtreePurgeScope.tla`](./SubtreePurgeScope.tla) models subtree purge, where
unsigned listing edges may select candidates outside a user-selected subtree.
The bounded model separates that listing from authenticated ancestry, the path
signed into a document purge or unlink, and the path at the server commit.

| Model action or predicate | Production seam |
| --- | --- |
| `CheckCandidate` | `createSubtreePurgeScope` verifies candidate ancestry before destructive operations |
| `LocalPlacementCurrent` | `snapshotContainerStates` owns captured placement fields so live store updates cannot replace them |
| `Prepare` | `assertSubtreePurgePath` checks the exact path that document purge and unlink requests cite, including the selected root's signed parent |
| `RestoreRoot` | `readLocalPurgeScope` compares captured root placement before dispatch; `assertSubtreePurgePath`, `verifiedRemoteScope` and `rootPlacementIsCurrent` compare the root's signed parent, so a settled restore without a local intent is also refused |
| `RestoreIntent` | `hasUnsettledDocumentPlacement` and `readPendingMoves` detect candidate and selected-root placement intents, including parked intents |
| `Commit` | `beforeSubmit` rechecks local scope; `deleteContainerWithExecutor` checks the required ancestor after locking current organization state |
| `CanCommit` | `assertLocalPurgeScope`, `deleteStoredDocumentIfMatches` and `deleteStoredContainers` preserve local placement inside their deletion transactions |
| `DeletionStaysInScope` | `requiredAncestorId` binds descendant deletion to the chosen root and requires the root's non-null captured parent to remain an ancestor; document mutations cite exact manifest paths |

Bounds are one candidate, four operation kinds, one placement move, and one
local restore intent at either the candidate or the selected root, and one
settled root restore outside the captured parent's subtree. These root
restores protect every candidate, including local-only content and documents
held directly by the root. A remote document purge or unlink compares the root's
signed parent in its exact request path; a local-only unit whose chain verifies
no remote container first verifies a remote ordinary root's own projection; the
root's own DELETE requires its non-null captured parent to remain an ancestor
at the server commit. This is not an exact-parent constraint: moving an empty
root deeper beneath that ancestor still permits its DELETE, and a parentless
root has no server-side parent binding. Those moves are outside this model's
settled-root restore abstraction. A document manifest-path comparison rejects
a remote request prepared before the move.
Container deletion checks its current signed ancestry under the organization
lock. For local-only candidates, `assertLocalPurgeScope` and the document
placement comparisons run inside document and folder deletion transactions.
The captured placement version abstracts both the document row and its ancestor
chain.
Implementation tests also cover local ancestors changing during remote
verification.

Before the scope runs, `settlePurgeScopeMoves` waits for the moves this device
queued inside it to reach the server, so a purge soon after Move to Trash does
not meet `RestoreIntent` refusals for its own trashing. The wait only delays
`CheckCandidate` and changes no guard, so it adds no model action: any intent
still queued afterwards is refused.

Cryptographic verification is abstracted as an authenticated membership fact;
this model does not prove signature correctness or multiple concurrent moves.
The client intent recheck and remote commit are one atomic model step. For
remote operations, `PendingMoveSurvives` covers intents queued before the final
`beforeSubmit` check. A restore queued after that check while HTTP is in flight
can race the dispatched destructive request; this model does not prove
preservation in that window. Local deletion rechecks intents in its transaction.
The container ancestor check runs under the server's organization lock at the
actual remote commit.

Nine negative controls remove the candidate proof, exact document request path,
container commit check, late candidate placement-intent check, selected-root
restore check, document or folder transaction placement comparison, immutable
scope capture, or settled-root placement. Each must violate scope containment
or pending-work preservation. A quiescent in-scope candidate must delete
successfully, and every candidate terminates under weak fairness
of verification, preparation, and commit. A tenth control makes the rules
over-strict instead: `RefuseUnsettledLocal = TRUE`, which has no production
seam, refuses every local purge and violates `HonestQuiescentPurgeSucceeds`, so
that property is not satisfied by refusing everything.
