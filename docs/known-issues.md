# Known Issues

This file tracks implementation bugs, schema mismatches, and unresolved design
questions that are already visible in the current docs and code.

For the current access-plane model, see
[access-plane-v1.md](./access-plane-v1.md).

## Access Plane And Envelope Storage

### KI-004: `object_recipient_envelopes` wrapped material is now strict

Status: resolved in #174

The table now has one storage meaning for all encrypted object types:

- each row is a recipient bundle row for one object type, object id, epoch, and
  recipient key fingerprint
- `recipient_principal_type` and `recipient_principal_id` identify the effective
  recipient principal for access-plane comparisons
- `kem_cipher_text` and `wrapped_key` are required wrapped-DEK material, not
  optional sidecar fields

Identity-only rows are no longer valid. Runtime document and blob bundle writes
reject empty wrapped material, and the database schema requires both wrapped key
columns for container, document, and blob rows.

Remaining caveat:

- the same table still spans `container`, `document`, and `blob` objects, so
  future audit/history retention may still choose to split historical bundle
  storage from current access-plane bundle storage

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
should be designed as a separate audit/history layer. The remaining gap is
longer-term generic document-management UI beyond the current note-specific
explorer flows.

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
