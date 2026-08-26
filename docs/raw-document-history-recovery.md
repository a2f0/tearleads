# Raw Document-History Recovery

Raw history is a deliberate recovery mode for clients that must reconstruct a
document without trusting a writer-supplied rotation-baseline coverage claim.
The server still authenticates the request and freezes pagination at one commit
LSN, but it bypasses baseline redirection and returns every retained missing
update plus the content-key bundle for every served epoch.

## Client Contract

Call `syncRemoteDocument` with `historyMode: "raw"`, a null local version
vector, and no outgoing updates. Ordinary sync omits `historyMode` and keeps its
existing wire shape.

A raw consumer must:

1. start with an empty scratch document;
2. authenticate, decrypt, and poison-isolate every response update;
3. retain the cursor and each page's verified projection state only in memory,
   then drain every bounded page;
4. reconstruct from original ordinary updates, not `rotate_baseline`
   checkpoints;
5. use a preliminary raw pull to prove each ordinary pending delta
   operation-for-operation against the live history, settle only those proven
   rows, and then perform a definitive raw pull;
6. publish the rebuilt document once through a guarded atomic install.

Rotation checkpoints are still authenticated, decrypted, and scratch-imported
during validation. They are excluded only from reconstruction, because their
declared version-vector coverage is the value raw recovery is designed not to
trust. The server retains original ciphertext, so the ordinary stream remains
the recovery source of truth.

The built-in document content-key rotation preflight implements this contract.
An interrupted page, a poison update, a changing document generation, or a
superseding pane leaves the previous durable document intact. Durable pending
ordinary rows are settled remotely before the baseline can be returned. Queued
rotation checkpoints remain excluded from reconstruction. If a
checkpoint is the only durable carrier of an operation, the client cannot
prove that operation originated locally rather than in a forged checkpoint,
so a preliminary raw reconstruction imports only queued ordinary local deltas
and must contain the exact live operation history before settlement (it may
also contain concurrent remote work). The deterministic operation-log identity
type-tags binary, string, and structural values so distinct operation payloads
cannot collapse to the same serialized identity. It detects a forged
checkpoint that reuses genuine version-vector identities, and
per-row range comparison proves that each queued binary delta contains the
live document's exact operations. The comparison reconstructs a partial peer
range from its external dependency frontiers, so an honest local delta authored
on a remotely restored baseline remains verifiable without widening the delta's
declared range. This proof completes before a dependent local edit can be
re-encrypted or published. Settlement is restricted to that exact proven row
set; a sibling pane appending or replacing an ordinary row aborts rotation
before the new row can be sent. Settlement persistence shares the document
identity-write chain with sync finalization, so a concurrent remote import must
append its history before settlement can persist the shared document. After
settling proven local rows, the client performs a definitive raw pull so remote
work racing the submit is included. A successful guarded install atomically
retires every queued checkpoint and its
matching local-history tail, whether or not its declared frontier is covered,
because checkpoints are never recovery sources. Every other tail row must match
the verified rebuild's exact operations for its declared range. This canonical
comparison is independent of Loro's update-versus-full-snapshot encoding, so a
settled rotation baseline retained in the tail can be quarantined by a later
recovery; version-vector coverage alone is insufficient and a same-frontier
fork aborts the install.
Final history and generation verification remain on the document identity-write
chain through that install, so a scheduled sync cannot advance live state in
the check-to-persist interval. Coverage is selected only after the guarded
install transaction acquires its write lock, preventing a concurrent append
from surviving as a stale or forged redirect after recovery.
The same transaction advances the canonical `recoveryGeneration`. Enqueues and
record saves capture that generation before waiting for the mutation queue; a
writer released after recovery must reject its stale fence and reload instead
of appending history or publishing its pre-recovery document.

Custom `DocumentsPersistence` adapters opt in by declaring
`supportsAtomicRecoveryHistoryPruning: true` and implementing that guarantee in
`commitDocumentMutation`: rejecting ordinary pending rows, selecting every
queued checkpoint and its matching tail plus other exact-history-matching rows,
rejecting an unrelated or same-frontier forged tail, and rejecting any selected
tail that lacks a durable row identifier and therefore cannot be pruned.
Replacing the checkpoint, pruning the selected rows, and committing the
canonical document must be one guarded transaction. Rotation recovery refuses
adapters that omit the
capability or declare it `false` instead of assuming compatible behavior. If
the exact
checkpoint-history gate or canonical-record comparison rejects the recovery
candidate, or if volatile runtime/trust ownership changes before the
transaction commits, the adapter rolls back the complete install, including
checkpoint/tail pruning, projection writes, and pending-row settlement. The
checkpoint gate must reject a candidate that does not dominate the stored
version vector or does not retain the stored checkpoint's exact operation-log
prefix; the in-memory conformance adapters exercise the same stale and
same-frontier-fork rejection as SQLite. The
generation guard and SQLite `COMMIT` dispatch share one synchronous slice, so
ownership cannot change between the final decision and commit dispatch.

If a retained update references a present, verified content-key bundle whose
key is no longer reachable — including a predecessor epoch whose retained
keyring is absent — the public `DocumentRawHistoryUnavailableError`
reports the stable code
`document_raw_history_epoch_unavailable` and numeric `contentKeyEpoch`. Callers
do not need to parse an integrity-error message, and the failed recovery does
not install partial document state. An absent bundle cannot establish that
distinction before its update is authenticated, so it remains a poison
incident instead of being reported as benign history unavailability. The raw
consumer checks every referenced epoch before reporting unavailability so a
malformed bundle in the same page always takes poison-isolation precedence.
Within a multi-target bundle it likewise aggregates unreachable-target causes,
so integrity failures outrank an absent predecessor keyring regardless of
target order. Failures for a shared predecessor epoch are merged with the same
priority across authorizing paths, so an earlier unavailable path cannot hide a
later integrity failure. Before reporting an unavailable epoch, the client
decrypts and import-validates every sibling whose content key is available. Any
poison retains precedence, including an unresolved dependency: the current
wire contract authenticates operation ranges but not an exact dependency set,
so the client cannot prove that an unavailable sibling carries that parent.
Every encrypted record is structurally parsed and checked against its
authenticated header before any missing epoch can be classified as benign
unavailability. Every historical bundle's target list is also recomputed and
compared with its committed target hash, and that hash plus the link-set
manifest must match every authenticated update header for the epoch.
When this error is derived using a cached writer projection, whether supplied
by the caller or returned by the API client, the client evicts and resolves
that projection once before exposing the error; a fresh projection may restore
access to retained predecessor keys. A raw
pagination conflict never restarts or resubmits the frozen cursor, including
when the first attempt was built from persisted projection state. Any raw-page
validation failure is terminal for that frozen cursor as well, including a
plain importer error that does not carry a specialized isolation type.

## Verification

Store-level tests cover honest recovery, forged remote and queued baselines,
malformed or missing historical bundles without durable mutation, unavailable
historical epochs, interrupted multi-page recovery, pre-rotation settlement of
pending local updates, forged-baseline-dependent edit isolation, rejection of
checkpoint-only settlement gaps, mixed-page poison precedence, atomic
checkpoint-gate rollback, racing-checkpoint quarantine across restart,
settled-baseline tail quarantine by a later recovery, same-frontier tail-fork
rejection, encoding-neutral and binary/string history-identity separation,
unavailable-record/header poison precedence, unrelated unresolved-dependency
isolation, stale and same-frontier-forked in-memory checkpoint rejection,
page-two generic validation failure without resubmission,
caller-supplied and API-cached projection recovery, missing tail-row identity
rejection, blocked enqueue/save rejection across the recovery-generation fence,
persisted-cursor conflicts, cross-client consecutive rotation, and the
unchanged ordinary-sync request shape.

The bounded TLA+ model
[`RawHistoryRecovery.tla`](../formal/document-sync/RawHistoryRecovery.tla)
explores arbitrary page assignment, ordinary/checkpoint classification,
per-update validity, epoch availability, a bounded remote update arriving
between the preliminary and definitive pulls, and arbitrary preexisting
durable history for three updates, two epochs, and two pages.

| Model action or state | Production implementation |
| --- | --- |
| `CommitPendingOrdinary` | identity-write-serialized bounded ordinary queue settlement only when every initial pending row belongs to the explicit `preliminaryProven` set |
| `ValidatePreliminaryPage` | the first complete raw pull validates every bounded page before ordinary provenance settlement can start |
| `ValidatePage` | `rotationIncomingUpdateIsolation` plus scratch import and verified projection-state carry-forward in `pullVerifiedRawHistoryForRotation`; invalid empty continuations fail instead of retrying |
| `RejectPreliminaryUnavailablePage` / `RejectUnavailablePage` | `DocumentRawHistoryUnavailableError` after a present verified bundle cannot yield a key on either pull |
| `RejectPreliminaryInvalidPage` / `RejectInvalidPage` | poison isolation on either pull, which takes precedence over availability reporting |
| `VerifyOrdinaryProvenance` / `RejectUnverifiedLocalGap` | preliminary raw reconstruction plus exact full-history comparison proves queued ordinary deltas before settlement and rejects checkpoint substitution |
| `RejectUnprovenPendingAppend` | settlement compares every live ordinary row with the preliminary proven row identity and atomically aborts on sibling-pane additions or replacements |
| `AppendUnprovenLocalArtifactBeforeInstall` / `RejectUnprovenLocalArtifactBeforeInstall` | the guarded install detects and rejects ordinary rows or tails whose exact operation range is absent from the rebuild, including same-frontier forks, and preserves them for explicit recovery |
| `VerifyExactLocalHistoryBeforeInstall` / `ready` | final exact-history provenance is an explicit publication prerequisite inside the identity-write section |
| `ChangeGeneration` / `RejectChangedGeneration` | a document, domain, database, or trust-resolver swap invalidates collection and install |
| `RejectSupersededInstall` | a newer durable record or checkpoint lacking the stored operation-log prefix rejects and rolls back the guarded install |
| `AppendCheckpointArtifact` | a checkpoint arriving before the install transaction acquires its write lock is selected and retired without entering recovered history |
| `BeginBlockedWriter` / `CommitBlockedWriterBeforeRecovery` | a writer that wins the queue before recovery becomes an unverified artifact and atomically aborts publication |
| `RejectBlockedWriterAfterRecovery` / `blockedWriterFence` | recovery advances the durable generation, so a writer that captured the prior generation and resumes afterward is rejected without a side effect |
| `PublishRecovery` | identity-write-serialized final verification and guarded `installRebuiltDocument`, including commit-time generation revalidation and atomic quarantine of every queued checkpoint artifact |
| `ordinaryUpdates` | raw decrypted updates without `rotate_baseline` checkpoints |

The checked invariants require every preliminary page to pass integrity and
availability validation before local settlement, every initially pending row
to belong to the retained preliminary-proven set before settlement, and
definitive raw collection
to start only after settlement, and publication to start only from the
exact-history-proven `ready` state. Incomplete or failed recovery preserves the
old durable
history, successful recovery contains every retained ordinary update,
successful recovery to retire every queued checkpoint artifact, scratch state
never to trust a rotation checkpoint, checkpoint artifacts appended during
collection to survive every failure or retire with the successful transaction,
unverified local history never to publish, the
scratch rebuild never to replace a superseding pane's winner, the captured
runtime generation never to publish after it changes, a blocked writer never
to cross the durable recovery-generation fence, the reported
unavailable epoch to be the deterministic lowest missing epoch on the failing
page, and invalid updates never to be mislabeled as availability failures.
