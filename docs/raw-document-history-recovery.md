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
3. retain the cursor only in memory and drain every bounded page;
4. reconstruct from original ordinary updates, not `rotate_baseline`
   checkpoints;
5. commit every proven ordinary pending delta before the raw pull and fail
   closed if the installed document still contains operations absent from the
   verified raw history;
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
so the preflight fails without re-encrypting or publishing it.

If a retained update references a present, verified content-key bundle whose
key is no longer reachable, the public `DocumentRawHistoryUnavailableError`
reports the stable code
`document_raw_history_epoch_unavailable` and numeric `contentKeyEpoch`. Callers
do not need to parse an integrity-error message, and the failed recovery does
not install partial document state. An absent bundle cannot establish that
distinction before its update is authenticated, so it remains a poison
incident instead of being reported as benign history unavailability.

## Verification

Store-level tests cover honest recovery, forged remote and queued baselines,
malformed or missing historical bundles without durable mutation, unavailable
historical epochs, interrupted multi-page recovery, pre-rotation settlement of
pending local updates, cross-client consecutive rotation, and the unchanged
ordinary-sync request shape.

The bounded TLA+ model
[`RawHistoryRecovery.tla`](../formal/document-sync/RawHistoryRecovery.tla)
explores arbitrary page assignment, ordinary/checkpoint classification,
per-update validity, epoch availability, and arbitrary preexisting durable
history for three updates, two epochs, and two pages.

| Model action or state | Production implementation |
| --- | --- |
| `CommitPendingOrdinary` | bounded ordinary queue settlement before the raw pull that can publish |
| `ValidatePage` | `rotationIncomingUpdateIsolation` plus scratch import in `pullVerifiedRawHistoryForRotation` |
| `RejectUnavailablePage` | `DocumentRawHistoryUnavailableError` after a present verified bundle cannot yield a key |
| `RejectInvalidPage` | poison isolation, which takes precedence over availability reporting |
| `RejectUnverifiedLocalGap` | fail-closed comparison of the rebuilt and installed version vectors |
| `PublishRecovery` | guarded `installRebuiltDocument` |
| `ordinaryUpdates` | raw decrypted updates without `rotate_baseline` checkpoints |

The checked invariants require raw collection to start only after local
ordinary settlement, incomplete or failed recovery to preserve the old durable
history, successful recovery to contain every retained ordinary update,
scratch state never to trust a rotation checkpoint, unverified local history
never to publish, the reported unavailable epoch to be the deterministic
lowest missing epoch on the failing page, and invalid updates never to be
mislabeled as availability failures.
