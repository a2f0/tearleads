# Principal acknowledgement races

[`PrincipalAcknowledgementRace.tla`](./PrincipalAcknowledgementRace.tla) models
a signed compound receipt that arrives after an honest reader has recovered that
receipt or a later descendant.

| Model action or predicate | Production seam |
| --- | --- |
| `CapturePredecessor` | `captureAcknowledgedPrincipalPredecessor` owns sealed predecessor evidence before dispatch; retention authenticates this snapshot |
| `Reader` | `recoverScopedPrincipalPolicyHistory` saves a newer authenticated prefix and may admit its checkpoint before the originating acknowledgement |
| `PinOnlyReader` | `admitDocumentPurgePolicyCheckpoints` pins a verified purge-proof source head without advancing this scope's prefix |
| `UncoveredPin` | `reconcileReceiptOnly` defers a receipt older than a pin that no scoped prefix covers with `PrincipalHistoryEvidenceUnavailableError` instead of a rollback incident |
| `UncoveredPinIsNotIncident` | `reconcileReceiptOnly` cannot prove receipt membership from a newer pin alone, so both honest and fork pins defer without an incident |
| `RecoverAndRetry` / `RetryDeferredReceipt` | A later `recoverScopedPrincipalPolicyHistory` call covers the pin, then the host retries `retainAcknowledgedPrincipalCurrents` with the same receipt |
| `Prepare` | `reconcileAcknowledgedPrincipalCurrent` authenticates the live prefix and proves the exact receipt and durable pin against its private history root |
| `Commit` | `persistAcknowledgedPrincipalCurrents` compares both observed prefix progress and checkpoint inside one guarded transaction; it preserves newer progress and admits the compound receipt atomically |
| `LostCAS` | `PrincipalAcknowledgementChangedError` retries local reconciliation without repeating HTTP; it is an ordinary error, never an incident |
| `ReceiptIsOnCurrentBranch` | `selectRecoveredPrincipalHistory` proves receipt membership in the current branch even when a reader advanced the version |
| `ProgressIsMonotonic` | `persistAcknowledgedPrincipalCurrents` cannot replace a newer prefix or checkpoint with its older acknowledged head |

Bounds are two principals, a predecessor, its acknowledged successor and one
later descendant. One reader can recover either the receipt branch or a fork,
before or after preparation, with or without checkpoint admission, or pin a head
without a scoped prefix. A receipt older than such a pin is deferred as an
ordinary retryable error even when the pin lies on a fork: its branch is unknown
until scoped history covers it. `DeferralNeedsUncoveredPin` keeps that outcome
from replacing ordinary completion. `RecoverAndRetry` models the later scoped
read and host retry, after which an honest receipt completes and a fork refuses.
Signatures, private prefix authentication and Merkle membership proofs are
abstracted as the authenticated branch relation. Runtime tests exercise real
signatures, SQLite transactions, private progress and proof verification. The
model treats compound writes as one atomic action; injected SQL failure tests
cover rollback. It does not model arbitrary reader starvation: production permits
eight local publication attempts (seven retries) before returning an ordinary
retryable error. The model assumes weak fairness of local reconciliation and of
the later scoped read and host retry. It does not claim progress while history
remains unavailable or a host never retries. Under those assumptions,
`HonestReceiptCompletes` requires actual publication; deferral alone does not
satisfy it. Six negative controls independently remove predecessor capture,
receipt ancestry, monotonic publication, CAS retry, uncovered-pin deferral and
the deferred receipt's recovery/retry.

`retainAcknowledgedPrincipalCurrents.pinRecovery.test.ts` admits a genuinely
verified successor pin without its scoped prefix. The same receipt first defers
without an incident or partial publication, then completes after scoped recovery
on the honest branch or reports a fork without modifying the recovered state.
