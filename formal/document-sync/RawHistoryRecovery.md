# Raw-History Rotation Recovery Model

[`RawHistoryRecovery.tla`](./RawHistoryRecovery.tla) models the fail-closed
recovery that runs before an opened document may rotate its content key.
Recovery first pulls authenticated ordinary history into a scratch document,
uses that exact history to prove any queued ordinary local rows before settling
them, then repeats the bounded raw pull so remote updates that raced settlement
are included. Rotation checkpoints are never treated as ordinary-history
provenance.

The final install is one guarded mutation: it replaces the local history
checkpoint, retires the proven pending/checkpoint artifacts, advances the
document recovery generation, and publishes the rebuilt record only if the
captured store generation and record/checkpoint comparisons still win. A
writer that began before this transaction must observe the advanced recovery
generation and reject its stale enqueue or save.

## Production Mapping

| Model action or predicate | Production implementation |
| --- | --- |
| `ValidatePreliminaryPage` / `VerifyOrdinaryProvenance` | the first `collectVerifiedRawHistoryForRotation` pass plus `importProvenOrdinaryPendingHistory` |
| `CommitPendingOrdinary` / `RejectPendingSettlement` | `settleOrdinaryDocumentUpdatesBeforeRotation` and its proven-row coverage checks |
| `ValidatePage` | the definitive `collectVerifiedRawHistoryForRotation` pass after settlement |
| monotonic `nextPage` advance | response-level cursor-advance validation plus `seenPullCursors` cycle rejection in rotation recovery |
| `RejectPreliminaryUnavailablePage` / `RejectUnavailablePage` | `DocumentRawHistoryUnavailableError` propagation after integrity-prioritized raw-page validation |
| `RejectPreliminaryInvalidPage` / `RejectInvalidPage` | incoming update isolation and fail-closed raw response validation |
| `VerifyExactLocalHistoryBeforeInstall` | `assertExactDocumentHistory` before the identity-chain install |
| `PublishRecovery` | `installRebuiltDocument` plus the atomic checkpoint replacement in `commitStoredDocumentMutation` |
| `ChangeGeneration` / `RejectChangedGeneration` | `captureDocumentStoreSyncGeneration` and `assertRotationRecoveryGeneration` checks around each awaited phase |
| `RejectSupersededInstall` | record and checkpoint compare-and-set guards in document mutation persistence |
| `hasUnverifiedLocalGap` / `RejectUnverifiedLocalGap` | exact `updateMatchesDocumentHistory` compaction coverage plus recovery's exact-history rejection; unmatched and malformed tail rows remain durable evidence |
| `AppendCheckpointArtifact` | a checkpoint row racing collection; atomic install retires the selected artifact without importing it as history |
| `BeginBlockedWriter` / `RejectBlockedWriterAfterRecovery` | the durable `recoveryGeneration` captured by enqueue/save preparation and rechecked by settlement and commit paths |

## Checked Properties and Bounds

The invariants require that failed recovery leaves durable history and queued
checkpoint artifacts intact; preliminarily proven ordinary rows may settle
before a later failure. Successful recovery publishes exactly all retained
ordinary history and no checkpoint-derived operations; settlement occurs only
after preliminary ordinary provenance is complete; generation changes stop
preliminary verification, pending settlement, and definitive collection;
superseded installs never publish; availability reporting is deterministic and
cannot mask an invalid page; and a blocked writer cannot cross the
recovery-generation fence.

The registered pull-request configuration bounds three updates, two content-key
epochs, and two pages. Initial server history and unsent local pending history
are disjoint; successful proven settlement promotes the local set into the
definitive raw frontier, while the highest update ID can independently represent
a remote update racing settlement. The maximal initial durable-history set is
the representative for preservation checks, so any pre-completion clear or
overwrite remains observable without multiplying equivalent initial subsets.

TLC explores 7,749,072 generated states, 4,408,696 distinct states, and depth
14 without an invariant violation. Sets abstract operation-log identity and page
membership; production tests remain responsible for cryptographic verification,
canonical operation bytes, Loro import semantics, SQLite transactionality,
pagination-token parsing, and projection-cache refetch behavior. This is
exhaustive bounded model checking, not an unbounded proof.
