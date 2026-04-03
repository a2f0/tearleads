# Known Issues

This file tracks implementation bugs, schema mismatches, and unresolved design
questions that are already visible in the current docs and code.

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

## Key Hierarchy And Sharing Model

### KI-006: Container DEK vs document/item/blob DEK boundary is only partially materialized

Status: partial

The docs now converge on the following model:

- container DEKs are container-level crypto state
- document DEKs protect document payloads
- blob DEKs protect blob payloads
- document principals derive from linked containers
- blob principals derive from linked documents

The principal-derivation model and the atomic attachment/document mutation
protocol now exist in the API. The remaining gap is full wrapped-key
materialization and client integration, not high-level direction.

Why this matters:

- multi-container document links need a clear recipient-union rule
- multi-document attachment bindings need a clear recipient-union rule
- structural mutations now participate in epoch and bundle invalidation

Current recommendation:

- keep container DEKs as container-level bundle-management state
- keep document and blob DEKs as payload-encryption keys
- derive document recipients from linked containers
- derive blob recipients from linked documents

Remaining implementation work:

- persist actual wrapped key material for document and blob envelope rows
- teach app clients to use `POST /blobs/stage` and
  `POST /documents/:documentId/commit-change`
- add document/container structural mutation routes and client flows

### KI-007: Rewrap and rotation rules across hierarchy are not fully implemented

Status: open

The docs now specify the intended rule:

- recipient set grows: re-wrap current DEK
- recipient set shrinks: rotate for future writes

The access-plane resolver chain exists, and attachment binding mutations now
recompute blob access state. The remaining work is implementing the rewrap vs
rotate decision consistently when recipient sets expand or shrink.

Implementation questions:

- how eager recomputation should be for large subtrees
- how to materialize bundles during offline structural edits before sync
- whether rewrap/rotate happens immediately on mutation or lazily before next
  write
- how to sequence recomputation for container subtree -> documents -> blobs

Recommended next step:

- implement the resolver chain and mutation entry points described in
  `docs/access-plane-v1.md`
