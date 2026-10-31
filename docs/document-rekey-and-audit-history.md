# Document Rekey, Rebaselines, And Write History

This document defines document rekey, fresh-baseline generation, offline merge
handling, and how accepted document write history is authenticated.

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

This is the additive-access path. It does not require a fresh baseline solely
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
`attachment_bindings`, attachment bind/detach cleanup stamps `dereferencedAt`
and starts a grace period. A bind during that window revives the blob. After
the grace period, GC locks and rechecks reachability before pruning the blob
row, blob content-key epochs, blob content-key target rows, write header, and
detached binding rows. The blob registry (`blob_audit_objects`) retains durable
physical-deletion work.
If another active binding still references the blob, the live rows remain until
the final active binding is deactivated.

Historical attachment bytes are therefore not durable. Detached bindings are
transient replacement metadata, not an attachment history log.

That means document update history and attachment/blob history have different
retention properties.

The attachment/blob retention policy is defined in
[attachment-retention.md](./attachment-retention.md).

### Signed Write Headers Authenticate History

Every retained document update and every attachment blob carries the writer
device's signed write header, and clients verify it on every synced record (see
[Write Integrity](#write-integrity)). Integrity of accepted history therefore
does not rest on server bookkeeping. The server keeps no separate audit ledger:
a nullable `document_updates` column only marks which retained updates are
rotation baselines, and `blob_audit_objects` registers every blob generation an
attachment binding referenced.

## Rekey / Rebaseline Model

### Any Retained Authorized Client Can Win

If access changes force a rotate, any still-authorized client that can read the
prior epoch can:

1. rematerialize document state from the last readable baseline plus accepted
 diffs
2. generate a new document DEK for the new epoch
3. encrypt a fresh baseline under that DEK
4. submit the new current-epoch bundle and baseline

The first valid writer for the new epoch becomes the canonical baseline winner
for that epoch.

### Epoch Bump Happens Before The Winning Baseline

The access change itself should advance the document `accessEpoch`.

The winning rotate baseline does not decide the new epoch number. It populates
content for an epoch that already exists because authorization state changed.

### Baselines Carry Frontier Metadata

Baseline updates can carry the source version vector / causal frontier used to
build the proposed baseline. The writer's signed metadata hash commits to that
frontier, and the update row repeats it so the server can find baselines
without parsing write headers. Readers recompute the metadata hash
from the served frontier, so a frontier altered in storage fails verification.

The server does not turn that source frontier into a compare-and-set gate on
accepted sync updates. A retained client that loses a rotate race adopts the
canonical bundle and re-emits from local CRDT state if needed.

### Declared Coverage Is Trusted, Not Verified

Normal sync can omit older ciphertext when an authenticated replayable baseline
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
- the declaration is durable and attributable: the baseline's signed write
  header commits to its frontier through the metadata hash and names the
  writer device. Signed ciphertext hashes and a record-key-derived HMAC
  attribute each retained update, but that per-update commitment is not
  comparable to a full-history snapshot's commitment. A current-epoch reader
  can compare a baseline's frontier to its claim. Raw read-only sync can
  retrieve retained ciphertext without redirection, but only when the client
  can unwrap every historical epoch key

Any authorized writer may author `rotate_baseline`, keeping lazy healing
independent of an administrator or original creator. A client that distrusts a
baseline can use [raw recovery](./raw-document-history-recovery.md) to
reconstruct from retained ordinary updates without redirection. Inner author
signatures remain the stronger mitigation.

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
exports a full-history Loro snapshot as a checkpoint and deletes only covered
tail rows that sync has settled. The checkpoint still carries the complete
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

## Write Integrity

Signed policy state protects authorization inputs:

- signed group / organization snapshots
- hash-chained policy-state versions
- signed access manifests that reference those policy states

Document content history is protected separately, by a per-device signed write
header on every content record.

### Signed Write Headers

Every accepted document update stores the writer's signed write header in
`document_content_write_headers`; attachment blobs store theirs in
`blob_content_write_headers`. The header commits to:

- the organization, object, content-key epoch, encryption suite, and content
  record id
- the access manifest hash and key-target hash the write was authorized
  under, plus the dependency manifest hashes it cites
- `ciphertextHash` over the encrypted record
- `metadataHash` over the update id, both partial version vectors, the
  record-key-derived plaintext HMAC, and, for a baseline, its checkpoint kind
  and source version vector
- the writer's user id, device id, and signing-key fingerprint, and `signedAt`

The API verifies the header before it accepts an update. Every client verifies
it again on every synced update: it recomputes the ciphertext hash and the
metadata hash from the served record and checks the writer's signature
([`packages/client-sdk/src/data/documents/shared/sync/syncResponses.ts`](../packages/client-sdk/src/data/documents/shared/sync/syncResponses.ts)).
A tampered ciphertext, version vector, plaintext HMAC, or baseline frontier
therefore fails closed on the client, and a tampered baseline cannot redirect a
reader to partial state.

Signatures are per device, matching how CRDT authorship behaves: several
devices of one user author concurrently and each signs with its own key.

### What Signed Headers Do Not Detect

Signed headers authenticate each record. They do not prove that the server
served every record. Tail deletion (the server dropping the newest updates) and
a database restored from backup are not detectable by a fresh device, which has
no earlier view to compare against. A retained device keeps its local history.

Detecting either needs a transparency log whose signed tree heads clients pin.
The server keeps no unsigned per-document hash chain: a chain the server
computes, stores, and never serves is no stronger than the rows it covers, and a
restored backup carries a self-consistent chain.

## Storage Decomposition

The persistence seams are:

- encrypted document updates in `document_updates`
- causal sync indexing in `document_update_spans`
- signed write headers in `document_content_write_headers` and
  `blob_content_write_headers`
- rotation-baseline markers in `document_updates`
- live blob reachability in `attachment_bindings`
- the blob registry in `blob_audit_objects`
- access-plane material in signed access manifest heads and key-target tables
- live blob bytes in `blobs`

The server retains every original encrypted document update in
`document_updates`. Rotation baselines are full-history Loro snapshots, not
flattened state-only snapshots.

### Rotation baselines in `document_updates`

A retained update that carries `checkpointKind` stores its signed
`sourceVersionVector` in the nullable `baseline_source_version_vector` column
of its own `document_updates` row; every other update leaves it null. The
checkpoint and payload kinds are the rotation constants, so they are not
stored. A partial index on `(document_id, sequence)` where the column is set
serves the redirect.

Three readers consume it:

- the coverage-gated baseline redirect (`documentSyncBaselineRedirect.ts`),
  which picks the newest replayable baseline by update sequence
- the sync response (`syncResponseUpdates.ts`), which echoes a served
  baseline's checkpoint metadata
- edit attribution (`documentEditAttribution.ts`), which flags spans a baseline
  first delivered as re-assertions rather than authorship

The redirect and the sync response recompute the signed metadata hash from the
constant kinds, this column, and the update row before they serve a baseline,
so a tampered column fails closed.

The write contract marks baselines explicitly on outgoing updates:
`checkpointKind: "rotate_baseline"`, `checkpointPayloadKind:
"full_history_snapshot"`, and `sourceVersionVector` are present together or
absent together. Only marked updates set the column.

### `blob_audit_objects`

The blob registry: one row per blob generation an attachment binding has
referenced.

Columns:

- `blob_id UUID PRIMARY KEY`
- `organization_id UUID NOT NULL`
- `sha256 TEXT NOT NULL`
- `byte_length INTEGER NOT NULL`
- `live_storage_key TEXT`
- `retention_mode TEXT NOT NULL`
- `historical_bytes_retained BOOLEAN NOT NULL`
- `pruned_at TIMESTAMP`
- `object_delete_attempted_at TIMESTAMP`
- `object_deleted_at TIMESTAMP`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

The only supported values are `retention_mode = 'live_only'` and
`historical_bytes_retained = false`.

The registry keeps blob metadata, not old bytes. After `pruned_at`, the key is
pending work. `object_delete_attempted_at` rotates retries; success clears the
key and records `object_deleted_at`. Blob GC, blob authorization (a registered
id is never promoted again and is concealed from other organizations), and
organization purge read it.

### Wrapped-Key Material

The server keeps no history-side wrapped-key or key-target tables. Each signed
write header names the access manifest hash and key-target hash its write was
authorized under.

### Historical Replay Scope

The server does **not** promise:

- fresh-client replay of all historical document updates from scratch
- historical blob download after a blob has been pruned from the live `blobs`
  table
- historical wrapped-DEK or key-target retention for old epochs
- a history of attachment bind, replace, and detach events; detached bindings
  are transient replacement metadata, and the registry records which blob
  generations existed, not when they were bound

The server promises:

- every accepted document update is retained with its signed write header
- every retained baseline is marked with its signed source frontier
- every blob generation an attachment referenced stays registered to its
  organization after live pruning

### Write-Path Boundaries

Baseline markers and registry rows are written inside the same transactions as
the live writes.

#### `POST /documents/:documentId/sync`

When new active-epoch updates are accepted, the transaction:

- verifies and stores each update's signed write header in
  `document_content_write_headers`
- writes `document_updates` and `document_update_spans`
- sets `baseline_source_version_vector` on each newly inserted update marked
  as a baseline, in the same insert

Only updates the transaction inserts are written, so a retried sync stays
idempotent. An unlink that carries an atomic rotation baseline uses the same
append.

#### blob attachment bind/detach

When structural attachment changes are accepted through
`POST /blobs/:blobId/attachment-bindings` or
`POST /blobs/:blobId/attachment-bindings/:bindingId/detach`, the transaction:

- mutates `attachment_bindings`, blob content-key rows, and live blobs
- registers, before live pruning can delete the rows the registry copies from,
  a `blob_audit_objects` row for each newly referenced blob (the bound blob
  and, on replace, the previous one)

Live GC never deletes registry rows; pruning stamps them and keeps the storage
key as deletion work.
