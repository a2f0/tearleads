# Protocol Specification

This document specifies messages, proofs, encrypted payload boundaries, and
validation rules across `@symcrypt/client-sdk`, `packages/api`, and shared
`@symcrypt/*` packages for identity, access, document sync, blob staging,
attachment binding, and slots.

The executable contract is layered:

- `packages/validators/src/{request,response,operation}` defines wire grammar
  and HTTP metadata.
- `packages/crypto/src/keying.ts` defines canonical cryptographic checks.
- `packages/api/src/workflows` defines authorized transactional transitions.
- `packages/client-sdk/src/workflows` defines local decisions and fail-closed
  response verification.

For document sync, `DocumentSyncRequestSchema` and `DocumentSyncResponseSchema`
are normative wire grammar and derive TS types; request and response predicates
delegate to them. `documentSyncOperation` owns method, auth, parameters,
statuses, and the canonical path. Parsing never coerces, defaults, strips, or
replaces signed input.

Auth challenge and verification use the same contract path:
`ChallengeRequestSchema`, `VerifyRequestSchema`, and their response schemas are
the runtime wire grammar, while `challengeOperation` and `verifyOperation` own
their HTTP metadata. Legacy predicates remain compatibility wrappers over the
schemas for API client and SDK consumers.

[`openapi.json`](./openapi.json) and checked generated TypeScript are structural
views of the operations migrated into the registry. Zod remains runtime
authority; each `x-symcrypt-runtime-refinements` gap needs an executable
OpenAPI-accepts/Zod-rejects witness. Crypto, transactions, convergence, and
formal guarantees remain separate.

Related documents:

- [glossary.md](./glossary.md)
- [api-architecture.md](./api-architecture.md)
- [access-plane.md](./access-plane.md)
- [client-sync-ordering.md](./client-sync-ordering.md)
- [keying-design.md](./keying-design.md)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)
- [security-guarantees.md](./security-guarantees.md)
- [formal protocol models](../formal/README.md)

## Goals

- Keep document and blob plaintext opaque to the server.
- Make access and key-target state client-verifiable.
- Bind every encrypted content record to a signed write header.
- Bind every structural access mutation to a signed access event and derived
 manifest.
- Keep blob attachment state server-indexable without exposing document
 plaintext.
- Let the app fail closed when required cryptographic policy material is
 missing, stale, or inconsistent.

## Protocol Planes

The protocol has three adjacent planes:

- Document plane: encrypted Loro updates plus visible causal metadata.
- Attachment plane: blob staging plus signed attachment bind/detach metadata.
- Access plane: signed principal policies, access manifests, container KEKs,
 content-key bundles, and write headers.

The planes are separate but not independent. A document sync write needs access
proofs and content-key targets. A blob bind needs a staged encrypted blob,
attachment metadata, access proofs, blob content-key targets, and a blob write
header.

## Common Cryptographic Objects

Signed access events have this logical shape:

```ts
type AccessEvent = {
  version: 1;
  eventId: string;
  eventType:
    | "attachment.bind"
    | "attachment.detach"
    | "container.create"
    | "container.grant"
    | "container.move"
    | "container.rekey"
    | "container.revoke"
    | "document.link"
    | "document.unlink";
  objectKind: "blob" | "container" | "document";
  objectId: string;
  organizationId: string;
  previousManifestHash: string | null;
  dependencyManifestHashes: string[];
  bodyHash: string;
  signerUserId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signedAt: string;
  signature: string;
};
```

Access manifests commit to the derived state for a container, document link
set, or blob target set:

```ts
type ReferencedPrincipalHead = {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
};

type AccessManifest = {
  version: 1;
  objectKind: "blob" | "container" | "document";
  objectId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  structuralHash: string;
  grantRoot: string;
  referencedPrincipalHeads: ReferencedPrincipalHead[];
  keyTargetHash: string;
};
```

Write headers commit encrypted content records to the object, access head, key
epoch, target set, ciphertext hash, metadata hash, nonce domain, and writer
identity:

```ts
type WriteHeader = {
  version: 1;
  organizationId: string;
  objectKind: "blob" | "document";
  objectId: string;
  accessManifestHash: string;
  contentKeyEpoch: number;
  targetHash: string;
  encryptionSuite: "aes-256-gcm-hkdf-sha256-record-key";
  contentRecordId: string;
  nonceDomainHash: string;
  metadataHash: string;
  ciphertextHash: string;
  writerUserId: string;
  writerDeviceId: string;
  writerKeyFingerprint: string;
  signedAt: string;
  signature: string;
};
```

The API treats route JSON as untrusted input until the shared verifiers produce
branded verified values. The app applies the same discipline before persisting
writer projections, accepting response key material, or decrypting content.

## Identity And Session Handshake

Registration is a bootstrap protocol, not only an account create call.
`POST /auth/register` submits:

- `userId`, `organizationId`, and `rootContainerId`
- signing and encapsulation public keys
- the initial reserved `Admins` group policy and direct member envelope
- the initial reserved `Members` group policy, holding the registering user
- the initial signed organization policy state and direct member envelope
- the signed root container create request
- the signed root metadata document create request
- optional initial roster-profile container and profile document create requests

The API validates the user key fingerprints, creates the user, organization,
reserved groups, root container, initial principal policies, root container KEK
state, root metadata document, and optional encrypted roster-profile bootstrap
material in one transaction, then returns a login challenge. The initial
`Admins` policy must project the registering user as the sole admin. The
initial `Members` policy must project the registering user as admin. The
initial organization policy must target the new organization, be version `1`,
use key epoch `1`, be signed by the registering user, project only the
registering user as admin, and carry a version-2 authority descriptor committing
the exact initial heads of both reserved groups.

`organizations.adminGroupId` is the reserved org-admin authority. Reachability
through it grants org-admin behavior. `organizations.memberGroupId` is the
reserved org-membership authority. Reachability through it drives active roster
state; disabled roster rows can remain visible without access. The organization
principal policy remains signed principal state, but it is not the product role
source for org-manager.

Authentication uses challenge signing:

1. `POST /auth/challenge` stores a short-lived challenge for a registered
 signing-key fingerprint.
2. `POST /auth/verify` verifies the signature over the challenge and issues a
 session token.
3. `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`, and
 `POST /auth/logout` manage authenticated session tokens.
4. Authenticated mutation routes require the session user and fingerprint to
 match the signer fields embedded in signed access events or write headers.

The session authenticates the transport caller. Signed access events, signed
principal states, and signed write headers are the protocol proofs that bind
mutations and content records to cryptographic authority.

## Principal Policy Protocol

Groups and organizations are managed by signed principal-state chains. The
generic policy `PUT` accepts organization successors only; standalone group
writes fail closed because they cannot advance the signed group directory.
Organization-group successors use
`PUT /organizations/:organizationId/groups/:groupId/policy-commit`, which
atomically stores the group successor and an organization-policy successor
whose authority descriptor commits the new exact group head.
Group creation uses the same rule: `POST /organizations/:organizationId/groups`
stores the group row, initial group policy, and matching organization-policy
successor in one transaction, or stores none of them.

A state commits the principal identity, version and predecessor, key epoch and
encapsulation key, membership/projection/envelope roots, payload hash, member
count, signer identity, and timestamp. The API verifies those commitments,
signature, chain, and admin-signer rule before atomically storing the state,
payload, projection, and exact envelope set. Initial signers are admins in the
new projection; successor signers are admins in the prior projection or, for
org-scoped updates, independently proven members of the reserved `Admins`
group. Clients verify the complete bundle again before caching or key use.

Public keys and envelope fields use canonical base64 and exact ML-KEM-1024
sizes: 1568-byte public keys/ciphertexts and a 3184-byte wrapped secret plus
AES-GCM tag. Envelopes cover the direct projection one-to-one and bind each
member id, recipient fingerprint, ciphertext, active state, and key epoch.

`memberEnvelopesRoot` is mandatory; a state missing it, required policy
material, or envelope material fails closed.

## Container Access And KEK Protocol

Signed container mutation routes are:

- `POST /containers`
- `POST /containers/with-metadata-document`
- `POST /containers/:containerId/share`
- `POST /containers/:containerId/revoke`
- `POST /containers/:containerId/rekey`
- `POST /containers/:containerId/move`

Most signed mutations use `ContainerMutationRequest`. The container with
metadata document create route wraps a `ContainerMutationRequest` with the
initial metadata `DocumentCreateRequest`.

Each signed mutation request carries:

- signed event and event body
- expected manifest hash and derived manifest state
- optional previous, parent, destination-parent, and history manifest bundles
- referenced principal policy bundles
- a container key epoch
- a required nullable predecessor bridge (`null` for creates and same-epoch
  mutations; populated for every KEK rotation)
- a required nullable sealed keyring (`null` for creates and same-epoch
  mutations; for every rotation, the complete predecessor key history sealed
  under the new KEK, with its hash committed in the signed event body)
- KEK wraps for derived recipient targets
- optional parent KEK state and direct user recipient keys

The API verifies the signed event, derives the manifest, checks predecessor and
path heads, verifies referenced principal policies, derives recipient targets,
and verifies the container KEK state. Container KEK wraps target direct users,
managed principals, or the parent container KEK. A child container can inherit
access through parent KEK edges without rewriting every descendant object when
an ancestor grant changes.

For a rotation, the API also verifies that the bridge connects the stored
current epoch to exactly the proposed next epoch, that the keyring is sealed to
the new epoch with a ciphertext length exactly matching the epoch number
(`8 + (n - 1) * 64 + 16` bytes — over- and under-length both reject), and that
both artifact hashes match the signed event body. Epoch numbers above
`MAX_CONTAINER_KEY_EPOCH` (65536) are rejected at rotation time as a
runaway-rotation backstop. Writer projections are gated by current access and
return the sealed keyring for each path epoch (null exactly at epoch 1).
Consequently current document access includes retained history; projections do
not return superseded recipient envelopes or filter old epochs by requester
membership era. `GET /containers/:containerId/kek-log` serves the append-only
rotation log — every epoch with its write-once bridge and sealed keyring — as
the rebuild/repair read path for any current reader.

Principal rotations and membership mutations rematerialize every retained
group container grant in the same transaction as the new principal state. The
resulting container mutation names the new principal head and wraps the current
container KEK to that head. A user restored onto a fresh client therefore needs
only the current verified principal policy and the current container grant to
recover every still-authorized container; recovery never walks historical
principal keys and does not depend on another user performing a repair action.

Completeness is authenticated by the principal state itself. `grantRoot` is
the digest of the sorted canonical `{containerId, accessLevel}` projection and
`grantCount` binds its cardinality. Policy requests and bundles include the
full projection for every state. During a transition the client plans from the
verified current/next projections, and the API recomputes the required union
from stored verified manifests. The policy state and the exact container batch
commit or roll back together; standalone group-grant changes are accepted only
when they already match the current signed projection.

The API intentionally exposes no historical principal-key envelope endpoint.
Serving a requester's subset of historical envelopes cannot prove inclusion in
the full `memberEnvelopesRoot`, while serving the full set would disclose
membership history. Keeping recovery on current rematerialized grants avoids
both the unverifiable subset and tenure-scoping problems. Removed users cannot
read the replacement wraps; users later re-added receive the current principal
key and recover through the grant's current rematerialization.

Document and blob writes may carry signed `container.rekey` requests inline in
`containerRekeys[]`. The API applies those rekeys inside the same transaction
before resolving document/blob targets. If the enclosing write fails, the rekey
rolls back with it.

`DELETE /containers/:containerId` is an authenticated admin-only structural
operation for empty non-system leaf containers. It is not a signed access-event
mutation and writes sync tombstones for discovery.

## Document Link And Sync Protocol

Documents do not own direct ACLs. A document link-set manifest names the
containers that link to the document. Document create and link-set mutation
routes use signed document access events:

- `POST /documents`
- `POST /documents/:documentId/link`
- `POST /documents/:documentId/unlink`

`DocumentCreateRequest` and `DocumentLinkSetMutationRequest` carry:

- signed `event` and typed `body`
- `expectedManifestHash`
- derived document manifest state
- previous document manifest when applicable
- target and authorizing container path bundles
- optional `containerRekeys[]`
- a document content-key bundle

The API verifies the event, verifies container path heads, loads referenced
principal policies, derives the document link-set manifest, stores the manifest
head, and validates the submitted content-key bundle against derived document
KEK targets.

An unlink rotates the document content key and must carry a `rotationBaseline`
— a signed `rotate_baseline` full-history snapshot whose source version vector
covers the complete committed update frontier — with one exception: a document
with **no committed updates** may be unlinked without a baseline. The server
proves that emptiness inside the mutation transaction under the document
manifest-head write lock (sync writers hold the corresponding shared lock, so
no update can commit between the emptiness proof and the unlink); a baseline-
less unlink against a non-empty committed frontier is rejected as a conflict.
A link must not carry a rotation baseline.

Encrypted Loro sync uses `POST /documents/{documentId}/sync`.
`DocumentSyncRequest` carries:

- `contentKeyEpoch`
- `expectedLinkSetManifestHash`
- `expectedTargetHash`
- optional `contentKeyBundle`
- optional `containerRekeys[]`
- optional `authorizingContainerPathRefs`, containing paths of
  `{containerId, manifestHash}` references that the server resolves from its own
  committed manifest store
- `localVersionVector`
- optional `minLsn`
- `outgoingUpdates[]`

Document sync updates carry encrypted bytes, partial version vectors, and a
signed write header. Checkpoint fields are either all absent or the tuple
`rotate_baseline`, `full_history_snapshot`, and a non-empty source vector.
Writes require path refs; the API requires an active path. Reads may omit refs
and carry no rekeys or bundle.
`expectedLinkSetManifestHash` pins the server-resolved document head instead of
echoing the full manifest.

For accepted writes, the API verifies:

- session user/fingerprint match the write header signer
- the document manifest and authorizing paths are active heads
- the caller has write access through at least one linked container path
- content-key targets match the active document KEK target hash
- the write header matches document id, organization id, manifest hash, target
 hash, content-key epoch, metadata hash, and ciphertext hash
- duplicate update ids are idempotent only when the encrypted content and write
 header match the already accepted update

The sync response returns accepted outgoing ids, a `commitLsn`, an optional
`commitLsnMode`, the active content-key bundle, a required array of any
additional returned epoch bundles, document KEK targets, and encrypted updates
missing from the client-supplied frontier. Tracked checkpoints are durable
backend positions and must satisfy a requested `minLsn`. A client advertises
`supportsUntrackedCommitLsn: true` to accept an untracked backend's `0/0` reset
sentinel; legacy clients instead receive their `minLsn` echoed as a compatibility
token, which is not a durability claim.

### Document Sync Conflict Codes

JSON `409` responses retain `error` for diagnostics and carry a normative code:

| Code | Client action |
| --- | --- |
| `document_sync_state_stale` | Refetch the writer projection and replan. |
| `document_sync_update_id_conflict` | Run pending-update ID recovery. |
| `document_sync_conflict` | Report the terminal conflict without retrying. |

Retry and recovery decisions use status plus `code`, never `error` text. A
missing or unknown code fails closed as a terminal conflict.

## Blob Stage Protocol

Blob bytes are staged before attachment binding:

- `POST /blobs/stages/multipart`
- `GET /blobs/stages/multipart/:stageId`
- `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`
- `POST /blobs/stages/multipart/:stageId/complete`

`InitiateMultipartBlobStageRequest` declares the completed encrypted object's
`byteLength` and `sha256`. Each part is sent as `application/octet-stream` with
its byte length, SHA-256 digest, and upload id in request headers. The API stores
only object-store multipart metadata in `blob_stages`; encrypted payload bytes
are never encoded into JSON or stored in the database. Staged objects are not
readable as committed blobs and are promoted only by a successful attachment
bind. Incomplete or expired stages fail closed during bind.

## Attachment Bind, Replace, Detach, And Slots

Attachment slots are opaque stable identifiers inside a document. Product code
may treat a slot as "front image" or "back image", but the protocol only sees a
`slotId`. There is at most one active binding for a document slot. A same-slot
replacement signs a new `attachment.bind` event whose `expectedBindingId`
matches the active binding being replaced.

Binding uses:

- `POST /blobs/:blobId/attachment-bindings`

`BlobAttachmentBindRequest` carries:

- signed `attachment.bind` event and body
- verified document manifest bundle
- authorizing container paths
- optional `containerRekeys[]`
- blob content-key bundle
- optional `stagedBlob` with `stageId` and signed blob write header

The bind body commits to `bindingId`, `blobId`, `documentId`, `slotId`,
`expectedBindingId`, and `documentManifestHash`. The event uses
`objectKind: "blob"` and dependency manifest hashes for the document and linked
container access heads.

For bind, the API verifies:

- session user/fingerprint match the event signer
- document manifest and authorizing paths are active heads
- referenced principal policies resolve and verify
- expected previous binding matches the active slot binding
- staged blob owner and expiry when `stagedBlob` is supplied
- existing blob presence when no staged blob is supplied
- blob content-key bundle matches derived blob KEK targets
- staged blob write header matches blob id, blob access manifest hash,
 content-key epoch, target hash, `ciphertextHash` matching the staged
 SHA-256, and writer identity

After verification, the API promotes staged bytes when supplied, detaches the
previous active slot binding if present, stores the new binding, persists blob
content-key targets, stores the blob write header, appends attachment audit
events, and touches the document plus linked containers for sync discovery.

Detach uses:

- `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`

`BlobAttachmentDetachRequest` carries the signed `attachment.detach` event and
body, the document manifest bundle, authorizing container paths, and optional
`containerRekeys[]`. The API verifies the active binding, signed event,
document manifest, authorizing paths, and referenced principal policies before
detaching the binding and appending audit rows.

The encrypted Loro document may reference slot ids for rendering, but signed
attachment binding metadata is the server-visible authority for blob access,
attachment listing, replacement, detach, and live blob reachability.

## Blob Read Protocol

Blob reads use:

- `GET /documents/:documentId/attachments`
- `GET /blobs/:blobId`
- `GET /blobs/:blobId/bytes`

Attachment listing requires document read access through a linked container
path and returns active `{ bindingId, blobId, slotId, contentKeyBundle }`
rows. The content-key bundle is loaded from the blob key-package tables, not
from the encrypted blob bytes. Blob reads require read access through at least
one active binding's document. The JSON blob route returns committed encrypted
bytes as a string plus digest metadata. The `/bytes` route streams committed
encrypted bytes as `application/octet-stream` and exposes blob id, byte length,
and SHA-256 digest headers. The app combines the attachment listing's blob
content-key bundle with verified document/container access material to unwrap
the blob content key and decrypt the committed bytes.

## Delete And Purge Semantics

Removal is terminal and structural. Link, unlink, share, revoke, rekey, and
move are signed access-event mutations that rewrite manifests; container delete
and document purge instead remove rows outright and are authenticated
operations rather than signed access events.

`DELETE /documents/:documentId` purges a document and every per-document row it
owns. The API requires that the caller holds write access through the
document's linked container, that the document is linked to exactly one
container — a document still linked to more than one container must be unlinked
down to a single link first — and that the target is not a container metadata
document, which is withheld from purge and torn down only when its container is
deleted. An unknown document id returns not found. Blobs the purge orphans —
referenced only by the purged document once its rows are gone — are
soft-deleted: `dereferencedAt` is stamped while the encrypted bytes, stored
objects, and key material are retained for a later garbage-collection sweep. A
blob still referenced by another document, or by a detached binding, is left
untouched, and re-stamping an already-dereferenced blob preserves its original
timestamp. The response returns `purgedAt`.

`DELETE /containers/:containerId` is an admin-only structural delete for empty,
non-system, non-root leaf containers. A root or system-slot container cannot be
deleted, a container with child containers is a conflict, and a container with
any linked user document is a conflict — but the container's own metadata
document is excluded from that guard, because every container links its
metadata document to itself, so the guard would otherwise make every folder
undeletable. An unknown container id returns not found. A successful delete
runs in one transaction: it writes a per-recipient `deleted` sync tombstone —
the peer discovery signal for the removal — removes the container row, then
tears down the container's own metadata document, deleting the
`containerMetadataDocuments` binding and, when the composite create path
materialized document rows, those rows and any blobs they orphan (dereferenced
at the same deletion timestamp). No purge tombstone is written for the metadata
document, which is withheld from client discovery; the container tombstone is
the sole peer signal. Any guard failure aborts and rolls the whole transaction
back.

Trash is itself a system-slot container and so cannot be deleted or purged.
Sending an item to Trash is an ordinary signed relocation — never a delete — and
stays reversible. A document is relocated by replacing its link set (link Trash,
unlink its source containers); a container is relocated by re-parenting it under
Trash with `container.move`. The move workflow guards only the moved container's
own system slot, not the destination's, so a normal folder and its whole subtree
may be moved into Trash, and moved back out again to restore it. Terminal
removal is the separate, structural step: `DELETE /documents/:documentId` for a
document and `DELETE /containers/:containerId` for a folder — a non-empty folder
is torn down by a client-orchestrated cascade of those two primitives applied
leaf-first.

## Failure Semantics

The protocol is fail-closed:

- malformed route JSON returns validation errors
- stale manifest heads, stale key targets, and stale recipient keys return
 conflicts
- missing signed policy material prevents managed-principal key derivation
- signer/session mismatches return forbidden
- unavailable policy, key, blob, or document material is an availability
 failure, not permission to bypass verification

Projection tables are indexes and caches. They are useful for list and lookup
performance, but they are not authority for encryption targets or access
proofs.
