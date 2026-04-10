# Known Issues

This file tracks implementation bugs, schema mismatches, and unresolved design
questions that are already visible in the current docs and code.

For the current access-plane model, see
[access-plane-v1.md](./access-plane-v1.md).

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
real. Additive document epoch rewrap now preserves pending Loro updates instead
of replacing them with a full baseline. Rotate handling now has source-frontier
validation, canonical bundle adoption, and explicit sync response
classification for prior/current missing updates. Note clients now probe
document sync before committing pending local attachment drafts for existing
remote documents, so completed rotates are discovered before attachment
`commit-change`. Already-committed note attachments now queue same-slot blob
replacement after subtractive rotates when local bytes are available, or block
raw rotate-baseline sync and ask the user to replace the file when they are not.
V1 attachment/blob retention is explicitly live-only: detached blobs are pruned
once their final active binding is retired. Durable historical attachment/audit
retention is not a #105 V1 requirement; if the product needs it later, it
should be designed as a separate audit/history layer. The remaining gaps are
longer-term generic document-management UI beyond the current note-specific
explorer flows and envelope storage cleanup.

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

- keep generic multi-container document-management UI separate from the
  note-specific explorer flow; the app explorer already supports note
  move/link/unlink, linked note projections under each linked container, and
  active local projection switching
- keep durable attachment/blob history separate from V1 live retention if
  product audit requirements need it; see
  [attachment-retention-v1.md](./attachment-retention-v1.md)
- longer-term rekey/bootstrap and tamper-evident document-history design notes
  live in [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md)
