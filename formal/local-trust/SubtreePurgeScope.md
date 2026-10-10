# Subtree purge scope

[`SubtreePurgeScope.tla`](./SubtreePurgeScope.tla) covers issue #2485 finding 1:
unsigned listing edges may select candidates outside a user-selected subtree.
The bounded model separates that listing from authenticated ancestry, the path
signed into a document purge or unlink, and the path at the server commit.

| Model action or predicate | Production seam |
| --- | --- |
| `CheckCandidate` | `createSubtreePurgeScope` verifies candidate ancestry before destructive operations |
| `Prepare` | `assertSubtreePurgePath` checks the exact path that document purge and unlink requests cite |
| `RestoreIntent` | `hasUnsettledDocumentPlacement` and `readPendingMoves` detect candidate and selected-root placement intents, including parked intents |
| `Commit` | `beforeSubmit` rechecks local scope; `deleteContainerWithExecutor` checks the required ancestor after locking current organization state |
| `DeletionStaysInScope` | `requiredAncestorId` binds container deletion to the chosen root; document mutations cite exact manifest paths |

Bounds are one candidate, three operation kinds, one remote move, and one local
restore intent at either the candidate or the selected root. Root restores must
protect every candidate, including local-only content. A current document
manifest-path comparison rejects a request
prepared before the move. Container deletion instead checks its current signed
ancestry under the organization lock. Local-only candidates have fixed ancestry
in this model; local row compare-and-set races remain implementation tests.
Cryptographic verification is abstracted as an authenticated membership fact;
this model does not prove signature correctness or multiple concurrent moves.
The local intent recheck and remote commit are one atomic model step. Therefore,
`PendingMoveSurvives` covers intents queued before the client's final
`beforeSubmit` check. A restore queued after that check, while HTTP is in
flight,
can race the already dispatched destructive request; this model does not prove
preservation in that window. The container ancestor check still runs under the
server's organization lock at the actual commit.

Five negative controls remove the candidate proof, the exact document request
path check, the container commit check, the late candidate placement-intent
check, or the selected-root
restore check.
They must respectively violate scope containment or pending-work preservation.
A quiescent in-scope candidate must delete successfully, and every candidate
terminates under weak fairness of verification, preparation, and commit.
