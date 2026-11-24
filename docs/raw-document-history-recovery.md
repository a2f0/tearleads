# Raw Document-History Recovery

Raw history is a deliberate recovery mode for clients that must reconstruct a
document without trusting a writer-supplied
[rotation-baseline coverage claim](./document-rekey-and-audit-history.md#declared-coverage-is-trusted-not-verified).
The server still authenticates the request and freezes pagination at one
[commit LSN](./glossary/sync.md#commit-lsn), but it bypasses baseline
redirection and returns every retained missing update plus the
[content-key bundle](./glossary/keys.md#content-key-bundle) for every served epoch.

## Client Contract

Call `RemoteDocumentService.syncRemoteDocument` with `historyMode: "raw"`, a
null local [version vector](./glossary/content.md#version-vector), and no
outgoing updates.
Ordinary sync omits `historyMode`.

A raw consumer must:

1. start with an empty scratch document;
2. authenticate, decrypt, and poison-isolate every response update, and leave
   out each [void update](./glossary/content.md#void-update) the import judge
   names, as a sync pass does;
3. retain the cursor and each page's verified projection state only in memory,
   then drain every bounded page;
4. reconstruct exactly what a sync pass applied: every original ordinary
   update and every served `rotate_baseline` checkpoint the judge accepted,
   and no checkpoint queued or installed on this device;
5. use a preliminary raw pull to prove each ordinary pending delta
   operation-for-operation against the live history, settle only those proven
   rows, and then perform a definitive raw pull;
6. publish the rebuilt document once through a guarded atomic install.

Raw recovery never trusts a checkpoint's declared version-vector coverage:
every ordinary update is imported whether or not a checkpoint claims to cover
it, so a checkpoint can only add operations. A served checkpoint is
reconstructed exactly when sync applies it to the live document: the judge
accepted it, so it is signed by a writer of the document, authenticated, and
consistent with every operation served before it. Its operations are in the
live document, and a rebuild without them could never equal the live history,
so every rotation and unlink of the document would fail. That makes the
reconstruction no wider than sync: each page's judged updates go through the
same import a sync pass applies to the live document. A checkpoint the judge
voided, or whose verdict is unsettled, is one sync has not applied, and a
checkpoint queued or installed on this device was never served, so none of
them enters the rebuild.

The built-in document content-key [rotation](./glossary/keys.md#rotate) preflight
implements this contract. It judges each page's stream as a sync pass does and
leaves out its voids; a sync pass never applied a void either, so the rebuilt
history must still equal the live one. A void this device already recorded
stays void without a Loro call, and the judge has no rebuild budget, so it
defers nothing. Once the rebuild proves equal to the live history, the
rotation records each void its payload alone decides (a metadata or
plaintext-integrity void) and reports it the first time this device meets it.
An import void depends on the history it is judged against, which a sync pass
may have started from a baseline, so the rotation leaves it out without
recording it. An update held after a Loro runtime failure fails the rotation,
which retries later
([advisory op spans](./advisory-op-spans.md#rotations-and-unlinks)). Each
page reads in a rotation read window, whose death counts toward this device's
rotation of the document rather than any update; after three under one judge
the device starts no rotation of it and leaves rotation to other members
([Loro runtime failures](./advisory-op-spans.md#loro-runtime-failures)).
An interrupted page, a poison update, a changing
document generation, or a superseding pane leaves the previous durable document
intact. Durable pending ordinary rows are settled remotely before the baseline
can be returned. Queued rotation checkpoints remain excluded from
reconstruction.

A checkpoint only this device holds, queued or installed locally, proves
nothing about where its operations came from: the client cannot tell a local
edit from one a forged checkpoint introduced. A preliminary raw reconstruction
therefore imports, besides the served history, only queued ordinary local
deltas and must contain the exact live operation history before settlement (it
may also contain concurrent remote work). The deterministic operation-log
identity type-tags binary, string, and structural values so distinct operation
payloads cannot collapse to the same serialized identity. Each change's
recorded commit time is part of that identity, so the same operations under
different times are a different history. Two holders of the same operations
can split them into different runs by the path that imported them, as a
reader that held part of a change does when a checkpoint brings the rest, so
the identity replays each history into an empty document before comparing.
It detects a forged
checkpoint that reuses genuine version-vector identities, and per-row range
comparison proves that each queued binary delta contains the live document's
exact operations. The comparison reconstructs a partial peer range from its
external dependency frontiers, so an honest local delta authored on a remotely
restored baseline remains verifiable without widening the delta's declared
range. This proof completes before a dependent local edit can be re-encrypted
or published.

Settlement is restricted to that exact proven row set; a sibling pane appending
or replacing an ordinary row aborts rotation before the new row can be sent.
Settlement persistence shares the document identity-write chain with sync
finalization, so a concurrent remote import must append its history before
settlement can persist the shared document. After settling proven local rows,
the client performs a definitive raw pull so remote work racing the submit is
included.

A successful guarded install atomically retires every queued checkpoint and its
matching local-history tail, whether or not its declared frontier is covered,
because a queued checkpoint is never a recovery source. Every other tail row
must match the verified rebuild's exact operations for its declared range. This
canonical comparison treats the two directions of a single-element deletion as
equivalent: coalescing backspaces can change that span's length from `1` to `-1`
without changing its target or position. Targets, positions, counters, and
multi-element deletion order remain exact. The comparison is independent of
Loro's update-versus-full-snapshot encoding, so a settled rotation baseline
retained in the tail can be quarantined by a later recovery; version-vector
coverage alone is insufficient and a same-frontier fork aborts the install.

Final history and generation verification remain on the document
identity-write chain through that install, so a scheduled sync cannot advance
live state in the check-to-persist interval. Coverage is selected only after
the guarded install transaction acquires its write lock, preventing a
concurrent append from surviving as a stale or forged redirect after recovery.
The same transaction advances the canonical `recoveryGeneration`. Enqueues and
record saves capture that generation before waiting for the mutation queue; a
writer released after recovery must reject its stale fence and reload instead
of appending history or publishing its pre-recovery document.

[Custom `DocumentsPersistence` adapters](./developer/custom-document-persistence.md)
opt in by declaring `supportsAtomicRecoveryHistoryPruning: true` and
implementing that guarantee in `commitDocumentMutation`: rejecting ordinary
pending rows, selecting every queued checkpoint and its matching tail plus other
exact-history-matching rows, rejecting an unrelated or same-frontier forged
tail, and rejecting any selected tail that lacks a durable row identifier and
therefore cannot be pruned. Replacing the checkpoint, pruning the selected rows,
and committing the canonical document must be one guarded transaction. Rotation
recovery refuses adapters that declare the capability `false`. If the exact
checkpoint-history gate or canonical-record comparison rejects the recovery
candidate, or if volatile runtime/trust ownership changes before the transaction
commits, the adapter rolls back the complete install, including checkpoint/tail
pruning, projection writes, and pending-row settlement. The checkpoint gate must
reject a candidate that does not dominate the stored version vector or does not
retain the stored checkpoint's exact operation-log prefix; the in-memory
conformance adapters exercise the same stale and same-frontier-fork rejection as
SQLite. The generation guard and SQLite `COMMIT` dispatch share one synchronous
slice, so ownership cannot change between the final decision and commit
dispatch.

If a retained update references a present, verified content-key bundle whose
key is no longer reachable — including a predecessor epoch whose retained
[keyring](./glossary/keys.md#container-kek-keyring) is absent — the public
`DocumentRawHistoryUnavailableError` reports the stable code
`document_raw_history_epoch_unavailable` and numeric `contentKeyEpoch`. Callers
do not need to parse an integrity-error message, and the failed recovery does
not install partial document state. An absent bundle cannot establish that
distinction before its update is authenticated, so it remains a poison incident
instead of being reported as benign history unavailability.

The raw consumer checks every referenced epoch before reporting unavailability
so a malformed bundle in the same page always takes poison-isolation
precedence. Within a multi-target bundle it likewise aggregates
unreachable-target causes, so integrity failures outrank an absent predecessor
keyring regardless of target order. Failures for a shared predecessor epoch are
merged with the same priority across
[authorizing paths](./glossary/access.md#authorizing-container-path), so an earlier
unavailable path cannot hide a later integrity failure. Before reporting an
unavailable epoch, the client decrypts and import-validates every sibling whose
content key is available. Any poison retains precedence, including an unresolved
dependency: the wire contract authenticates operation ranges but not an exact
dependency set, so the client cannot prove that an unavailable sibling carries
that parent. Every encrypted record is structurally parsed and checked against
its authenticated header before any missing epoch can be classified as benign
unavailability. Every historical bundle's target list is also recomputed and
compared with its committed [target hash](./glossary/keys.md#target-hash), and that
hash plus the
[link-set manifest](./glossary/access.md#document-link-set-manifest) must match
every authenticated update header for the epoch.

When this error is derived using a cached
[writer projection](./glossary/sync.md#writer-projection), whether supplied by the
caller or returned by the API client, the client evicts and resolves that
projection once before exposing the error; a fresh projection may restore access
to retained predecessor keys. A raw pagination conflict never restarts or
resubmits the frozen cursor, including when the first attempt was built from
persisted projection state. Any raw-page validation failure is terminal for that
frozen cursor as well, including a plain importer error that does not carry a
specialized isolation type.

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
ordinary-sync request shape.

The bounded TLA+ model
[`RawHistoryRecovery.tla`](../formal/document-sync/RawHistoryRecovery.tla)
explores arbitrary page assignment, ordinary/served/local checkpoint
classification, per-update validity, void and unsettled verdicts, epoch
availability, a bounded remote update arriving
between the preliminary and definitive pulls, and arbitrary preexisting
durable history for three updates, two epochs, and two pages.

| Model action or state | Production implementation |
| --- | --- |
| `CommitPendingOrdinary` | identity-write-serialized bounded ordinary queue settlement only when every initial pending row belongs to the explicit `preliminaryProven` set |
| `ValidatePreliminaryPage` | the first complete raw pull validates every bounded page before ordinary provenance settlement can start |
| `ValidatePage` | `rotationIncomingUpdateIsolation` plus scratch import and verified projection-state carry-forward in `pullVerifiedRawHistoryForRotation`; invalid empty continuations fail instead of retrying |
| `VoidUpdates` | the voids `rotationIncomingUpdateIsolation` leaves out of the rebuild, recorded by `RotationRawHistoryVoids` once the rebuild is proven |
| `AcceptedServedCheckpoints` / `RebuildCheckpoints` | served `rotate_baseline` checkpoints the judge accepted, imported with each page through `importSyncedDocumentUpdates`, the import sync applies to the live document |
| `UnsettledUpdates` | `assertRotationVerdictsSettled` fails the pass on a held or runtime-pending verdict |
| `RejectInexactHistory` | `assertExactDocumentHistory` fails with unverified local history when the rebuild differs from the live history |
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
| `FinishBlockedWriterAfterRecovery` / `blockedWriterFence` | recovery advances the durable generation, so a writer that captured the prior generation is rejected; the model fault control disables this check and lets its stale checkpoint overwrite recovered history |
| `PublishRecovery` | identity-write-serialized final verification and guarded `installRebuiltDocument`, including commit-time generation revalidation and atomic quarantine of every queued checkpoint artifact |
| `ordinaryUpdates` | raw decrypted updates without `rotate_baseline` checkpoints |
| `initialQueuedCheckpoints` | checkpoints queued or installed on this device, which the raw pull never serves and the rebuild never imports |

The checked invariants require that:

- every preliminary page passes integrity and availability validation before
  local settlement;
- every initially pending row belongs to the retained preliminary-proven set
  before settlement;
- definitive raw collection starts only after settlement, and publication only
  from the exact-history-proven `ready` state;
- incomplete or failed recovery preserves the old durable history;
- successful recovery contains exactly the history a sync pass applies, every
  retained ordinary update and accepted served checkpoint and no void update,
  and retires every queued checkpoint artifact;
- every failure has a cause in the recovery's inputs, never a void update or
  a served checkpoint sync applied;
- scratch state never holds a checkpoint queued or installed on this device,
  a voided one, or one whose verdict is unsettled, and checkpoint artifacts
  appended during collection survive every failure or retire with the
  successful transaction;
- unverified local history never publishes;
- the scratch rebuild never replaces a superseding pane's winner, and the
  captured runtime generation never publishes after it changes;
- a blocked writer never crosses the durable recovery-generation fence;
- the reported unavailable epoch is the deterministic lowest missing epoch on
  the failing page, and invalid updates are never mislabeled as availability
  failures.
