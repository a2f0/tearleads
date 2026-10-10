# Principal acknowledgement races

[`PrincipalAcknowledgementRace.tla`](./PrincipalAcknowledgementRace.tla) models
issue #2485 finding 4: a signed compound receipt arrives after an honest reader
has recovered that receipt or a later descendant.

| Model action or predicate | Production seam |
| --- | --- |
| `CapturePredecessor` | `captureAcknowledgedPrincipalPredecessor` owns sealed predecessor evidence before dispatch; retention authenticates this snapshot |
| `Reader` | `recoverScopedPrincipalPolicyHistory` saves a newer authenticated prefix and may admit its checkpoint before the originating acknowledgement |
| `Prepare` | `reconcileAcknowledgedPrincipalCurrent` authenticates the live prefix and proves the exact receipt and durable pin against its private history root |
| `Commit` | `persistAcknowledgedPrincipalCurrents` compares both observed prefix progress and checkpoint inside one guarded transaction; it preserves newer progress and admits the compound receipt atomically |
| `LostCAS` | `PrincipalAcknowledgementChangedError` retries local reconciliation without repeating HTTP |
| `ReceiptIsOnCurrentBranch` | `selectRecoveredPrincipalHistory` proves receipt membership in the current branch even when a reader advanced the version |
| `ProgressIsMonotonic` | `persistAcknowledgedPrincipalCurrents` cannot replace a newer prefix or checkpoint with its older acknowledged head |

Bounds are two principals, a predecessor, its acknowledged successor and one
later descendant. One reader can recover either the receipt branch or a fork,
before or after preparation, with or without checkpoint admission. Signatures,
private prefix authentication and Merkle membership proofs are abstracted as
the authenticated branch relation. Runtime tests exercise real signatures,
SQLite transactions, private progress and proof verification. The model treats
compound writes as one atomic action; injected SQL failure tests cover
rollback. It does not model arbitrary reader starvation: production permits
eight local publication attempts (seven retries) before returning an ordinary
retryable error. Weak fairness requires an honest receipt to finish within
this bound, rather than satisfying safety by rejecting every acknowledgement.
Four negative controls independently remove predecessor capture, receipt
ancestry, monotonic publication and CAS retry.
