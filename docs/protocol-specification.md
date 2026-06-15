# Protocol Specification

This document specifies the protocol boundary between `@tearleads/client-sdk`,
`packages/api`, and the shared `@tearleads/*` packages. It describes the
messages, proofs, encrypted payload boundaries, and validation rules used for
identity, access, document sync, blob staging, attachment binding, and
attachment slots.

The executable source of truth is:

- request validators in `packages/validators/src/request`
- response validators in `packages/validators/src/response`
- protocol verifiers in `packages/crypto/src/keying.ts`
- API workflows in `packages/api/src/workflows`
- client request builders and response checks in `packages/client-sdk/src/workflows`

Related background documents:

- [glossary.md](./glossary.md)
- [api-architecture.md](./api-architecture.md)
- [access-plane.md](./access-plane.md)
- [client-sync-ordering.md](./client-sync-ordering.md)
- [keying-design.md](./keying-design.md)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)
- [security-guarantees.md](./security-guarantees.md)

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
- the initial reserved `Members` group policy, with `Admins` nested as a
 member
- the initial signed organization policy state and direct member envelope
- the signed root container create request
- the signed root metadata document create request
- optional initial roster-profile container and profile document create requests

The API validates the user key fingerprints, creates the user, organization,
reserved groups, root container, initial principal policies, root container KEK
state, root metadata document, and optional encrypted roster-profile bootstrap
material in one transaction, then returns a login challenge. The initial
`Admins` policy must project the registering user as the sole admin. The
initial `Members` policy must project the registering user as admin and the
`Admins` group as a member. The initial organization policy must target the new
organization, be version `1`, use key epoch `1`, be signed by the registering
user, and project only the registering user as admin.

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

Groups and organizations are managed principals. Their authority is a signed
principal state chain:

- `PUT /principals/:principalType/:principalId/state`
- `PUT /principals/:principalType/:principalId/member-envelopes`
- `GET /principals/:principalType/:principalId/policy`

A principal state signs the principal id, version, previous state hash, key
epoch, encapsulation key fingerprint, membership/projection roots, encrypted
payload hash, member count, signer id, signer key fingerprint, timestamp, and
signature. The API validates the signature, hash chain, projection root,
payload hash, member count, and admin-signer rule before storage. Initial
states must be signed by an admin in their own initial projection. Successor
states must normally be signed by an admin in the previous projection. For
org-scoped principal policy updates, the API can additionally authorize a
successor signer by proving reachability through the organization's reserved
`Admins` group. The app validates fetched bundles again before caching or
using them for decryption; external org-admin signer authority is only accepted
when the caller supplies that independently verified authority to the verifier.

Direct member envelopes must match the active direct projection exactly:

- one envelope for each direct member
- no envelopes for unknown members
- envelope state hash equals the active principal state hash
- envelope epoch equals the active principal key epoch
- recipient key fingerprints match registered recipient keys

Managed-principal grants fail closed when the referenced signed policy state or
required member envelope material is unavailable.

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
- KEK wraps for derived recipient targets
- optional parent KEK state and direct user recipient keys

The API verifies the signed event, derives the manifest, checks predecessor and
path heads, verifies referenced principal policies, derives recipient targets,
and verifies the container KEK state. Container KEK wraps target direct users,
managed principals, or the parent container KEK. A child container can inherit
access through parent KEK edges without rewriting every descendant object when
an ancestor grant changes.

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

Encrypted Loro sync uses `POST /documents/:documentId/sync`.
`DocumentSyncRequest` carries:

- `contentKeyEpoch`
- `expectedLinkSetManifestHash`
- `expectedTargetHash`
- optional `contentKeyBundle`
- optional `containerRekeys[]`
- optional `documentManifest`
- optional `authorizingContainerPaths`
- `localVersionVector`
- optional `minLsn`
- `outgoingUpdates[]`

Outgoing updates carry encrypted bytes, visible partial start/end version
vectors, optional source version vector, optional checkpoint kind, and a signed
write header. Writes require `documentManifest` and
`authorizingContainerPaths`; read-only sync probes can omit those proofs.

For accepted writes, the API verifies:

- session user/fingerprint match the write header signer
- the document manifest and authorizing paths are active heads
- the caller has write access through at least one linked container path
- content-key targets match the active document KEK target hash
- the write header matches document id, organization id, manifest hash, target
 hash, content-key epoch, metadata hash, and ciphertext hash
- duplicate update ids are idempotent only when the encrypted content and write
 header match the already accepted update

The sync response returns accepted outgoing ids, a `commitLsn`, the active
content-key bundle, optional bundles for returned older epochs, document KEK
targets, missing epoch classes, and encrypted updates missing from the
client-supplied frontier.

## Blob Stage Protocol

Blob bytes are staged before attachment binding:

- `GET /blobs/uploads/capabilities`
- `POST /blobs/stage`
- `POST /blobs/stages/multipart`
- `GET /blobs/stages/multipart/:stageId`
- `PUT /blobs/stages/multipart/:stageId/parts/:partNumber`
- `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes`
- `POST /blobs/stages/multipart/:stageId/complete`

`StageBlobRequest` contains `encryptedBytes`, `byteLength`, and `sha256`. The
encrypted bytes are only the blob payload record; they do not contain the blob
content-key bundle or current target hash. The API recomputes the encoded byte
length and SHA-256 digest, stores the stage under the authenticated user, and
returns `stageId` plus `expiresAt`. Staged bytes are not readable as committed
blobs and are promoted only by a successful attachment bind.

`GET /blobs/uploads/capabilities` lets clients discover whether automatic
multipart uploads are enabled for durable object storage. Multipart staging
uses the same ownership, expiry, byte-length, and SHA-256 rules, but stores
object-store multipart metadata in `blob_stages` until all parts are uploaded
and completed. A completed multipart stage is promoted by the same attachment
bind path as a single-request stage; incomplete multipart stages fail closed
during bind.

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
