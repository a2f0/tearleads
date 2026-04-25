# Keying V2 Design

This document is a greenfield design for the next access and key-delivery
model. It incorporates the direction from:

- #257, local-first nested container creation
- #265 and #266, container KEK hierarchy for document/blob key delivery
- `docs/security-guarantees.md`, especially the gaps around unsigned object
  grants, rollback, split views, and first-contact identity keys

The design intentionally does not preserve V1 wire compatibility.

## Goals

- Make additive sharing cheap: no per-document or per-blob recipient fanout.
- Prevent the API from tricking honest clients into encrypting to unauthorized
  recipients.
- Let clients verify access/key state with shared code, not UI convention.
- Keep server-visible structure authoritative for access derivation.
- Preserve E2EE: the server stores ciphertext and wrapped keys, not plaintext
  content keys.
- Keep revocation honest: forward-looking unless content is re-encrypted.
- Support local-first creation without fake server access hashes.

## Non-Goals

- Retroactive revocation of bytes or keys already distributed.
- Hiding container/document/blob structure from the server.
- Preventing denial of service, withholding, or delayed publication.
- Solving first-contact identity trust without a trust root.
- Making a public blockchain the primary authorization system.

## Core Design

V2 has four distinct planes:

1. Identity and principal policy.
2. Signed object access manifests.
3. Container KEK key delivery.
4. Content-object encryption for documents and blobs.

The API can store and project these planes, but an honest client must be able to
verify the authority for each plane independently.

## Threat Model

Assume:

- client code is honest and runs the verifier;
- user/device signing keys and private encapsulation keys are uncompromised;
- cryptographic primitives hold;
- the API, database, object storage, cache, and read replicas may be malicious,
  stale, or inconsistent.

The server may still deny service, omit data, or delay publication. V2 is
designed so those attacks become availability failures, not silent
confidentiality failures.

## Identity And Principal Policy

Principal policy keeps the current signed group/organization model, but V2
tightens two rules.

First, any principal transition that removes a reader, demotes a role that can
read, removes a nested group, disables a member, or changes a member key in a
way that shrinks future access must advance the principal key epoch. Clients
and the API both reject shrinking policy transitions that reuse the old
principal key epoch.

Second, user identity keys need an authority outside mutable API rows. V2
should support one of these trust roots:

- out-of-band key verification or invitation links that bind `userId` to an
  identity signing key fingerprint;
- organization-admin signed invitations that name the recipient identity key;
- an append-only identity transparency log with client checkpoint pinning;
- a combination of the above.

Without one of these, first-contact key substitution remains possible. No
object keying algorithm can fully fix that by itself.

## Signed Access Manifests

The biggest V1 gap is that object grants are API-authored. In V2, every
security-relevant graph mutation is represented by a signed access event and a
derived access manifest.

Protected manifest scopes:

- organization;
- container;
- document link set;
- attachment binding set;
- blob target set, derived from signed attachment bindings.

The API may store materialized projection rows, but projection rows are not
authority. A client verifies manifests and derives projections locally.

### Access Event Shape

Each mutation signs canonical bytes for an event like:

```ts
type AccessEventV2 = {
  version: 2;
  eventId: string;
  eventType:
    | "container.create"
    | "container.grant"
    | "container.revoke"
    | "container.move"
    | "document.link"
    | "document.unlink"
    | "attachment.bind"
    | "attachment.detach";
  objectKind: "container" | "document" | "attachment";
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

The event body is type-specific. For example, `container.grant` includes the
subject principal, access level, current referenced principal policy head, and
the container manifest hash being advanced. `document.link` includes the
document manifest hash and target container manifest hash. `attachment.bind`
includes document id, slot id, blob id, expected binding id, and document
manifest hash.

### Manifest Shape

An access manifest is a canonical snapshot derived from events:

```ts
type AccessManifestV2 = {
  version: 2;
  objectKind: "container" | "document" | "blob";
  objectId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  structuralHash: string;
  grantRoot: string;
  referencedPrincipalHeads: ReferencedPrincipalHead[];
  keyTargetHash: string;
  manifestHash: string;
};
```

Clients verify:

- event signatures;
- signer identity key authenticity;
- signer authorization against the previous manifest;
- referenced group/organization policy chains;
- cross-object dependencies, such as parent container, linked container, or
  active attachment binding heads;
- monotonic local checkpoint rules;
- optional transparency inclusion and consistency proofs.

This turns "the API returned a self-consistent grant view" into "the API
returned a verifiable signed state transition."

### Container Access Manifests

A container access manifest is the signed head for the container's direct
access and structural parent edge. It should not contain a full expanded
recipient list for every descendant document.

Container manifest inputs:

- container id and organization id;
- parent container id and parent manifest hash;
- direct grants on this container;
- referenced principal policy heads for direct managed-principal grants;
- current container KEK epoch id;
- previous container manifest hash;
- authorizing signed event hash.

The effective access for a container is derived by walking ancestor container
manifest heads and unioning their direct grants. For runtime efficiency, the
server may materialize ancestor paths and effective grant summaries, but a
client can verify the path from signed manifest hashes.

Important scaling rule: sharing or revoking a container must not rewrite every
descendant container manifest. Descendants inherit through their parent edge and
their parent KEK wrap. A descendant manifest changes only when that descendant's
own direct grants, parent edge, or key epoch changes.

### Document Link-Set Manifests

A document link-set manifest is the signed head for the set of containers that
currently link to a document. It is not a per-container access manifest and it
does not expand users.

Document link-set inputs:

- document id and organization id;
- active linked container ids;
- dependency container manifest hashes used to authorize the link/unlink event;
- previous document link-set manifest hash;
- authorizing signed event hash.

`document.link` and `document.unlink` events advance only this link-set head.
They do not copy container grants into the document and they do not mutate
container manifests.

The document's write targets are derived at write time:

1. verify the document link-set manifest;
2. load and verify each active linked container's current manifest head;
3. resolve each linked container's current container KEK epoch;
4. sort and hash those KEK targets.

This means a container grant change does not cause writes to thousands of
document link-set manifests. Existing documents see the new container KEK state
when their next write target set is derived.

### Derived Document Access Views

A document access view is a deterministic projection:

```ts
type DocumentAccessViewV2 = {
  documentId: string;
  linkSetManifestHash: string;
  linkedContainerManifestHashes: string[];
  linkedContainerKeyEpochIds: string[];
  documentKeyTargetHash: string;
};
```

This view can be cached, indexed, and returned by the API, but it is not the
authority. Clients recompute and verify it from signed manifests before using
it to encrypt.

The same pattern applies to blobs. Blob access is a derived view from signed
active attachment binding events plus the linked documents' verified target
sets.

## Authorization Rules

Use stricter rules than V1:

- `container.create`: signer must have write access to the parent container.
- `container.grant` / `container.revoke`: signer must have admin access to the
  container.
- `container.move`: signer must have admin access to the moved container and
  write access to the destination parent; the event references both manifest
  heads.
- `document.link`: signer must have write access to the document through all
  current linked containers and write access to the target container.
- `document.unlink`: signer must have write access to the document through all
  current linked containers and write access to the unlinked container.
- `attachment.bind` / `attachment.detach`: signer must have write access to the
  document under the current document manifest.

These rules are conservative. They prevent a writer from one linked container
from silently changing another linked container's access to the same document.

## Container KEK Hierarchy

Each container has a current container KEK epoch.

Container KEKs are wrapped to:

- direct user identity/device encapsulation key epochs;
- group or organization principal key epochs;
- the parent container KEK epoch when inherited access should flow downward.

Documents and blobs do not wrap content keys directly to every effective user.
They wrap content keys to current container KEK targets.

### Why Parent KEK Edges Exist

If child containers always wrap their KEK to the parent container KEK, an
additive share on an ancestor can be one new wrap of the ancestor KEK. The new
recipient follows the existing KEK chain to descendant content. That is the
main fanout win.

The tradeoff is explicit: compromising an ancestor KEK compromises the subtree
that inherits from it. That matches inherited access semantics, but it must be
treated as the blast-radius boundary.

### Container Key Epoch Row

```ts
type ContainerKeyEpochV2 = {
  id: string;
  containerId: string;
  keyEpoch: number;
  accessManifestHash: string;
  parentContainerKeyEpochId: string | null;
  createdByEventHash: string;
  createdAt: string;
};
```

### Container Key Wrap Row

```ts
type ContainerKeyWrapV2 = {
  containerKeyEpochId: string;
  recipientKind: "user" | "group" | "organization" | "container";
  recipientId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
  wrapManifestHash: string;
};
```

The `wrapManifestHash` binds the wrap to the manifest that justified it. A
client rejects wraps whose recipient key epoch, principal policy head, parent
container key epoch, or manifest hash does not match the verified graph.

## Additive Versus Subtractive Changes

Additive changes:

- advance the signed access manifest;
- keep the current container KEK epoch;
- add one or more wraps for the existing KEK;
- do not touch descendant document/blob content-key bundles.

Subtractive changes:

- advance the signed access manifest;
- create a new KEK epoch for the changed container;
- require descendants whose future access depends on the changed ancestor KEK to
  move to a post-change KEK epoch before accepting future writes;
- do not rewrite old document/blob bytes unless a separate re-encryption job is
  requested.

Lazy descendant rekey is acceptable, but writes must fail closed. If a document
write targets a container whose current key epoch is still reachable through a
revoked ancestor key, the client/API must materialize the new descendant KEK
epoch first or return `409`.

## Document Content Keys

A document has one canonical content-key bundle per document key epoch.

Document write targets are the current KEK epochs of every linked container:

```ts
type DocumentKekTargetV2 = {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
};
```

The client:

1. verifies the document manifest and linked container manifests;
2. verifies all referenced principal policies and identity keys;
3. derives the sorted target list;
4. computes `documentKeyTargetHash`;
5. wraps the document content key to each target container KEK;
6. signs the encrypted write header over object id, document epoch, manifest
   hash, target hash, update metadata, and ciphertext hash.

The API rejects writes when submitted targets do not exactly match current
verified targets. Readers verify the signed write header before trusting target
metadata.

For additive changes, the document content key may be reused and wrapped to a
new target if the target set only grows. For shrink, future writes require a
new document content-key epoch and a fresh baseline, preserving the V1
forward-only revocation model.

## Blob Content Keys

Blob targets derive from the union of active signed attachment bindings.

For each active binding:

1. verify the attachment event signature;
2. verify the referenced document manifest;
3. derive the document's linked container KEK targets.

The blob content key is wrapped to the union of those container KEK targets.
Clients and the API reject blob writes or attachment commits that omit targets
for other active bindings.

Immutable blob bytes should keep one content key. If access shrink means future
use should not depend on the old blob key, the correct operation is blob
replacement or content re-encryption, not silent rewrap.

## Local-First Create Intents

Local-first creation should use signed local intents, not fake access hashes.

Local schema should track:

- `local_intent_id`;
- intent type and canonical body;
- signer identity/device;
- local dependencies by remote manifest hash or local intent id;
- provisional encrypted payload;
- sync status;
- remote object id and remote manifest hash after acceptance.

A child under a local-only parent depends on the parent's local create intent.
Sync uploads intents topologically:

1. submit parent create against the latest verified remote parent manifest;
2. receive authoritative parent/child manifest and KEK target state;
3. re-encrypt or rewrap provisional child metadata if required;
4. submit child create using the authoritative parent result.

The API never accepts `local:` hashes as access preconditions. Local hashes are
client dependency markers only.

If the remote parent changed while offline, the client rebases the pending
intent by verifying the new parent manifest and re-signing or re-encrypting as
needed.

## Transparency And Checkpointing

Signed manifests prevent unauthorized mutation, but they do not alone prove
latest-state freshness. V2 should add monotonic client checkpoints and,
optionally, a transparency log.

Minimum:

- clients persist highest-seen identity key state per user;
- clients persist highest-seen principal policy version/hash per principal;
- clients persist highest-seen access manifest epoch/hash per object;
- clients refuse to move backwards without explicit recovery UX.

Stronger:

- append identity states, principal policy heads, and object manifest heads to
  an append-only Merkle log;
- return inclusion and consistency proofs with API responses;
- let clients gossip or compare signed tree heads across devices.

Public blockchain anchoring is optional. It can timestamp an aggregate log root
and make server equivocation harder to hide, but it does not authorize object
grants, solve first-contact identity trust, or prevent withholding. If used,
anchor only aggregate tree roots, not object ids or metadata-bearing leaves.

## Client Verification API

All verification should live in a shared package used by both API tests and app
code.

Suggested entry points:

```ts
verifyIdentityKeyState(input): VerifiedIdentityState | VerificationError;
verifyPrincipalPolicyBundle(input): VerifiedPrincipalPolicy | VerificationError;
verifyAccessManifest(input): VerifiedAccessManifest | VerificationError;
deriveContainerKekState(input): VerifiedContainerKekState | VerificationError;
deriveDocumentKekTargets(input): DocumentKekTargetV2[] | VerificationError;
deriveBlobKekTargets(input): BlobKekTargetV2[] | VerificationError;
verifyWriteHeader(input): VerifiedWriteHeader | VerificationError;
verifyTransparencyProof(input): VerifiedCheckpoint | VerificationError;
```

These functions should be deterministic and side-effect free. API routes may
use them for validation, but the security guarantee comes from app clients
running the same verification before encrypting or decrypting.

## Programmable Proof Obligations

V2 should treat verifier functions as the executable security specification.
Each verifier returns a branded verified value, and later derivation functions
only accept those verified values. This keeps unverified API JSON from flowing
into encryption decisions by type accident.

Required proof obligations:

- `VerifiedIdentityState` proves a user/device key is signed by an accepted
  identity trust root and is not older than the client's local checkpoint.
- `VerifiedPrincipalPolicy` proves the group/org policy chain is signed,
  contiguous, projection-bound, payload-bound, and key-epoch-correct for any
  shrink transition.
- `VerifiedAccessManifest` proves the object graph transition was signed by a
  user/device authorized under the previous verified manifest.
- `VerifiedContainerKekState` proves each container KEK wrap is justified by
  the verified manifest, recipient key epoch, and parent KEK edge.
- `DocumentKekTargetV2[]` and `BlobKekTargetV2[]` prove the exact target set
  implied by the verified graph, not by an API-provided recipient list.
- `VerifiedWriteHeader` proves encrypted content metadata commits to the object
  id, manifest hash, content key epoch, target hash, ciphertext hash, and
  writer identity.
- `VerifiedCheckpoint` proves the response is not older than the client's
  persisted checkpoint and, when transparency is enabled, is included in a
  consistent append-only log.

This creates two classes of guarantees:

- Impossible without key compromise or broken first-contact trust: forging a
  grant, adding a recipient target, swapping a recipient key, or authorizing a
  write target that was not signed by an authorized principal.
- Detectable under checkpoint/transparency assumptions: replaying an old valid
  state or showing split views to different clients.

Withholding data, refusing proofs, delaying publication, and returning no state
remain availability failures. Clients fail closed.

## API Attack Outcomes

| API behavior | V2 outcome |
| --- | --- |
| Adds unauthorized object grant | Missing authorized signed access event; client refuses to encrypt. |
| Changes group/org projection rows | Signed policy projection/hash mismatch; fail closed. |
| Reuses principal key after membership shrink | Policy transition rejected by verifier. |
| Swaps recipient public key | Identity/principal key fingerprint mismatch; fail closed unless first-contact trust was never established. |
| Omits a linked container target | Derived target hash differs; write/read verification fails. |
| Drops blob targets for another active binding | Blob target derivation from signed bindings catches mismatch. |
| Replays older manifest | Local highest-seen checkpoint or transparency consistency proof rejects when client has seen newer state. |
| Shows split views | Detectable through transparency consistency/gossip/witnessing; otherwise still an availability/equivocation gap. |
| Withholds state or proofs | Availability failure; clients fail closed. |

## Storage Direction

Core server tables:

- `identity_states`
- `access_events`
- `access_manifests`
- `access_manifest_log_leaves`
- `container_key_epochs`
- `container_key_wraps`
- `document_content_key_epochs`
- `document_content_key_targets`
- `blob_content_key_epochs`
- `blob_content_key_targets`
- `client_checkpoint_receipts` or local-only checkpoint storage

Projection tables may exist for indexing:

- effective container grants;
- current document links;
- current attachment bindings;
- current KEK target summaries.

Projection tables are caches. The verifier must be able to reject a projection
that does not match signed manifests.

## Scaling Model

The design relies on not propagating access changes into every descendant
document/blob row.

Expected costs:

| Operation | Expected write cost |
| --- | --- |
| Create container | `O(1)` plus parent manifest verification and one container KEK epoch. |
| Additive share on container | `O(new recipient key wraps)`; no document/blob rewrite. |
| Revoke on container | `O(remaining direct wrap targets for that container)` plus one new container KEK epoch; descendants rekey lazily before future writes. |
| Move container | `O(1)` manifest/key update for moved container, unless policy chooses eager descendant rekey. |
| Link document to container | `O(number of linked containers for that document)`, usually small. |
| Document write | `O(number of linked containers for that document)`, not `O(users)`. |
| Blob attach/write | `O(number of active document/container target domains for that blob)`, not `O(users)`. |

For tens of thousands of folders/documents and up to roughly 1000 users, this
is viable if these constraints hold:

- Most documents are linked to a small number of containers.
- Most blobs have a small number of active bindings.
- Container KEKs inherit through parent KEK edges so ancestor additive shares do
  not require descendant key rewrites.
- Group/organization grants target principal KEKs, not every user directly.
- The API maintains projection indexes for listing and search, but encryption
  decisions are made from verified manifests.

The scaling cliff to avoid is embedding expanded effective recipients or
descendant document references inside container manifests. A container manifest
should commit to direct grants and parent/key edges. It should not contain the
full subtree or all linked documents.

With 1000 users, direct user grants on a container are still acceptable for
small shares, but organization-wide sharing should go through an organization
or group principal key. Otherwise an additive grant can still be `O(1000)` key
wraps, which is manageable occasionally but should not be the default hot path.

The main residual cost is lazy rekey after revocation. A subtractive change on
a high-level container can force future writes in a large subtree to first
materialize post-revocation descendant KEK epochs. That work can be spread out
by background jobs or first-writer-wins lazy materialization. The security rule
is that future writes must not continue under a KEK chain reachable by the
revoked principal.

## Implementation Slices

1. Define canonical encodings and shared verifier APIs.
2. Add signed access event and manifest types for containers.
3. Add identity/principal checkpoint pinning and key-shrink validation.
4. Add container KEK epoch/wrap storage and target derivation.
5. Switch document create/sync to document KEK targets.
6. Add signed document link manifests and multi-container target validation.
7. Switch blobs/attachments to signed binding events and blob KEK targets.
8. Add local-first intent storage and topological sync for container creation.
9. Add transparency log inclusion/consistency proofs; optionally anchor
   aggregate roots externally.
10. Remove V1 per-object recipient fanout paths.

Because V2 is greenfield, these slices do not need dual-write compatibility.
They can be implemented behind a new protocol namespace and cut over object
creation to V2-only objects.

## Acceptance Criteria

- An honest client can derive document/blob key targets without trusting
  API-authored recipient lists.
- A forged object grant cannot make an honest client encrypt to a new
  recipient without an authorized signature.
- Additive share on an ancestor does not rewrite descendant document/blob
  content-key bundles.
- Subtractive change prevents future writes under KEK epochs reachable by the
  removed subject.
- Multi-linked documents require all linked container KEK targets.
- Blob writes and attachment commits cannot drop targets for other active
  signed bindings.
- Local child creation under a local-only parent queues without inventing a
  server access hash.
- Clients enforce monotonic checkpoints for identities, principal policies, and
  object manifests.
- Tests include malicious API fixtures for forged grants, swapped keys,
  omitted targets, stale manifests, split projection rows, and key-epoch reuse
  after membership shrink.
