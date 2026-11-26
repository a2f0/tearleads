# Raw-History Rotation Recovery Model

[`RawHistoryRecovery.tla`](./RawHistoryRecovery.tla) models the fail-closed
recovery that runs before an opened document may rotate its content key.
Recovery first rebuilds the served raw history in a scratch document, uses that
exact history to prove any queued ordinary local rows before settling them, then
repeats the bounded raw pull so remote updates that raced settlement are
included.

The rebuild holds exactly what an honest sync pass applied to the live
document, no more and no less (#3135):

- Every ordinary update the server serves. A checkpoint never stands in for
  one, so a checkpoint can only add operations.
- Every served rotation checkpoint the import judge accepted. A checkpoint
  here is one segment of a
  [rotation baseline](../../docs/glossary/keys.md#rotation-baseline): the
  baseline is an ordered group of ordinary updates, and the judge reads each
  segment as it reads any update. Sync imports it into the live document, so
  a rebuild without it never equals the live history, and every rotation and
  unlink of the document would fail. The judge accepts a segment only when it
  is signed by a writer of the document, authenticated, and consistent with
  every operation served before it.
- No [void](../../docs/glossary/content.md#void-update) update, ordinary or
  checkpoint: sync never applied it. Recovery leaves it out rather than
  failing on it.
- No checkpoint whose verdict is unsettled (held, or pending on the Loro
  runtime): sync has not applied it either. The pass fails and a later
  rotation retries.
- No checkpoint installed on this device. It was never served, so it
  supplies no provenance, and `ScratchNeverLaundersCheckpoints` keeps recovery
  from laundering it into the baseline the rotator signs.

That set is no wider than what sync applies: production rebuilds each page by
handing its judged updates to the same import that applies a sync pass to the
live document.

The model's abstraction did not change when a baseline became a group of
segments: a served checkpoint is still an update the judge accepts, voids, or
leaves unsettled on its own, and the rebuild still holds exactly the accepted
ones. A device no longer queues a baseline, so the model's local checkpoints
(`initialQueuedCheckpoints`, `AppendCheckpointArtifact`) now stand only for
the local history checkpoint a device installs, never for a queued row. The
group rules a served baseline must meet (index order, count, digest) fail a
raw page before the judge reads it, as any invalid page does
(`RejectInvalidPage`).

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
| `RejectPreliminaryInvalidPage` / `RejectInvalidPage` | incoming update isolation (`DocumentSyncUpdateIsolationError`) and fail-closed raw response validation |
| `RebuildCheckpoints` / `PageRebuild` | `pullVerifiedRawHistoryForRotation`, which imports each page's accepted `decryptedUpdates` with `importSyncedDocumentUpdates`, the import `applyIncomingSyncedUpdates` applies to the live document |
| `ServedCheckpoints` | the baseline segments a raw page serves, which `judgeServedBaselineGroups` holds to their group rules; the raw pull sends no outgoing updates, and every queued row is an ordinary update `importProvenOrdinaryPendingHistory` proves with `provenOrdinaryUpdateBytes` |
| `UnsettledUpdates` with `RejectPreliminaryInvalidPage` / `RejectInvalidPage` | `assertRotationVerdictsSettled`, which fails the pass on a held, deferred, or runtime-pending verdict |
| `RejectInexactHistory` | `assertExactDocumentHistory`, which compares replayed operation logs and fails with unverified local history |
| `VoidUpdates` / `ExcludeVoids` | `rotationIncomingUpdateIsolation`, which leaves the voids `validateDocumentSyncUpdateImports` returns out of the rebuild, recorded by `RotationRawHistoryVoids` once the rebuild is proven |
| `RejectPreliminaryInvalidPage` / `RejectInvalidPage` on a void, with `ExcludeVoids` off | the pre-#3135 rotation, which passed its verdicts to `assertNoVoidedDocumentSyncUpdates` and so failed on any void (negative control only) |
| `VerifyExactLocalHistoryBeforeInstall` | `assertExactDocumentHistory` before the identity-chain install |
| `PublishRecovery` | `installRebuiltDocument` plus the atomic checkpoint replacement in `commitStoredDocumentMutation` |
| `ChangeGeneration` / `RejectChangedGeneration` | `captureDocumentStoreSyncGeneration` and `assertRotationRecoveryGeneration` checks around each awaited phase |
| `RejectSupersededInstall` | record and checkpoint compare-and-set guards in `commitStoredDocumentMutation` persistence |
| `hasUnverifiedLocalGap` / `RejectUnverifiedLocalGap` | exact `updateMatchesDocumentHistory` compaction coverage plus recovery's exact-history rejection; unmatched and malformed tail rows remain durable evidence |
| `AppendCheckpointArtifact` | a checkpoint row racing collection; the atomic install (`installRebuiltDocument`) retires the selected artifact without importing it as history |
| `BeginBlockedWriter` / `FinishBlockedWriterAfterRecovery` | the durable `recoveryGeneration` captured by enqueue/save preparation and rechecked by settlement and commit paths |
| `VerifyOrdinaryProvenance` / `BeginBlockedWriter` for merged rows | a row written by `replaceQueuedPendingUpdates` has the update import mode and stored vectors equal to its decoded ones, so `importProvenOrdinaryPendingHistory` proves it with `updateMatchesDocumentHistory` like any ordinary row; `replaceDocumentQueuedUpdates` compares the document's `recoveryGeneration` inside its transaction, so a merge planned before recovery advanced the generation changes nothing |

## Checked Properties and Bounds

The invariants require that failed recovery leaves durable history and queued
checkpoint artifacts intact; preliminarily proven ordinary rows may settle
before a later failure. Successful recovery publishes exactly the history
sync applied (`CompleteRecoveryContainsAppliedHistory`); the scratch history
never holds a void, a local checkpoint, or an unsettled one
(`ScratchNeverLaundersCheckpoints`); every failure has a cause in the
recovery's inputs, never history sync applied or left out
(`RecoveryFailsOnlyForCause`); settlement occurs only
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

A served update that passed authentication, ordinary or checkpoint, can be
void, and a served checkpoint's verdict can be unsettled. Both are fixed with
the rest of the served history: the import judge's verdicts are a function of
the update and the judge, which [VoidUpdateProgress](./VoidUpdateProgress.md)
models. Checkpoint IDs queued on this device at the start are its local
checkpoints; every other checkpoint ID is served.

The safety configuration explores 24,247,232 generated states, 13,008,680
distinct states, and depth 14. Sets abstract operation-log identity (in production,
each change's operations together with its recorded commit time) and page
membership; production tests remain responsible for cryptographic verification,
canonical operation bytes, Loro import semantics, SQLite transactionality,
pagination-token parsing, and projection-cache refetch behavior. This is
exhaustive bounded model checking, not an unbounded proof.

## Progress and Negative Controls

[`RawHistoryRecoveryProgress.cfg`](RawHistoryRecoveryProgress.cfg) checks
`RecoveryEventuallyTerminates` with two updates, two epochs, and two pages.
Every fair recovery eventually either publishes or explicitly fails. `FairSpec`
adds weak fairness only for `RecoveryStep`, the worker's validation, settlement,
rejection, and publication actions. It does not require a reset, a competing
write, or a waiting writer to run. Each worker step advances a bounded
page/phase or terminates; the model contains no worker retry cycle that could
satisfy fairness without progress. This assumes awaited worker operations
eventually return. It does not prove network availability, successful recovery
for invalid input, or completion under unbounded retries.

The smaller progress run explores 683,416 generated states, 366,496 distinct
states, and depth 13. The three-update safety configuration checks the larger
frontier without temporal-check cost.

Nine fault switches are `TRUE` in both registered configurations. Automated
negative controls independently flip them and require these failures:

| Disabled switch | Expected violation |
| --- | --- |
| `RequireCurrentGeneration` | `ChangedGenerationNeverPublishes` |
| `RequireWinningInstall` | `SupersededInstallNeverPublishes` |
| `RetireCheckpoints` | `CompleteRecoveryRetiresQueuedCheckpoints` |
| `FenceBlockedWriters` | `CompleteRecoveryContainsAppliedHistory` |
| `FinishVerifiedRecovery` | `RecoveryEventuallyTerminates` |
| `ExcludeVoids` | `RecoveryFailsOnlyForCause` |
| `RebuildServedCheckpoints` | `RecoveryFailsOnlyForCause` |
| `RebuildOnlyServedCheckpoints` | `ScratchNeverLaundersCheckpoints` |
| `RequireSettledVerdicts` | `ScratchNeverLaundersCheckpoints` |

The first four mutate the install guards or effects. `ExcludeVoids` restores
the judge that failed rotation on any void, which failed every rotation and
unlink of a document holding one. `RebuildServedCheckpoints` restores the
rebuild from ordinary updates alone: under a served checkpoint carrying
operations no ordinary update carries, its proof fails on every attempt.
`RebuildOnlyServedCheckpoints` rebuilds a checkpoint this device installed,
and `RequireSettledVerdicts` one whose verdict is unsettled; each
puts history sync never applied into the baseline the rotator signs.
`FinishVerifiedRecovery` suppresses the verified publication step: safety
still permits waiting forever in `ready`, but
the temporal check rejects it even though an external reset could end recovery.
These are model fault switches, not runtime configuration options. The writer
completion represents both rejection and an erroneously committed stale
write that restores the pre-recovery checkpoint. The control must violate exact
durable-history preservation, independently of the writer's status label.
