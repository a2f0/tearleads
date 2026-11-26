# Document Rekey, Rebaselines, And Write History

This document defines document [rekey](./glossary/keys.md#rekey), fresh-baseline
generation, offline merge handling, and how accepted document write history is
authenticated.

For shared protocol terminology, see [glossary.md](./glossary.md).

It is separate from the signed group / organization
[policy-state](./glossary/principals.md#principal-policy-state) design, which
protects who should have access. This document covers how document content and
history behave when [access epochs](./glossary/access.md#access-epoch) change.

## Behavior

### Document Updates Are Epoch-Bound

- each encrypted [Loro update](./glossary/content.md#loro-update) carries one
  `accessEpoch`
- each encrypted Loro update is encrypted with the document
  [DEK](./glossary/keys.md#dek) for that epoch
- a client only decrypts updates that match the epoch + DEK it currently
 resolved

So a client does not replay arbitrary mixed-epoch document history with a
single key. Once a document DEK [rotates](./glossary/keys.md#rotate), subsequent
updates are expected to use the new epoch's DEK.

### Rewrap Reuses The Active DEK

When a target change is additive, the client can keep using the prior
document DEK, materialize a current-epoch
[content-key bundle](./glossary/keys.md#content-key-bundle) for the expanded target
set, and retry any local pending Loro updates under the new epoch.

This
[additive-access path](./keying-design/container-keks.md#additive-versus-subtractive-changes)
does not require a fresh baseline solely because the access epoch changed.

### Rotate Means Fresh Baseline For Later Writes

When access shrinks or otherwise invalidates the prior document DEK for later
writes, the client does not reuse the previous epoch's document DEK. Instead,
a retained client clears stale pending encrypted updates and resends a fresh
baseline under the new DEK.

Distinction:

- old ciphertext remains valid under the old DEK
- later writes move to a new DEK
- the rotate baseline is the bridge from old readable state to new epoch state

### Blob History Is Live-Only

[Blob](./glossary/content.md#blob) GC is based on active attachment
reachability, not historical document replay. If a blob is no longer referenced
by any active `attachment_bindings`, attachment bind/detach cleanup stamps `dereferencedAt`
and starts a grace period. A bind during that window revives the blob. After the
grace period, GC locks and rechecks reachability before pruning the blob row,
blob content-key epochs, blob content-key target rows, write header, and
detached binding rows. The blob registry (`blob_audit_objects`) retains durable
physical-deletion work. If another
[active binding](./glossary/content.md#attachment-binding) still references the
blob, the live rows remain until the final active binding is deactivated.

Historical attachment bytes are therefore not durable. Detached bindings are
transient replacement metadata, not an attachment history log. Document update
history and attachment/blob history thus have different retention properties.

The attachment/blob retention policy is defined in
[attachment-retention.md](./attachment-retention.md).

### Signed Write Headers Authenticate History

Every retained document update and every attachment blob carries the writer
device's [signed write header](./glossary/content.md#signed-write-header), and clients
verify it on every synced record (see [Write Integrity](#write-integrity)).
Integrity of accepted history therefore does not rest on server bookkeeping. The
server keeps no separate audit ledger: nullable `document_updates` columns only
mark which retained updates are segments of
[rotation baselines](./glossary/keys.md#rotation-baseline), and `blob_audit_objects`
registers every blob generation an attachment binding referenced.

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

### A Baseline Is A Group Of Segments

A rotation baseline is an ordered group of ordinary update records, its
segments. Each segment is an `update`-mode Loro blob with its own update id,
envelope, and signed write header, written at the new content-key epoch.
Imported in index order into an empty document, the segments rebuild the
whole history their writer proved. A small history is one segment.

Each segment's signed content-record metadata places it in the group. Every
segment carries `baselineId` and `baselineSegmentIndex`. The final segment
also carries `baselineSegmentCount`, `baselineSegmentsDigest` (a hash chain
over the segments before it), and, optionally, `coversThroughUpdateId`. An
ordinary update carries none of the five. The metadata hash covers them with
the rest of the signed metadata, so they reach the AES-GCM associated data
and the write-header signature. The update row repeats them so the server can
find a group's segments and judge them together. Readers recompute the
metadata hash from the served fields, so a field altered in storage fails
verification. The
[group rules](./document-link-and-sync-protocol.md#rotation-baseline-groups)
define the fields, the digest, what the API admits, and what a reader checks.

What a group covers is not signed. It is derived: for each peer, the highest
end among the segments' signed `partialEndVersionVector`s. A group's spans
run gapless from zero, so that version names every operation the group holds.
The server does not turn that coverage into a compare-and-set gate on
accepted sync updates. A retained client that loses a rotate race adopts the
canonical bundle and re-emits from local CRDT state if needed.

The final segment can also sign its author's processed cursor as
`coversThroughUpdateId`: every update committed at or before it was imported
into the history the baseline carries or void for its author. The rotation
gates and the redirect ask the group to cover only the updates committed
after that cursor, so an update whose op span overclaims does not refuse
every rotation
([advisory op spans](./advisory-op-spans.md#rotations-and-unlinks)). A
baseline whose author voided every update is one empty segment that signs
its cursor.

### Declared Coverage Is Trusted, Not Verified

Normal sync can omit older ciphertext when the latest whole baseline at the
current content-key epoch (`loadLatestStoredDocumentBaselineGroup`) covers
every older update. The server retains every original encrypted document
update; there is no document-payload GC or pruner.

Under [E2EE](./loro-e2ee-sync-protocol.md) the server cannot open a segment,
so it cannot verify that the ciphertext carries the operations its spans
declare. A malicious authorized writer can redirect readers away from older
ciphertext. Because version vectors describe causal shape rather than
content, a rotation-capable writer can also sign a baseline whose segments
declare the same spans but carry fabricated prior plaintext.

The resulting risk has these bounds:

- the attack requires an authorized writer. Current access is
  history-inclusive: a writer added after rotation recovers every retained
  [container KEK](./glossary/keys.md#container-kek) through the
  [sealed keyring](./glossary/keys.md#container-kek-keyring), so any authorized
  writer can read old history and could substitute content while preserving the
  visible version-vector shape
- the declaration is durable and attributable: each segment's signed write
  header commits to its spans and its place in the group through the metadata
  hash and names the writer device. Signed ciphertext hashes and a
  record-key-derived HMAC attribute each retained update, but an ordinary
  update's commitment is not comparable to that of a segment carrying the
  same operations again. A current-epoch reader checks each segment's
  declared span against its payload, as it does for any update. Raw read-only
  sync can retrieve retained ciphertext without redirection, but only when
  the client can unwrap every historical epoch key

Any authorized writer may author a rotation baseline, keeping lazy healing
independent of an administrator or original creator. A client that distrusts a
baseline can use [raw recovery](./raw-document-history-recovery.md) to
reconstruct from retained ordinary updates without redirection. Inner author
signatures remain the stronger mitigation.

A reader can check what it already holds.
[History verification](./developer/client-sdk/document-history.md#verifying-history)
(`documents.verifyHistory`) rebuilds the document from raw history and
compares the rebuild with the device's durable history, operation for
operation. A device that started from a baseline with fabricated plaintext
gets `mismatch` and can show the rebuilt history instead. The check is on
demand and changes nothing on the device. It has these limits:

- it needs the genuine ordinary updates still served, and every historical
  epoch key reachable; otherwise it reports the epoch it could not reach
- operations that only a baseline ever carried stay asserted by its signer.
  Verification marks them `baseline` rather than vouching for them
- a server that withholds updates is
  [not detected](#what-signed-headers-do-not-detect)

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

The correct recovery path is not "replay old encrypted pending patches." It
is:

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
rejected when it comes back online — not because the edits are
unrepresentable, but because they come from a
[principal](./glossary/principals.md#principal) that is no longer authorized.

If desired, revoked offline edits can be preserved as local drafts or forks,
but they should not be accepted as canonical writes after revocation.

## Historical Replay And Fresh-Client Bootstrap

Two kinds of client differ:

- a retained client that already has prior document state and old key material
- a fresh client that has access now but has never downloaded the older epochs

Winning-baseline generation relies on the retained-client case. Fresh-client
bootstrap is the supported recovery path: a pristine client unwraps the
current container KEK from its recipient wrap, opens the sealed keyring for
every retained historical KEK, fetches prior readable epoch bundles, unwraps
their [content keys](./glossary/keys.md#content-key) through those historical KEKs,
and rematerializes current state with no local copy and no other client online.
Reading never depends on that client subsequently writing a baseline, though a
full-history baseline it later writes serves ordinary sync optimization.

## Write Integrity

Signed policy state protects authorization inputs:

- signed group / organization snapshots
- hash-chained policy-state versions
- signed [access manifests](./glossary/access.md#access-manifest) that reference
  those policy states

Document content history is protected separately, by a per-device signed write
header on every content record.

### Signed Write Headers

Every accepted document update stores the writer's signed write header in
`document_content_write_headers`; attachment blobs store theirs in
`blob_content_write_headers`. The header commits to:

- the organization, object, content-key epoch, encryption suite, and content
  record id
- the access manifest hash and [key-target hash](./glossary/keys.md#target-hash)
  the write was authorized under, plus the dependency manifest hashes it cites
- `ciphertextHash` over the encrypted record
- `metadataHash` over the update id, the partial and dependency version
  vectors, the record-key-derived plaintext HMAC, and, for a baseline
  segment, its baseline fields
- the writer's user id, device id, and signing-key fingerprint, and `signedAt`

The API verifies the header before it accepts an update. Every client verifies
it again on every synced update: it recomputes the ciphertext hash and the
metadata hash from the served record and checks the writer's signature
([`packages/client-sdk/src/data/documents/shared/sync/syncResponses.ts`](../packages/client-sdk/src/data/documents/shared/sync/syncResponses.ts)).
A tampered ciphertext, version vector, plaintext HMAC, or baseline field
therefore [fails closed](./glossary/access.md#fail-closed) on the client, and a
tampered baseline cannot redirect a reader to partial state.

Signatures are per device, matching how CRDT authorship behaves: several
devices of one user author concurrently and each signs with its own key.

### Change Times

Every change in the encrypted Loro state records when it was committed. Each
authoring document is created with Loro timestamp recording on
([`changeTimestamps.ts`](../packages/loro/src/changeTimestamps.ts)), so a
change carries the writer's Unix time in seconds, and a writer's consecutive
commits share one change only while they fall within
`DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS` of its timestamp. These times are:

- inside the ciphertext, so the server learns nothing it could not already
  infer from upload times
- part of the operation log, so they survive upload merging, rotation
  baselines, and local checkpoint compaction, and the
  [exact-history comparison](./raw-document-history-recovery.md#client-contract)
  covers them
- self-reported by the writing device, and never earlier than the newest time
  the document already holds, so one device whose clock runs ahead moves every
  later change forward with it

A signed write header's `signedAt` and the update's server `createdAt` are the
independent upper bounds on when a change was made. Each
[attribution range](./api-architecture.md) carries both for the upload that
first delivered it: `createdAt` is the server's own clock, and `signedAt` is
the writer's, authenticated but self-reported like the change time itself. A
reader that shows a change's time can therefore show the lesser of that time
and the `createdAt` of the upload that delivered the change's first operation,
which bounds a clock that ran ahead; a clock that ran behind has no such
bound. A rotation baseline carries the times its writer asserts, under the
same [coverage limitation](#declared-coverage-is-trusted-not-verified) as its
content.

### What Signed Headers Do Not Detect

Signed headers authenticate each record. They do not prove that the server
served every record. Tail deletion (the server dropping the newest updates) and
a database restored from backup are not detectable by a fresh device, which has
no earlier view to compare against. A retained device keeps its local history.

Detecting either needs a
[transparency log](./security-guarantees/boundaries.md#transparency-requires-a-pinned-view-or-witnessing)
whose signed tree heads clients pin. The server keeps no unsigned per-document
hash chain: a chain the server computes, stores, and never serves is no stronger
than the rows it covers, and a restored backup carries a self-consistent chain.

## Storage Decomposition

The persistence seams are:

- encrypted document updates in `document_updates`
- causal sync indexing in `document_update_spans`
- signed write headers in `document_content_write_headers` and
  `blob_content_write_headers`
- rotation-baseline markers in `document_updates`
- live blob reachability in `attachment_bindings`
- the blob registry in `blob_audit_objects`
- [access-plane](./access-plane.md) material in signed access manifest
  [heads](./glossary/sync.md#head) and key-target tables
- live blob bytes in `blobs`

The server retains every original encrypted document update in
`document_updates`. A rotation baseline carries the full operation history
as update segments, not a flattened state-only snapshot.

### Rotation baselines in `document_updates`

A baseline's segments are ordinary `document_updates` rows, with their
`document_update_spans` rows and write headers. One statement inserts them
in index order, so `sequence` rises with the index. Nullable columns hold
each segment's signed
[baseline fields](#a-baseline-is-a-group-of-segments), and an ordinary update
leaves all five null:

- `baseline_id` and `baseline_segment_index`, on every segment
- `baseline_segment_count` and `baseline_segments_digest`, on the final
  segment only
- `baseline_covers_through_update_id`, on a final segment that signs a cursor

No column stores what a group covers: the redirect merges the segments' end
version vectors. A partial index on `(document_id, sequence)` where
`baseline_id` is set lists a document's segments for the redirect. A unique
partial index on `(baseline_id, baseline_segment_index)` keeps two rows from
taking one place in a group, so a new group that reuses a committed group's
`baselineId` is refused as a write conflict.

Three readers consume the columns:

- the coverage-gated baseline redirect
  ([`documentSyncBaselineRedirect.ts`](../packages/api/src/documents/documentSyncBaselineRedirect.ts)),
  which picks the latest whole group at the current content-key epoch
  ([`documentStoredBaselineGroup.ts`](../packages/api/src/documents/documentStoredBaselineGroup.ts))
- the sync response
  ([`syncResponseUpdates.ts`](../packages/api/src/workflows/documents/mutations/syncResponseUpdates.ts)),
  which returns each served segment's baseline fields
- edit attribution
  ([`documentEditAttribution.ts`](../packages/api/src/documents/documentEditAttribution.ts)),
  which flags spans a baseline segment first delivered as re-assertions
  rather than authorship

The redirect and the sync response recompute the signed metadata hash from
these columns and the update row, so a tampered column fails closed: the
redirect skips the group, and a pull that would serve the row fails
([serving](./document-link-and-sync-protocol.md#serving-and-the-redirect)).

The write contract marks segments explicitly on outgoing updates with the
[baseline segment fields](./document-link-and-sync-protocol.md#rotation-baseline-groups).
Only marked updates set the columns.

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
- every retained baseline segment is marked with its signed baseline fields
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
- sets the baseline columns on each newly inserted update marked as a
  baseline segment, in the same insert

Only updates the transaction inserts are written, so a retried sync stays
idempotent. A baseline's segments commit together in that transaction or not
at all. An unlink's rotation baseline uses the same append, and the unlink
is refused unless the append inserted every segment.

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
