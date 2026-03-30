# Access Plane V1 Note

## Summary

We can remove SpiceDB and start with an application-owned access plane.

That is feasible because the current repo does not meaningfully depend on
SpiceDB for runtime authorization. The remaining footprint was a small adapter,
one test, one nullable `items.spicedb_zed_token` column, and README setup
instructions.

The initial access plane should focus on explicit, durable metadata we control:

- users
- organizations
- groups
- memberships
- object grants
- access epochs
- recipient envelopes

## Why Gut SpiceDB Now

SpiceDB is useful when the hard part is server-side relationship evaluation at
scale across a stable object graph.

That is not where this repo is yet. The harder problems here are:

- offline-first mutation flow
- E2EE recipient management
- attachment commit gating
- key epoch rotation
- sync-safe permission checkpoints

Those concerns already require app-specific protocol semantics. Keeping a mostly
unused external auth graph in the loop adds complexity without solving the
problems we actually have.

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

### 3. Permissions And Keys Must Be Related But Distinct

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
  - `updated_at`

Any change that affects future recipient sets should advance the epoch.

Examples:

- direct grant added or removed
- group membership change affecting access
- organization membership change affecting access

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

## Notes, Loro, And Access

For notes:

- Loro updates belong to the document plane
- access epochs and recipient envelopes belong to the access plane

A note write should carry enough metadata to say:

- which document it targets
- which `accessEpoch` it assumes
- which recipient set the update was encrypted for

If the access epoch is stale, the server should reject the write rather than
accepting ciphertext for an obsolete recipient set.

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
- Do not require SpiceDB parity before shipping basic local-first sync.

## Recommended First Implementation Slice

1. Remove the dead SpiceDB integration.
2. Add explicit access-plane schema tables owned by the app.
3. Add a small resolver that computes effective recipients for one object.
4. Use that resolver in notes writes before encrypted update append.
5. Add epoch mismatch rejection on note update append.

That gets us from "unused external auth dependency" to "real app-owned access
metadata" without overcommitting to a full graph engine too early.
