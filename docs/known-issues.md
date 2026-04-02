# Known Issues

This file tracks implementation bugs, schema mismatches, and unresolved design
questions that are already visible in the current docs and code.

## Registration And Onboarding

### KI-001: Duplicate registration leaks orphan organizations and containers

Status: open

The current `POST /auth/register` flow creates the organization and root
container before attempting the unique user insert. On duplicate fingerprint,
the route returns `409`, but the transaction still commits the earlier rows.

Impact:

- repeated registration attempts can accumulate orphan organizations
- repeated registration attempts can accumulate orphan root containers
- onboarding metrics and later cleanup become harder

Recommended fix:

- attempt the unique user insert before creating dependent rows, or
- throw to force a rollback when the user insert conflicts

### KI-002: Registration accepts unverified wrapped-DEK envelopes

Status: open

The server currently validates only the request shape, then persists
`wrappedDekEnvelope.keyFingerprint`, `kemCipherText`, and `wrappedKey` as
supplied by the client.

Impact:

- onboarding can succeed with undecryptable recipient-envelope data
- the persisted recipient envelope can claim a key fingerprint that does not
  match the submitted encapsulation public key
- malformed envelope material can survive until a later decrypt attempt

Recommended fix:

- verify that `wrappedDekEnvelope.keyFingerprint` matches the submitted
  encapsulation public key
- reject obviously invalid envelope sizes
- if stronger guarantees are needed, require a server-verifiable proof that the
  envelope was derived from the submitted recipient key

### KI-003: Client registration flow can race local persistence

Status: open

The client starts login immediately after registration while local SQLite
persistence of the root container and self-contact still runs in an unawaited
promise chain.

Impact:

- explorer initialization can observe zero containers and never refresh during
  that session
- local onboarding state may appear partially initialized even though the
  server registration succeeded

Recommended fix:

- await local persistence before completing the onboarding flow, or
- make explorer and contacts stores react to post-registration writes instead
  of assuming one-shot initialization

## Access Plane And Envelope Storage

### KI-004: `object_recipient_envelopes` mixes identity metadata with wrapped key material

Status: open

The current table serves two different roles:

- document access currently stores recipient identity metadata only
- container onboarding now stores actual wrapped-DEK material

This is why `kem_cipher_text` and `wrapped_key` are nullable in the current
schema even though container onboarding conceptually wants them present.

Impact:

- schema meaning is ambiguous
- a `NOT NULL` migration is not currently possible
- docs can drift because one feature assumes envelope material is mandatory and
  another assumes it is optional

Recommended fix:

- either split envelope identity rows from wrapped-key bundle rows, or
- define object-type-specific invariants explicitly:
  - containers require wrapped key material
  - documents may temporarily allow nulls until wrapped key persistence is
    implemented there too

### KI-005: Documentation says recipient-envelope key material is `NOT NULL`, implementation does not

Status: open

`docs/container-dek-onboarding.md` describes `kem_cipher_text` and
`wrapped_key` as `TEXT NOT NULL`, but the actual schema allows nulls.

Impact:

- readers get the wrong picture of current invariants
- future migrations may be designed from incorrect assumptions

Recommended fix:

- update the doc to reflect current behavior and explain why nullability exists
- only document `NOT NULL` once document and container envelope semantics are
  aligned

## Key Hierarchy And Sharing Model

### KI-006: Container DEK vs document/item/blob DEK boundary needs implementation

Status: open

The docs now converge on the following model:

- container DEKs are container-level crypto state
- document DEKs protect document payloads
- blob DEKs protect blob payloads
- document principals derive from linked containers
- blob principals derive from linked documents

The remaining gap is implementation, not high-level direction.

Why this matters:

- multi-container document links need a clear recipient-union rule
- multi-document blob links need a clear recipient-union rule
- structural mutations now participate in epoch and bundle invalidation

Current recommendation:

- keep container DEKs as container-level bundle-management state
- keep document and blob DEKs as payload-encryption keys
- derive document recipients from linked containers
- derive blob recipients from linked documents

### KI-007: Rewrap and rotation rules across hierarchy need implementation

Status: open

The docs now specify the intended rule:

- recipient set grows: re-wrap current DEK
- recipient set shrinks: rotate for future writes

The remaining work is implementing that rule consistently for containers,
documents, and blobs when structural links change.

Implementation questions:

- how eager recomputation should be for large subtrees
- how to materialize bundles during offline structural edits before sync
- whether rewrap/rotate happens immediately on mutation or lazily before next
  write
- how to sequence recomputation for container subtree -> documents -> blobs

Recommended next step:

- implement the resolver chain and mutation entry points described in
  `docs/access-plane-v1.md`
