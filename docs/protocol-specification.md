# Protocol Specification

This document specifies messages, proofs, encrypted payload boundaries, and
validation rules across `@tearleads/client-sdk`,
[`packages/api`](../packages/api/), and shared `@tearleads/*` packages for
identity, access, document sync, blob staging, attachment binding, and slots.

The executable contract is layered:

- [`packages/validators/src/request`](../packages/validators/src/request/),
  [`packages/validators/src/response`](../packages/validators/src/response/),
  and
  [`packages/validators/src/operation`](../packages/validators/src/operation/)
  define wire grammar and HTTP metadata.
- [`packages/crypto/src/keying.ts`](../packages/crypto/src/keying.ts) defines
  canonical cryptographic checks.
- [`packages/api/src/workflows`](../packages/api/src/workflows/) defines
  authorized transactional transitions.
- [`packages/client-sdk/src/workflows`](../packages/client-sdk/src/workflows/)
  defines local decisions and fail-closed response verification.

For document sync, `DocumentSyncRequestSchema` and `DocumentSyncResponseSchema`
are normative wire grammar and derive TS types; request and response predicates
delegate to them. `documentSyncOperation` owns method, auth, parameters,
statuses, and the canonical path. Parsing never coerces, defaults, strips, or
replaces signed input.

Auth challenge and verification use the same contract path:
`ChallengeRequestSchema`, `VerifyRequestSchema`, and their response schemas are
the runtime wire grammar, while `challengeOperation` and `verifyOperation` own
their HTTP metadata. API client and SDK predicates validate against these
schemas.

[`openapi.json`](./openapi.json) and checked generated TypeScript are structural
views of the operations in the registry. Zod is the runtime authority; each
`x-tearleads-runtime-refinements` gap needs an executable
OpenAPI-accepts/Zod-rejects witness. Crypto, transactions, convergence, and
formal guarantees lie outside these views.

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
    | "container.recite"
    | "container.rekey"
    | "container.revoke"
    | "document.link"
    | "document.purge"
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
  dependencyManifestHashes: string[];
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

The header's `dependencyManifestHashes` is the sorted, unique union of all
manifest hashes in the complete authorizing container paths. Submission must
cite the verified current paths; historical reads rebuild those exact signed
paths and use referenced group membership. The API retains the dependencies
of retained document and blob headers for fresh-device verification.
All signed timestamps use the exact UTC `Date.toISOString()` representation.

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
- signed create requests for the root container, its metadata document, and the
  organization metadata container
- optional create requests for the organization profile document, the
  roster-profile container and document, and initial system containers

The API validates the user key fingerprints, creates the user, organization,
reserved groups, initial principal policies, and every requested container, KEK
state, and metadata or profile document in one transaction, then returns a login
challenge. The initial `Admins` policy must project the registering user as the
sole admin. The initial `Members` policy must project the registering user as
admin. The initial organization policy must target the new organization, be
version `1`, use key epoch `1`, be signed by the registering user, project only
the registering user as admin, and carry a version-2 authority descriptor
committing the exact initial heads of both reserved groups.

The response returns each created container and document head, each
acknowledged by hash as described under container mutation conflicts below. The
client checks every one against the request it signed before pinning it as a
local verification checkpoint. The acknowledged heads of the roster and organization
profile documents also seed discovery evidence, and the founding policy heads
seed verified recovery progress, so the device fetches neither those documents'
writer projections nor the founding groups' history. Creating an additional
organization follows the same rule.

`organizations.adminGroupId` is the reserved org-admin authority. Reachability
through it grants org-admin behavior. `organizations.memberGroupId` is the
reserved org-membership authority. Reachability through it drives active roster
state; disabled roster rows can remain visible without access. The organization
principal policy remains signed principal state, but it is not the product role
source for org-manager.

Organization read-model and data-usage denials use
`organization_presentation_access_denied` on both the existing `403` access
denial and `404` missing-organization responses. The code gives clients exact
authority to hide and purge that requester's local presentation projection
without matching diagnostic text. An uncoded, malformed, or unknown failure is
ambiguous: clients report it and retain last-known-good data.

A warm organization read-model client discards its opaque cursor and requests a
fresh snapshot only for the exact `400 organization_read_model_cursor_invalid`
failure. Other `400` responses, missing or malformed codes, unknown codes, and
the cursor code on another status retain the last-known-good projection and are
reported instead of triggering reset behavior. Only a valid cursor ahead of the
head converges through a `200` snapshot; others get a delta.

Authentication uses challenge signing:

1. `POST /auth/challenge` stores a short-lived challenge for a registered
   signing-key fingerprint.
2. `POST /auth/verify` verifies the signature over the challenge and this API's
   origin, then issues a session token and its first single-use, sixty-second
   websocket ticket; later connects mint one with `POST /auth/ws-ticket`.
3. `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`, and
   `POST /auth/logout` manage authenticated session tokens.
4. Authenticated mutation routes require the session user and fingerprint to
   match the signer fields embedded in signed access events or write headers.

A `401 session_refresh_required` response means the bearer token identified a
missing, expired, or invalid stored session and permits the client to renew and
replay a replayable request. Missing or malformed bearer credentials remain an
uncoded terminal `401`; clients never infer refresh behavior from `error` text.

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
member id, recipient fingerprint, KEM ciphertext, and wrapped key. The root
does not commit active state; separate policy validation binds the principal
and key epoch. Principal-state signing and hashing use the domain
`tearleads.principal-state`.

`memberEnvelopesRoot` is mandatory; a state missing it, required policy
material, or envelope material fails closed.

`GET /principals/:principalType/:principalId/policy` serves one pinned head
in pages ([history transport](principal-history-transport.md)). Every read
applies live read authorization and verifies the current policy first. An
unpinned discovery read may name the head the client holds with `ifVersion`
and `ifStateHash`; when that is the live head, the reply is
`{unchanged: true, head}` and carries no artifacts, otherwise it is the first
page. The reply proves only freshness: the client authenticates the held head
from its own verified history and re-reads unconditionally on any other reply.

## Container Access And KEK Protocol

Container create bodies and manifest structural state carry a required nullable
`systemSlot`. A non-null slot is signed, immutable, and allowed only on a root
child created by a root administrator. Composite create requests must repeat
the exact signed value. Normal children may still be created by writers.

Before adopting a listed root or system destination, the SDK verifies its
writer projection and uses the manifest's parent edge, metadata document id,
and slot. Pre-login content merges only into the session root id with a signed
parentless manifest in the session organization. Login returns that root id
(or null after purge); the login response alone does not authenticate its role.
Shared system containers remain valid destinations. Projection GETs require
read access; signed mutations still enforce their own write/admin authority.
Destination classification verifies signed history without advancing write
checkpoints. Root and system containers cannot move, so their roles and parent
identity remain stable across later grants, recitations, and rekeys.

Signed container mutation routes are:

- `POST /containers`
- `POST /containers/with-metadata-document`
- `POST /containers/:containerId/share`
- `POST /containers/:containerId/revoke`
- `POST /containers/:containerId/rekey`
- `POST /containers/:containerId/move`
- `POST /containers/:containerId/recite` (`ContainerReciteRequest`)

Most signed mutations use `ContainerMutationRequest`. The container with
metadata document create route wraps a `ContainerMutationRequest` with the
initial metadata `DocumentCreateRequest`, and an optional
`initialMetadataSync` seed that follows the
[document create seed](document-link-and-sync-protocol.md) rules.

Each signed mutation request carries:

- signed event and event body
- expected manifest hash and derived manifest state
- optional `previousManifestRef`, `previousContainerPathRefs`,
  `parentContainerPathRefs`, `destinationParentContainerPathRefs`, and
  `containerManifestHistoryRefs`: `{containerId, manifestHash}` citations of
  manifests the server already stores, never the bundles themselves. No list
  may cite one manifest twice, and history cites only the mutated container
  (the one `previousManifestRef` names), so both are refused with `400`
  before any citation is read; the history then loads in one bulk read
- `principalPolicyRefs`: `{principalType, principalId, version, stateHash}`
  heads of the principal policies the mutation was planned against, at most
  4,096 (`MAX_CONTAINER_PRINCIPAL_POLICY_REFS`), never the policies themselves
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
and verifies the container KEK state. Each principal policy ref must name the
principal's current head, or the mutation is refused with
`409 principal_policy_stale` and the current heads the requester may read; the
API then authorizes from its own verified copy of each head. The `stateHash`
commits the signed state, and with it the projection and grant roots, so the
head pins everything an inline policy would have carried. Every cited manifest
is resolved from the API's own artifacts: a manifest an earlier mutation of the
same batch verified, or the stored bundle, re-verified because database rows are
not a trust boundary. A citation whose hash is not stored, or whose
`containerId` names a different container, is refused with `409`. The previous
manifest and every path element must also be the container's current head, and
the signed event's `dependencyManifestHashes` must equal the cited hashes, so a
stale or uncited head is refused. Only the new manifest the mutation commits
travels in full; a recitation cites its previous head and current path the same
way. Container KEK wraps target direct users, managed principals, or the parent
container KEK. A child container can inherit access through parent KEK edges
without rewriting every descendant object when an ancestor grant changes.

For a rotation, the API also verifies that the bridge connects the stored
current epoch to exactly the proposed next epoch, that the keyring is sealed to
the new epoch with a ciphertext length exactly matching the epoch number
(`8 + (n - 1) * 64 + 16` bytes — over- and under-length both reject), and that
both artifact hashes match the signed event body. Epoch numbers above
`MAX_CONTAINER_KEY_EPOCH` (65536) are rejected at rotation time as a
runaway-rotation backstop; the other protocol bounds are listed in
[limits.md](./limits.md). Writer projections are gated by current access and
return the sealed keyring for each path epoch (null exactly at epoch 1).
Consequently current document access includes retained history; projections do
not return superseded recipient envelopes or filter old epochs by requester
membership era. `GET /containers/:containerId/kek-log` serves the append-only
rotation log — every epoch with its write-once bridge and sealed keyring — as
the rebuild/repair read path for any current reader.

Container and document writer projections carry each access-manifest bundle
once, in a `bundles` map keyed by manifest hash. Every manifest position cites
that map by hash: the container `path`, each KEK's `containerManifestHistory`,
and, for documents, every authorizing path, `documentManifest`,
`documentManifestHistory`, `documentContainerManifestHistory`, and each
`documentManifestContainerPaths` row. Bundles are the stored bytes, so no signed
bytes change. A cited hash without a bundle, a bundle stored under a key other
than its own `manifestHash`, or a bundle nothing cites is a response-shape
failure. The client resolves every citation to its own copy of the bundle
before any cache or verifier sees the projection, then verifies the result,
recomputing each cited manifest's hash before any position that cites it is
trusted.

A projection GET may send `x-known-manifests`: up to 48 unique typed digests
of bytes the device durably holds verified. `m:<hash>` names a manifest
bundle by its manifest hash; `k:<digest>` names a container KEK level by the
SHA-256 of its canonical wire JSON (the level with its manifest history cited
by hash). After its ordinary authorization and stored-evidence verification,
the API omits the bundle of each listed hash the projection cites and lists
those hashes in the required `omittedBundles`; every other cited hash travels
in `bundles`, and unknown hashes are ignored. A KEK level whose served bytes
have a listed digest travels as `{levelDigest, containerManifestHistory}`, so
its manifest citations still count; a rotated epoch, a new wrap, or any other
change gives the level a new digest, and it travels in full. A hash must not
be both served and omitted, and an omitted hash must be cited. The client fills
an omitted bundle, and replaces each level stub with its own copy of the held
level, only from the bytes its request cited, and only when the held level's
manifest citations equal the stub's; otherwise it refetches once with no hints.
Hints grant nothing: the projection is authorized, and the rebuilt projection
validated and verified, exactly as without them.

The client cites from its verified-bundle cache, never across organizations:
the latest verified KEK level of each container on the target's lineage,
then those objects' bundles, then its organization's most recently verified
bundles. Lineage follows stored container parents. A container the device has
not stored yet, such as a folder a hydration pass prefetches from a listing,
takes its listed parent's lineage, and the listing's organization is one more
source that must agree; a wrong listing only changes which held bytes are
cited.

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

For document sync, a stale inline rekey returns
`document_sync_state_stale`. When the stale state is a principal policy, the
response may include the current `principalHeads[]` the requester may read;
clients recover those heads through ordinary policy reads before refetching the
writer projection and replanning.

An absent target on `DELETE /containers/:containerId`, a document-listing lane,
or writer-projection reads returns `404 container_not_found` (a lane `failure`).
Clients may treat that exact pair as permanent absence: delete installs a
maximal anti-resurrection fence, document listing treats the lane as
unavailable, and restoration sweeps may purge retained dormant metadata. A bare,
malformed, unknown, or wrong-status tag is not deletion authority and fails
closed.

A successful container mutation (create, share, revoke, rekey, move, recite,
with-metadata-document, the carried `containerRekeys`, and each
`containerMutations` entry of a principal policy commit) acknowledges by hash.
The response carries the identity the client signed (`containerId`,
`organizationId`, `parentId`, `systemSlot`), the server-assigned `createdAt` and
`updatedAt`, `eventHash`, `manifestHead`, and, except for a recitation,
`containerKek` with `containerKeyEpochId`, `containerKeyEpoch`, `keyEpochHash`,
`keyTargetHash`, `keyringHash` (null exactly at epoch 1), and
`parentContainerKeyEpochId`. It never echoes the signed event, body, manifest,
state, key epoch, wraps, keyring, recipient targets, or KEK history. The client
compares each hash with the plan it signed and records state built from that
plan; any mismatch refuses the acknowledgement. The manifest hash commits to
the derived state, and `keyTargetHash` commits to every wrap recipient, so a
wrap stored for anyone else cannot match. Later writer projections still verify
what the server stored.

Document creates (including a with-metadata-document's metadata document and
every provisioning document) and link-set mutations acknowledge the same way:
`id`, the signed `eventHash`, the committed `manifestHash`, the stored
`contentKeyEpoch`, the resolved KEK `targetHash`, and, for a create,
`createdAt` and the seed's `initialSync`. The client records the manifest,
content-key bundle, and KEK targets from its plan. An attachment bind returns
the binding identity, `eventHash`, `contentKeyEpoch`, `writeHeaderHash`, and
the resolved `blobKekTargets`; it no longer echoes the event, wraps, write
header, or write authorization, which a staged upload's bind stores as exactly
those targets.

Behavior-bearing container mutation conflicts use stable tags. A stale parent
or concurrent mutation returns `409 container_mutation_state_stale`; a
stable-id create retry returns `409 container_manifest_already_exists`, which
proves the container committed and permits lost-response adoption. A compound
create may instead return `409 document_manifest_already_exists`; that conflict
can roll back the newly created container, so it is terminal unless the client
independently verifies both remote artifacts. Clients replan or adopt only on
the exact status and code. Missing, malformed, and unknown tags are terminal.

## Document Link And Sync Protocol

The normative link, write-verification, pagination, checkpoint, and conflict
rules live in [Document Link and Sync Protocol](document-link-and-sync-protocol.md).

## Blob Stage Protocol

Blob bytes are staged before attachment binding:

- `POST /blobs/stages/multipart`
- `GET /blobs/stages/multipart/:stageId`
- `POST /blobs/stages/multipart/:stageId/parts/:partNumber/upload`
- `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes` (non-signing stores)

`InitiateMultipartBlobStageRequest` declares the completed encrypted object's
`organizationId`, `byteLength`, and `sha256`, plus `firstParts`: the number,
exact byte length, and base64 Content-MD5 of each part the client sends first
(one to four, its upload concurrency). The caller must have direct
organization access. Before creating any upload, the API refuses first parts
that repeat a number, exceed the declared object alone or together, or (on
S3/R2) name a part number the declared size cannot reach with 5 MiB parts.
The response's `partUploads` carries one upload source per first part, so the
parts the client starts at once need no authorization request of their own.
Later parts, and a renewal after a URL expires or fails, are authorized one at
a time with the same byte length, Content-MD5, and upload ID. S3/R2 sources are
five-minute UploadPart URLs scoped to the stored key, upload ID, part number,
checksum, and exact byte length; the client sends
`application/octet-stream` directly to storage and confirms the returned ETag.
URL expiry never invalidates uploaded parts or extends the one-hour stage.
Non-signing stores answer every part with the API byte route (`kind: "api"`),
so their clients never authorize a part; S3/R2 reject that proxy path before
reading a body.

There is no completion request. Attachment binding completes the stage: before
its transaction it assembles parts 1..k of the stage's upload, the run whose
stored lengths add up to exactly the declared byte length, and verifies the
object's length and SHA-256 against the stage, deleting a mismatched object and
refusing with `409`. A part numbered past that run is left out, so a stray part
cannot change the object. No uploaded parts, a gap (the 409 names its first
missing part), or parts that miss the declared length are refused before the
upload is consumed, so that part can still be sent. Completion is idempotent: a
stage already complete is used as is, and an object assembled before a lost
state flip is re-verified before it is adopted. A bind that finds the upload
consumed and no object re-reads the stage: if a concurrent bind has marked it
complete, that object is verified and used. The stage is marked complete once
the digest matches, before the envelope header is judged, so a malformed
envelope is refused (`400`) with the stage left complete, and a retry is refused
the same way.

The API stores only object-store multipart metadata in `blob_stages`; encrypted
payload bytes are never encoded into JSON or stored in the database. Staged
objects are not readable as committed blobs and are promoted only by a
successful attachment bind. Expired stages, and stages whose parts do not
assemble to the declared object, fail closed during bind.

Object keys are `organizations/<organizationId>/blob-stages/<stageId>` and
remain unchanged after promotion. The stage's immutable organization must match
the destination document's verified organization, even when the uploader belongs
to both organizations. Initiation and status responses include
`organizationId`; clients check it before resuming an upload.

GC retains the full key and organization in durable deletion work, checks their
agreement before object deletion, and retries that exact key after a failure.
Expiry cleanup uses the stored stage key for both multipart aborts and completed
object deletion. Organization purge expires and drains only its own stages and
waits for stage cleanup before finalizing. Stage persistence rechecks
organization access under the organization row lock after object-store
initiation, so a purge that wins that race causes the new multipart upload to be
aborted.

A client replacing a persisted resume stage must require positive API proof:
`GET /blobs/stages/multipart/:stageId` returns
`404 multipart_blob_stage_not_found` when the stage or its object-store upload
or completed staged object is absent, and
`409 multipart_blob_stage_expired` when the stage expired. Only those exact
status-and-code pairs permit opening a fresh stage. Uncoded, malformed, unknown,
cross-status, proxy, route, and unrelated conflict failures are terminal so the
client does not abandon resumable state on an ambiguous error.
If a bind consumed the multipart upload but its completion write was lost, the
status lookup revalidates the surviving staged object, converges the stage to
complete, and returns it instead of emitting absence.

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
- `authorizingContainerPathRefs` citing stored container manifests; the API
  resolves the document manifest from its own store
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
- submitted blob content-key targets and their hash match only the new binding's
  current derived KEK targets; any other binding in the submission is refused
- staged blob write header matches blob id, blob access manifest hash,
  content-key epoch, target hash, `ciphertextHash` matching the staged
  SHA-256, and writer identity

After verification, the API promotes staged bytes when supplied, detaches the
previous active slot binding if present, stores the new binding, persists blob
content-key targets merged with the exact stored envelopes of all other bindings
under the blob row lock, recomputes the merged target hash, stores the blob
write header, registers the blob in `blob_audit_objects`, and touches the
document plus linked containers for sync discovery.

Detach uses:

- `POST /blobs/:blobId/attachment-bindings/:bindingId/detach`

`BlobAttachmentDetachRequest` carries the signed `attachment.detach` event and
body, `authorizingContainerPathRefs`, and optional `containerRekeys[]`. The API
verifies the active binding, signed event, document manifest, authorizing paths,
and referenced principal policies before detaching the binding.

Each encrypted Loro attachment entry carries its slot ID and required lowercase
SHA-256 `contentSha256` of the intended plaintext. Local attachment creation and
replacement author this digest before staging; resumable uploads verify their
source against it. Hydration verifies the signed binding and ciphertext, then
checks the decrypted plaintext against the current authenticated document entry.
An older valid binding with different content remains unavailable and cannot
replace locally held bytes. A mismatch alone is not tampering evidence: the
current document can arrive before its new blob upload.

Hydration commits only while its document intent is still current and the
durable slot still names the local copy observed before downloading. SQLite
compares the slot inside the guarded transaction; a competing facade's
replacement is retained. Replaced bytes enter the reference-checked orphan
reclaim queue. Signed attachment binding metadata remains the server-visible
authority for blob access, attachment listing, replacement, detach, and live
blob reachability.

## Blob Read Protocol

Blob reads use:

- `GET /documents/:documentId/attachments`
- `GET /blobs/:blobId/download`
- `GET /blobs/:blobId/bytes`

Attachment listing requires document read access through a linked container path
and returns one row per active binding: its `bindingId`, `blobId`, `slotId`,
signed binding event, blob write header and authorization, KEK targets, and
`contentKeyBundle`. The content-key bundle is loaded from the blob key-package
tables, not from the encrypted blob bytes. Blob reads require read access
through at least one active binding's document. The download route returns the
blob id, byte length, and SHA-256 plus a `source`: a five-minute signed
object-store URL, or `kind: "api"` when the store cannot sign. The `/bytes`
route streams committed encrypted bytes as `application/octet-stream` with blob
id, byte length, and SHA-256 digest headers. The app combines the attachment
listing's blob content-key bundle with verified document/container access
material to unwrap the blob content key and decrypt the committed bytes.

The stored blob wrap set and current access-target projection are distinct.
Container rotation does not rotate immutable blob ciphertext: a cold reader may
use a retained KEK from the verified current keyring to open an older envelope.
Each envelope's container manifest and KEK identity must resolve through signed
history. Signed blob write authority and binding history are verified
separately. The API retains prior envelope sets by target hash; updating the
latest set never deletes an issued historical wrap. Link/unlink events carry
signed `blobRewraps` and atomically install destination envelopes with the
document's new links (see
[document link protocol](document-link-and-sync-protocol.md)).

Attachment hydration isolates individual download and verification failures so
one unavailable or invalid binding cannot suppress unrelated attachments.
Typed verification failures reach the security reporter. Database closure and
projection-generation cancellation still abort the whole hydration operation.

## Delete And Purge Semantics

Removal is terminal and structural. Link, unlink, share, revoke, rekey, move,
and document purge carry signed access events; container delete is an
authenticated control-plane operation without a signed artifact.

`POST /documents/:documentId/purge` accepts a signed `document.purge` event. The
signature binds the current document manifest, the sole linked container, and
every manifest hash in the exact current root-to-leaf container path that
authorized the purge. The API independently verifies the event, exact heads,
root completeness, path contiguity, organization scope, and signer write access,
stores the terminal event, and then removes the document's mutable row, content
keys, encrypted updates, attachments, and live-head pointer. It retains the
signed document manifest chain and the exact signed authorization path plus its
verification dependencies so a device authorized through that purge-time path
can retrieve the proof from `GET /documents/:documentId/purge` after the live
document is gone. A user whose only access came through a path unlinked before
the purge cannot retrieve it.

The proof carries redacted principal-policy snapshots for every group head its
container evidence references. Each snapshot retains the signed public state
chain and committed membership/grant projections, but no encrypted payload,
epoch-key row, or member envelope. Clients verify those signatures and
commitments before using historical group membership. Group deletion can
therefore erase recoverable server-side key material without making an earlier
terminal purge unverifiable.

Purge-path access permits a terminal snapshot. A caller's recorded observation
of a signed document head also permits full history; an explicit earlier
checkpoint requires that caller's observation of that exact head. History
includes cited public container/policy evidence, not keys. The SDK
authenticates before reading local pins (verified manifest checkpoints) and
verifies one response without refetching. Deletion requires an exact pin or
signed transitions from a pin or genesis. Missing history with no local
checkpoint defers deletion without an incident. A conflicting checkpoint
records an incident; snapshots cannot advance it. A newer path pin, ancestors
included, withholds deletion without incidents or retry loops: ancestry
cannot order the purge signature. The SDK commits the terminal purge
checkpoint in the same local SQLite transaction that removes the matching
document row and its side state. A stale local generation, identity
replacement, failed cleanup, or interruption rolls back both the checkpoint and
deletion so the verified proof can be retried safely. After a lost POST
response, a coded not-found retry uses the retained proof.

The API also requires that the document is linked to exactly one container (a
document with several links must first be unlinked down to one) and that the
target is not a container metadata document, which is torn down only with its
container. An unknown document id returns not found. Blobs referenced only by
the purged document are soft-deleted under the
[attachment retention](attachment-retention.md) lifecycle: `dereferencedAt` is
stamped (an existing stamp keeps its original time) while bytes, objects, and
key material wait for the garbage-collection sweep, and a bind during the grace
period revives the blob. A blob still referenced by another active binding is
untouched; detached bindings do not keep a blob live. The response returns
`purgedAt`.

`DELETE /containers/:containerId` is an admin-only structural delete for empty,
non-system, non-root leaf containers. A root or system-slot container cannot be
deleted. Child containers or any linked user document make the delete a
conflict; the container's own metadata document, which every container links to
itself, is excluded from that guard. An unknown container id returns not found.
A successful delete runs in one transaction: it writes a per-recipient
`deleted` sync tombstone (the peer discovery signal), removes the container
row, then tears down its metadata document: the `containerMetadataDocuments`
binding and, when the composite create path materialized document rows, those
rows and any blobs they orphan (dereferenced after required row locks using the
database wall clock, so lock waits cannot consume the garbage-collection grace
period). The metadata document gets no purge tombstone because it is withheld
from client discovery; the container tombstone is the sole peer signal. Any
guard failure rolls the whole transaction back.

Trash is itself a system-slot container and so cannot be deleted or purged.
Sending an item to Trash is an ordinary signed relocation — never a delete — and
stays reversible. A document is relocated by replacing its link set (link Trash,
unlink its source containers); a container is relocated by re-parenting it under
Trash with `container.move`. The move workflow guards only the moved container's
own system slot, not the destination's, so a normal folder and its whole subtree
may be moved into Trash, and moved back out again to restore it. Terminal
removal is the separate, structural step:
`POST /documents/:documentId/purge` for a document and
`DELETE /containers/:containerId` for a folder — a non-empty folder is torn
down by a client-orchestrated cascade of those two primitives applied
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
