# Subtree purge scope

[`SubtreePurgeScope.tla`](./SubtreePurgeScope.tla) covers issue #2485 finding 1:
unsigned listing edges may select candidates outside a user-selected subtree.
The bounded model separates that listing from authenticated ancestry, the path
signed into a document purge or unlink, and the path at the server commit.

| Model action or predicate | Production seam |
| --- | --- |
| `CheckCandidate` | `createSubtreePurgeScope` verifies candidate ancestry before destructive operations |
| `LocalPlacementCurrent` | `snapshotContainerStates` owns captured placement fields so live store updates cannot replace them |
| `Prepare` | `assertSubtreePurgePath` checks the exact path that document purge and unlink requests cite |
| `RestoreRoot` | `readLocalPurgeScope` compares captured root placement before dispatch, including a settled restore with no local intent |
| `RestoreIntent` | `hasUnsettledDocumentPlacement` and `readPendingMoves` detect candidate and selected-root placement intents, including parked intents |
| `Commit` | `beforeSubmit` rechecks local scope; `deleteContainerWithExecutor` checks the required ancestor after locking current organization state |
| `CanCommit` | `assertLocalPurgeScope`, `deleteStoredDocumentIfMatches` and `deleteStoredContainers` preserve local placement inside their deletion transactions |
| `DeletionStaysInScope` | `requiredAncestorId` binds container deletion to the chosen root; document mutations cite exact manifest paths |

Bounds are one candidate, four operation kinds, one placement move, and one
local restore intent at either the candidate or the selected root, and one
settled root restore. Root
restores protect every candidate, including local-only content. A document
manifest-path comparison rejects a remote request prepared before the move.
Container deletion checks its current signed ancestry under the organization
lock. For local-only candidates, `assertLocalPurgeScope` and the document
placement comparisons run inside document and folder deletion transactions.
The captured
placement version abstracts both the document row and its ancestor chain.
Implementation tests also cover local ancestors changing during remote
verification.

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
or pending-work preservation. A quiescent in-scope candidate
must delete successfully, and every candidate terminates under weak fairness
of verification, preparation, and commit.
