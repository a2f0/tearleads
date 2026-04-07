# Loro E2EE Sync Protocol Note

Related issue: `#82`

## Summary

This note refines the scope of the Loro-native E2EE sync work.

The main decision is:

- Raw Loro sync should cover encrypted CRDT document state.
- Blob attach and detach should **not** exist only inside encrypted Loro diffs.
- Attachment metadata must remain server-indexable so we can support staging,
  permission changes, orphan cleanup, and future branch-aware reachability.

In other words, note sync is not a single protocol surface. It has three
adjacent planes:

1. document plane: encrypted Loro updates
2. attachment plane: blob stage plus atomic attachment-binding metadata
3. access plane: permissions, recipient envelopes, and key epochs

The server must remain plaintext-blind for document content.

## Current Implementation

The sequence-based client protocol has now been replaced by a single sync
handshake for the document plane.

Current shape:

- `POST /documents`
  - creates a document and initializes access state
- `POST /documents/:documentId/sync`
  - request includes:
    - `accessEpoch`
    - `localVersionVector`
    - `outgoingUpdates[]`
  - each outgoing update includes:
    - client-generated update id
    - encrypted Loro update envelope
    - visible `partialStartVersionVector`
    - visible `partialEndVersionVector`
  - response includes:
    - `currentAccessEpoch`
    - `acceptedOutgoingUpdateIds[]`
    - encrypted updates whose visible causal metadata is not yet covered by the
      client version vector

The server still does not decrypt document content. It filters updates using the
visible partial version-vector metadata supplied with each encrypted update.

Important current limitation:

- each encrypted Loro update currently carries its own recipient envelope with
  a fresh per-update payload key
- the system does not yet materialize a stable per-document DEK bundle in
  `object_recipient_envelopes`
- blob payloads are further along: committed blob envelopes now carry real
  wrapped-key material that the API can persist for blob objects when the blob
  recipient set matches current access
- blob envelopes now use a header-delimited wire format so recipient metadata
  can be read without JSON-parsing the ciphertext body

## Why This Boundary Matters

Issue `#82` is about replacing the current sequence-oriented update fetch with a
Loro-native causal sync contract. That is the right direction for document
state, but it does not fully answer attachment lifecycle questions.

If attach and detach exist only inside encrypted Loro diffs, the server cannot
reliably:

- validate staged upload commits
- reject stale attach after a permission change
- maintain attachment indexes
- identify orphaned blobs
- reason about branch or snapshot reachability

That means attachment state cannot be only "whatever is implied by decrypted
Loro content on the client." Some attachment metadata has to be visible.

## Recommended Model

### 1. Document Plane

Use a Loro-native sync handshake for note document state.

This plane owns:

- document identity
- client causal state summary
- encrypted Loro updates
- visible sync metadata needed to route and filter updates

The server should not need plaintext CRDT state. It may, however, need visible
metadata such as:

- `documentId`
- `updateId`
- `authorFingerprint`
- `clientId`
- visible causal summary or frontier metadata
- `keyEpoch`
- `createdAt`

The current database `sequence` may still exist internally as a storage-order
implementation detail, but it should stop being the primary client-visible sync
contract.

### 2. Attachment Plane

Attachment lifecycle should be a separate, explicit metadata protocol.

This plane owns:

- blob staging
- attachment bind / replace
- attachment detach
- attachment-to-note indexing
- any server-visible attachment binding identity required for commit and GC

The Loro document may still reference attachment IDs for editor semantics, but
the authoritative attachment state should not live only inside encrypted Loro
updates.

Recommended objects:

- `blob_object`
  - immutable encrypted blob bytes in object storage
- `blob_stage`
  - temporary staged upload owned by one actor and expiring automatically
- `note_attachment`
  - logical attachment record keyed to a note
- `attachment_binding`
  - current or historical binding from attachment record to blob object

For the current access-plane direction, the important semantic is:

- blobs are first-class encrypted objects
- blobs may be attached to multiple documents
- a blob's effective recipients are derived from the union of the principals of
  the documents that currently reference it

So attach and detach are not only indexing operations. They are also
security-relevant graph mutations that may require access-epoch bumps and
wrapped-key bundle changes for the blob object.

Recommended logical operations:

- `POST /blobs/stage`
- `POST /documents/:documentId/commit-change`

The current V1 implementation uses:

- `blob_stages`
  - temporary encrypted upload bytes keyed by `stageId`
- `attachment_bindings`
  - document-visible attachment state keyed by opaque `slotId`
  - `detached_at IS NULL` means the binding is currently active

This means blob reachability is derived from active attachment bindings, not
from an older generic doc/blob link table.

### 3. Access Plane

Permissions and key distribution are adjacent to both document and attachment
sync, but should remain conceptually separate.

This plane owns:

- recipient membership
- visible permission checkpoints
- `accessEpoch`
- wrapped content keys / recipient envelopes

Important limitation:

Permission revocation is not retroactive. If a client has already received the
relevant DEK or plaintext, removing that client from a group does not make them
forget it. Revocation can only reliably control future access unless old
ciphertext is re-encrypted.

## Atomic Attachment Semantics

The implemented V1 contract is intentionally atomic at the document-mutation
layer:

1. `POST /blobs/stage`
2. `POST /documents/:documentId/commit-change`

`commit-change` accepts:

- `accessEpoch`
- `attachmentCommits[]`
- `attachmentDetaches[]`
- optional `loroUpdate`

Each attachment commit contains:

- opaque `slotId`
- `stageId`
- `expectedBindingId`

Each attachment detach contains:

- opaque `slotId`
- `expectedBindingId`

The optional `loroUpdate` contains:

- encrypted update envelope
- visible partial version vectors
- `referencedSlotIds[]`

### Server Guarantees

The server must reject `commit-change` if:

- the provided `accessEpoch` is stale
- the caller cannot write the document
- a `stageId` does not exist, expired, or belongs to another user
- a `slotId` is not currently bound to the `expectedBindingId`
- the encrypted Loro update recipient set does not match the current document
  recipient set
- `referencedSlotIds[]` includes a slot without an active binding after the
  requested attachment mutations are applied

If the request succeeds:

- staged blobs are promoted to committed blob objects
- requested binding replacements/detaches are persisted
- the optional Loro update is appended
- affected blob access state is recomputed
- all of the above happen in one transaction

This gives the important invariant:

- an accepted Loro update cannot reference an uncommitted or missing attachment
  slot

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

- Loro sync transports encrypted note document updates.
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

In V1, one practical consequence is:

- document access derives from linked containers
- blob access derives from active attachment bindings and linked documents

That makes attach and detach part of the access-derivation graph even though
they remain outside encrypted Loro payloads.

## Server Indexing

Issue `#82` correctly calls out that we have not yet defined server-side
indexing for Loro-native causal sync.

The recommended split is:

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

If there is no branching in v1, treat every object as living on a single
implicit branch, usually `main`.

If branching is added later, GC must consider references from all live branches
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

Future writes then use a new epoch and new recipient envelopes.

## Read Replica / Consistency Guidance

Near-term policy should remain explicit:

- primary reads for sync-sensitive write-after-read paths are acceptable
- replica-safe behavior can be added later with a consistency token if needed

This applies to both:

- Loro update sync
- attachment metadata commit and lookup

Loro causal metadata does not, by itself, solve database replication lag.

## Proposed Implementation Slices

### Slice 1: document protocol

- define Loro-native visible sync metadata
- define push and pull handshake around causal state
- keep payloads encrypted end-to-end

### Slice 2: attachment protocol

- define stage / commit / detach metadata contracts
- define server-visible attachment index model
- define ownership and expiry semantics for staged blobs

### Slice 3: access and epochs

- define `accessEpoch`
- define recipient envelope updates for notes and attachments
- document non-retroactive revocation limits

### Slice 4: GC and reachability

- define orphan detection rules
- define grace periods
- define whether branches or snapshots are in scope for v1

## Near-Term Scope Recommendation

For the first implementation:

- keep `packages/loro` focused on the document-plane protocol
- keep attachment lifecycle adjacent to, but separate from, the raw Loro sync
  handshake
- do not require server-side indexing of encrypted Loro diffs to manage blobs

That keeps the Loro work in `#82` coherent while leaving room for a larger
note-sync protocol that includes attachments and access epochs.
