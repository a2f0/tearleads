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
