# Known Issues

This file tracks implementation bugs, schema mismatches, and unresolved design
questions that are already visible in the current docs and code.

## Access Plane And Envelope Storage

### KI-004: `object_recipient_envelopes` still has object-type-specific semantics

Status: partial

The current table no longer means the same thing for every object type:

- containers store actual wrapped-DEK material
- blobs now store actual wrapped-DEK material when the blob ciphertext carries a
  valid blob envelope
- documents do not yet store a stable per-document wrapped-DEK bundle because
  the current Loro sync model encrypts each update with a fresh per-update
  payload key

This is why `kem_cipher_text` and `wrapped_key` remain nullable in the current
schema even though some object types conceptually want them present.

Impact:

- schema meaning is still object-type-dependent
- a `NOT NULL` migration is not currently possible
- docs can drift unless the document-side limitation is kept explicit

Recommended fix:

- either split envelope identity rows from wrapped-key bundle rows, or
- keep the object-type-specific invariants explicit until the document DEK model
  exists:
  - containers require wrapped key material
  - blobs require wrapped key material when the stored blob ciphertext is a
    valid blob envelope
  - documents should not fabricate placeholder envelope rows until a stable
    document DEK / bundle model is implemented

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
protocol now exist in the API. Blob wrapped-key persistence is now real; the
remaining gap is document wrapped-key materialization and client integration,
not high-level direction.

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

- finish stable document wrapped-key materialization
- teach app clients to use `POST /blobs/stage` and
  `POST /documents/:documentId/commit-change`
- add document/container structural mutation routes and client flows

### KI-007: Rewrap and rotation rules across hierarchy are not fully implemented

Status: open

The docs now specify the intended rule:

- recipient set grows: re-wrap current DEK
- recipient set shrinks: rotate for future writes

The access-plane resolver chain exists, and attachment binding mutations now
recompute blob access state. Blob ciphertext commits now persist real wrapped
key rows when the payload already matches the current recipient set. The
remaining work is implementing the rewrap vs rotate decision consistently when
recipient sets expand or shrink.

Implementation questions:

- how eager recomputation should be for large subtrees
- how to materialize bundles during offline structural edits before sync
- whether rewrap/rotate happens immediately on mutation or lazily before next
  write
- how to sequence recomputation for container subtree -> documents -> blobs

Recommended next step:

- implement the resolver chain and mutation entry points described in
  `docs/access-plane-v1.md`
