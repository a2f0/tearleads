# Protocol Models

This directory contains executable abstractions of protocol safety rules. The
models complement the runtime grammar in
[`docs/protocol-specification.md`](../docs/protocol-specification.md); they do
not replace Zod validation, cryptographic verification, database constraints,
or integration tests.

Run every bounded model with:

```sh
mise install java github:tlaplus/tlaplus
bun run check:protocol-models
```

The repository pins Java 21 and the prebuilt TLA+ tools; TLC itself requires
Java 11 or newer. No generated state directory or tool binary is committed.

[`protocol-models.txt`](./protocol-models.txt) is the pull-request model
registry. Each non-comment line pairs one repository-relative TLA+ module and
configuration as `model|config`. The checker validates the complete registry
before starting Java, rejects unregistered configuration files, sorts pairs
deterministically, and gives each TLC invocation an isolated state directory.

To add a model, commit its `.tla` and bounded `.cfg` files and register the pair.
One module may appear with multiple configurations, but each configuration must
appear exactly once. Keep registered bounds small enough for `check:fast`;
broader configurations should use a separate scheduled suite rather than
silently increasing pull-request check time.

## Document Baseline Dominance

[`document-sync/BaselineDominance.tla`](./document-sync/BaselineDominance.tla)
models the no-data-loss gate for document sync baseline redirection. A baseline
dominates an update exactly when both conditions hold:

1. the update's content-key epoch is strictly older than the baseline epoch;
2. the baseline source version vector componentwise covers the update's end
   version vector.

The one-readable-baseline abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `Dominated` | `isDocumentUpdateDominatedByBaseline` |
| `Serve` | `selectServedSyncUpdates` |

TLC explores the sync serve decision. The checked invariants require that:

- only dominated older updates are omitted from the response;
- every uncovered update is served;
- current-or-newer-epoch updates are served;
- after serving, every unserved update is carried by the readable baseline.

The invariants are stated with the same `Dominated`/`Older` operators that
guard the action, so TLC verifies the redirect decision relative to those
definitions — not the dominance definition itself. Mutation testing confirms
this boundary: weakening `VectorCovers` or deleting its conjunct from
`Dominated` passes TLC unchanged, while removing the serve gate is caught. The
ground truth for the dominance semantics is the TypeScript parity suite below,
which `check:fast` runs on every push and pull request via
`test:protocol-conformance`.

The checked configuration bounds the state space to two peers, counters from
zero through two, three content-key epochs, and two arbitrary updates. The
TypeScript bounded-parity test
`packages/api/src/documents/documentBaselineDominance.test.ts` independently
constructs real Loro version vectors for the same bounds. It checks 729
predicate cases, 39,366 readable-baseline redirect cases across both candidate
orders, and 4,374 missing-baseline cases. It also checks the order-preserving
behavior that the set-based TLA+ abstraction intentionally omits. The test does
not consume TLC-generated traces, so the explicit mapping above must stay
synchronized as either side evolves.

This is exhaustive bounded model checking, not an unbounded mathematical proof.
The model assumes well-formed persisted version vectors, one same-document
baseline that has passed authenticated replayability checks, and continued
availability of that current-epoch baseline. Cryptographic authenticity,
database transactions, SQL ordering, and Loro's own CRDT correctness remain
outside the abstraction. A future TLAPS or theorem-prover layer could prove the
parameterized invariant after this model has stabilized.

## Deferred Document-Tail Settlement

[`document-sync/DeferredTailSettlement.tla`](./document-sync/DeferredTailSettlement.tla)
models the device-first outgoing-delta marker across local edits, durable queue
writes, restarts, sync preparation, server acceptance, incoming updates, and a
final clean skip. The marker may safely lag the stored content frontier while
durable pending rows semantically cover the difference. Pulled updates land in
the durable history tail (as remote-origin rows) in their own write before the
record persist, and restart restores the marker from the persisted base
extended across those remote-origin rows — provenance proves the server holds
them — so a crash between the two writes never re-enters server-held ops into
the outgoing delta; accepted local-origin rows are re-derived and re-sent, the
safe idempotent direction. Before queued rows may be submitted and deleted, the
document lane must make that accounting durable:

1. synchronously capture the snapshot frontier, then merge the in-memory base
   and every semantically connected durable queued end vector;
2. if the merged coverage does not reach that capture, enqueue the captured
   base-to-frontier delta;
3. freeze the covered marker before persistence adapter awaits, claim the
   guarded durable mutation for that exact value, then merge it into the live
   in-memory marker on success;
4. then submit and atomically settle any accepted subset of queued rows.

The response is bound to the document identity and access/keying context used
by the pass. After all pre-adapter awaits, `canStartDurableMutation` rechecks
the generation and complete request context immediately before
`runSerializedSqlMutation` claims the captured executor's mutation queue. The
model linearizes the fixed marker, settlement, or deletion effect at that
guarded `Start` transition. A synchronous reset may then replace the live
generation before the queued mutation returns, but the post-await check
suppresses replacement in-memory publication, effect callbacks, and store
removal.

On the same executor, replacement mutations queue behind the already-claimed
operation and therefore observe its ordering. If reset installs a different
executor, the captured operation finishes on the old one. The model takes the
conservative shared-durable-state branch: reset may load the already-linearized
effect, but stale completion itself cannot mutate the replacement generation.

Relink and security-context writes use the same identity-write chain. If relink
A -> B wins before a deletion for A starts, the stale deletion is consumed
without a durable operation. If deletion starts first, relink cannot overtake
it; the deletion completes in A's claimed queue position before the queued
relink proceeds. In neither ordering can the deletion remove live B.

Preparation and response continuations additionally capture one immutable
document-store generation: the live document object, domain scope, SQLite
executor, and projection-key resolver. Reset/reinitialize may replace that
generation during any await. An enqueue, marker persist, response persist, or
deletion that claimed its durable queue position may still complete. The model
updates durable snapshot, marker, settlement, and presence at guarded start,
keeps post-reset returns as explicit stale-completion transitions, and
separates durable presence from live in-memory presence. Reset may load those
ordered durable effects; the later stale completion publishes nothing further.

The abstraction coalesces `applyIncomingSyncedUpdates` into live response
completion. Production performs that synchronous import before the persistence
helper's pre-adapter awaits. A full reset abandons the captured document, but a
domain-scope- or resolver-only generation change can retain already-imported,
authenticated remote operations even when the later durable claim aborts. That
same-document preparatory mutation is outside
`StaleDurableCompletionCannotPublish`; the property covers publication after a
durable mutation has actually been claimed.

An edit that lands after capture belongs to the next outgoing frontier. A
normal write durably queues its delta and requests a coalesced pass; an
intentionally deferred write remains behind the marker as a visible retained
tail. Neither is silently included in the already-captured frontier.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `QueueEdit` / `DeferEdit` | `pendingDeltaSinceBase`, `enqueuePendingUpdate`, `persistDocument`, and `advancePendingBaseVersion` |
| `CapturePreparation` | `prepareDocumentOutgoingCoverage` using `extendDocumentVersionCoverage` before its first await |
| `MaterializeCapturedTail` | `prepareDocumentOutgoingCoverage` exporting and durably enqueuing an uncovered captured delta, whether its capture stays live or becomes stale |
| `AbortStalePreparation` | post-enqueue generation checks returning without marker publication; an enqueue already submitted to persistence may still finish |
| `PlanMarkerPersist` / `StartMarkerPersist` / `CompleteLiveMarkerPersist` | freezing `nextBaseVersion` before adapter awaits, the later successful `canStartDurableMutation` check and mutation claim, and post-await non-null persistence result in `prepareDocumentOutgoingCoverage` |
| `CompleteStaleMarkerPersist` | a claimed marker mutation returning after reset, with a null persistence result suppressing replacement-store publication and effects |
| `ResetReinitialize` | replacement of any `DocumentStoreSyncGeneration` identity: `currentDoc`, `domainScope`, `execSql`, or `resolveProjectionUserKey` |
| `BeginSyncResponse` | `captureDocumentStoreSyncGeneration` plus the sync attempt's plan and captured `currentRecord` identity/access/keying context |
| `Relink` / `StartedDurableOpSerializesRelink` | document-id, container, access, and keying-context writes sharing `chainIdentityWrite`, so none can overtake a durable operation that already started there |
| `StartResponseDurableOp` | `canStartDurableMutation` rechecking generation and `documentSyncContextMatches` immediately before `runSerializedSqlMutation` claims the persistence or deletion queue |
| `CompleteLiveResponsePersist` / `CompleteLiveDeletion` | the post-await generation check allowing response publication or `markDocumentStoreRemoved` only into the still-matching generation |
| `CompleteStaleResponseDurableOp` | a claimed response persist or deletion returning after reset, followed by no additional in-memory publication or effect callback on the replacement store |
| `CancelOrIgnoreResponse` | response cancellation or `finalizeDocumentSync` returning and re-arming without response-derived snapshot, marker, or queue mutation |
| `CompleteCapturedPass` | `shouldSkipCleanScheduledDocumentSync` after outgoing coverage preparation |

TLC explores restarts before and after both durable preparation steps, every
partial/all queued-settlement ordering, ordinary edits that re-export an older
deferred operation, ordinary and deliberately deferred edits after capture,
an incoming update concurrent with a retained local tail, reset/reinitialize
before a guarded operation starts and while marker persistence, response
persistence, or deletion is already awaiting physical completion, and relink
on either side of that serialized start. This includes an authoritative
deletion captured for A followed by relink A -> B before the deletion callback
obtains the identity-write chain. The invariants and temporal properties
require that:

- persisted and in-memory marker coverage never outrun the union of accepted
  and durably queued operations;
- every snapshot operation is accepted, durably queued, or still retained by
  the base-to-snapshot tail;
- a prepared or completed pass has no tail through its captured frontier;
- the frontier certified by a completed pass is fully materialized upstream,
  while newer operations remain durably queued or retained;
- every marker or response publication matched the captured generation and
  identity/access context at its post-await publication check;
- every durable mutation start passed its adjacent generation/context guard;
- a stale completion returns but cannot publish into replacement snapshot,
  marker, presence, identity, or effects;
- same-generation relink cannot overtake an active identity-chain operation;
- an authoritative deletion can remove only the store whose live generation
  and full identity/access context match the deletion request;
- ignoring a response that was stale before its guarded start cannot mutate
  snapshot, markers, or queue, while stale preparation may retain/add coverage;
- a stale deletion captured for A cannot remove a relinked live B store;
- user-discarded local state has no queued or retained work, while an accepted
  authoritative remote deletion is tracked separately as a terminal state.

Relaxing the durable queue-claim guard violates
`DurableStartRequiresLiveContext`; relaxing the publication guard violates
`AllPublicationsMatchContext`. Publishing from a stale completion violates
`StaleDurableCompletionCannotPublish`, while letting relink overtake a claimed
chain task violates
`StartedDurableOpSerializesRelink`. Relaxing either
deletion publication guard violates `AllPublicationsMatchContext`, and letting
a stale deletion remove the live store violates
`StaleDeletionCannotRemoveLiveDocument`. These checks are independent from the
tail-accounting invariants.

The checked configuration uses two abstract operations, two document
identity/access contexts, and two non-reused store generations, exploring
3,067,900 generated and 568,008 distinct states at depth 40. Set union stands in
for semantic version-vector merge, and each queued operation stands in for the
coverage carried by one or more durable pending rows. A same-document key
rotation is a new model identity even when its remote UUID is unchanged; key
derivation and cross-identity content migration remain outside this
abstraction. The `authoritativelyDeleted` bit distinguishes a matched upstream
deletion from a user discard so the tail-safety property does not reinterpret
server deletion semantics. The production tests remain responsible for Loro
version-vector decoding, partial-start/end continuity, full-history checkpoint
coverage, SQL transactionality, update payload bytes, and sync-coordinator
scheduling. This is exhaustive bounded model checking, not an unbounded proof.
A current-schema local database with already-reconciled canonical root
identities is the runtime cutover boundary; migration of retired pre-cutover
backups is outside both the model and the supported protocol.

## Opened-Document Recovery Probes

[`document-sync/RestartProbeConvergence.tla`](./document-sync/RestartProbeConvergence.tla)
models startup and acknowledged-reconnect probes, peer writes during the
handshake or an in-flight pull, and signal-sequence coalescing for encrypted Loro
body and attachment-slot state. Its bounded run explores 6,757 generated states,
1,912 distinct states, and depth 15. See the
[production mapping and model boundary](./document-sync/RestartProbeConvergence.md)
for the action seams, fairness assumptions, and excluded blob-hydration layer.

## Empty-Frontier Baseline-less Unlink

[`document-sync/EmptyFrontierUnlink.tla`](./document-sync/EmptyFrontierUnlink.tla)
models the acceptance gate for a document unlink submitted without a rotation
baseline. An unlink rotates the document content key, so a committed update no
accepted baseline covers becomes unreadable under the new epoch. A document
with an empty committed frontier cannot produce a baseline at all — a
zero-span full-history snapshot encodes no replayable history — so the server
accepts a baseline-less unlink only after proving the committed frontier is
empty inside the mutation transaction, under the document manifest-head write
lock that sync writers take in shared mode.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginBaselinelessUnlink` / `CommitBaselinelessUnlink` | `assertBaselinelessUnlinkHasEmptyCommittedFrontier` inside `mutateDocumentLinkSetWithExecutor` |
| `CommitCoveringUnlink` | `assertAtomicRotationBaselineCoversCommittedFrontier` + `appendAtomicRotationBaseline` |
| `WriterMayCommit` | the manifest-head write lock in `lockDocumentLinkSetMutationFrontier` versus the sync writers' shared lock |
| the client never sending an empty baseline | `buildDocumentRotationBaseline` returning null for a zero-span snapshot |

The checked configuration sets `LockedUnlink = TRUE`, matching production, and
the invariants require that no rotation ever orphans an uncovered committed
update and that the emptiness observation stays true through the commit
window. Setting `LockedUnlink = FALSE` (a writer allowed to commit between the
emptiness proof and the unlink commit) makes TLC report the `NoDataLoss`
violation immediately — the lock discipline is load-bearing, not incidental.
The bounds stay small (`MaxUpdates = 3`); the state space is tiny because the
model tracks only the uncovered-update count and the unlink transaction phase.
