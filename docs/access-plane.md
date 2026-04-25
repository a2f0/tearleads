# Access Plane

## Summary

The access plane is application-owned.

The initial access plane focuses on explicit, durable metadata we control:

- users
- organizations
- groups
- memberships
- object grants
- access epochs
- access fingerprints
- recipient envelopes

## Principles

### 1. Access Is Metadata We Sync And Index

The access plane is part of the product protocol, not an afterthought bolted
onto a storage layer.

We need server-visible metadata for:

- who can currently read or write an object
- what recipient set a ciphertext was encrypted for
- what `accessEpoch` a write targeted
- whether a staged blob attach is still valid

### 2. Revocation Is Forward-Looking

Removing a user from a group does not revoke bytes or keys they already have.

Revocation must therefore be modeled as:

- future writes use a new `accessEpoch`
- future ciphertext uses new recipient envelopes
- old ciphertext remains readable to prior recipients unless re-encrypted

### 3. Access Fingerprints Should Be Derived State

The access graph is the source of truth.

An `accessFingerprint` should be derived from the current effective access
closure for an object, not treated as the only authoritative record of access.

That makes it useful as:

- a cache key for the current wrapped-DEK bundle
- a fast stale-check for future writes
- a compact summary of whether the recipient set has changed

The fingerprint should roll up changes such as:

- direct grant changes
- group membership changes
- organization membership changes
- account deactivation
- recipient key changes that affect wrapping

### 4. Permissions And Keys Must Be Related But Distinct

The access graph answers who should have access.

Recipient envelopes answer how a particular ciphertext can be decrypted.

Those concepts must line up, but they should not be collapsed into one table or
one API.

### 5. Fingerprints Are Not Proofs By Themselves

An `accessFingerprint` is only as trustworthy as the inputs used to derive it.

If grants, group membership, and organization membership live only as mutable
API/database state, then a client cannot use the fingerprint alone to prove
that the current recipient set is legitimate.

That matters for the threat model where a bad API change adds an unauthorized
user to a group. In that case:

- the derived fingerprint will change
- the epoch can advance correctly
- the server can still present a self-consistent but unauthorized recipient set

So in zero-trust mode, the fingerprint must be derived from policy inputs that
are independently verifiable by the client, not just returned by the API.

## Data Model

### Principals

- `users`
- `organizations`
- `groups`
- `containers`
- `documents`
- `blobs`

This model treats containers, documents, and blobs as first-class protected objects.

- containers are the primary access roots
- documents derive access from linked containers
- blobs derive access from linked documents

### Membership

- `principal_states`
  - signed group/organization policy headers
  - chained by `prevStateHash`
  - keyed by the computed `stateHash`
- `principal_state_payloads`
  - encrypted canonical membership payloads keyed by `stateHash`
- `principal_membership_projection`
  - server-visible projection rows keyed by `stateHash`
  - derived cache, not authority

Start with direct `group -> user` and `organization -> user` membership inside
signed principal state. Mutable `organization_members` / `group_members` rows
are not part of the access authority model.

Nested groups are compatible with this model but can be deferred. If added,
they are expanded transitively from current projection rows before computing
effective recipients, referenced principal states, or access-state hashes.

### Object Grants

Use direct grants on containers first.

For example:

- `object_access_grants`
  - `object_type`
  - `object_id`
  - `subject_type`
  - `subject_id`
  - `access_level`

`subject_type` can start as:

- `user`
- `group`
- `organization`

Rule:

- containers own direct ACL grants
- child containers inherit parent grants automatically
- child containers may add more grants
- inherited access is additive only
- deny rules or narrowing inherited access are out of scope

That means a deep folder can be shared directly, and its descendants inherit
that access automatically.

### Structural Links

This model needs explicit visible link metadata for derived principals:

- `document_container_links`
  - `document_id`
  - `container_id`
- `attachment_bindings`
  - `document_id`
  - `slot_id`
  - `blob_id`
  - `detached_at`
  - detached rows are transient metadata and may be pruned once the referenced
    blob is garbage-collected

These links are not cosmetic only. They are security-relevant metadata because
they affect the effective recipient set of documents and blobs.

### Access Epochs

Every protected object should have a current epoch.

- `object_access_epochs`
  - `object_type`
  - `object_id`
  - `epoch`
  - `access_fingerprint`
  - `updated_at`

Any change that affects future recipient sets should advance the epoch.

Examples:

- direct container grant added or removed
- container re-parenting that changes inherited access
- document linked to or unlinked from a container
- blob attached to or detached from a document
- group membership change affecting access
- organization membership change affecting access
- account deactivation affecting access
- recipient key change affecting future wrapping

The current epoch and current `accessFingerprint` together represent the active
authorization state for future writes.

### Access Fingerprints

An `accessFingerprint` is a canonical hash of the current effective access
closure for one object.

At minimum it should be derived from:

- effective active users
- contributing groups and organizations
- upstream linked object identities and/or fingerprints
- recipient key fingerprints or equivalent key identity

This gives the server one compact validation point for deciding whether the
current wrapped-DEK bundle is still valid.

The fingerprint is not a substitute for grants, memberships, or envelopes. It
is derived state that helps detect when those underlying inputs have changed.

## Principal Derivation Model

### Containers

Container access is inherited downward through the folder tree.

For one container:

- effective grants = union of grants on the ancestor path from root to that
  container
- effective recipients = expanded users reachable from those grants through
  organization and group membership
- `accessFingerprint` = canonical hash of the ancestor path, resolved grant
  inputs, and recipient key identities

This makes sharing a parent container automatically share descendants, while a
direct share on a deep child expands only that subtree.

### Documents

Documents do not own direct ACL grants.

Instead:

- a document links to one or more containers
- the document's effective principal is the union of the linked container
  principals
- the document's `accessFingerprint` should include:
  - linked container ids
  - linked container fingerprints
  - effective recipient key identities

This gives "drag document into folder to share it there" semantics. Linking a
document into another container is therefore a security mutation, not only a
navigation mutation.

### Blobs

Blobs derive access from the documents that currently reference them.

Instead:

- a blob is reachable through one or more active `attachment_bindings`
- each active binding contributes one document edge
- the blob's effective principal is the union of the linked document
  principals
- detached bindings are not durable history; once no active binding keeps the
  blob reachable, blob GC may also remove those detached rows
- the blob's `accessFingerprint` should include:
  - linked document ids
  - linked document fingerprints
  - effective recipient key identities

This lets one blob be attached to multiple documents without inventing a
standalone blob ACL.

## Wrapped Key Material

Recipient envelopes should persist the wrapped key bundle for the current epoch
of each encrypted object.

Key hierarchy:

- containers have wrapped key bundles for container-level crypto state
- documents have wrapped key bundles for document DEKs
- blobs have wrapped key bundles for blob DEKs

Implemented behavior:

- containers persist real wrapped key material
- documents persist real wrapped key material for the current access epoch once
  a client supplies or initializes the current document-DEK bundle
- blobs persist real wrapped key material when the committed blob ciphertext is
  a valid blob envelope for the current effective recipient set
- blob envelopes delimit header metadata from ciphertext bytes so blob recipient
  inspection does not require parsing the full ciphertext payload as JSON
- committed note attachments update current-epoch blob recipient wraps
  in place, and `GET /blobs/:blobId` serves the current wrapped-recipient
  header from sidecar envelope rows so additive access growth does not require
  a new blob row
- encrypted Loro updates use the current epoch's document DEK plus an
  inline `accessEpoch`, not a per-update recipient bundle
- newly created documents may still have no persisted bundle until the client
  seeds one during initial metadata creation or the first document write of the
  epoch
- container listings, container document listings, and Loro create/sync
  responses surface `referencedPrincipals[]` summaries for the current
  signed group/org policy states that contributed to derived access
- app clients can fetch, verify, and cache the current principal policy
  bundle for those references when a trusted policy signer set is configured
  out of band
- document and blob wrapped-key paths consume that cache at runtime so a
  client can unwrap a group/org-addressed object bundle through the current
  principal member-envelope chain
- current object recipient material requires current signed policy state
  for managed grants; group/org-addressed grants without that state fail
  closed instead of falling back to expanded user recipient material

Distinction:

- grants and memberships answer who should have access
- recipient envelopes answer how the current epoch's DEK is distributed

## Structural Mutations

The following operations are security-relevant because they can change derived
principals:

- share or unshare container
- move or re-parent container
- link or unlink document from container
- attach or detach blob from document

That is acceptable. It simply means the access plane must recompute affected
objects and bump epochs when fingerprints change.

## Recompute Scope

When one object's effective principal changes, derived objects downstream of it
must be recomputed.

Examples:

- container change
  - recompute that container
  - recompute descendant containers
  - recompute documents linked to any affected container
  - recompute blobs attached to any affected document
- document link change
  - recompute that document
  - recompute blobs attached to that document
- blob attachment change
  - recompute that blob

## Rewrap And Rotation Rules

For containers, documents, and blobs, use the same rule:

- if the effective recipient set grows only, reuse the current DEK and re-wrap
  it for the new epoch
- if the effective recipient set shrinks or is otherwise invalidated, rotate to
  a new DEK for future writes

Any fingerprint change should bump `accessEpoch`, even if the final recipient
set happens to be unchanged, because upstream security-relevant structure may
have changed.

The sync path exposes that server-side decision through
`documentRecipientEnvelopeAction` on `POST /documents/:documentId/sync`:

- `none`
- `rewrap`
- `rotate`

The same response also exposes rotate/adoption sync state explicitly:

- every returned document update includes its stored `accessEpoch`
- `missingUpdateEpochs[]` summarizes whether the response contains
  `prior_epoch` updates, `current_epoch` updates, or both
- `canonicalDocumentRecipientEnvelopesAdopted` is true when the server rejected
  divergent same-epoch bundle material, returned the canonical current bundle,
  and left outgoing updates unaccepted for retry

Clients use `rewrap` to seed a missing current-epoch document bundle, preserve
local pending Loro updates, and retry those updates under the new epoch with
the same document DEK. When the server returns `rotate`, clients clear stale
current-epoch bundles and resend a fresh baseline under a new DEK instead of
trying to reuse the prior epoch's bundle. Committed blob bindings follow the
same keep/rewrap/rotate rule: additive recipient growth can update wrapped-key
header material in place, but recipient shrink now requires a later blob
replacement instead of header-only reuse.

For pending local note attachment drafts on an existing remote document, clients
probe document sync with no outgoing updates before calling `commit-change`.
This discovers completed rotates or canonical bundle adoption without uploading
attachment metadata through raw document sync ahead of the server-visible
attachment binding commit. If the probe discovers a rotate, the later
attachment baseline commit carries the rotate baseline source frontier so the
server can validate it against the prior-epoch document frontier.

For already-committed note attachments after a subtractive rotate, clients do
not attempt header-only blob rewrap. If local plaintext bytes are available, the
client queues a same-slot attachment replacement through `commit-change` and
sends the rotate baseline in the same atomic mutation. If bytes cannot be
hydrated locally, the note UI marks the affected attachment as requiring a
replacement file and raw document sync waits so the current-epoch baseline does
not get uploaded ahead of the server-visible replacement binding.

## Implementation Plan

The implementation should build on the existing generic object-access tables
rather than creating a parallel model.

Keep:

- `object_access_grants`
- `object_access_epochs`
- `object_recipient_envelopes`

`object_recipient_envelopes` is a strict wrapped-DEK bundle table. Every row
represents actual envelope material for one recipient key in one object epoch;
identity-only rows are not valid.

Add:

- `object_access_epochs.access_fingerprint`
- `document_container_links`
- `blob_stages`
- `attachment_bindings`

Resolver modules:

- `containerAccess.ts`
  - resolves inherited container access from the ancestor path
- `documentAccess.ts`
  - resolves document access from linked containers
- `blobAccess.ts`
  - resolves blob access from active attachment bindings and linked documents

Mutation entry points:

- `shareContainer`
- `unshareContainer`
- `moveContainer`
- `linkDocumentToContainer`
- `unlinkDocumentFromContainer`
- `POST /blobs/stage`
- `POST /documents/:documentId/commit-change`

Atomic document mutation payload:

- `accessEpoch`
- `expectedAccessStateHash`
- `attachmentCommits[]`
  - `slotId`
  - `stageId`
  - `expectedBindingId`
- `attachmentDetaches[]`
  - `slotId`
  - `expectedBindingId`
- optional `loroUpdate`
  - encrypted payload
  - visible partial version vectors
  - `referencedSlotIds[]`

Important invariant:

- the server must not accept a Loro update that references a slot without an
  active committed binding after the same atomic mutation is applied

Attachment/blob retention is live-only:

- `attachmentDetaches[]` and same-slot `attachmentCommits[]` retire the prior
  active binding for that document slot
- if no active binding references the retired blob after the atomic mutation,
  the server prunes the blob row, blob access epochs, blob recipient envelopes,
  and detached binding rows for that blob
- if another active binding still references the blob, the blob and its access
  material remain live until the final active binding is retired
- detached bindings are transient replacement metadata, not historical
  attachment/audit retention

For retention semantics, see
[attachment-retention.md](./attachment-retention.md). Durable old blob bytes,
attachment tombstones, signed manifests, and historical attachment replay
belong to a separate audit/history layer.

The initial scope should allow offline structural mutations such as move, link,
unlink, attach, and detach, with authoritative recomputation at sync time.

The API exposes structural mutation routes:

- `POST /documents`
- `POST /containers`
- `POST /containers/:containerId/share`
- `POST /containers/:containerId/move`
- `POST /documents/:documentId/link`
- `POST /documents/:documentId/unlink`

Each structural/access-sensitive write now carries access-state preconditions:

- `document create`: current linked container metadata access-state hash for
  each linked container, keyed by container id
- `container create`: current parent container metadata access-state hash
- `share`: current container metadata access-state hash
- `move`: current container metadata access-state hash
- `link` / `unlink`: current document access-state hash

These routes recompute the affected container subtree first, then
materialize downstream document epochs and active blob epochs so access and
bundle invalidation move with the structure instead of waiting for an unrelated
content mutation.

The app explorer uses `POST /containers` for child creation,
`POST /containers/:containerId/move` for container reparenting, and moves
documents between containers by calling
`POST /documents/:documentId/link` followed by
`POST /documents/:documentId/unlink` while updating the local
document/container projection from the authoritative mutation response. The
explorer detail view also exposes direct document `link` / `unlink`
management for already-linked documents, and it can locally switch which
linked container is treated as the active document projection without mutating
the authoritative link graph. The explorer sidebar now renders linked
document projections beneath each linked container for document kinds such as
notes and driver's licenses.

## Zero-Trust Extension For Membership Changes

This section answers the specific concern:

- what if the API changes a group so a bad user gets added?

In the current model, if the API is the only authority for group membership,
clients cannot distinguish:

- a legitimate group change
- an unauthorized server-side membership insertion

To make that verifiable, the trust root for group and ACL state must live
outside the ordinary API mutation path.

### Required Trust Boundary

At minimum, clients need one or both of:

- trusted group or organization admin public keys
- a dedicated policy-signing service whose signing key is isolated from the API

The API may store and distribute access metadata, but it must not be able to
invent authoritative membership state on its own.

### Signed Principal State

One workable shape is a signed snapshot for each group or organization version.

```ts
interface SignedPrincipalState {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: "projection_v1";
  membershipRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  signedAt: string;
  signerKeyId: string;
  signature: string;
}
```

Rules:

- `membershipRoot` identifies the encrypted canonical membership payload
- `projectionRoot` is the hash of the normalized server-visible projection
- `payloadCiphertextHash` binds the encrypted membership payload to the signed
  header
- `prevStateHash` forms a hash chain so rollback is detectable
- `encapsulationPublicKey` and `keyFingerprint` bind the current principal epoch
  key to the signed policy state
- `signature` must verify against a trusted admin or policy key

If the API adds `mallory` to a group without a valid signature from the
principal's authorized signer, clients reject the new principal state.

### Principal Epoch Keys

The signed snapshot should remain the trust root, but the API still needs an
indexed table for principal epoch keys so object-envelope lookup is efficient.

- `principal_epoch_keys`
  - `principal_type`
  - `principal_id`
  - `epoch`
  - `introduced_by_state_hash`
  - `encapsulation_public_key`
  - `key_fingerprint`

This is the public-key side of the principal-recipient model. The member-wrap
side for distributing principal keys to current members is separate work.

### Principal Member Envelopes

The API also needs a state-scoped table for distributing the current principal
epoch secret to the principal's direct members.

- `principal_member_envelopes`
  - `principal_type`
  - `principal_id`
  - `state_hash`
  - `epoch`
  - `member_principal_type`
  - `member_principal_id`
  - `member_key_fingerprint`
  - `kem_cipher_text`
  - `wrapped_key`

`state_hash` is required here, not just `epoch`, because additive membership
changes may keep the same principal epoch key while changing the direct member
set that needs fresh wrapped copies.

### Policy API Surface

The implementation exposes the principal-policy foundation through
authenticated API routes:

- `PUT /principals/:principalType/:principalId/state`
  Stores a signed current principal state after verifying its signature against
  a trusted policy signer configured outside the ordinary mutation path.
- `PUT /principals/:principalType/:principalId/member-envelopes`
  Stores the current direct-member wrapped copies of the principal epoch secret
  for the current signed state.
- `GET /principals/:principalType/:principalId/policy`
  Returns the current signed principal state plus the current state-scoped
  member envelopes.

This is no longer only policy-metadata plumbing. Container/document/blob
access resolution now uses current group/org principal keys when verified
signed policy state exists, and managed grants without that state now fail
closed instead of degrading to expanded user recipients.

### Signed Access Manifest

The server can still materialize a per-object access view, but clients should
verify it against the signed policy inputs.

```ts
interface SignedAccessManifest {
  objectType: string;
  objectId: string;
  accessEpoch: number;
  accessFingerprint: string;
  aclEntries: Array<{
    subjectType: "user" | "group" | "organization";
    subjectId: string;
    accessLevel: "read" | "write" | "admin";
  }>;
  referencedGroups: Array<{
    groupId: string;
    version: number;
    stateHash: string;
  }>;
  referencedOrganizations: Array<{
    organizationId: string;
    version: number;
    stateHash: string;
  }>;
  effectiveRecipients: Array<{
    principalType: "user" | "group" | "organization";
    principalId: string;
    recipientKeyFingerprint: string;
  }>;
  issuedAt: string;
  signerKeyId: string;
  signature: string;
}
```

The manifest signer should be a trusted policy signer, not the general-purpose
API process. A client should treat the manifest as invalid unless:

- the manifest signature verifies
- every referenced group or organization state is signed by a trusted authority
- each referenced state hash matches the signed group or organization snapshot
- the client can recompute the effective recipients and `accessFingerprint`

### Client Verification Flow

Before encrypting for a new write, the client should:

1. Fetch the latest `SignedAccessManifest` plus all referenced signed group or organization states.
2. Verify signatures on the manifest and all referenced policy states.
3. Check monotonicity:
   - `accessEpoch` did not go backwards
   - each `group.version` did not go backwards
   - each `prevStateHash` chain is consistent
4. Expand the ACL plus signed membership states locally into the effective recipient set.
5. Recompute `accessFingerprint` from that verified closure.
6. Encrypt only if the recomputed fingerprint matches the manifest fingerprint and the caller is still an authorized writer.

The client should include the manifest identity in writes:

- `accessEpoch`
- `accessFingerprint`
- optionally a `manifestHash` or manifest signature reference

The server should reject a write if the client targets anything other than the
current signed manifest.

### Why This Helps

With this extension, the API cannot unilaterally add a bad user to a group and
successfully trick honest clients into encrypting for them unless at least one
of these is also true:

- a trusted policy signing key is compromised
- clients accept unsigned or invalidly signed policy state
- clients fail to detect rollback or split-view responses

### Split-View And Rollback Protection

Signatures alone are not enough if the API can show different clients different
valid old states.

To fail closed, clients should remember the highest seen versions and hashes
for:

- object manifests
- group states
- organization states

Stronger deployments can additionally publish signed state hashes into an
append-only transparency log or auditable checkpoint stream.

That prevents the API from safely replaying an older signed group state that
excluded the newly added recipient from some clients and included them for
others.

### Practical Interpretation

So the secure interpretation is:

- `accessFingerprint` is a useful stale-check and cache key
- it is not an authorization proof by itself
- zero-trust verification of group membership requires signed, versioned policy
  state outside the API's unilateral control
- without that extra structure, the server remains the trust root for group
  membership

### Recipient Envelopes

Persist the effective recipient set used for a given encrypted object version.

- `object_recipient_envelopes`
  - `object_type`
  - `object_id`
  - `epoch`
  - `recipient_principal_type`
  - `recipient_principal_id`
  - `recipient_key_fingerprint`
  - `kem_cipher_text`
  - `wrapped_key`

`kem_cipher_text` and `wrapped_key` are required for every persisted container,
document, and blob recipient bundle. The recipient principal columns can still
be read without the wrapped material for rewrap/rotate classification, but the
stored row itself is never an identity-only placeholder.

The principal-recipient pivot now also has schema support for signed principal
snapshots and indexed principal epoch keys:

- `principal_states`
- `principal_epoch_keys`

Those tables are foundational. They do not yet
drive effective-recipient expansion or object rewrap decisions.

For document rekey, rotate-baseline generation, and tamper-evident document
history considerations, see [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md).

For notes and attachments, this is what lets the server remain plaintext-blind
while still coordinating future writes correctly.

Operationally, think in terms of envelope bundles:

- the current bundle is the set of recipient envelopes for the latest
  `accessEpoch`
- historical bundles are the sets of recipient envelopes for earlier epochs

This is important because the access plane must support both:

- future writes against the current authorization state
- previously accepted ciphertext that was wrapped for an older epoch

There should be one active bundle for the current object epoch, but there may
be multiple historical bundles retained for older ciphertext versions.

## Notes, Loro, And Access

For notes:

- Loro updates belong to the document plane
- access epochs and recipient envelopes belong to the access plane

A note write should carry enough metadata to say:

- which document it targets
- which `accessEpoch` it assumes
- which `expectedAccessStateHash` it targeted

If the access epoch is stale, the server should reject the write rather than
accepting ciphertext for an obsolete recipient set.

If the epoch matches but the expected access-state hash does not, the server
should also reject the write as targeting stale authorization state.

## Attachments, Blobs, And Access

Attachment commit should check the access plane before finalizing a bind between
a note and a staged blob.

The server should reject attachment commit if:

- the caller no longer has write access
- the `accessEpoch` is stale
- the staged blob is expired or missing

This is why access must be server-indexable and cannot live only inside
encrypted Loro diffs.

## Non-Goals

- Do not implement full Zanzibar-style relationship semantics.
- Do not solve retroactive revocation yet.
- Do not add branching-aware access semantics yet.
- Do not require external authorization service parity before shipping basic local-first sync.

## Initial Implementation Slice

1. Add explicit access-plane schema tables owned by the app.
2. Add a small resolver that computes effective recipients for one object.
3. Derive a current `accessFingerprint` from that resolver output.
4. Use the epoch plus fingerprint check in notes writes before encrypted update append.
5. Persist recipient envelopes by epoch so the latest bundle is active and older bundles remain available for historical ciphertext.
