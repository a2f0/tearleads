# Glossary: Keys And Rotation

Part of the [glossary](../glossary.md).

## Blob Content-Key Bundle

The wrapped [blob content key](#content-key) plus the derived
[container KEK](#container-kek) target envelopes for the blob's active
[attachment bindings](./content.md#attachment-binding). The bundle is persisted
in blob content-key epoch and target rows, returned by attachment listing or bind
responses, and is not embedded in committed blob encrypted bytes.

Related docs:

- [keying-design.md](../keying-design/content-keys.md#blob-content-keys)
- [protocol-specification.md](../protocol-specification/blobs.md#blob-read-protocol)

## Container KEK

A container key-encryption key. Container KEKs deliver document and blob
[content keys](#content-key) to [authorized targets](#key-target) without
exposing plaintext content keys to the server. Each container has a current KEK
epoch, and child containers may inherit through parent KEK edges.

Related docs:

- [keying-design.md](../keying-design/container-keks.md#container-kek-hierarchy)
- [container-dek-onboarding.md](../container-dek-onboarding.md)

## Container KEK Keyring

The container's complete predecessor KEK history sealed under the current
epoch's KEK — the snapshot read path for history-inclusive access. One decrypt
yields every retained historical KEK; each entry is verified against its
material-committing epoch id, and the sealed length is an exact function of the
epoch number. Rewritten at every rotation by re-sealing the previous entries
plus the retiring key. Distinct from the [Local Keyring](#local-keyring), which
wraps a device's root key material.

Related docs:

- [keying-design.md](../keying-design/container-keks.md#container-key-epoch-database-row)

## Container KEK Predecessor Bridge

The write-once append-only log entry a rotation stores alongside the
[keyring](#container-kek-keyring): the retiring KEK encrypted under the new KEK,
hash-committed by the signed rotation event. Never rewritten by later rotations,
which makes the bridge log ground truth for rebuilding a damaged keyring via
`GET /containers/:id/kek-log`.

Related docs:

- [keying-design.md](../keying-design/container-keks.md#container-key-epoch-database-row)
- [security-guarantees.md](../security-guarantees/properties.md#content-confidentiality)

## Content Key

The symmetric key used to encrypt a
[document update stream](./content.md#loro-update) or
[blob record](./content.md#blob). It is wrapped to the current
[verified target set](#key-target) rather than stored in plaintext server-side.

Related docs:

- [keying-design.md](../keying-design/content-keys.md#document-content-keys)
- [keying-design.md](../keying-design/content-keys.md#blob-content-keys)

## Content-Key Bundle

The collection of wrapped [content-key material](#content-key) for one document
or blob content key epoch. A bundle must match the [target hash](#target-hash)
derived from verified access state before the API or app accepts it.

Related docs:

- [protocol-specification.md](../protocol-specification/container-access.md#document-link-and-sync-protocol)
- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#protocol-shape)

## DEK

Data-encryption key. In these docs, DEK usually means the plaintext symmetric
[content key](#content-key) for a document epoch or blob record. The server
stores ciphertext and wrapped keys, not plaintext DEKs.

Related docs:

- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md)
- [security-guarantees.md](../security-guarantees/overview.md#short-answer)

## Epoch

A monotonically increasing version for access state or key material. Epochs let
clients distinguish current state from historical state and reject stale,
conflicting, or unsafe key reuse.

Related docs:

- [keying-design.md](../keying-design/verification.md#transparency-and-checkpointing)
- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md)

## Key Target

One recipient target for wrapped key material: a user's encapsulation key, a
[group principal key](./principals.md#managed-principal), or a [container KEK](#container-kek).
The [target hash](#target-hash) commits to the sorted derived target set.

Related docs:

- [keying-design.md](../keying-design/content-keys.md#document-content-keys)
- [keying-design.md](../keying-design/content-keys.md#blob-content-keys)

## Local Keyring

The SDK helper that wraps one account-root secret with a host-provided wrapping
key keystore, persists a manifest through a host-provided manifest store, and
derives local SQLite, blob-store, identity-persistence, or custom-purpose keys
from that root.

Related docs:

- [developer/client-sdk.md](../developer/client-sdk/local-keyring.md#local-keyring)
- [security-guarantees.md](../security-guarantees/properties.md#local-at-rest-key-wrapping)

## Member Envelope

Encrypted key material that delivers a [managed principal's](./principals.md#managed-principal)
[active key epoch](#epoch) to one direct member. Member envelopes must match the
active direct membership projection and recipient key fingerprints.

Related docs:

- [protocol-specification.md](../protocol-specification/identity-and-policy.md#principal-policy-protocol)
- [security-guarantees.md](../security-guarantees/properties.md#member-envelope-binding)

## Rekey

Advancing key material to a [new epoch](#epoch). Container rekeys rotate
[container KEKs](#container-kek); document or blob rekeys advance
[content-key material](#content-key) for later writes.

Related docs:

- [keying-design.md](../keying-design/container-keks.md#additive-versus-subtractive-changes)
- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md#rekey--rebaseline-model)

## Rewrap

An additive-access operation that keeps the same
[plaintext content key](#content-key) but adds or updates wrapped key material
for a [changed target set](#key-target). Rewrap does not by itself require
re-encrypting document content.

Related docs:

- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md#rewrap-reuses-the-active-dek)
- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#protocol-shape)

## Rotate

A subtractive-access operation that stops using prior plaintext key material for
future writes. For documents, rotate means later writes use a [fresh DEK](#dek)
and normally begin from a fresh encrypted baseline.

Related docs:

- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md#rotate-means-fresh-baseline-for-later-writes)
- [keying-design.md](../keying-design/container-keks.md#additive-versus-subtractive-changes)

## Rotation Baseline

A signed full-history Loro snapshot that a [rotate](#rotate) writes under the
new epoch's [DEK](#dek), bridging old readable state to the new epoch. Its
update carries `checkpointKind` `"rotate_baseline"`, `checkpointPayloadKind`
`"full_history_snapshot"`, and a `sourceVersionVector`, all committed by its
[signed write header](./content.md#signed-write-header). An unlink must carry
one whose source [version vector](./content.md#version-vector) covers the
complete committed update frontier, unless the document has no committed
updates; a link must not carry one. The first valid writer for the new epoch
becomes the canonical baseline, and normal sync can then omit older ciphertext
its declared coverage dominates. That coverage is trusted, not verified, because
the server cannot open the snapshot.

Related docs:

- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md#rotate-means-fresh-baseline-for-later-writes)
- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md#declared-coverage-is-trusted-not-verified)
- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md#rotation-baselines-in-document_updates)
- [document-link-and-sync-protocol.md](../document-link-and-sync-protocol.md)

## Target Hash

The digest of the sorted derived [key target set](#key-target) for a document,
blob, or manifest state. A submitted [content-key bundle](#content-key-bundle)
or [write header](./content.md#signed-write-header) must match the expected
target hash before it is accepted.

Related docs:

- [protocol-specification.md](../protocol-specification/container-access.md#document-link-and-sync-protocol)
- [keying-design.md](../keying-design/content-keys.md#document-content-keys)
