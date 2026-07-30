# Loro E2EE Sync Protocol

## Summary

This document defines the Loro-native E2EE sync protocol boundary.

For shared protocol terminology, see [glossary.md](./glossary.md).

Core rules:

- Raw Loro sync should cover encrypted CRDT document state.
- Blob attach and detach should **not** exist only inside encrypted Loro diffs.
- Attachment metadata must remain server-indexable so we can support staging,
 permission changes, orphan cleanup, and branch-aware reachability.

In other words, document sync is not a single protocol surface. It has three
adjacent planes:

1. document plane: encrypted Loro updates
2. attachment plane: blob stage plus atomic attachment-binding metadata
3. access plane: permissions, key-target envelopes, and key epochs

For the client-side order that drains container structure, document creation,
blob attachment work, and Loro update sync, see
[client-sync-ordering.md](./client-sync-ordering.md).

The server must remain plaintext-blind for document content.

## Protocol Shape

The document plane uses signed Keying mutation routes.

Document write routes:

- `POST /documents`
 - creates a document link-set manifest and initial content-key bundle
 - request shape: `DocumentCreateRequest`
 - key fields: signed `event`, event `body`, `expectedManifestHash`,
 `manifest`, optional `previousManifest`, optional `targetContainerPath`,
 optional `authorizingContainerPaths`, optional signed `containerRekeys[]`,
 and required `contentKeyBundle`
 - response shape: `DocumentCreateResponse`
- `POST /documents/:documentId/link`
- `POST /documents/:documentId/unlink`
 - advances the signed document link-set manifest
 - request shape: `DocumentLinkSetMutationRequest`
 - key fields: signed `event`, event `body`, `expectedManifestHash`,
 `manifest`, required `previousManifest`, `targetContainerPath`,
 `authorizingContainerPaths`, optional signed `containerRekeys[]`, and
 required `contentKeyBundle`
 - response shape: `DocumentLinkSetMutationResponse`
- `POST /documents/:documentId/sync`
 - syncs encrypted Loro updates against the current signed link-set manifest
 and current derived KEK targets
 - request shape: `DocumentSyncRequest`
 - key fields: optional `contentKeyBundle`, optional signed
 `containerRekeys[]`, `contentKeyEpoch`, `expectedLinkSetManifestHash`,
 `expectedTargetHash`, optional `authorizingContainerPathRefs`,
 `localVersionVector`, optional `minLsn`, and `outgoingUpdates[]`
 - each authorizing path contains `{containerId, manifestHash}` references; the
 server resolves the signed container manifests it already stores, while
 `expectedLinkSetManifestHash` pins the document head without echoing its bundle
 - each outgoing update includes `id`, encrypted `encryptedData`, visible
 `partialStartVersionVector`, visible `partialEndVersionVector`, required
 `plaintextHash`, optional `sourceVersionVector`, optional `checkpointKind`,
 and a signed `writeHeader`; the header's authenticated metadata hash commits
 the domain-separated plaintext hash
 - response shape: `DocumentSyncResponse`
 - response fields: `acceptedOutgoingUpdateIds[]`, `commitLsn | null`,
 `contentKeyBundle`, `contentKeyBundles[]`, `documentId`,
 `documentKekTargets`, and encrypted `updates[]`
 - `contentKeyBundles[]` covers every served update's signed content-key epoch
 - each returned update includes its stored `accessEpoch`, visible causal
 metadata, `plaintextHash`, and signed `writeHeader`, which names that
 content-key epoch; readers verify the signed metadata commitment, decrypt,
 and reject a plaintext-hash mismatch before importing the Loro update

Attachment write routes:

- multipart stage routes
 - `POST /blobs/stages/multipart`
 - `GET /blobs/stages/multipart/:stageId`
 - `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`
 - `POST /blobs/stages/multipart/:stageId/complete`
 - store and complete large temporary encrypted blob uploads before a bind
   promotes the stage
- `POST /blobs/:blobId/attachment-bindings`
 - binds or same-slot replaces a blob attachment through signed
 `attachment.bind`
 - request shape: `BlobAttachmentBindRequest`
 - key fields: signed event/body, verified document manifest,
 `authorizingContainerPaths`, optional signed `containerRekeys[]`, blob
 `contentKeyBundle`, and optional staged blob plus signed blob `writeHeader`
- `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`
 - detaches a blob attachment through signed `attachment.detach`
 - request shape: `BlobAttachmentDetachRequest`

Access write routes are the signed `/containers` mutation family:

- `POST /containers`
- `POST /containers/with-metadata-document`
- `POST /containers/:containerId/share`
- `POST /containers/:containerId/revoke`
- `POST /containers/:containerId/rekey`
- `POST /containers/:containerId/move`

For the full HTTP surface, see
[api-architecture.md](./api-architecture.md#http-protocol-surface).
For the cross-package handshake, proof, blob stage, attach, and slot contract,
see [protocol-specification.md](./protocol-specification.md).

The server does not decrypt document content. It filters updates using the
visible partial version-vector metadata supplied with each encrypted update.
`document_update_spans` is the server-side causal indexing primitive: it stores
one row per document/update
peer span with start and end counters, plus indexes for
`(document_id, peer_id, end_counter)` and unique update/peer lookups. The
composite index also covers document-only lookups. Append paths write the
encrypted update row and visible span rows in the same transaction, and the
sync route asks Postgres for only the updates whose causal span is not yet
covered by the client's frontier instead of loading full document history into
application memory. Sync responses include a `commitLsn`: accepted
current-epoch writes return the append LSN, and read-only syncs return the
current WAL LSN observed after the missing-update read. Sync requests may
include `minLsn` as a consistency hook for
replica-safe read-after-write behavior.

The sync response no longer tells the client to `rewrap` or `rotate` through a
dedicated action field. Clients derive that decision from the signed link-set
manifest, current KEK targets, target hash, content-key epoch, and locally
retained DEK material. Additive target changes can reuse the same content key
when the submitted bundle matches the current derived target hash. Shrinks
require a new content-key epoch and a baseline encrypted under fresh key
material.

Behavior:

- each encrypted Loro update carries:
 - an inline `accessEpoch`
 - AES-GCM ciphertext encrypted with the current document DEK
 - a fresh per-record AES-GCM IV committed by the encrypted bytes and signed
   write-header ciphertext hash
- sync responses expose stored `accessEpoch` per update; clients reject values
 newer than the current signed manifest epoch, and no derived epoch summary is
 sent
- clients read each required content-key epoch from the signed `writeHeader`,
 require one consistent response bundle for it, and decrypt with that key;
 cold and multi-epoch sync fail closed on missing or conflicting bundles
- accepted current-epoch sync writes return a `commitLsn`, and the server
 materializes per-peer `document_update_spans` from each update's visible
 partial version-vector metadata in the same transaction as the encrypted
 `document_updates` row
- the current document content-key bundle is materialized in
 `document_content_key_targets` rows with required wrapped-key material
- blob content-key bundles are materialized in `blob_content_key_targets`
 rows, and container KEK sharing is materialized in `container_key_wraps`
- `POST /auth/register` and signed `/containers` mutations seed initial
 metadata document bundles atomically
- committed blob encrypted records carry the encrypted payload and its metadata
 only; blob content-key bundles are stored in `blob_content_key_epochs` and
 `blob_content_key_targets`
- committed attachments update blob content-key targets for additive access
 growth or same-epoch rewraps, and `GET /blobs/:blobId` plus
 `GET /blobs/:blobId/bytes` return committed encrypted bytes or byte streams
 plus digest metadata without creating a new blob row
- access-sensitive create and structural mutation routes are signed routes:
 - `POST /documents`
 - `POST /documents/:documentId/link`
 - `POST /documents/:documentId/unlink`
 - signed `/containers` mutations
- those routes verify signed manifests and current derived targets before
 accepting key material or writes
- the Explorer app drives signed container mutations through the
 container/document workflow for
 container writes and uses `link` + `unlink` to move a note between containers
 without creating a new document object; it also exposes direct note
 link/detach controls in note detail and can locally switch which linked
 container is treated as the active note projection
- additive document epoch changes reuse the current document DEK by
 materializing a current-epoch key-target bundle; documents preserve pending
 Loro updates and retry them under the new epoch instead of replacing them
 with a full baseline
- note attachment rewrap-only work commits blob key-target updates
 without sending an unrelated Loro baseline
- note clients with pending local attachment drafts for an existing remote
 document may first issue a no-outgoing document sync probe, so completed
 target changes are visible before the signed blob attachment bind/detach
 mutation

Limitations:

- document/blob bundle material consumes cached principal policy bundles
 and can target current group/org keys, but managed grants require current
 signed policy state to remain usable; missing policy state fails closed
 instead of degrading to expanded user recipients
- container/document discovery and Loro create/sync responses expose
 `referencedPrincipals[]` summaries so clients can discover and cache the
 current signed group/org policy states that back those principal recipients
- the Explorer app renders linked document projections beneath each
 linked container, exposes document link/unlink management, and can switch
 which linked container is locally active
- subtractive rotation for document epochs uses the fresh-baseline path with
 source-frontier checkpoint metadata; durable audit rows are written on live
 sync and attachment writes, while audit export surfaces remain separate
- encrypted Loro updates do not expose `referencedSlotIds[]`; attachment slot
 reachability is validated through signed binding metadata rather than through
 the encrypted Loro payload

For the access-plane model, see
[access-plane.md](./access-plane.md).

## Why This Boundary Matters

The protocol uses a Loro-native causal sync contract instead of a
sequence-oriented update fetch. That is the right direction for document state,
but it does not fully answer attachment lifecycle questions.

If attach and detach exist only inside encrypted Loro diffs, the server cannot
reliably:

- validate staged upload commits
- reject stale attach after a permission change
- maintain attachment indexes
- identify orphaned blobs
- reason about branch or snapshot reachability

That means attachment state cannot be only "whatever is implied by decrypted
Loro content on the client." Some attachment metadata has to be visible.

## Reference Model

### 1. Document Plane

Use a Loro-native sync handshake for application document state.

This plane owns:

- document identity
- client causal state summary
- encrypted Loro updates
- visible sync metadata needed to route and filter updates

Inside the encrypted Loro state, document kind is explicit structured state,
not something inferred from serialized text. Notes store their body in the
Loro `text` container. Structured document types store kind and schema metadata
in a metadata map and typed scalar fields in first-class Loro maps, so
independent field edits are normal CRDT map operations. Local SQLite projection
columns such as `document_kind` and `title` are summary caches derived from
decrypted Loro state; JSON-looking note text must remain note text and must not
drive document kind selection.

The server should not need plaintext CRDT state. It may, however, need visible
metadata such as:

- `documentId`
- `updateId`
- `authorFingerprint`
- `clientId`
- visible causal summary or frontier metadata
- `keyEpoch`
- `createdAt`

The database `sequence` may still exist internally as a storage-order
implementation detail, but it should stop being the primary client-visible sync
contract.

### 2. Attachment Plane

Attachment lifecycle is a separate, explicit metadata protocol.

This plane owns:

- blob staging
- attachment bind / replace
- attachment detach
- attachment-to-document indexing
- any server-visible attachment binding identity required for commit and GC

The Loro document may still reference attachment IDs for editor semantics, but
the authoritative attachment state should not live only inside encrypted Loro
updates.

Objects:

- `blobs`
 - committed encrypted blob metadata rows backed by an object-store storage key
- `blob_stages`
 - temporary multipart uploads owned by one actor and expiring automatically;
 stages store object-store upload metadata until completion
- `attachment_bindings`
 - server-visible bindings from document slots to blob objects; detached
 bindings are transient replacement metadata and are pruned with unreachable
 blobs

For the attachment/blob retention decision, see
[attachment-retention.md](./attachment-retention.md). Historical attachment
bytes, signed tombstones, and attachment manifests are audit/history
concepts, not part of the live attachment binding contract.

For the access-plane model, the important semantic is:

- blobs are first-class encrypted objects
- blobs may be attached to multiple documents
- a blob's effective recipients are derived from the union of the principals of
 the documents that currently reference it

So attach and detach are not only indexing operations. They are also
security-relevant graph mutations that may require blob content-key epoch
changes and wrapped-key bundle changes for the blob object.

Logical operations:

- `POST /blobs/stages/multipart`
- `GET /blobs/stages/multipart/:stageId`
- `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`
- `POST /blobs/stages/multipart/:stageId/complete`
- `POST /blobs/:blobId/attachment-bindings`
- `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`

Implementation objects:

- `blobs`
 - committed encrypted blob rows and object-store keys
- `blob_stages`
 - temporary multipart upload metadata keyed by `stageId`, including the
 object-store key, upload id, expected digest and length, and completion state
- `attachment_bindings`
 - document-visible attachment state keyed by opaque `slotId`
 - `detached_at IS NULL` means the binding is currently active
 - detached rows are transient and may be pruned when blob GC removes the
 now-unreachable blob they referenced

This means blob reachability is derived from active attachment bindings.

### 3. Access Plane

Permissions and key distribution are adjacent to both document and attachment
sync, but should remain conceptually separate.

This plane owns:

- recipient membership
- visible permission checkpoints
- `accessEpoch`
- wrapped content keys / key-target envelopes

Limitation:

Permission revocation is not retroactive. If a client has already received the
relevant DEK or plaintext, removing that client from a group does not make them
forget it. Revocation controls subsequent access unless old ciphertext is
re-encrypted.

## Attachment Semantics

The contract separates encrypted document sync from server-visible signed
attachment binding mutations:

1. initiate, upload, and complete `POST /blobs/stages/multipart` using the
 binary part endpoint
2. `POST /blobs/:blobId/attachment-bindings`
3. `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`
4. `POST /documents/:documentId/sync` for the encrypted Loro update that
 makes the attachment visible in document content

For an existing remote document, clients may probe
`POST /documents/:documentId/sync` with no outgoing updates before
committing a pending local attachment draft. That probe refreshes the current
signed document manifest, content-key bundle, and target state before the
attachment mutation.

Attachment listing returns the blob content-key bundle for each active
binding. Blob reads return only encrypted bytes and digest metadata, so clients
use the listing or bind response bundle plus verified document/container access
material to unwrap the blob content key.

The blob binding route validates:

- signed `attachment.bind` event and body
- expected blob id, document id, slot id, and previous binding id
- current document manifest hash
- authorizing container paths and referenced principal policy state
- optional signed container rekeys
- staged blob ownership/expiry when a staged blob is supplied
- staged encrypted blob bytes carry a fresh per-record AES-GCM IV committed by
 the staged object hash and signed blob write header
- blob content-key bundle against current derived blob KEK targets
- signed staged blob write header when bytes are promoted

Blob staged bytes and document updates use the content-record encryption suite
`aes-256-gcm-hkdf-sha256-record-key`. Document content-key targets use
`tearleads.document.content-key-wrap.aes-256-gcm-container-kek`, and blob
content-key targets use
`tearleads.blob.content-key-wrap.aes-256-gcm-container-kek`; those wrap suites
are direct AES-GCM under a verified container KEK and are separate from the
HKDF content-record suite.

The blob detach route validates:

- signed `attachment.detach` event and body
- expected blob id, document id, slot id, and binding id
- current document manifest hash
- authorizing container paths and referenced principal policy state
- optional signed container rekeys

If a attachment mutation succeeds:

- staged blobs are promoted to committed blob objects when supplied
- requested binding replacements/detaches are persisted
- detached bindings, blob content-key material, and blob bytes are pruned when
 no active binding references the blob after the mutation
- affected blob key targets are recomputed and persisted

Because encrypted Loro updates do not expose `referencedSlotIds[]`, the server
cannot prove that a document update references only active attachment slots.
The authoritative server-visible attachment state is the signed binding
metadata.

### Why `slotId` Instead Of `bindingId`

The API contract intentionally uses opaque stable `slotId` values for Loro
references, not server-generated `bindingId` values.

Reason:

- a new binding id does not exist until the atomic commit lands
- the client can know and reference a stable opaque slot before the server
 generates the replacement binding
- semantic labels such as `front` and `back` remain client-local, while the
 server only sees opaque attachment identities

## Loro And Attachments

The clean split is:

- Loro sync transports encrypted document updates.
- Attachment sync transports visible document-to-blob reference metadata.

The note editor may store attachment IDs inside Loro content, for example to
render inline placeholders or cards, but the server should not need to parse or
index encrypted Loro diffs to answer basic attachment questions.

Human-meaningful attachment semantics such as `front`, `back`, `cover`, or
`inline` do not need to be server-visible by default. The visible field should
be an opaque `slotId`, not a semantic label.

So the answer to "does attach/detach get wired into the Loro protocol?" is:

- not as the only source of truth
- only as a client-visible reference inside note content if useful
- authoritative attach/detach state should live beside Loro, not inside opaque
 encrypted diffs alone

One practical consequence is:

- document access derives from linked containers
- blob access derives from active attachment bindings and linked documents

That makes attach and detach part of the access-derivation graph even though
they remain outside encrypted Loro payloads.

## Server Indexing

Server-side indexing for Loro-native causal sync is defined around
`document_update_spans` plus SQL-side missing-update selection.

Split:

- index Loro update metadata for causal sync
- index attachment metadata for lookup and GC
- do not require server-side plaintext inspection of Loro payloads

For attachments, a derived index table is reasonable and useful. The important
part is that it should be derived from explicit attachment metadata, not from
attempting to mine encrypted Loro diffs after the fact.

## Orphan Blob Detection

Do not use client-maintained refcounts as the source of truth.

Prefer server-authoritative reachability derived from:

- active committed attachment bindings
- staged-but-not-yet-committed uploads
- retained branches or snapshots, if supported

Blob states:

- staged only
 - can expire and be abandoned automatically
- attached
 - live and reachable
- detached but still referenced elsewhere
 - not orphaned
- detached and unreachable from all live metadata roots
 - GC eligible after grace period

If there is no branching yet, treat every object as living on a single
implicit branch, usually `main`.

For branch-aware retention, GC must consider references from all live branches
or snapshots, not just the canonical head.

## Upload / Permission Change Race

Consider a note containing a driver's license with front and back photos.

Possible race:

1. client stages encrypted blob bytes
2. client prepares attachment commit
3. group membership changes before commit reaches the server

The protocol should fail closed:

- attachment commit is checked against current permission state
- attachment commit includes the `accessEpoch` the client thought it was
 targeting
- server rejects commit if that epoch is stale or if the caller no longer has
 write permission

Subsequent writes use a new epoch and new key-target envelopes.

## Read Replica / Consistency Guidance

Consistency policy:

- primary reads for sync-sensitive write-after-read paths are acceptable
- replica-safe behavior uses a consistency token when a read path is served
 from a replica

This applies to both:

- Loro update sync
- attachment metadata commit and lookup

Loro causal metadata does not, by itself, solve database replication lag.
