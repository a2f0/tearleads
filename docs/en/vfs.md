# VFS (Virtual Filesystem)

Status: design in progress (tracked in GitHub issue #1220).

This document captures the current VFS design direction for Tearleads. The goal
is to support encrypted, multi-user sharing of domain objects (contacts, photos,
notes, files) with flexible hierarchy and strong key management.

## Goals

- Organize domain objects in a hierarchy (folders and nested structures)
- Share objects or subtrees across users
- Allow the same object to appear in multiple places
- Keep content encrypted end-to-end with explicit key wrapping

## Core Data Model

### `vfs_registry`

Identity table for all VFS-participating items.

- `id`: shared primary key for the object
- `object_type`: `folder`, `contact`, `photo`, `note`, etc.
- `owner_id`: owner user id
- `encrypted_session_key`: content encryption key (encrypted at rest)
- `public_hierarchical_key`: public key for subtree sharing
- `encrypted_private_hierarchical_key`: encrypted private hierarchical key

### Folder Metadata (Canonical)

Folder metadata is canonical on `vfs_registry` for `object_type = 'folder'`.
Runtime read/write paths use `vfs_registry.encrypted_name` and related metadata
columns (`icon`, `view_mode`, `default_sort`, `sort_direction`).

### `vfs_links`

Parent-child relationships between registry items.

- `parent_id`, `child_id`
- `wrapped_session_key`: child's session key wrapped with parent's hierarchical key
- `wrapped_hierarchical_key`: wrapped child hierarchical key (optional)
- `visible_children`: optional child filtering for partial share views

This supports a DAG-like layout where one object can be linked from multiple
parents.

### `user_keys`

Per-user key material.

- public encryption key (for receiving shares)
- public signing key
- encrypted private keys
- Argon2 salt for password-based derivation

### `vfs_acl_entries`

Canonical access grants for users, groups, and organizations.

- principal-scoped grants (`user`, `group`, `organization`)
- permission/access levels
- lifecycle metadata (`revoked_at`, provenance, timestamps)

## Registry Pattern

Domain tables share primary keys with `vfs_registry`.

Example:

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
  encrypted_data BYTEA NOT NULL
);
```

This keeps referential integrity strong and lets VFS operations treat domain
objects through one identity layer.

## Sharing and Traversal Model

For policy-compiled ACL precedence and deny-wins merge semantics, see
`docs/en/vfs-share-policy-precedence.md`.
For implementation details, limitations, and edge cases of the current compiler,
see `docs/en/vfs-share-policy-acl-compiler.md`.
For proposed improvements, see
`docs/en/vfs-share-policy-acl-compiler-enhancements.md`.
For rollout correctness/perf gates, see
`docs/en/vfs-share-policy-rollout-gates.md`.

### Opening a root

1. Read grants in `vfs_acl_entries`
2. Decrypt wrapped keys with user's private key
3. Render root items

### Traversing children

1. Query `vfs_links` for `parent_id`
2. Unwrap child keys using parent hierarchical key
3. Repeat recursively

### Sharing a subtree

1. Wrap root keys for recipient user
2. Insert grant in `vfs_acl_entries`
3. Recipient traverses subtree through wrapped link keys

### Multi-placement

The same object can be linked from multiple parents by adding more `vfs_links`
rows. Each link can have independent visibility constraints.

### Has-one parent (link_reassign)

Some object types require single-parent semantics — a child must belong to
exactly one container. For example, a health reading is assigned to one contact
at a time.

The `link_reassign` CRDT operation enforces this by atomically tombstoning all
existing parent links for a child before adding the new one. Two concurrent
reassign operations from different replicas converge deterministically to a
single parent via the CRDT tiebreaker chain.

This is opt-in per operation, not per object type. Callers use `link_reassign`
instead of `link_add` when single-parent enforcement is needed. See
`packages/vfs-sync/src/vfs/protocol/README.md` for merge semantics.

For container clock tracking, a `link_reassign` is scoped to the destination
parent container named by `parentId`. Parents that lose the child are not given
an additional container clock entry by the same operation.

## Encryption Direction

Current design direction:

- content encryption: `AES-256-GCM`
- password derivation: `Argon2id` + `HKDF`
- key sharing/wrapping: hybrid `ML-KEM-768 + X25519`
- signatures: `ML-DSA` (or `Ed25519` where required)

Design intent is defense-in-depth plus a path toward post-quantum resistance.

## ACL Operation Signing Format

ACL mutation signatures use Ed25519 over a deterministic byte string defined in
`packages/shared/src/crypto/aclOperationSigning.ts`.

- Version: prepend a single version byte, currently `0x01`
- Field order: `opId`, `opType`, `itemId`, `replicaId`, `writeId`,
  `occurredAt`, `principalType`, `principalId`, `accessLevel`
- Encoding: each field is UTF-8 with a 4-byte unsigned big-endian length prefix
- `writeId`: serialize as its base-10 string before UTF-8 encoding
- `acl_remove`: serialize `accessLevel` as the empty string
- Signature output: base64-encoded Ed25519 signature persisted as
  `operationSignature`

Equivalent wire format:

```text
0x01
|| u32be(len(opId)) || utf8(opId)
|| u32be(len(opType)) || utf8(opType)
|| u32be(len(itemId)) || utf8(itemId)
|| u32be(len(replicaId)) || utf8(replicaId)
|| u32be(len(decimal(writeId))) || utf8(decimal(writeId))
|| u32be(len(occurredAt)) || utf8(occurredAt)
|| u32be(len(principalType)) || utf8(principalType)
|| u32be(len(principalId)) || utf8(principalId)
|| u32be(len(accessLevel)) || utf8(accessLevel)
```

Any client or auditor that reproduces these bytes exactly and verifies the
signature against the actor's Ed25519 public signing key should reach the same
result as the canonical implementation.

## Example Hierarchy

```text
Folder "People"
  - Contact "John Doe"
    - Photo (avatar)
    - Note "Met at conference"

Folder "Work Contacts"
  - Contact "John Doe" (same object, different link)
```

Different links to the same child can expose different subsets of descendants.

## OPFS Notes

Binary payloads (photos/files) are expected to live in OPFS with item-level
encryption. The VFS registry stores metadata and wrapped keys; binary bytes stay
in client-managed storage.

## Implementation Phases

1. Core tables and key lifecycle primitives
2. Crypto plumbing (key generation, wrapping, unwrap flows)
3. VFS operations (link, share, unshare, traversal)
4. Domain integrations (contacts/photos/notes + encrypted fields)
5. Advanced features (`visible_children`, key rotation, expiration, recovery)

## Current Caveats

- This is an evolving design document, not a finalized spec.
- Parent/child type constraints are currently expected at application layer.
- Key rotation and recovery flows are planned but not finalized.
- Sync guardrail and restart/recovery suites are intentionally sharded across
  focused `sync-client-*.test.ts` files to keep invariants reviewable and avoid
  oversized test modules.
