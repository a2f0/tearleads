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

This is similar in spirit to CRDT compaction: compacting history does not break
mergeability if the client still has the local logical state.

### Revoked Offline Clients

If a client lost write access before reconnecting, later writes should be
rejected when it comes back online.

That is not because the edits are unrepresentable. It is because those writes
would be writes from a principal that is no longer authorized.

If desired, revoked offline edits can still be preserved as local drafts
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

That bootstrapping path is outside the live sync and audit boundary described
here.

## Tamper-Evident Document History

Signed policy-state work is about tamper-evident authorization
inputs:

- signed group / organization snapshots
- hash-chained policy-state versions
- signed access manifests that reference those policy states

That is separate from tamper-evident document edit history.

### Audit-Layer Structure

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
- a stable checkpoint model for verification

### Why Not Store Full History Inside The Baseline

Embedding the full edit history inside each new baseline would:

- inflate the live document payload
- duplicate data already better represented as a ledger
- make every rotate baseline progressively larger

For that reason, the better design is:

- compact baseline for live sync
- separate tamper-evident history log

## Implementation Decomposition

The code has clear live-state seams:

- encrypted live document updates live in `document_updates`
- causal sync indexing lives in `document_update_spans`
- live blob reachability lives in `attachment_bindings`
- access-plane material lives in signed access manifest heads and key-target
 tables
- live blob bytes live in `blobs`

Those tables should remain optimized for active sync and access state.
The audit/history work should add separate history-specific persistence instead
of trying to reinterpret live GC tables as durable history.

### Audit Model And Storage Boundary

The storage boundary is:

- explicit split between live-state tables and history tables
- baseline/checkpoint metadata model
- attachment/blob history model
- historical access-material model for old epochs if historical replay needs
 old wrapped keys

The signed document sync path appends audit entries for newly accepted live
updates and writes checkpoint rows for accepted baseline updates. Signed blob
attachment bind, same-slot replace, and detach paths append attachment audit
events and ensure `blob_audit_objects` coverage for referenced live blobs.

### Baseline Checkpoints Commit To History

Persist explicit baseline/checkpoint records that commit to the history they
cover.

Those records should include metadata such as:

- source frontier / version vector
- current access epoch
- previous baseline hash
- last included audit entry hash or history-root hash
- author or device identity for the checkpoint write

### Tamper-Evident Document Update Ledger

Record one immutable audit entry for every accepted document update.

That ledger should be append-only and tamper-evident, for example with:

- per-entry hashes linked to the previous entry
- update metadata copied from the live sync path
- author or device signatures if we decide to require them
- access epoch and visible causal metadata

The important boundary is that `document_updates` stays the live sync store,
while the audit ledger is the durable audit record.

### Attachment And Blob Audit History

Record immutable attachment-history events for:

- attach
- replace / same-slot rebind
- detach
- blob rewrap or epoch transitions if historical blob key access needs them

`attachment_bindings` should remain the live projection of active bindings.
Detached bindings should not become the history mechanism. Historical manifests,
tombstones, and optional retained old blob bytes belong in the audit layer.

### Historical Access Material

If historical replay or historical attachment download is a product
requirement, keep historical wrapped-key material separate from the live
access-plane rows.

That likely means history-specific bundle or envelope storage persists the
material needed to verify or decrypt retained historical objects.

This should not overload the live access-plane tables with mixed live and
historical semantics.

### Audit Read / Verification Surfaces

Only after the write-side model is stable should we add read paths such as:

- audit export or verification APIs
- baseline checkpoint verification
- historical attachment manifest inspection
- optional fresh-client historical replay

Fresh-client historical replay is outside the live write path and should not
block the core write-side audit model.

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

## Audit Storage Design

This section resolves the audit storage boundary.

### Design Decisions

- keep the live-state tables live-only:
 - `document_updates`
 - `document_update_spans`
 - `attachment_bindings`
 - `access_manifest_heads`
 - key-target tables
 - `blobs`
- add separate history-side persistence rather than keeping detached live rows
 forever
- make the audit layer tamper-evident with server-persisted hash chains,
 not new client-side write signatures
- if client signatures are added, they should be per-device, not per-user; the
 auth/session model is fingerprint-based user auth, and the CRDT peer seed is
 not an authenticated device identity
- defer fresh-client historical replay and historical blob download from the
 server
- because historical replay is deferred, do not add historical wrapped-key or
 key-target tables
- instead, snapshot `accessEpoch`, `accessManifestHash`, and
 `accessStateHash` into audit records so the audit layer can prove which
 access state a write was accepted under

### Live-State Boundary

The live tables keep their meanings:

- `document_updates` remains the live sync store for encrypted Loro updates
- `document_update_spans` remains the causal-sync index
- `attachment_bindings` remains the live projection of active attachment slots
- `access_manifest_heads` and key-target tables remain the canonical
 access-plane rows
- `blobs` remains the live blob-byte store and can continue to be pruned when
 the final active binding disappears

No history requirement should be satisfied by changing those live tables into a
mixed live-and-history store.

### History-Side Schema

The audit layer has five history-side tables and keeps one deferred table family
explicitly deferred.

#### `document_audit_entries`

One append-only ledger row per accepted document write event.

Suggested columns:

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

Suggested columns:

- `audit_entry_id UUID PRIMARY KEY REFERENCES document_audit_entries(id)`
- `live_update_id UUID NOT NULL`
- `partial_start_version_vector TEXT NOT NULL`
- `partial_end_version_vector TEXT NOT NULL`
- `source_version_vector TEXT`
- `encrypted_update_sha256 TEXT NOT NULL`
- `encrypted_update_byte_length INTEGER NOT NULL`

Required indexes and constraints:

- unique `(live_update_id)`

This keeps the audit ledger durable even if the live sync store adds compaction
or pruning. `document_updates` remains the live ciphertext store; the audit
side records immutable hashes and visible metadata, not a second full
ciphertext copy.

#### `document_audit_checkpoints`

Explicit baseline/checkpoint records that commit to the audit history they
cover.

Suggested columns:

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

Suggested columns:

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

Suggested columns:

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

### Explicitly Deferred Table Family

The live audit layer does not add history-side wrapped-key tables.

Server-side historical replay or historical blob download should use dedicated
history-side tables such as:

- audit key-target tables

Those deferred tables should be keyed by history objects or audit checkpoints,
not by the live object rows. Signed access manifest heads and key-target tables
should remain live-only.

### Verification Model

The verifier checks history with:

- append-only `document_audit_entries`
- deterministic `entry_hash` over canonical event payload plus
 `prev_entry_hash`
- append-only `document_audit_checkpoints`
- deterministic `checkpoint_hash` over canonical checkpoint payload plus
 `previous_checkpoint_hash`

This is enough for tamper evidence without introducing a new client signature
protocol.

Client signatures, if added, should be per-device. Per-user signatures would
collapse multiple concurrently-authoring devices into one signer and do not
match how CRDT authorship actually behaves.

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

This section describes the live write-path wiring.

#### `POST /documents/:documentId/sync`

When new active-epoch updates are accepted:

- keep writing `document_updates` and `document_update_spans`
- in the same transaction, write one `document_audit_entries` row and one
 `document_update_audit_events` row for each newly accepted update
- if the update is explicitly marked as a baseline, also write one
 `document_audit_checkpoints` row

The sync path should stay idempotent by keying audit-update rows to
`live_update_id`.

#### blob attachment bind/detach

When structural attachment changes are accepted through
`POST /blobs/:blobId/attachment-bindings` or
`POST /blobs/:blobId/attachment-bindings/:bindingId/detach`:

- keep mutating `attachment_bindings`, blob content-key rows, and live blobs
- before live pruning deletes rows needed for audit metadata, write:
 - `blob_audit_objects` rows for newly referenced blobs
 - one `document_audit_entries` row plus one
 `document_attachment_audit_events` row per committed attach / replace /
 detach / rewrap event

Live GC must never delete from history-side tables.

## Open Questions

- Should fresh retained clients be able to rematerialize old epochs directly
 from the server, or is a retained already-synced client sufficient for the
 initial rollout?
- Should rotate baselines carry an explicit compare-and-set frontier in the API
 contract?
- Should document updates be signed by users, devices, or both?
- Should baseline checkpoints be individually signed, or only hash-linked into
 the audit ledger?
- If historical document replay becomes a product requirement, should an
 attachment-history layer retain old blob bytes, signed tombstones/manifests,
 or only live reachability state?
