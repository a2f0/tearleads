# Document Rekey, Rebaselines, And Audit History

This document defines document rekey, fresh-baseline generation, offline merge
handling, and tamper-evident document history.

For shared protocol terminology, see [glossary.md](./glossary.md).

It is separate from the signed group / organization policy-state design. Policy
state protects who should have access. This document covers how document
content and document history behave when access epochs change.

## Behavior

### Document Updates Are Epoch-Bound

- each encrypted Loro update carries one `accessEpoch`
- each encrypted Loro update is encrypted with the document DEK for that epoch
- a client only decrypts updates that match the epoch + DEK it currently
 resolved

Practically, this means a client does not replay arbitrary mixed-epoch document
history with a single key. Once a document DEK rotates, subsequent updates are
expected to use the new epoch's DEK.

### Rewrap Reuses The Active DEK

When a target change is additive, the client can keep using the
prior document DEK, materialize a current-epoch content-key bundle for the
expanded target set, and retry any local pending Loro updates under the new
epoch.

This is the additive-access path. It should not require a fresh baseline solely
because the access epoch changed.

### Rotate Means Fresh Baseline For Later Writes

When access shrinks or otherwise invalidates the prior document DEK for later
writes, the client does not try to reuse the previous epoch's document DEK.
Instead, a retained client clears stale pending encrypted updates and resends a
fresh baseline under the new DEK.

Distinction:

- old ciphertext remains valid under the old DEK
- later writes move to a new DEK
- the rotate baseline is the bridge from old readable state to new epoch state

### Blob History Is Live-Only

Blob GC is based on active attachment reachability, not historical document
replay. If a blob is no longer referenced by any active
`attachment_bindings`, attachment bind/detach cleanup may prune the blob row,
blob content-key epochs, blob content-key target rows, and detached binding rows
for that blob. If another active binding still references the same blob, those
rows remain live until the final active binding is deactivated.

Historical attachment bytes are therefore not durable. Detached bindings are
transient replacement metadata, not an attachment audit log.

That means document update history and attachment/blob history have different
retention properties.

The attachment/blob retention policy is defined in
[attachment-retention.md](./attachment-retention.md).

### Audit Storage Is Live-Wired For Writes

The codebase has history-side tables and services for:

- append-only `document_audit_entries`
- typed `document_update_audit_events`
- `document_audit_checkpoints`
- `blob_audit_objects`
- typed `document_attachment_audit_events`
- `verifyDocumentAuditHistory(...)`

Those helpers are covered by service tests and are also wired into normal
application writes. Signed document sync appends audit rows for newly accepted
updates and signed blob attachment mutations append attachment audit rows before
live blob pruning can remove metadata needed by `blob_audit_objects`.

## Rekey / Rebaseline Model

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

### Baselines Carry Frontier Metadata

Baseline updates can carry the source version vector / causal frontier used to
build the proposed baseline. Checkpoint rows persist that source frontier so
audit verification can inspect what history the baseline claims to cover.

The server does not turn that source frontier into a compare-and-set gate on
accepted sync updates. A retained client that loses a rotate race adopts the
canonical bundle and re-emits from local CRDT state if needed.

### Declared Coverage Is Trusted, Not Verified

Normal sync can omit older ciphertext when an authenticated v2 baseline
(`isAuthenticatedReplayableBaseline`) declares coverage that dominates every
older update. The server retains every original encrypted document update;
there is no document-payload GC or pruner.

Under E2EE the server cannot open the baseline snapshot, so it cannot verify
that its ciphertext carries the operations it claims to cover. A malicious
authorized writer can redirect readers away from older ciphertext. Because
version vectors describe causal shape rather than content, a rotation-capable
writer can also sign a full-history snapshot with the same frontier but
fabricated prior plaintext.

The resulting risk has these bounds:

- the attack requires an authorized writer. Current access is
  history-inclusive: a writer added after rotation recovers every retained
  container KEK through the sealed keyring, so any authorized writer can read
  old history and could substitute content while preserving the visible
  version-vector shape
- the declaration is durable and attributable: checkpoint rows persist the
  frontier and commit it to the audit ledger. Signed ciphertext hashes and a
  record-key-derived HMAC attribute each retained update, but that per-update
  commitment is not comparable to a full-history snapshot's commitment. A
  current-epoch reader can compare a baseline's frontier to its claim. Original
  ciphertext remains stored, but sync has no way to bypass redirection and
  recover it

The stronger mitigation remains per-update re-encryption with inner author
signatures. Other possible hardening measures include:

- restrict `rotate_baseline` authorship by policy, narrowing which principals
  can trigger redirection
- expose an authenticated recovery mode that serves retained update history
  without baseline redirection

### There Must Be Only One Canonical Bundle Per Epoch

Once a current-epoch document bundle exists, later writes for that same epoch
should not be allowed to replace it with a different DEK for the same recipient
set.

Rule:

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

- already-uploaded edits are recoverable from the server's encrypted update
 stream when the client has the relevant epoch material
- local-only edits may not be included in the first winning baseline, because
 the server has not seen them
- local-only edits should still be recoverable if the client retains its
 local CRDT state

The correct recovery path is not "replay old encrypted pending patches." The
correct recovery path is:

1. keep the local CRDT state
2. sync and adopt the canonical post-rotate baseline
3. merge local state with the canonical state
4. emit a new baseline or rebased updates under the canonical current-epoch DEK

Local durable-history compaction does not flatten the CRDT. It periodically
exports a full-history Loro snapshot as a checkpoint and deletes only the local
tail rows that snapshot covers. The checkpoint still carries the complete
operation history needed for merging, rotation, and recovery.

### Revoked Offline Clients

If a client lost write access before reconnecting, later writes should be
rejected when it comes back online.

That is not because the edits are unrepresentable. It is because those writes
would be writes from a principal that is no longer authorized.

If desired, revoked offline edits can still be preserved as local drafts
or forks, but they should not be accepted as canonical writes after revocation.

## Historical Replay And Fresh-Client Bootstrap

There is a meaningful distinction between two clients:

- a retained client that already has prior document state and old key material
- a fresh client that has access now but has never downloaded the older epochs

Winning-baseline generation relies on the retained-client case. Fresh-client
bootstrap is the supported recovery path: a pristine client unwraps the
current container KEK from its recipient wrap, opens the sealed keyring for
every retained historical KEK, fetches prior readable epoch bundles, unwraps
their content keys through those historical KEKs, and rematerializes current
state with no local copy and no other client online. Reading never depends on
that client subsequently writing a baseline, though a full-history baseline it
later writes serves ordinary sync optimization.

## Tamper-Evident Document History

Signed policy-state work is about tamper-evident authorization
inputs:

- signed group / organization snapshots
- hash-chained policy-state versions
- signed access manifests that reference those policy states

That is separate from tamper-evident document edit history.

### Audit-Layer Structure

Live document state and audit history are separate layers:

- encrypted document updates and full-history rotation baselines for sync
- an append-only tamper-evident update ledger for audit

The server retains original encrypted document updates. Rotation baselines are
full-history Loro snapshots, not flattened state-only snapshots. Separately,
the audit layer records:

- previous-hash-linked update records
- visible causal metadata such as version vectors and access epoch
- signed baseline checkpoints that commit to the audit ledger

A baseline checkpoint commits to history through both the encrypted full-history
snapshot and its visible metadata: the source version vector / frontier used to
build it, the last included audit entry hash, the previous checkpoint hash, and
the current access epoch. The metadata makes the history a baseline claims to
cover auditable without exposing its plaintext to the server.

## Storage Decomposition

The live-state seams are:

- encrypted live document updates in `document_updates`
- causal sync indexing in `document_update_spans`
- live blob reachability in `attachment_bindings`
- access-plane material in signed access manifest heads and key-target tables
- live blob bytes in `blobs`

Those tables are optimized for active sync and access state. Original document
ciphertext is retained in `document_updates`, while tamper-evident metadata
lives in separate history-side persistence. The split is:

- retained document ciphertext plus live-state projections
- a baseline/checkpoint metadata model
- an attachment/blob history model
- access-state metadata and hashes snapshotted into audit records
  (`accessEpoch`, `accessManifestHash`, `accessStateHash`) so the audit layer can
  prove which access state a write was accepted under

The signed document sync path appends audit entries for newly accepted live
updates and writes checkpoint rows for accepted baseline updates. Signed blob
attachment bind, same-slot replace, and detach paths append attachment audit
events and ensure `blob_audit_objects` coverage for referenced live blobs.

The audit layer is tamper-evident through server-persisted hash chains, not
client-side write signatures. The fingerprint-based user auth model and the
CRDT peer seed do not provide an authenticated device identity, so per-user
write signatures are not used; any future client signatures would be per-device.

## Live Write-Path Wiring

The live write-path wiring:

- calls `appendDocumentUpdateAuditEntries(...)` from the signed
 `/documents/:documentId/sync` transaction for newly accepted updates
- calls `maybeWriteDocumentAuditCheckpoint(...)` for accepted updates marked
 `fresh_baseline` or `rotate_baseline`
- calls `appendDocumentAttachmentAuditEntries(...)` from signed blob
 bind/replace/detach transactions before live blob pruning can remove
 metadata needed for `blob_audit_objects`
- preserves audit idempotency for retried document sync updates by appending
 audit rows only for updates newly accepted into `document_updates`
- has route/service coverage proving normal writes populate the audit tables,
 not only direct audit-helper tests

## Audit Storage

### Content And Live-State Boundary

The content and live-state tables keep distinct roles:

- `document_updates` retains encrypted Loro updates and serves sync
- `document_update_spans` is the causal-sync index
- `attachment_bindings` is the live projection of active attachment slots
- `access_manifest_heads` and key-target tables are the canonical
 access-plane rows
- `blobs` is the live blob-byte store and is pruned when the final active
 binding disappears

The audit tables do not duplicate ciphertext. They preserve independently
verifiable hashes and visible metadata for the retained document updates and
for live-only objects such as blob bindings.

### History-Side Schema

The audit layer has five history-side tables.

#### `document_audit_entries`

One append-only ledger row per accepted document write event.

Columns:

- `id UUID PRIMARY KEY`
- `document_id UUID NOT NULL`
- `sequence BIGINT GENERATED ALWAYS AS IDENTITY`
- `event_type TEXT NOT NULL`
- `access_epoch INTEGER NOT NULL`
- `access_manifest_hash TEXT NOT NULL`
- `access_state_hash TEXT`
- `actor_user_id UUID NOT NULL`
- `actor_fingerprint TEXT NOT NULL`
- `prev_entry_hash TEXT`
- `entry_hash TEXT NOT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

Required indexes and constraints:

- unique `(document_id, sequence)`
- unique `(document_id, entry_hash)`
- index on `(document_id, created_at)`

This table is the canonical per-document audit chain. Hash verification walks
`prev_entry_hash -> entry_hash` in sequence order.

#### `document_update_audit_events`

Typed payload for `document_audit_entries.event_type = 'loro_update'`.

Columns:

- `audit_entry_id UUID PRIMARY KEY REFERENCES document_audit_entries(id)`
- `live_update_id UUID NOT NULL`
- `partial_start_version_vector TEXT NOT NULL`
- `partial_end_version_vector TEXT NOT NULL`
- `source_version_vector TEXT`
- `encrypted_update_sha256 TEXT NOT NULL`
- `encrypted_update_byte_length INTEGER NOT NULL`

Required indexes and constraints:

- unique `(live_update_id)`

`document_updates` remains the retained ciphertext store. The audit side records
immutable hashes and visible metadata, not a second full ciphertext copy.

#### `document_audit_checkpoints`

Explicit baseline/checkpoint records that commit to the audit history they
cover.

Columns:

- `id UUID PRIMARY KEY`
- `document_id UUID NOT NULL`
- `sequence BIGINT GENERATED ALWAYS AS IDENTITY`
- `baseline_update_id UUID NOT NULL`
- `checkpoint_kind TEXT NOT NULL`
- `source_version_vector TEXT NOT NULL`
- `covered_audit_entry_hash TEXT`
- `previous_checkpoint_hash TEXT`
- `checkpoint_hash TEXT NOT NULL`
- `access_epoch INTEGER NOT NULL`
- `access_manifest_hash TEXT NOT NULL`
- `access_state_hash TEXT`
- `actor_user_id UUID NOT NULL`
- `actor_fingerprint TEXT NOT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

Required indexes and constraints:

- unique `(baseline_update_id)`
- unique `(document_id, checkpoint_hash)`
- index `(document_id, sequence)`
- index on `(document_id, created_at)`

These rows are not the live baseline payload. They are durable checkpoint
metadata that says which audit head a baseline claims to cover.

The write contract has explicit baseline markers on outgoing
updates: `checkpointKind: "fresh_baseline" | "rotate_baseline"` plus
`sourceVersionVector`. Checkpoint rows should only be written for updates with
that explicit marker.

The signed sync route has the authenticated `userId` and session
fingerprint available at the service boundary, so live wiring records both
`actorUserId` and `actorFingerprint`.

#### `blob_audit_objects`

Immutable blob metadata plus retention state for any blob that appears in audit
history.

Columns:

- `blob_id UUID PRIMARY KEY`
- `sha256 TEXT NOT NULL`
- `byte_length INTEGER NOT NULL`
- `live_storage_key TEXT`
- `retention_mode TEXT NOT NULL`
- `historical_bytes_retained BOOLEAN NOT NULL`
- `pruned_at TIMESTAMP`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

The initial value should be:

- `retention_mode = 'live_only'`
- `historical_bytes_retained = false`

That makes the first retention policy explicit: the audit layer keeps durable
metadata and event history for old blobs, but not durable old blob bytes.

#### `document_attachment_audit_events`

Typed payload for attachment-related `document_audit_entries`.

Columns:

- `audit_entry_id UUID PRIMARY KEY REFERENCES document_audit_entries(id)`
- `action TEXT NOT NULL`
- `slot_id TEXT NOT NULL`
- `binding_id UUID`
- `previous_binding_id UUID`
- `blob_id UUID`
- `previous_blob_id UUID`
- `retention_mode TEXT NOT NULL`

This table captures the immutable attachment event stream:

- attach
- replace / same-slot rebind
- detach
- blob rewrap

`attachment_bindings` stays the active-state projection. This table is the
durable history.

### Wrapped-Key Material

The audit layer has no history-side wrapped-key or key-target tables. Signed
access manifest heads and key-target tables are live-only. Audit records instead
snapshot `accessEpoch`, `accessManifestHash`, and `accessStateHash`, which prove
the access state a write was accepted under without retaining old wrapped keys.

### Verification Model

The verifier checks history with:

- append-only `document_audit_entries`
- deterministic `entry_hash` over canonical event payload plus
 `prev_entry_hash`
- append-only `document_audit_checkpoints`
- deterministic `checkpoint_hash` over canonical checkpoint payload plus
 `previous_checkpoint_hash`

This is enough for tamper evidence without a client signature protocol. Any
future client signatures would be per-device: per-user signatures would collapse
multiple concurrently-authoring devices into one signer and do not match how
CRDT authorship behaves.

### Historical Replay Scope

The audit layer does **not** promise:

- fresh-client replay of all historical document updates from scratch
- historical blob download after a blob has been pruned from the live `blobs`
 table
- historical wrapped-DEK or key-target retention for old epochs

The audit layer promises:

- durable history of accepted document writes
- durable history of attachment/blob events
- verifiable checkpoint records that commit to the history they cover
- durable proof of historical blob metadata even after live blob pruning

That keeps the audit layer focused on verifiable history and storage
boundaries rather than turning it into a full historical replay product.

### Write-Path Boundaries

The audit tables are populated inside the same transactions as the live writes.

#### `POST /documents/:documentId/sync`

When new active-epoch updates are accepted, the transaction:

- writes `document_updates` and `document_update_spans`
- writes one `document_audit_entries` row and one `document_update_audit_events`
 row for each newly accepted update
- writes one `document_audit_checkpoints` row when the update is marked as a
 baseline

Audit-update rows are keyed to `live_update_id`, so retried sync stays
idempotent.

#### blob attachment bind/detach

When structural attachment changes are accepted through
`POST /blobs/:blobId/attachment-bindings` or
`POST /blobs/:blobId/attachment-bindings/:bindingId/detach`, the transaction:

- mutates `attachment_bindings`, blob content-key rows, and live blobs
- writes, before live pruning can delete rows needed for audit metadata:
 - `blob_audit_objects` rows for newly referenced blobs
 - one `document_audit_entries` row plus one
 `document_attachment_audit_events` row per committed attach / replace /
 detach / rewrap event

Live GC never deletes from history-side tables.
