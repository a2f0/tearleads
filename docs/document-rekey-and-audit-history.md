# Document Rekey, Rebaselines, And Audit History

This note captures the current behavior and intended future direction for
document rekey, fresh-baseline generation, offline merge handling, and
tamper-evident document history.

It is separate from the signed group / organization policy-state design. Policy
state protects who should have access. This note is about how document content
and document history behave when access epochs change.

## Current Behavior

### Document Updates Are Epoch-Bound

- each encrypted Loro update carries one `accessEpoch`
- each encrypted Loro update is encrypted with the document DEK for that epoch
- a client only decrypts updates that match the epoch + DEK it currently
  resolved

Practically, this means a client does not replay arbitrary mixed-epoch document
history with a single key. Once a document DEK rotates, future updates are
expected to use the new epoch's DEK.

### Rewrap Reuses The Current DEK

When the server classifies a document epoch transition as `rewrap`, the client
keeps using the prior document DEK, materializes a current-epoch recipient
bundle for the expanded recipient set, and retries any local pending Loro
updates under the new epoch.

This is the additive-access path. It should not require a fresh baseline solely
because the access epoch changed.

### Rotate Means Fresh Baseline For Future Writes

When the server classifies a document epoch transition as `rotate`, the client
does not try to reuse the previous epoch's document DEK. Instead, a retained
client clears stale pending encrypted updates and resends a fresh baseline under
the new DEK.

The important distinction is:

- old ciphertext remains valid under the old DEK
- future writes move to a new DEK
- the rotate baseline is the bridge from old readable state to new epoch state

### Blob History Is Live-Only In V1

Current blob GC is based on active attachment reachability, not historical
document replay. If a blob is no longer referenced by any active
`attachment_bindings`, commit-change prunes the blob row, blob access epochs,
blob recipient envelopes, and detached binding rows for that blob. If another
active binding still references the same blob, those rows remain live until the
final active binding is retired.

Historical attachment bytes are therefore not durable in V1. Detached bindings
are transient replacement metadata, not an attachment audit log.

That means document update history and attachment/blob history have different
retention properties.

This is an accepted V1 product decision, not only an implementation accident.
For the explicit attachment/blob retention policy, see
[attachment-retention-v1.md](./attachment-retention-v1.md).

## Desired Rekey / Rebaseline Model

### Any Retained Authorized Client Should Be Able To Win

If access changes force a rotate, any still-authorized client that can read the
prior epoch should be able to:

1. rematerialize document state from the last readable baseline plus accepted
   diffs
2. generate a new document DEK for the new epoch
3. encrypt a fresh baseline under that DEK
4. submit the new current-epoch bundle and baseline

The first valid writer for the new epoch should become the canonical baseline
winner for that epoch.

### Epoch Bump Happens Before The Winning Baseline

The access change itself should advance the document `accessEpoch`.

The winning rotate baseline does not decide the new epoch number. It populates
content for an epoch that already exists because authorization state changed.

### The Winning Baseline Should Be Frontier-Checked

The server should not accept a rotate baseline blindly. To avoid dropping
server-known edits, the baseline should commit to the exact source frontier it
includes.

Recommended acceptance rule:

- the client includes the source version vector / causal frontier used to build
  the proposed baseline
- the server accepts the rotate baseline only if that frontier still matches
  the server's latest accepted frontier for the prior epoch
- otherwise the server returns `409`, and the client must rebuild the baseline
  against the newer state

This gives the right guarantee:

- the winning baseline includes all edits already accepted by the server at the
  time the baseline is accepted

It does not guarantee inclusion of edits that only exist on offline clients and
have never been uploaded.

### There Must Be Only One Canonical Bundle Per Epoch

Once a current-epoch document bundle exists, later writes for that same epoch
should not be allowed to replace it with a different DEK for the same recipient
set.

Recommended rule:

- if no current-epoch bundle exists yet, one client may seed it
- if a current-epoch bundle already exists and another client proposes a
  different bundle for that same epoch, do not accept updates encrypted under
  the proposed bundle; sync should return the canonical bundle, while
  non-sync commit paths may reject with `409`
- the losing client retries sync, adopts the canonical current-epoch bundle,
  and re-emits from local state if needed

Without this rule, multiple clients can seed different DEKs for the same epoch
and strand accepted updates behind the losing DEK.

## Offline Clients And Pending Edits

### Still-Authorized Offline Clients

If a client remains authorized but was offline during the rotate:

- its already-uploaded edits should be included in the first winning baseline
  if they were known to the server before the baseline was accepted
- its local-only edits may not be included in the first winning baseline,
  because the server has not seen them yet
- those local-only edits should still be recoverable if the client retains its
  local CRDT state

The correct recovery path is not "replay old encrypted pending patches." The
correct recovery path is:

1. keep the local CRDT state
2. sync and adopt the canonical post-rotate baseline
3. merge local state with the canonical state
4. emit a new baseline or rebased updates under the canonical current-epoch DEK

This is similar in spirit to CRDT compaction: compacting history does not break
mergeability if the client still has the local logical state.

### Revoked Offline Clients

If a client lost write access before reconnecting, future writes should be
rejected when it comes back online.

That is not because the edits are unrepresentable. It is because those writes
would be future writes from a principal that is no longer authorized.

If desired later, revoked offline edits can still be preserved as local drafts
or forks, but they should not be accepted as canonical writes after revocation.

## Historical Replay And Fresh-Client Bootstrap

There is a meaningful distinction between:

- a retained client that already has prior document state and old key material
- a fresh client that has access now but has never downloaded the older epochs

The retained-client case is enough to support winning-baseline generation.

The fresh-client case is a larger feature:

- the client would need access to prior readable epoch bundles
- the client would need to fetch and replay older encrypted updates
- the client would need to rematerialize current state without already having a
  local copy

That bootstrapping path is not fully implemented today.

## Tamper-Evident Document History

The current signed policy-state work is about tamper-evident authorization
inputs:

- signed group / organization snapshots
- hash-chained policy-state versions
- signed access manifests that reference those policy states

That is not yet the same thing as a tamper-evident document edit history.

### Recommended Direction

Treat live document state and audit history as separate layers:

- live baseline / snapshot for sync and compaction
- append-only tamper-evident update ledger for audit

The live baseline should stay compact. It should not embed the entire edit
history payload.

Instead, the audit layer should preserve history separately, for example with:

- per-update author or device signatures
- previous-hash or Merkle-linked update records
- visible causal metadata such as version vectors and access epoch
- optional signed baseline checkpoints that commit to the audit ledger

### What A Baseline Should Commit To

Rather than embedding every historical edit, a baseline checkpoint should
commit to history using metadata such as:

- the source version vector / frontier used to build it
- the last included update hash or a history-root hash
- the previous baseline hash
- the current access epoch

That gives:

- compact live sync state
- auditability of what history the baseline claims to include
- a stable checkpoint model for later verification

### Why Not Store Full History Inside The Baseline

Embedding the full edit history inside each new baseline would:

- inflate the live document payload
- duplicate data already better represented as a ledger
- make every rotate baseline progressively larger

For that reason, the better design is:

- compact baseline for current sync
- separate tamper-evident history log

## Open Questions

- Should fresh retained clients be able to rematerialize old epochs directly
  from the server, or is a retained already-synced client sufficient for V1/V2?
- Should rotate baselines carry an explicit compare-and-set frontier in the API
  contract?
- Should document updates be signed by users, devices, or both?
- Should baseline checkpoints be individually signed, or only hash-linked into
  the audit ledger?
- If historical document replay becomes a product requirement, should a future
  attachment-history layer retain old blob bytes, signed tombstones/manifests,
  or only live reachability state?
