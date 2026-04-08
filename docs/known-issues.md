# Known Issues

This file tracks implementation bugs, schema mismatches, and unresolved design
questions that are already visible in the current docs and code.

## Access Plane And Envelope Storage

### KI-004: `object_recipient_envelopes` still has sparse / object-type-specific semantics

Status: partial

The current table no longer means the same thing for every object type:

- containers store actual wrapped-DEK material
- documents now store actual wrapped-DEK material for the current epoch when a
  client seeds or updates the current document bundle
- blobs now store actual wrapped-DEK material when the blob ciphertext carries a
  valid blob envelope
- recipient identity rows are now principal-shaped in schema terms, even though
  the current runtime still mostly emits `user` principals

This is why `kem_cipher_text` and `wrapped_key` remain nullable in the current
schema even though some object types conceptually want them present.

Impact:

- schema meaning is still object-type-dependent
- a `NOT NULL` migration is not currently possible
- docs can drift unless the document-side limitation is kept explicit

Recommended fix:

- either split envelope identity rows from wrapped-key bundle rows, or
- keep the object-type-specific invariants explicit until the document DEK model
  fully settles:
  - containers require wrapped key material
  - blobs require wrapped key material when the stored blob ciphertext is a
    valid blob envelope
  - documents should only persist current-epoch wrapped key material when a
    real document bundle exists

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
protocol now exist in the API. Blob and document wrapped-key persistence are now
real; the remaining gap is epoch-to-epoch bundle management and rewrap /
rotation policy, not basic document-key materialization.

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

- finish the principal-recipient pivot beyond the current user-principal-only
  runtime behavior
- wire the new `principal_states` / `principal_epoch_keys` /
  `principal_member_envelopes` foundation into real principal recipient
  expansion and member key distribution
- implement additive rewrap / subtractive rotation for document epochs and
  remaining object paths under that principal-based model
- continue wiring structural mutation routes and client flows
- decide detached-binding retention / GC policy separately from blob GC

### KI-007: Rewrap and rotation rules across hierarchy are not fully implemented

Status: open

The docs now specify the intended rule:

- recipient set grows: re-wrap current DEK
- recipient set shrinks: rotate for future writes

The access-plane resolver chain exists, and attachment binding mutations now
recompute blob access state. Document and blob ciphertext commits now persist
real wrapped key rows for the current epoch. Notes/blob additive access growth
can now rewrap existing committed blob bindings in place without creating a new
blob row. Signed principal-state and principal member-envelope metadata now
have real API ingestion/read routes as policy inputs, and container/document
responses now expose `referencedPrincipals[]` summaries for the current signed
group/org states that contributed to access. Runtime object access resolution
still flattens crypto recipients to users, but app clients can now cache the
current signed principal policy bundle for referenced group/org states when a
trusted signer set is configured. The remaining work is implementing the
rewrap vs rotate decision consistently for document epochs and the remaining
hierarchy edges when recipient sets expand or shrink, using the new
principal-based recipient model rather than the old fully flattened per-user
model.

Implementation questions:

- how eager recomputation should be for large subtrees
- how to materialize bundles during offline structural edits before sync
- whether rewrap/rotate happens immediately on mutation or lazily before next
  write
- how to sequence recomputation for container subtree -> documents -> blobs

Recommended next step:

- build on the signed principal-state and principal epoch-key foundation before
  implementing more of the old per-user document-epoch rewrap path
