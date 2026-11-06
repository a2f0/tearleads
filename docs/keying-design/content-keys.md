# Keying Design: Content Keys

Part of the [keying design](../keying-design.md).

## Document Content Keys

A document has one canonical
[content-key bundle](../glossary/keys.md#content-key-bundle) per document key epoch.

Document write targets are the current KEK epochs of every linked container:

```ts
type DocumentContentKeyTarget = {
 containerId: string;
 containerManifestHash: string;
 containerKeyEpochId: string;
 containerKeyEpoch: number;
};
```

For a content write, the client:

1. verifies the document manifest and linked container manifests;
2. verifies all referenced principal policies and identity keys;
3. derives the sorted target list;
4. computes `documentKeyTargetHash`;
5. verifies that the current canonical document content-key bundle commits to
 that exact [target hash](../glossary/keys.md#target-hash);
6. signs the encrypted write header over object id, document epoch, manifest
 hash, target hash, update metadata, and ciphertext hash.

The API rejects writes when submitted targets do not exactly match current
verified targets. Readers verify the signed write header before trusting target
metadata.

Write authorization requires one linked write path. Reusing a current
content-key bundle needs its document key, not every linked container's KEK.
Each write still commits to all targets so every linked reader observes the
same document state.

This is not an independent-progress guarantee across rotations. Creating or
rotating the bundle requires wraps for every current target KEK, and the
symmetric content-key wrap needs those target keys, so a writer with access to
only some links can wait for a member able to repair the other targets and
materialize the complete bundle. Even a readable target can require
another member's repair when its path is stale and the writer lacks write
access there. The SDK keeps the queued edit and reports
`document_ancestor_repair_inaccessible` when another verified linked path still
grants write access; losing all linked write access remains an authorization
refusal. A later sync can resume after repair.

This design retains the privacy boundary on inaccessible linked paths: it does
not disclose their current grants to enable public-key-only repair. Public
target wrapping or envelope contributions would need a separate authenticated
protocol; the write-liveness claim assumes neither.

### Content Write Authorization

A content write-header signature proves which device produced the ciphertext
metadata, but not by itself that the device was allowed to write the object.
Because any reader with the current content key can usually produce fresh
ciphertext under that key, write verification must treat write authorization as
part of the signed-header proof.

`verifyWriteHeader` must verify that:

- the signer identity/device key is trusted for the signed identity state
 referenced by the header;
- the header commits to the object id, organization id, object kind, content-key
 epoch, access manifest hash, key target hash, encryption suite, nonce or
 subkey derivation inputs, update metadata, and ciphertext hash;
- the committed access manifest and referenced principal policy heads verify;
- the signer had write access under the committed manifest state, not merely
 read access and not merely a mutable API-authenticated session;
- the committed key targets exactly match the verified graph for that manifest
 state.

Historical writes are verified against the manifest state they commit to, while
new writes must also satisfy the latest-state and local-checkpoint rules before
the API accepts them. For documents linked to multiple containers, write access
through at least one active linked container authorizes a document content
write, which is then encrypted to the full verified target set for all active
linked containers.

### AEAD Nonce And Subkey Discipline

Documents and blobs are multi-writer objects. Multiple devices may encrypt
different ciphertext records under the same content key epoch, including while
offline, so must not rely on local counters or implicit library defaults for
nonce uniqueness. Every encrypted content record needs a verifier-enforced
encryption domain:

1. assign a globally unique, high-entropy `contentRecordId` for each encrypted
 update, baseline, blob version, or replacement object, such as a UUIDv4 or
 another identifier with at least 128 bits of CSPRNG randomness;
2. derive a per-record AEAD key with domain-separated HKDF inputs that include
 protocol version, organization id, object kind, object id, content-key epoch,
 encryption suite, and `contentRecordId`;
3. generate a fresh 96-bit AES-GCM IV for every encryption attempt and commit
 it in the encrypted record bytes covered by the signed `ciphertextHash`;
4. include the derivation-domain fields as AEAD additional authenticated data;
5. commit those fields in the signed write header;
6. reject duplicate `contentRecordId` or duplicate derived nonce domains for the
 same object/content-key epoch.

For document updates, the header's signed `metadataHash` also commits a
domain-separated HMAC of the plaintext update bytes. Its key is derived by HKDF
from the document content key and record domain, so authorized readers can
verify it without exposing an offline plaintext-confirmation oracle to the
server. A content-key holder can also generate a commitment for arbitrary
plaintext, so this binds the record against server or storage substitution, not
against a malicious authorized reader. Readers authenticate the metadata,
decrypt the record, and reject a plaintext-hash mismatch before importing it
into [Loro](../loro-e2ee-sync-protocol.md). Retained history thereby keeps a
keyed identity for an authored plaintext while retaining its ciphertext,
provided the signed header, original content-record id and epoch, and
corresponding content key remain available. A full-history rotation snapshot's
commitment is not comparable to its constituent per-update commitments, so this
is weaker than per-update re-encryption with inner author signatures, which the
protocol does not implement.

The content-record suite is `aes-256-gcm-hkdf-sha256-record-key`. A content
writer supplies a UUIDv4 `contentRecordId`, commits the suite in the signed
write header, and commits a `nonceDomainHash` over the protocol version,
organization id, object kind, object id, content-key epoch, suite, and
`contentRecordId`. The content record domain is the input to per-record key
derivation, and the encrypted record carries a fresh random AES-GCM IV.
Storage enforces uniqueness for both `contentRecordId` and `nonceDomainHash`
within the same object/content-key epoch, while the random IV keeps accidental
same-domain re-encryption from reusing the same AEAD key/nonce pair before the
duplicate write reaches server storage. The invariant is fixed: honest
concurrent writers must be unable to reuse the same AEAD key/nonce pair for two
different plaintexts.

For additive changes, the document content key may be reused and wrapped to a
new target if the target set only grows. For shrink, subsequent writes require a
new document content-key epoch and a fresh baseline. Revocation remains
forward-only unless old ciphertext is re-encrypted.

### Content-Key And KEK Wrapping Suites

Content-key and KEK wraps do not use the content-record HKDF suite. Their
[suite identifiers](../cipher-suites.md) are:

- document content-key to container KEK:
  `tearleads.document.content-key-wrap.aes-256-gcm-container-kek`
- blob content-key to container KEK:
  `tearleads.blob.content-key-wrap.aes-256-gcm-container-kek`
- container KEK to user or managed-principal key:
  `tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm`
- container KEK to parent-container KEK:
  `tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm-parent-kek`
- successor container KEK to predecessor container KEK:
  `tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek`
- predecessor keyring sealed under the current container KEK:
  `tearleads.container-kek-keyring.aes-256-gcm-current-kek`

Document and blob content-key target envelopes carry `wrappingMetadata.suite`
and an AES-GCM IV; the AAD binds suite, object id, content-key epoch and
target. Container KEK wraps carry no suite field: `recipientKind` selects the
user/managed-principal ML-KEM wrap path or the parent-container ML-KEM wrap
path.

Every keyed container signs `containerKeyPublicKey` in its access event and
manifest key-target commitment. Grant and recitation events preserve it with
the KEK epoch. Creation, rekey, revoke, and move events bind the replacement
public key. The encoding is canonical base64, with the ML-KEM-1024 length and
coefficient checks from FIPS 203 section 7.2. Unkeyed states carry null for both
the KEK epoch and public key.

The parent wrapping key pair is derived from its 32-byte KEK using HKDF-SHA-256:
64 output bytes, UTF-8 salt
`tearleads.container-kek.parent-wrapping.ml-kem-1024.v1`, and UTF-8 container ID
as info. Those bytes seed ML-KEM-1024 key generation. Readers check the derived
public key against the signed current state; retained historical KEKs derive
the matching historical decapsulation keys. A child-only writer can wrap
a new child KEK to the verified parent public key without learning its secret.
The parent recipient fingerprint is the signed epoch-record hash. The child
epoch's parent pin must equal the parent epoch named by its signed creation
event's verified dependency citation, even when the pin names the current
parent. A self-consistent epoch record and wrap target cannot substitute
another parent epoch. A later grant or recitation cannot stand in for the first
signed manifest of that key epoch. Historical parent resolution is enabled only
for read/recovery; write verification still requires the current parent epoch.

All authors and readers use public parent wraps; there is no symmetric
parent-wrap path. Each parent KEM ciphertext is 1568 bytes, and each signed
public key is 1568 bytes before base64 encoding. Public keys add public
metadata, not access to ancestor keys.
Whole-path write-currency checks remain necessary: a stale intermediate key
can be known to a revoked ancestor holder, so descendants must not wrap future
keys to it. Public wrapping enables independent repair immediately below a
current parent; it does not reach further up.

A writer whose only grant sits below a stale intermediate therefore cannot
restore currency itself. A rekey is authorized over the root-to-target path, so
a grant further down never counts, and the writer is never given the
intermediate's key: besides being reachable by the revoked holder, it opens the
intermediate's other children, which that grant does not cover.

No device may wait on another device's write, so that state is never committed.
The invariant is that every proper ancestor of a directly granted container has
a current parent edge. A rekey, revoke, or move must carry, in its own
transaction, the rekeys of every descendant that sits above a directly granted
container; the API refuses it otherwise and names them. A self-revoker losing
write access on owed levels is refused with `container_descendant_rekeys_inaccessible`;
another authorized member must complete that revoke. Retained access inherits downward.
A container's first direct grant requires the chain above it to be current, and
the sharer repairs a lazily stale path first; those repairs need not be atomic,
since a repair never strands anyone. A container that already carries a grant
owes nothing more for a further one. Inline repairs inside document and blob
writes are checked against the same rule, though under it a stale container is
never above a granted one, so an honest inline repair cannot trip it. With
those levels current and within the carried-rekey bound, a grantee repairs its
own subtree independently. A document linked outside that subtree can still
wait on another member's repair, as described under content-key bundles above.

Containers with no grant beneath them still repair lazily, first writer wins,
which keeps a rotation's cost proportional to what is shared below it rather
than to the subtree. A child container carries no direct grant unless shared, so
the carried set is usually empty. It is capped at 64 per rotation; past the cap
the remainder repairs lazily rather than refuse a revocation, and a writer who
meets such a level parks under an explicit
`document_ancestor_repair_inaccessible` state until the dependent-path hint that
follows its repair; [limits.md](../limits.md#limits-that-trade-write-liveness)
records that trade. Group rematerialization is held to the same rule: a
rekey or revoke among a policy's containers carries what it owes in its batch,
parent-first under the rotation it rides; a level its rotations strand between
two of its containers is carried unnamed; and each entry cites the heads
earlier entries leave, grants included.
The [inaccessible-intermediate repair model](../../formal/container-keying/InaccessibleIntermediateRepair.md)
covers the rule and the alternatives it rejects.

## Blob Content Keys

Blob targets derive from the union of active signed attachment bindings.

For each active binding:

1. verify the attachment event signature;
2. verify the referenced document manifest;
3. derive the document's linked container KEK targets.

The blob content key is wrapped to the union of those container KEK targets.
A bind submits only its new binding's targets and target hash. The API holds the
blob row lock, checks that exact scope, carries every other stored binding's
envelopes byte for byte (including retained historical epochs), and recomputes
the merged stored hash. Read access to an existing blob never permits replacing
another binding's key material.

For fresh link-set attachment envelopes, the SDK indexes KEKs by the full
container, manifest, epoch identity, and epoch number derived from verified
current paths. Historical keyring keys can authenticate existing content but
cannot serve as fresh destinations chosen by unsigned target rows. Existing
authenticated envelopes for an inaccessible linked container remain reusable.

Document and blob content-key envelopes share one public format check: the
object-kind-specific AES-GCM suite, a canonical base64 12-byte IV, and a
canonical base64 48-byte wrapped 32-byte key plus authentication tag. The API
applies it to newly wrapped material, additionally requiring the wrapping
metadata to carry exactly `suite` and `iv`, and rejects a failing submission
before persistence. Clients apply the same check when reading a stored envelope,
minus that exact-key requirement, so an unrecognized metadata key can never make
a decryptable envelope unreadable. Every submitted envelope is held to the
strict submission shape, including retained wraps that link, unlink, bind,
[rewrap](../glossary/keys.md#rewrap), and sync writes resubmit verbatim; there
is no retained-envelope exemption. Stored projection reads remain available for
diagnostics, but malformed stored material cannot be resubmitted unchanged. When
a bundle submission is both malformed and stale, staleness usually wins: the
target hash and current-target checks run first, and only the target-set
comparison is ordered after the envelope shape check. A blob rewrap has no
preceding target-hash check — it recomputes the hash afterward — but its epoch
and coverage checks still run first.

A retired blob target that re-enters a bundle is the one case where what lands
is not what was submitted: the server discards the resubmitted wrap and writes
back the authentic stored one, because active key material cannot be replaced.

There are no legacy-suite or alternate-encoding paths. These checks validate
structure; only a recipient with the KEK can authenticate the ciphertext and
establish the recovered key. An authorized writer can still submit
well-shaped, undecryptable material.

Clients and the API reject blob writes or attachment commits that omit targets
for other active bindings.

Blob encrypted bytes and blob key packages are separate records. The encrypted
blob record carries the encrypted payload and its metadata: blob id, byte
length, content-key epoch, content record id, nonce-domain hash, metadata hash,
IV, suite, and ciphertext. The
[blob content-key bundle](../glossary/keys.md#blob-content-key-bundle) lives in
`blob_content_key_epochs` and `blob_content_key_targets`, and attachment
listing/bind responses return that bundle alongside server-visible binding
metadata.

Before promotion, the API hashes the [staged](../glossary/content.md#blob-stage)
object stream and validates it with the same binary-envelope parser SDK readers
use: magic, bounded canonical JSON header, exact fields, suite/version, chunk layout,
canonical 12-byte IV, and total encrypted length. The header buffer is bounded
by 64 KiB plus the fixed prefix, and validation shares the existing hashing
pass. The transaction also binds the parsed blob id, content-key epoch, record
id, metadata hash, and nonce domain to the signed write header. Rejection rolls
back promotion and binding. These checks reject malformed framing; an authorized
writer can still submit well-shaped ciphertext that fails authentication or
contains unwanted content.

This separation lets key packages change without restaging immutable blob
bytes. If active bindings grow, the same blob content key can be wrapped to the
expanded target set. If a container KEK rotates for an otherwise unchanged
active binding set, the blob content key can be rewrapped to the new current
container KEK targets. The latest stored bundle remains useful source material
when a retained authorized client can still unwrap one of its targets and
repair stale blob key packages.

Immutable blob bytes should keep one content-key epoch. A same-epoch rewrap is
metadata maintenance; changing the blob content-key epoch requires replacing or
re-encrypting the blob bytes so the encrypted record and write header remain
bound to the key epoch that can decrypt them.

If, after an access shrink, future use should not depend on the old blob key,
replace the blob or re-encrypt its content rather than silently rotating its
content-key epoch.

## Local-First Create Intents

Local-first creation queues local intents, not fake access hashes. The SDK's
durable outbox (`local_intents`) holds container creates, container moves, and
document placements, one intent per lane and subject,
[replayed in creation order](../client-sync-ordering.md#structural-phase). An
intent records its target, sync status, and, once a create is accepted, the
remote container id and metadata access-state hash.

Replay signs each access event against the latest verified remote manifests.
A child under a local-only parent waits until the parent's create is accepted:

1. submit parent create against the latest verified remote parent manifest;
2. receive authoritative parent manifest and KEK target state;
3. submit child create signed against that authoritative parent result.

Documents created in a pending folder likewise wait for the folder's create.
The API accepts only server manifest hashes as access preconditions.

If the remote parent changed while offline, the client verifies the new parent
manifest and re-signs the pending create against it.
