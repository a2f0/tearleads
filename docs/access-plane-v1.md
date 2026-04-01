# Access Plane V1 Note

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

## Recommended V1 Data Model

### Principals

- `users`
- `organizations`
- `groups`

### Membership

- `organization_members`
  - `organization_id`
  - `user_id`
  - `role`
- `group_members`
  - `group_id`
  - `user_id`

V1 can start with direct `group -> user` and `organization -> user`
membership.

Nested groups are compatible with this model but can be deferred. If added,
they should be expanded transitively before computing effective recipients or
an `accessFingerprint`.

### Object Grants

Use direct grants on protected objects first.

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

- direct grant added or removed
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
- recipient key fingerprints or equivalent key identity

This gives the server one compact validation point for deciding whether the
current wrapped-DEK bundle is still valid.

The fingerprint is not a substitute for grants, memberships, or envelopes. It
is derived state that helps detect when those underlying inputs have changed.

## Zero-Trust Extension For Membership Changes

This section answers the specific concern:

- what if the API changes a group so a bad user gets added?

In the current V1 model, if the API is the only authority for group membership,
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

### Signed Group State

One workable shape is a signed snapshot for each group version.

```ts
interface SignedGroupState {
  groupId: string;
  version: number;
  prevStateHash: string | null;
  members: Array<
    | { principalType: "user"; principalId: string }
    | { principalType: "group"; principalId: string }
  >;
  membershipRoot: string;
  signedAt: string;
  signerKeyId: string;
  signature: string;
}
```

Rules:

- `members` must be canonically sorted before hashing or signing
- `membershipRoot` is the hash of the normalized member list
- `prevStateHash` forms a hash chain so rollback is detectable
- `signature` must verify against a trusted admin or policy key

If the API adds `mallory` to a group without a valid signature from the group's
authorized signer, clients reject the new group state.

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
    userId: string;
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
  - `recipient_user_id`
  - `recipient_key_fingerprint`
  - wrapped key material or reference to it

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
- which `accessFingerprint` or recipient-set identity it targeted

If the access epoch is stale, the server should reject the write rather than
accepting ciphertext for an obsolete recipient set.

If the epoch matches but the derived fingerprint does not, the server should
also reject the write as targeting a stale wrapped-key bundle.

## Attachments, Blobs, And Access

Attachment commit should check the access plane before finalizing a bind between
a note and a staged blob.

The server should reject attachment commit if:

- the caller no longer has write access
- the `accessEpoch` is stale
- the staged blob is expired or missing

This is why access must be server-indexable and cannot live only inside
encrypted Loro diffs.

## V1 Non-Goals

- Do not implement full Zanzibar-style relationship semantics.
- Do not solve retroactive revocation in v1.
- Do not add branching-aware access semantics yet.
- Do not require external authorization service parity before shipping basic local-first sync.

## Recommended First Implementation Slice

1. Add explicit access-plane schema tables owned by the app.
2. Add a small resolver that computes effective recipients for one object.
3. Derive a current `accessFingerprint` from that resolver output.
4. Use the epoch plus fingerprint check in notes writes before encrypted update append.
5. Persist recipient envelopes by epoch so the latest bundle is active and older bundles remain available for historical ciphertext.
