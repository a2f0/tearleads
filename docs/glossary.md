# Glossary

This glossary defines shared protocol terms used across the Tearleads docs. It
is a reading aid; executable request, response, and verifier behavior remains
defined by the shared validators, crypto verifiers, API workflows, and app
workflows named in [protocol-specification.md](./protocol-specification.md).

## Access Epoch

The monotonically advancing epoch of an access manifest or encrypted content
key. Document updates are epoch-bound: clients decrypt an update only with the
document key material for the update's epoch.

Related docs:

- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md)
- [keying-design.md](./keying-design.md)

## Access Event

A signed mutation statement for an access-relevant change, such as
`container.grant`, `document.link`, or `attachment.bind`. The event commits to
the object, previous manifest, dependency manifests, event body hash, signer
identity, timestamp, and signature.

Related docs:

- [access-plane.md](./access-plane.md)
- [keying-design.md](./keying-design.md#access-event-shape)
- [protocol-specification.md](./protocol-specification.md#common-cryptographic-objects)

## Access Manifest

A canonical, client-verifiable snapshot derived from signed access events. A
manifest commits to object identity, organization, epoch, predecessor, event
hash, structural state, grants, referenced principal heads, and key-target
hash. Projection rows are caches of manifest state; they are not authority.

Related docs:

- [access-plane.md](./access-plane.md)
- [keying-design.md](./keying-design.md#signed-access-manifests)

## Access Plane

The protocol plane that owns authorization state and key-target derivation. It
includes signed principal policies, access manifests, container KEKs,
content-key bundles, and write headers.

Related docs:

- [access-plane.md](./access-plane.md)
- [api-architecture.md](./api-architecture.md#protocol-planes)

## Attachment Binding

A server-visible signed relationship between a document slot and a blob. Active
bindings are the authority for attachment listing, blob reachability, blob read
access, replacement, and detach behavior.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#attachment-semantics)
- [protocol-specification.md](./protocol-specification.md#attachment-bind-replace-detach-and-slots)
- [attachment-retention.md](./attachment-retention.md)

## Attachment Plane

The protocol plane for encrypted blob staging and signed attachment
bind/detach metadata. Attachment metadata stays server-indexable even though
blob bytes and document content remain encrypted.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)
- [api-architecture.md](./api-architecture.md#protocol-planes)

## Attachment Slot

An opaque stable identifier inside a document, such as a product-level "front
image" or "back image" slot. The protocol only treats it as a `slotId`; at
most one active binding may occupy a slot at a time.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#why-slotid-instead-of-bindingid)
- [protocol-specification.md](./protocol-specification.md#attachment-bind-replace-detach-and-slots)

## Authorizing Container Path

A verified chain of container manifest heads from an access root toward a
target container. The path proves that a user has read, write, or admin access
through signed container state rather than through a server-authored ACL row.

Related docs:

- [access-plane.md](./access-plane.md#containers)
- [protocol-specification.md](./protocol-specification.md#document-link-and-sync-protocol)

## Blob

An encrypted binary object stored separately from document CRDT updates. Blob
access is derived from active signed attachment bindings and the linked
document/container access graph.

Related docs:

- [access-plane.md](./access-plane.md#blobs)
- [protocol-specification.md](./protocol-specification.md#blob-read-protocol)

## Blob Content-Key Bundle

The wrapped blob content key plus the derived container KEK target envelopes
for the blob's active attachment bindings. The bundle is persisted in blob
content-key epoch and target rows, returned by attachment listing or bind
responses, and is not embedded in committed blob encrypted bytes.

Related docs:

- [keying-design.md](./keying-design.md#blob-content-keys)
- [protocol-specification.md](./protocol-specification.md#blob-read-protocol)

## Local Keyring

The SDK helper that wraps one account-root secret with a host-provided wrapping
key keystore, persists a manifest through a host-provided manifest store, and
derives local SQLite, blob-store, identity-persistence, or custom-purpose keys
from that root.

Related docs:

- [developer/client-sdk.md](./developer/client-sdk.md#local-keyring)
- [security-guarantees.md](./security-guarantees.md#local-at-rest-key-wrapping)

## Blob Stage

A temporary holding record for encrypted blob bytes before an attachment bind
promotes them to committed blob storage. The server validates byte length,
digest, ownership, and expiry, but does not decrypt the bytes. Stages are
multipart object-store uploads that must be completed before bind promotion.

Related docs:

- [protocol-specification.md](./protocol-specification.md#blob-stage-protocol)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#protocol-shape)

## Commit LSN

The Postgres WAL log sequence number returned by sync responses after accepted
writes or read-only observations. Clients can use it as a consistency hook for
replica-safe read-after-write behavior.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#protocol-shape)

## Container

The tree-structured object where access control is applied. A container carries
direct grants, parent linkage, a metadata document id, and a current container
KEK epoch. Documents appear under containers through document link-set
manifests; a document may be linked to more than one container in the same
organization.

Related docs:

- [access-plane.md](./access-plane.md#containers)
- [container-dek-onboarding.md](./container-dek-onboarding.md#containers)
- [keying-design.md](./keying-design.md#container-access-manifests)

## Container KEK

A container key-encryption key. Container KEKs deliver document and blob
content keys to authorized targets without exposing plaintext content keys to
the server. Each container has a current KEK epoch, and child containers may
inherit through parent KEK edges.

Related docs:

- [keying-design.md](./keying-design.md#container-kek-hierarchy)
- [container-dek-onboarding.md](./container-dek-onboarding.md)

## Container KEK Keyring

The container's complete predecessor KEK history sealed under the current
epoch's KEK — the snapshot read path for history-inclusive access. One
decrypt yields every retained historical KEK; each entry is verified against
its material-committing epoch id, and the sealed length is an exact function
of the epoch number. Rewritten at every rotation by re-sealing the previous
entries plus the retiring key. Distinct from the Local Keyring, which wraps a
device's root key material.

Related docs:

- [keying-design.md](./keying-design.md#container-key-epoch-database-row)

## Container KEK Predecessor Bridge

The write-once append-only log entry a rotation stores alongside the keyring:
the retiring KEK encrypted under the new KEK, hash-committed by the signed
rotation event. Never rewritten by later rotations, which makes the bridge
log ground truth for rebuilding a damaged keyring via
`GET /containers/:id/kek-log`.

Related docs:

- [keying-design.md](./keying-design.md#container-key-epoch-database-row)
- [security-guarantees.md](./security-guarantees.md)

## Content Key

The symmetric key used to encrypt a document update stream or blob record. It
is wrapped to the current verified target set rather than stored in plaintext
server-side.

Related docs:

- [keying-design.md](./keying-design.md#document-content-keys)
- [keying-design.md](./keying-design.md#blob-content-keys)

## Content-Key Bundle

The collection of wrapped content-key material for one document or blob content
key epoch. A bundle must match the target hash derived from verified access
state before the API or app accepts it.

Related docs:

- [protocol-specification.md](./protocol-specification.md#document-link-and-sync-protocol)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#protocol-shape)

## DEK

Data-encryption key. In these docs, DEK usually means the plaintext symmetric
content key for a document epoch or blob record. The server stores ciphertext
and wrapped keys, not plaintext DEKs.

Related docs:

- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md)
- [security-guarantees.md](./security-guarantees.md#short-answer)

## Document

An encrypted CRDT object whose plaintext is opaque to the server. Documents do
not own direct ACLs. Access is resolved through their signed link-set manifest
and the active linked container paths.

Related docs:

- [access-plane.md](./access-plane.md#documents)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#reference-model)

## Document Link-Set Manifest

The access manifest for a document's linked container set. It names the
containers that project the document into navigation and access decisions, and
it is advanced by signed `document.link` and `document.unlink` events.

Related docs:

- [keying-design.md](./keying-design.md#document-link-set-manifests)
- [protocol-specification.md](./protocol-specification.md#document-link-and-sync-protocol)

## Document Plane

The protocol plane for encrypted Loro updates plus visible causal metadata.
The server indexes and relays encrypted updates but does not decrypt document
content.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)
- [api-architecture.md](./api-architecture.md#protocol-planes)

## Effective Access

The access level derived by walking the relevant signed manifest graph, such as
the root-to-target container path and referenced managed-principal policy
heads. Effective access is computed from verifiable state, not trusted from a
single mutable projection row.

Related docs:

- [access-plane.md](./access-plane.md#containers)
- [keying-design.md](./keying-design.md#authorization-rules)

## Epoch

A monotonically increasing version for access state or key material. Epochs let
clients distinguish current state from historical state and reject stale,
conflicting, or unsafe key reuse.

Related docs:

- [keying-design.md](./keying-design.md#transparency-and-checkpointing)
- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md)

## Fail Closed

The rule that missing, stale, malformed, or inconsistent policy and key
material causes rejection instead of fallback to a weaker authorization path.
Unavailable verification material is an availability failure, not permission to
bypass checks.

Related docs:

- [protocol-specification.md](./protocol-specification.md#failure-semantics)
- [security-guarantees.md](./security-guarantees.md)

## Grant

A signed access assignment on a container or managed principal. Container
grants are direct manifest inputs and may be inherited along container paths.
Group grants require policy; organization access uses reserved groups.

Related docs:

- [access-plane.md](./access-plane.md#containers)
- [keying-design.md](./keying-design.md#authorization-rules)

## Key Target

One recipient target for wrapped key material, such as a direct user/device
encapsulation key, a group or organization principal key, or a parent container
KEK. The target hash commits to the sorted derived target set.

Related docs:

- [keying-design.md](./keying-design.md#document-content-keys)
- [keying-design.md](./keying-design.md#blob-content-keys)

## Loro Update

An encrypted CRDT update produced by the Loro document layer. The server can
see causal metadata such as version-vector spans, but the update payload remains
encrypted with the document content key.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)

## Managed Principal

A group or organization whose membership and key epoch are represented by a
signed principal policy chain. Managed-principal grants fail closed when the
policy state or member envelopes needed for verification are missing or stale.

Related docs:

- [access-plane.md](./access-plane.md#principals)
- [security-guarantees.md](./security-guarantees.md#managed-grants-fail-closed)

## Member Envelope

Encrypted key material that delivers a managed principal's active key epoch to
one direct member. Member envelopes must match the active direct membership
projection and recipient key fingerprints.

Related docs:

- [protocol-specification.md](./protocol-specification.md#principal-policy-protocol)
- [security-guarantees.md](./security-guarantees.md#member-envelope-binding)

## Organization

The top-level ownership and policy boundary for user data. Registration creates
a default organization, reserved `Admins` and `Members` groups, and a root
container. The organization row stores `adminGroupId` and `memberGroupId`.
Reachability through `Admins` is org-admin authority. Reachability through
`Members` is organization membership. Org-manager directory lifecycle is stored
in organization roster entries so disabled users can remain visible after access
removal. Organization policy can still act as a managed principal for grants,
but org-manager product role semantics come from the reserved groups.

Related docs:

- [container-dek-onboarding.md](./container-dek-onboarding.md)
- [protocol-specification.md](./protocol-specification.md#identity-and-session-handshake)

## Organization Admins Group

The reserved organization-scoped `Admins` group. Reachable users have
organization-admin authority, including admin-only org-manager mutations and
org-scoped principal policy successor signing when the API verifies that
authority.

Related docs:

- [access-plane.md](./access-plane.md#principals)
- [security-guarantees.md](./security-guarantees.md#admin-signer-authorization)

## Organization Members Group

The reserved organization-scoped `Members` group. Reachable users belong to the
organization. Active roster entries are synchronized from this group's signed
reachability, but disabled roster entries may remain visible without granting
access. `Admins` is not nested into `Members` — principals contain only users —
so the policy write instead rejects any managed principal naming a user who is
not an active roster entry, which keeps every admin an organization member.

## Organization Roster Entry

An organization-scoped product row that records directory lifecycle state for a
user. It stores server-visible routing/status metadata such as `status`,
`joinedAt`, `disabledAt`, `disabledByUserId`, and optional `profileDocumentId`.
It does not store plaintext profile fields such as email, first name, or last
name; those belong in encrypted documents.

Related docs:

- [access-plane.md](./access-plane.md#principals)
- [container-dek-onboarding.md](./container-dek-onboarding.md#adding-users-to-an-organization)

## Principal

An entity that can receive access or key material. Users are principals with
registered signing and encapsulation keys; groups and organizations are managed
principals with signed policy state.

Related docs:

- [access-plane.md](./access-plane.md#principals)
- [keying-design.md](./keying-design.md#identity-and-principal-policy)

## Principal Policy State

The signed state chain for a managed principal. It commits to membership,
projection roots, key epoch, encrypted payload hash, signer, and predecessor
state so clients can verify group or organization authority.

Related docs:

- [protocol-specification.md](./protocol-specification.md#principal-policy-protocol)
- [security-guarantees.md](./security-guarantees.md#principal-policy-integrity)

## Projection Row

A relational index or cache derived from signed protocol state. Projection rows
help list, lookup, and sync performance, but clients must not treat them as
authorization authority by themselves.

Related docs:

- [access-plane.md](./access-plane.md#authority)
- [security-guarantees.md](./security-guarantees.md#projection-rows-are-not-a-security-boundary)

## Rekey

The operation of advancing key material to a new epoch. Container rekeys rotate
container KEKs; document or blob rekeys advance content-key material for later
writes.

Related docs:

- [keying-design.md](./keying-design.md#additive-versus-subtractive-changes)
- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md#rekey--rebaseline-model)

## Rewrap

An additive-access operation that keeps the same plaintext content key but
adds or updates wrapped key material for a changed target set. Rewrap does not
by itself require re-encrypting document content.

Related docs:

- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md#rewrap-reuses-the-active-dek)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#protocol-shape)

## Rotate

A subtractive-access operation that stops using prior plaintext key material
for future writes. For documents, rotate means later writes use a fresh DEK and
normally begin from a fresh encrypted baseline.

Related docs:

- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md#rotate-means-fresh-baseline-for-later-writes)
- [keying-design.md](./keying-design.md#additive-versus-subtractive-changes)

## Root Container

The top container for an organization. It has no parent container and anchors
the container hierarchy used for path-based access resolution.

Related docs:

- [container-dek-onboarding.md](./container-dek-onboarding.md#containers)
- [constraints.md](./constraints.md)

## Signed Write Header

A signed commitment that binds an encrypted document update or blob record to
the object id, access manifest hash, content-key epoch, target hash, metadata
hash, ciphertext hash, nonce domain, writer identity, and encryption suite.

Related docs:

- [protocol-specification.md](./protocol-specification.md#common-cryptographic-objects)
- [keying-design.md](./keying-design.md#content-write-authorization)

## Target Hash

The digest of the sorted derived key target set for a document, blob, or
manifest state. A submitted content-key bundle or write header must match the
expected target hash before it is accepted.

Related docs:

- [protocol-specification.md](./protocol-specification.md#document-link-and-sync-protocol)
- [keying-design.md](./keying-design.md#document-content-keys)

## Version Vector

Visible causal metadata for Loro sync. Clients submit their local frontier, and
the server uses stored update spans to return encrypted updates not covered by
that frontier.

Related docs:

- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md#protocol-shape)

## Writer Projection

A server response that packages the current verified access and key-target
material needed for a client to prepare future writes. Writer projections
require stronger authorization than simple reads because they expose wrapped
key material for writing.

Related docs:

- [access-plane.md](./access-plane.md#containers)
- [api-architecture.md](./api-architecture.md#http-protocol-surface)
