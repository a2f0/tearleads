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
5. use a preliminary raw pull to prove each ordinary pending delta byte-for-byte
   against the live operation history, settle only those proven rows, and then
   perform a definitive raw pull;
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
rotation checkpoints remain queued and excluded from reconstruction. If a
checkpoint is the only durable carrier of an operation, the client cannot
prove that operation originated locally rather than in a forged checkpoint,
so a preliminary raw reconstruction imports only queued ordinary local deltas
and must contain the exact live operation history before settlement (it may
also contain concurrent remote work). Deterministic operation-log comparison
detects a forged checkpoint that reuses genuine version-vector identities, and
per-row range comparison proves that each queued binary delta contains the
live document's exact operations, before a dependent local edit can be
re-encrypted or published. Settlement is restricted to that exact proven row
set; a sibling pane appending or replacing an ordinary row aborts rotation
before the new row can be sent. After settling proven local rows, the client
performs a definitive raw pull so remote work racing the submit is included. A
successful guarded install atomically removes queued checkpoints whose declared
frontier is covered by the verified rebuild, along with covered local-history
tail rows. Final history and generation verification remain on the document
identity-write chain through that install, so a scheduled sync cannot advance
live state in the check-to-persist interval. Coverage is selected only after
the guarded install transaction acquires its write lock, preventing a
concurrent append from surviving as a stale or forged redirect after recovery.

Custom `DocumentsPersistence` adapters must declare
`supportsAtomicRecoveryHistoryPruning: true` and implement that guarantee in
`commitDocumentMutation`: selecting covered pending checkpoints and history
tail rows, replacing the checkpoint, pruning those rows, and committing the
canonical document must be one guarded transaction. Rotation recovery refuses
adapters that omit the capability instead of assuming compatible behavior.
If the monotonic checkpoint gate or canonical-record comparison rejects the
recovery candidate, the adapter rolls back the complete install, including
checkpoint/tail pruning and pending-row settlement.

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
target order. Before reporting an unavailable epoch, the client decrypts and
import-validates every sibling whose content key is available. Any poison
retains precedence, including an unresolved dependency: the current wire
contract authenticates operation ranges but not an exact dependency set, so
the client cannot prove that an unavailable sibling carries that parent.
Every historical bundle's target list is also recomputed and compared with its
committed target hash before missing KEK material can be classified as benign
unavailability.
When this error is derived using a reusable cached writer projection, the
client evicts and resolves that projection once before exposing the error; a
fresh projection may restore access to retained predecessor keys. A raw
pagination conflict never restarts or resubmits the frozen cursor, including
when the first attempt was built from persisted projection state.

## Verification

Store-level tests cover honest recovery, forged remote and queued baselines,
malformed or missing historical bundles without durable mutation, unavailable
historical epochs, interrupted multi-page recovery, pre-rotation settlement of
pending local updates, forged-baseline-dependent edit isolation, rejection of
checkpoint-only settlement gaps, mixed-page poison precedence, atomic
checkpoint-gate rollback, unrelated unresolved-dependency isolation,
cached-projection recovery, persisted-cursor conflicts, cross-client
consecutive rotation, and the unchanged ordinary-sync request shape.

The bounded TLA+ model
[`RawHistoryRecovery.tla`](../formal/document-sync/RawHistoryRecovery.tla)
explores arbitrary page assignment, ordinary/checkpoint classification,
per-update validity, epoch availability, and arbitrary preexisting durable
history for three updates, two epochs, and two pages.

| Model action or state | Production implementation |
| --- | --- |
| `CommitPendingOrdinary` | bounded ordinary queue settlement before the raw pull that can publish |
| `ValidatePage` | `rotationIncomingUpdateIsolation` plus scratch import and verified projection-state carry-forward in `pullVerifiedRawHistoryForRotation`; invalid empty continuations fail instead of retrying |
| `RejectUnavailablePage` | `DocumentRawHistoryUnavailableError` after a present verified bundle cannot yield a key |
| `RejectInvalidPage` | poison isolation, which takes precedence over availability reporting |
| `VerifyOrdinaryProvenance` / `RejectUnverifiedLocalGap` | preliminary raw reconstruction plus exact full-history comparison proves queued ordinary deltas before settlement and rejects checkpoint substitution |
| `RejectUnprovenPendingAppend` | settlement compares every live ordinary row with the preliminary proven row identity and atomically aborts on sibling-pane additions or replacements |
| `ChangeGeneration` / `RejectChangedGeneration` | a document, domain, database, or trust-resolver swap invalidates collection and install |
| `RejectSupersededInstall` | a newer durable record or non-dominated history checkpoint rejects and rolls back the guarded install |
| `AppendCoveredLocalArtifact` | a covered checkpoint or tail row arriving before the install transaction acquires its write lock |
| `PublishRecovery` | identity-write-serialized final verification and guarded `installRebuiltDocument`, including atomic retirement of covered queued checkpoints |
| `ordinaryUpdates` | raw decrypted updates without `rotate_baseline` checkpoints |

The checked invariants require local settlement to start only after raw
ordinary provenance verification and definitive raw collection to start only
after settlement. Incomplete or failed recovery preserves the old durable
history, successful recovery contains every retained ordinary update,
successful recovery to retire covered queued checkpoints, scratch state never
to trust a rotation checkpoint, covered local artifacts appended during
collection to survive every failure or retire with the successful transaction,
unverified local history never to publish, the
scratch rebuild never to replace a superseding pane's winner, the captured
runtime generation never to publish after it changes, the reported
unavailable epoch to be the deterministic lowest missing epoch on the failing
page, and invalid updates never to be mislabeled as availability failures.
