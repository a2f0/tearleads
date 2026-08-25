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
5. merge durable local ordinary deltas after the remote frontier validates;
6. publish the rebuilt document once through a guarded atomic install.

Rotation checkpoints are still authenticated, decrypted, and scratch-imported
during validation. They are excluded only from reconstruction, because their
declared version-vector coverage is the value raw recovery is designed not to
trust. The server retains original ciphertext, so the ordinary stream remains
the recovery source of truth.

The built-in document content-key rotation preflight implements this contract.
An interrupted page, a poison update, a changing document generation, or a
superseding pane leaves the previous durable document intact. Durable pending
rows remain queued. Ordinary deltas are merged into the returned full-history
snapshot, while queued rotation checkpoints are excluded from reconstruction.

If a retained update's content-key epoch cannot be resolved, the public
`DocumentRawHistoryUnavailableError` reports the stable code
`document_raw_history_epoch_unavailable` and numeric `contentKeyEpoch`. Callers
do not need to parse an integrity-error message, and the failed recovery does
not install partial document state.

## Verification

Store-level tests cover honest recovery, forged remote and queued baselines,
malformed historical bundles, unavailable historical epochs without durable
mutation, interrupted multi-page recovery, pending local updates, and the
unchanged ordinary-sync request shape.

The bounded TLA+ model
[`RawHistoryRecovery.tla`](../formal/document-sync/RawHistoryRecovery.tla)
explores arbitrary page assignment, ordinary/checkpoint classification,
per-update validity, epoch availability, and arbitrary preexisting durable
history for three updates, two epochs, and two pages.

| Model action or state | Production implementation |
| --- | --- |
| `ValidatePage` | `rotationIncomingUpdateIsolation` plus scratch import in `pullVerifiedRawHistoryForRotation` |
| `RejectUnavailablePage` | `DocumentRawHistoryUnavailableError` |
| `PublishRecovery` | guarded `installRebuiltDocument` |
| `ordinaryUpdates` | raw decrypted updates without `rotate_baseline` checkpoints |

The checked invariants require incomplete or failed recovery to preserve the
old durable history, successful recovery to contain every retained ordinary
update, scratch state never to trust a rotation checkpoint, and the reported
unavailable epoch to be the deterministic lowest missing epoch on the failing
page.
