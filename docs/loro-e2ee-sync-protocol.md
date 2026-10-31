# Loro E2EE Sync Protocol

## Summary

This document defines the Loro-native E2EE sync protocol boundary.

For shared protocol terminology, see [glossary.md](./glossary.md).

Core rules:

- Raw Loro sync covers encrypted CRDT document state.
- Blob attach and detach do **not** exist only inside encrypted Loro diffs.
- Attachment metadata stays server-indexable so the server can stage uploads,
  enforce permission changes, and collect orphaned blobs.

Document sync is therefore not a single protocol surface. It has three adjacent
planes:

1. document plane: encrypted Loro updates
2. attachment plane: blob stage plus atomic attachment-binding metadata
3. access plane: permissions, key-target envelopes, and key epochs

For the client-side order that drains container structure, document creation,
blob attachment work, and Loro update sync, see
[client-sync-ordering.md](./client-sync-ordering.md).

The server remains plaintext-blind for document content.

## Protocol Shape

The document plane uses signed Keying mutation routes.

Document write routes:

- `POST /documents`
  - creates a document link-set manifest and initial content-key bundle
  - request shape: `DocumentCreateRequest`
  - key fields: signed `event`, event `body`, `expectedManifestHash`,
    `manifest`, optional `targetContainerPathRefs`, optional
    `authorizingContainerPathRefs`, optional signed `containerRekeys[]`, and
    required `contentKeyBundle`; a create has no predecessor manifest
  - response shape: `DocumentCreateResponse`
- `POST /documents/:documentId/link`
- `POST /documents/:documentId/unlink`
  - advances the signed document link-set manifest
  - request shape: `DocumentLinkSetMutationRequest`
  - key fields: signed `event`, event `body`, `expectedManifestHash`,
    `manifest`, `targetContainerPathRefs`, `authorizingContainerPathRefs`,
    optional signed `containerRekeys[]`, and required `contentKeyBundle`; the
    server resolves the previous link-set manifest from its own store
  - response shape: `DocumentLinkSetMutationResponse`
- `POST /documents/:documentId/sync`
  - syncs encrypted Loro updates against the current signed link-set manifest
    and current derived KEK targets
  - request shape: `DocumentSyncRequest`
  - key fields: optional `contentKeyBundle`, optional signed `containerRekeys[]`
    with its `inlineRekeyCommitId`, `contentKeyEpoch`,
    `expectedLinkSetManifestHash`, `expectedTargetHash`, optional
    `authorizingContainerPathRefs`, `localVersionVector`, optional `minLsn`,
    required `supportsPullPagination: true`, optional read-only `pullCursor`
    and `historyMode`, and `outgoingUpdates[]`
  - path references name stored signed container manifests;
    `expectedLinkSetManifestHash` pins the document head
  - each outgoing update includes `id`, encrypted `encryptedData`, visible
    `partialStartVersionVector`, visible `partialEndVersionVector`, required
    `plaintextHash`, optional checkpoint fields, and a signed `writeHeader`; its
    metadata hash commits the opaque, record-key-derived plaintext HMAC
  - response shape: `DocumentSyncResponse`
  - response fields: `acceptedOutgoingUpdateIds[]`, `commitLsn | null`,
    `commitLsnMode`, `contentKeyBundle`, `contentKeyBundles[]`, `documentId`,
    `documentKekTargets`, required `pullPage: {hasMore, nextCursor}`, and
    encrypted `updates[]`
  - `contentKeyBundles[]` holds each older epoch a served update cites, once
  - each returned update includes its stored `accessEpoch`, visible causal
    metadata, `plaintextHash`, and signed `writeHeader`, which names that
    content-key epoch; readers verify the signed metadata commitment, decrypt,
    and reject a plaintext-hash mismatch before importing the Loro update

Attachment write routes:

- multipart stage routes
  - `POST /blobs/stages/multipart`
  - `GET /blobs/stages/multipart/:stageId`
  - `POST /blobs/stages/multipart/:stageId/parts/:partNumber/upload`
  - `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`
    (non-signing stores)
  - store temporary encrypted blob parts; initiation returns the first parts'
    upload sources, and the bind assembles, verifies, and promotes the stage
- `POST /blobs/:blobId/attachment-bindings`
  - binds or same-slot replaces a blob attachment through signed
    `attachment.bind`
  - request shape: `BlobAttachmentBindRequest`
  - key fields: signed event/body, `authorizingContainerPathRefs`, optional
    signed `containerRekeys[]`, blob `contentKeyBundle`, and optional
    `stagedBlob` with its signed blob `writeHeader`; the server resolves the
    document manifest from its own store
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
- `POST /containers/:containerId/recite`

Container mutations cite every manifest the server already stores (previous
head, current and destination paths, KEK manifest history) by
`{containerId, manifestHash}` reference, and every principal policy by its
`{principalType, principalId, version, stateHash}` head; only the manifest
being committed travels in full.

For the full HTTP surface, see
[api-architecture.md](./api-architecture.md#http-protocol-surface).
For the cross-package handshake, proof, blob stage, attach, and slot contract,
see [protocol-specification.md](./protocol-specification.md).

The server does not decrypt document content. It filters updates using the
visible partial version-vector metadata supplied with each encrypted update.
`document_update_spans` is the server-side causal indexing primitive: it stores
one row per document/update peer span with start and end counters, plus indexes
for `(document_id, peer_id, end_counter)` and unique update/peer lookups. The
composite index also covers document-only lookups. Append paths write the
encrypted update row and visible span rows in the same transaction, and the
sync route asks Postgres for only the updates whose causal span is not yet
covered by the client's frontier instead of loading full document history into
application memory. Sync responses include a `commitLsn`: accepted
current-epoch writes return the append LSN, and read-only syncs return the
current WAL LSN observed after the missing-update read. Sync requests may
include `minLsn` as a consistency hook for replica-safe read-after-write
behavior. Every response declares its mode. A remote-primary backend without a
portable WAL position returns `commitLsnMode: "untracked"` and the `0/0` reset
sentinel. Tracked mode retains the normal `commitLsn >= minLsn` requirement.

The sync response carries no rewrap or rotate directive. Clients derive that
decision from the signed link-set manifest, current KEK targets, target hash,
content-key epoch, and locally retained DEK material. Additive target changes
can reuse the same content key when the submitted bundle matches the current
derived target hash. Shrinks require a new content-key epoch and a baseline
encrypted under fresh key material.

Behavior:

- the server stores each encrypted Loro update with:
  - its `accessEpoch`, the epoch of the signed link-set manifest it was
    accepted under
  - AES-GCM ciphertext under a record key derived from the document content key
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
- committed blob records carry only the encrypted payload and its metadata;
  blob content-key bundles are stored in `blob_content_key_epochs` and
  `blob_content_key_targets`, and container KEK sharing in `container_key_wraps`
- `POST /auth/register`, `POST /organizations`, and
  `POST /containers/with-metadata-document` store each metadata document and its
  content-key bundle in the same transaction as its container
- committed attachments update blob content-key targets for additive access
  growth or same-epoch rewraps; `GET /blobs/:blobId/download` returns digest
  metadata and a byte source, and `GET /blobs/:blobId/bytes` streams the
  committed encrypted bytes
- access-sensitive create and structural mutation routes are signed routes:
  - `POST /documents`
  - `POST /documents/:documentId/link`
  - `POST /documents/:documentId/unlink`
  - signed `/containers` mutations
- those routes verify signed manifests and current derived targets before
  accepting key material or writes
- moving a note between containers links the destination and unlinks the
  source on the same document object instead of creating a new document
- additive document epoch changes reuse the current document DEK by
  materializing a current-epoch key-target bundle; documents preserve pending
  Loro updates and retry them under the new epoch instead of replacing them
  with a full baseline
- subtractive rotation for document epochs uses the fresh-baseline path with
  source-frontier checkpoint metadata signed in the write header;
  a baseline's own update row marks it for the coverage-gated redirect
- note attachment rewrap-only work commits blob key-target updates without
  sending an unrelated Loro baseline
- document discovery summaries from `POST /containers/documents/query` expose
  `referencedPrincipals[]` so clients can discover and cache the current signed
  group/org policy states that back those principal recipients

Limitation: document/blob bundle material consumes cached principal policy
bundles and can target current group/org keys, but managed grants require
current signed policy state to remain usable; missing policy state fails closed
instead of degrading to expanded user recipients.

For the access-plane model, see
[access-plane.md](./access-plane.md).

## Why This Boundary Matters

The protocol uses a Loro-native causal sync contract instead of a
sequence-oriented update fetch. That suits document state, but it does not
answer attachment lifecycle questions.

If attach and detach existed only inside encrypted Loro diffs, the server could
not reliably:

- validate staged upload commits
- reject stale attach after a permission change
- maintain attachment indexes
- identify orphaned blobs

Attachment state therefore cannot be only "whatever is implied by decrypted
Loro content on the client." Some attachment metadata is visible.

## Reference Model

### 1. Document Plane

The document plane is a Loro-native sync handshake for application document
state.

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

The server never needs plaintext CRDT state. The visible metadata of an update
is its `id`, `documentId`, `authorFingerprint`, `createdAt`, `accessEpoch`,
partial start and end version vectors, opaque `plaintextHash`, optional
checkpoint fields, and signed `writeHeader`.

The database `sequence` column is an internal storage order behind the opaque
pull cursor; it is not part of the client-visible sync contract.

### 2. Attachment Plane

Attachment lifecycle is a separate, explicit metadata protocol.

This plane owns:

- blob staging
- attachment bind / replace
- attachment detach
- attachment-to-document indexing
- any server-visible attachment binding identity required for commit and GC

The Loro document may reference attachment IDs for editor semantics, but the
authoritative attachment state does not live inside encrypted Loro updates.

Objects:

- `blobs`
  - committed encrypted blob rows and their object-store keys
- `blob_stages`
  - temporary multipart uploads owned by one user and organization, keyed by
    `stageId`, holding the object-store key, upload id, expected digest and
    length, and completion state; stages expire automatically
- `attachment_bindings`
  - document-visible attachment state keyed by opaque `slotId`
  - `detached_at IS NULL` means the binding is currently active
  - detached rows are transient replacement metadata, pruned when blob GC
    removes the now-unreachable blob they referenced

Blob reachability is derived from active attachment bindings.

For the attachment/blob retention decision, see
[attachment-retention.md](./attachment-retention.md). Historical attachment
bytes, signed tombstones, and attachment manifests are not retained or part
of the live attachment binding contract.

For the access-plane model, the important semantic is:

- blobs are first-class encrypted objects
- blobs may be attached to multiple documents
- a blob's effective recipients are derived from the union of the principals of
  the documents that currently reference it

So attach and detach are not only indexing operations. They are also
security-relevant graph mutations that may require blob content-key epoch
changes and wrapped-key bundle changes for the blob object.

### 3. Access Plane

Permissions and key distribution are adjacent to both document and attachment
sync, but remain conceptually separate.

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

1. `POST /blobs/stages/multipart` to initiate a stage, then upload its parts;
   there is no completion request, because the bind completes the stage
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
- blob content-key submission against the new binding's current derived KEK
  targets, preserving other bindings' stored envelopes under the blob lock
- signed staged blob write header when bytes are promoted

Blob staged bytes and document updates use the content-record encryption suite
`aes-256-gcm-hkdf-sha256-record-key`. Document content-key targets use
`tearleads.document.content-key-wrap.aes-256-gcm-container-kek`, and blob
content-key targets use
`tearleads.blob.content-key-wrap.aes-256-gcm-container-kek`; those wrap suites
are direct AES-GCM under a verified container KEK, with AAD binding the object,
content-key epoch and target, and are separate from the HKDF content-record
suite.

The blob detach route validates:

- signed `attachment.detach` event and body
- expected blob id, document id, slot id, and binding id
- current document manifest hash
- authorizing container paths and referenced principal policy state
- optional signed container rekeys

If an attachment mutation succeeds:

- staged blobs are promoted to committed blob objects when supplied
- requested binding replacements/detaches are persisted
- when no active binding references a blob, the mutation stamps
  `dereferencedAt` and starts the garbage-collection grace period
- a bind during the grace period revives the blob; otherwise GC locks and
  rechecks it before pruning the live row, content-key material, write header,
  and detached bindings
- `blob_audit_objects` retains the storage key as durable physical-object
  deletion work until maintenance records a successful deletion
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

The split is:

- Loro sync transports encrypted document updates.
- Attachment sync transports visible document-to-blob reference metadata.

The note editor may store attachment IDs inside Loro content, for example to
render inline placeholders or cards, but the server never parses or indexes
encrypted Loro diffs to answer attachment questions.

Human-meaningful attachment semantics such as `front`, `back`, `cover`, or
`inline` are not server-visible. The visible field is an opaque `slotId`, not a
semantic label.

Authoritative attach/detach state therefore lives beside Loro, not inside
opaque encrypted diffs; note content may carry a slot reference only for the
editor.

One practical consequence is:

- document access derives from linked containers
- blob access derives from active attachment bindings and linked documents

That makes attach and detach part of the access-derivation graph even though
they remain outside encrypted Loro payloads.

## Server Indexing

Server-side indexing for Loro-native causal sync is `document_update_spans`
plus SQL-side missing-update selection. Loro update metadata is indexed for
causal sync and attachment metadata for lookup and GC; neither requires
server-side plaintext inspection. Attachment indexes derive from explicit
attachment metadata, never from mining encrypted Loro diffs.

## Orphan Blob Detection

Clients maintain no reference counts. Reachability is server-authoritative: a
committed blob is live while at least one active attachment binding references
it. Documents have no branches or retained snapshots, so active bindings are the
only reachability roots.

Blob states:

- staged only
  - expires and is cleaned up automatically; only a bind promotes it
- attached
  - live and reachable
- detached but still referenced by another active binding
  - not orphaned
- detached and referenced by no active binding
  - GC eligible after the grace period

## Upload / Permission Change Race

Consider a note containing a driver's license with front and back photos. A
client stages encrypted blob bytes and prepares the attachment commit, and
group membership changes before the commit reaches the server.

The commit fails closed:

- the signed bind body commits to the document manifest hash, and the blob
  content-key bundle to the derived target hash, that the client planned
  against
- the server rejects the commit if either is stale or if the caller no longer
  has write permission

The client then replans against the new manifest and key targets.

## Read-After-Write Consistency

Loro causal metadata does not, by itself, solve database replication lag.
Document sync carries a consistency token: the client sends its last recorded
`commitLsn` as `minLsn`, and the server refuses (`503`) a read whose database
position has not reached it. A remote-primary backend has no replica in the
request path and reports `commitLsnMode: "untracked"`. Attachment metadata
routes carry no consistency token.
