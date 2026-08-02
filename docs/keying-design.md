# Keying Design

This document describes the access and key-delivery model for:

- local-first nested container creation
- container KEK hierarchy for document/blob key delivery
- `docs/security-guarantees.md`, especially the gaps around unsigned object
 grants, rollback, split views, and first-contact identity keys

HTTP routes use the signed mutation surface summarized in
[api-architecture.md](./api-architecture.md#http-protocol-surface).

For shared protocol terminology, see [glossary.md](./glossary.md).

The signed access-event, access-manifest, container KEK, document
content-key, blob content-key, principal-policy, write-header, and local
checkpoint primitives define the executable keying boundary. Transparency
deployment, first-contact identity trust, complete verifier adoption at every
client encryption decision, and historical replay are separate deployment
boundaries.

## Design Properties

- Additive sharing avoids per-document and per-blob recipient fanout.
- Encryption targets are derived from verified signed access state, not from
 server-provided recipient lists.
- Access and key state are verified through shared protocol code rather than UI
 convention.
- Server-visible structure remains the input to access derivation.
- End-to-end encryption is preserved: the server stores ciphertext and wrapped
 keys, not plaintext content keys.
- Revocation is forward-looking unless content is re-encrypted.
- Local-first creation uses signed local intents rather than fake server access
 hashes.

## Boundaries

- The protocol does not retroactively revoke bytes or keys already
 distributed.
- The protocol does not hide container, document, or blob structure from the
 server.
- The protocol does not prevent denial of service, withholding, or delayed
 publication.
- First-contact identity trust requires a trust root outside mutable API rows.
- Public blockchain anchoring is optional and is not the primary authorization
 system.

## Core Design

Keying has four distinct planes:

1. Identity and principal policy.
2. Signed access manifests.
3. Container KEK key delivery.
4. Content-object encryption for documents and blobs.

The API can store and project these planes, but an honest client must be able to
verify the authority for each plane independently.

## Threat Model

Assume:

- client code is honest and runs the verifier;
- user/device signing keys and private encapsulation keys are uncompromised;
- cryptographic primitives hold;
- the API, database, object storage, cache, and read replicas may be malicious,
 stale, or inconsistent.

The server may still deny service, omit data, or delay publication. The keying
protocol is designed so those attacks become availability failures, not silent
confidentiality failures.

## Identity And Principal Policy

Principal policy uses the signed group/organization model and tightens two
rules.

First, any principal transition that removes a reader, demotes a role that can
read, removes a nested group, disables a member, or changes a member key in a
way that shrinks future access must advance the principal key epoch. Clients
and the API both reject shrinking policy transitions that reuse the old
principal key epoch.

Second, user identity keys need an authority outside mutable API rows. Keying
should support one of these trust roots:

- out-of-band key verification or invitation links that bind `userId` to an
 identity signing key fingerprint;
- organization-admin signed invitations that name the recipient identity key;
- an append-only identity transparency log with client checkpoint pinning;
- a combination of the above.

Without one of these, first-contact key substitution remains possible. No
object keying algorithm can fully fix that by itself.

Organization administration uses reserved groups: `Admins` authorizes admins,
and `Members` drives the roster. Registration nests `Admins` into `Members`.
The signed organization payload binds both IDs, and `Admins` contains only
direct `admin` users. Each signed principal state uses a null
`externalAuthority` for direct authorization or the exact Admins head for
external authorization. Historical citations match exact signed Admins states;
post-checkpoint child successors must cite its verified current head.
Display/read-model projections never provide keying inputs.

## Signed Access Manifests

Every security-relevant graph mutation is represented by a signed access event
and a derived access manifest.

Protected manifest scopes:

- organization;
- container;
- document link set;
- blob attachment/target set, derived from signed attachment binding events.

The API may store materialized projection rows, but projection rows are not
authority. A client verifies manifests and derives projections locally.

### Access Event Shape

Each mutation signs canonical bytes for an event like:

```ts
type AccessEvent = {
 version: 1;
 eventId: string;
 eventType:
 | "container.create"
 | "container.grant"
 | "container.revoke"
 | "container.rekey"
 | "container.move"
 | "document.link"
 | "document.unlink"
 | "attachment.bind"
 | "attachment.detach";
 objectKind: "container" | "document" | "blob";
 objectId: string;
 organizationId: string;
 previousManifestHash: string | null;
 dependencyManifestHashes: string[];
 bodyHash: string;
 signerUserId: string;
 signerDeviceId: string;
 signerKeyFingerprint: string;
 signedAt: string;
 signature: string;
};
```

The event body is type-specific. For example, `container.grant` includes the
subject principal, access level, current referenced principal policy head, and
the container manifest hash being advanced. `document.link` includes the
document manifest hash and target container manifest hash. `attachment.bind`
includes document id, slot id, blob id, expected binding id, and document
manifest hash. Attachment events use `objectKind: "blob"` when they advance
the blob target/binding manifest; the attachment-specific identity lives in the
event body, not in a separate fourth manifest kind.

### Manifest Shape

An access manifest is a canonical snapshot derived from events:

```ts
type ReferencedPrincipalHead = {
 principalType: "group" | "organization";
 principalId: string;
 version: number;
 keyEpoch: number;
 stateHash: string;
 keyFingerprint: string;
};

type AccessManifest = {
 version: 1;
 objectKind: "container" | "document" | "blob";
 objectId: string;
 organizationId: string;
 epoch: number;
 previousManifestHash: string | null;
 eventHash: string;
 structuralHash: string;
 grantRoot: string;
 referencedPrincipalHeads: ReferencedPrincipalHead[];
 keyTargetHash: string;
};

type AccessManifestHash = string;
```

`AccessManifestHash` is the digest of the canonical serialization of
`AccessManifest`. It is stored and referenced beside the manifest, not inside
the manifest payload being hashed.

Clients verify:

- event signatures;
- signer identity key authenticity;
- signer authorization against the previous manifest;
- referenced group/organization policy chains;
- cross-object dependencies, such as parent container, linked container, or
 active attachment binding heads;
- monotonic local checkpoint rules;
- optional transparency inclusion and consistency proofs.

This turns "the API returned a self-consistent grant view" into "the API
returned a verifiable signed state transition."

### Container Access Manifests

A container access manifest is the signed head for the container's direct
access and structural parent edge. It should not contain a full expanded
recipient list for every descendant document.

Container manifest inputs:

- container id and organization id;
- parent container id and parent manifest hash;
- authoritative metadata document id for the container;
- direct grants on this container;
- referenced principal policy heads for direct managed-principal grants;
- current container KEK epoch id;
- previous container manifest hash;
- authorizing signed event hash.

The effective access for a container is derived by walking ancestor container
manifest heads and unioning their direct grants. For runtime efficiency, the
server may materialize ancestor paths and effective grant summaries, but a
client can verify the path from signed manifest hashes.

Important scaling rule: sharing or revoking a container must not rewrite every
descendant container manifest. Descendants inherit through their parent edge and
their parent KEK wrap. A descendant manifest changes only when that descendant's
own direct grants, parent edge, or key epoch changes.

### Document Link-Set Manifests

A document link-set manifest is the signed head for the set of containers that
currently link to a document. It is not a per-container access manifest and it
does not expand users.

Document link-set inputs:

- document id and organization id;
- active linked container ids;
- dependency container manifest hashes used to authorize the link/unlink event;
- previous document link-set manifest hash;
- authorizing signed event hash.

`document.link` and `document.unlink` events advance only this link-set head.
They do not copy container grants into the document and they do not mutate
container manifests.

The document's write targets are derived at write time:

1. verify the document link-set manifest;
2. load and verify each active linked container's current manifest head;
3. resolve each linked container's current container KEK epoch;
4. sort and hash those KEK targets.

This means a container grant change does not cause writes to thousands of
document link-set manifests. Existing documents see the new container KEK state
when their next write target set is derived.

### Derived Document Access Views

A document access view is a deterministic projection:

```ts
type DocumentAccessView = {
 documentId: string;
 linkSetManifestHash: string;
 linkedContainerManifestHashes: string[];
 linkedContainerKeyEpochIds: string[];
 documentKeyTargetHash: string;
};
```

This view can be cached, indexed, and returned by the API, but it is not the
authority. Clients recompute and verify it from signed manifests before using
it to encrypt.

The same pattern applies to blobs. Blob access is a derived view from signed
active attachment binding events plus the linked documents' verified target
sets.

## Authorization Rules

Use these rules:

- `container.create`: signer must have write access to the parent container.
- `container.grant` / `container.revoke`: signer must have admin access to the
 container.
- `container.rekey`: signer must have current write access to the container and
 may only advance the KEK epoch for an already-authorized manifest. It cannot
 change grants, parentage, or linked objects.
- `container.move`: signer must have admin access to the moved container and
 write access to the destination parent; the event references both manifest
 heads.
- `document.link`: signer must have write access to the document through at
 least one current linked container and write access to the target container.
- `document.unlink`: signer must have write access to the document through at
 least one remaining linked container and write or admin access to the
 unlinked container.
- `attachment.bind` / `attachment.detach`: signer must have write access to the
 document under the current document manifest.

These rules treat link as additive and unlink as potentially subtractive. A
writer who can edit the document can already disclose its plaintext through
ordinary content edits, so requiring write access through every linked
container would add friction without preventing a meaningful confidentiality
attack. Unlink remains stricter because it can remove another container's
future access path.

## Container KEK Hierarchy

Each container has a current container KEK epoch.

Container KEKs are wrapped to:

- direct user identity/device encapsulation key epochs;
- group or organization principal key epochs;
- the parent container KEK epoch when inherited access should flow downward.

Documents and blobs do not wrap content keys directly to every effective user.
They wrap content keys to current container KEK targets.

### Why Parent KEK Edges Exist

If child containers always wrap their KEK to the parent container KEK, an
additive share on an ancestor can be one new wrap of the ancestor KEK. The new
recipient follows the existing KEK chain to descendant content. That is the
main fanout win.

The tradeoff is explicit: compromising an ancestor KEK compromises the subtree
that inherits from it. That matches inherited access semantics, but it must be
treated as the blast-radius boundary.

### Container Key Epoch Database Row

```ts
type ContainerKeyEpoch = {
 id: string;
 containerId: string;
 keyEpoch: number;
 accessManifestHash: string;
 parentContainerKeyEpochId: string | null;
 predecessorContainerKeyEpochId: string | null;
 predecessorBridgeVersion: number | null;
 predecessorBridgeSuite: string | null;
 predecessorBridgeIv: string | null;
 wrappedPredecessorKey: string | null;
 keyringIv: string | null;
 sealedKeyring: string | null;
 createdByEventHash: string;
 createdByManifestHash: string;
 createdAt: string;
};
```

Every epoch after the first stores two immutable rotation artifacts, both
committed by hash in the signed move, rekey, or revoke event so server-side
ciphertext substitution is detectable before decryption.

The **predecessor bridge** is the append-only log entry: the immediately
preceding KEK encrypted under the new KEK, binding the container id and both
committed epoch ids as AES-GCM additional data. It is written exactly once by
the rotator — the only party the protocol guarantees held both keys — and is
never rewritten by any later rotation. The bridge's wrapping suite and version
are persisted per row so a future suite rotation is representable.

The **sealed keyring** is the snapshot read path: the container's complete
predecessor key history — one fixed-width record per epoch, in ascending
order — AEAD-sealed under the new KEK. A client that unwraps the current KEK
opens the keyring in one decrypt and holds every retained historical KEK; no
chain walk occurs on the hot path. Entry ordinal `i` is key epoch `i + 1`, so
the sealed ciphertext length for key epoch `n` is an equality
(`8 + (n - 1) * 64 + 16` bytes), which the server enforces at write time on a
blob it cannot decrypt and clients enforce again after opening. Each recovered
entry is verified against its material-committing epoch id before use.

Initial epochs have every rotation-artifact field null; later epochs have all
of them populated (a database check constraint enforces the all-or-none
shape). The keyring is derived, rebuildable state; the bridge log is ground
truth.

Container KEK epochs use ids of the form
`tearleads.container-kek.v1.sha256:<hash>`, where the hash commits to the
container id, numeric KEK epoch, and plaintext 32-byte KEK material. The signed
container manifest commits to this id through `containerKeyEpochId`, so clients
that can unwrap the KEK reject a projection if the decrypted material does not
match the committed id. Non-prefixed ids are rejected because they do not carry
this material commitment.

### Container Key Wrap Row

```ts
type ContainerKeyWrap = {
 containerKeyEpochId: string;
 recipientKind: "user" | "group" | "organization" | "container";
 recipientId: string;
 recipientKeyEpochId: string;
 recipientKeyFingerprint: string;
 kemCipherText: string;
 wrappedKey: string;
 wrapManifestHash: string;
};
```

The `wrapManifestHash` binds the wrap to the manifest that justified it. A
client rejects wraps whose recipient key epoch, principal policy head, parent
container key epoch, or manifest hash does not match the verified graph.
The client also rejects wraps that decrypt to different KEK material than the
signed epoch id commits to.

## Additive Versus Subtractive Changes

Additive changes:

- advance the signed access manifest;
- keep the current container KEK epoch;
- add one or more wraps for the existing KEK;
- do not touch descendant document/blob content-key bundles.

Subtractive changes:

- advance the signed access manifest;
- create a new KEK epoch for the changed container;
- require a bridge from that new KEK to the immediate previous KEK;
- require a keyring holding every predecessor KEK sealed under the new KEK;
- require descendants whose future access depends on the changed ancestor KEK to
 move to a post-change KEK epoch before accepting future writes;
- do not rewrite old document/blob bytes unless a separate re-encryption job is
 requested.

Lazy descendant rekey is acceptable, but writes must fail closed. If a document
write targets a container whose current key epoch is still reachable through a
revoked ancestor key, a post-revocation descendant KEK epoch must be
materialized before the write is accepted.

That materialization is a key-maintenance transition, not an access-control
transition. A current writer may submit a signed `container.rekey` event when
the event only advances the KEK epoch for the already-verified manifest and
wraps the new KEK to the exact current targets. Admin rights are still required
for grant, revoke, and move events. The API can coordinate the transaction and
validate targets, but it cannot synthesize wrapped key material because it does
not know the plaintext KEK. For committed KEK epoch ids, a client that unwraps
server-supplied replacement material rejects it unless the material hashes back
to the id signed in the manifest.

Current access is history-inclusive. A newly admitted user receives only a
current recipient wrap, then opens the sealed keyring for every retained
historical KEK; old user/principal envelopes are never served. Revocation
remains forward-only because a user who possessed an old KEK may retain it,
but a current user does not depend on a retained device, an old principal key,
or a document rebaseline to read retained history. Fresh baselines remain a
sync optimization and content-key rotation mechanism, not a key-recovery or
liveness dependency.

This also exposes retained-history metadata to every current member even before
decryption: keyring size (and therefore rotation count), material-committing
epoch ids, access-manifest hashes, and parent epoch references. The design
accepts that metadata disclosure as part of history-inclusive access; only the
old plaintext KEKs and content remain sealed.

History delivery is O(1) in rotation count on the hot path: one sealed blob
whose length is fixed by the epoch number, opened with one decrypt, with
per-entry verification that is independent and parallelizable. Historical
epoch *records* ride the projection only when a descendant path entry pins an
older parent epoch, because a child's parent wrap binds to the parent epoch's
record hash; content-key envelopes address epochs by id alone and need no
records. Rotation pays the linear cost instead — the rotator opens the
previous keyring and re-seals it plus the retiring key under the new KEK —
which is one decrypt, one seal, and tens of bytes per retained epoch.

There is deliberately no depth cap and no truncation: the keyring for epoch
`n` must contain exactly `n - 1` entries, over- and under-length payloads are
rejected by the same equality, and a keyring that omits an epoch fails the
structural entry-count check. The `MAX_CONTAINER_KEY_EPOCH` write-time bound
(65536) is a runaway-rotation backstop sized to be unreachable by legitimate
use, enforced when a rotation is accepted — never against existing data — so
it can never make retained ciphertext unreadable.

A keyring that fails verification is a hard integrity failure for the affected
historical epochs, but it is cache poisoning, not data loss. The client
reports the failure when an operation needs one of those epochs, retains its
independently verified current KEK so corrupt history cannot brick
current-epoch reads, and can rebuild ground truth from the append-only bridge
log served by `GET /containers/:id/kek-log`: walking the write-once bridges
from the current KEK recovers every predecessor, each checked against its
material-committing epoch id. Repair is an ordinary `container.rekey` whose
keyring is sealed from the rebuilt entries; the poisoned artifact stays on
record, attributed to the signed event that committed it.

The bridge log has no repair story of its own — that is why it is never
rewritten. A bridge that fails to decrypt severs log-based recovery for the
epochs below it, but every epoch's recipient wraps are retained forever
(cross-epoch wraps are never deleted; this is a stated protocol invariant,
not an implementation accident). A member present at epoch `i` can therefore
recover `K_i` from their identity keys plus server state, written by the
epoch-`i` rotator and untouchable by any later writer, and re-anchor a repair
rekey from there. The only unrecoverable case is a sole-ever member destroying
their own history. `formal/container-keying/KeyringReachability.tla` model
checks this composition: the log alone recovers everything while bridges are
intact, severance damage is bounded to epochs below the broken link, an
honest current keyring implies full recoverability, and retained wraps
backstop a poisoned snapshot.

The server cannot prove that sealed rotation artifacts actually decrypt to the
keys their ids commit to. An authorized writer that deliberately signs
well-formed but undecryptable ciphertext can deny access to older history up
to the limits above. The supported clients round-trip both artifacts while
constructing mutations, but this is not an availability guarantee against a
malicious writer. Database backup only repairs later storage damage; it cannot
repair deliberately invalid ciphertext that was originally accepted.

A container move creates fresh successor KEK material as well as a new epoch
identity because the parent binding changes. It carries the same two rotation
artifacts as rekeys and revocations — the write-once bridge and the re-sealed
keyring — without an AES-GCM key-dependent self-wrap.

## Document Content Keys

A document has one canonical content-key bundle per document key epoch.

Document write targets are the current KEK epochs of every linked container:

```ts
type DocumentKekTarget = {
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
 that exact target hash;
6. signs the encrypted write header over object id, document epoch, manifest
 hash, target hash, update metadata, and ciphertext hash.

The API rejects writes when submitted targets do not exactly match current
verified targets. Readers verify the signed write header before trusting target
metadata.

Read/key access to every linked container is not required for ordinary content
writes. Verifying linked container manifests and deriving target ids uses signed
server-visible metadata, not plaintext container KEKs. A writer needs a valid
document content key from an authorized linked-container path and write
authorization through at least one active linked container. The write still
commits to the full target hash so all linked-container readers use the same
document state.

Creating or rotating a document content-key bundle is the separate operation
that must produce wraps for every current linked container KEK target. The
implementation may require the bundle materializer to have key access to all
target container KEKs, or it may support a protocol for per-target envelope
contribution. If the full target bundle cannot be materialized, the API should
return `rekey_required` or a bundle-materialization conflict instead of making
ordinary document writes require read access to every linked container.

### Content Write Authorization

A content write-header signature proves which device produced the ciphertext
metadata, but it does not by itself prove that the device was allowed to write
the object. Because any reader with the current content key can usually produce
fresh ciphertext under that key, write verification must treat write
authorization as part of the signed-header proof.

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
the API accepts them. For documents linked to multiple containers, the
authorization rule is that write access through at least one active linked
container authorizes a document content write, and that write is then encrypted
to the full verified target set for all active linked containers.

### AEAD Nonce And Subkey Discipline

Documents and blobs are multi-writer objects. Multiple devices may encrypt
different ciphertext records under the same content key epoch, including while
offline, so must not rely on local counters or implicit library defaults for
nonce uniqueness.

Every encrypted content record needs a verifier-enforced encryption domain. The
preferred rule is:

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
domain-separated HMAC of the plaintext update bytes. Its key is derived by
HKDF from the document content key and record domain, so authorized readers can
verify it without exposing an offline plaintext-confirmation oracle to the
server. A content-key holder can also generate a commitment for arbitrary
plaintext, so this binds the record against server or storage substitution, not
against a malicious authorized reader. Readers authenticate the metadata,
decrypt the record, and reject a plaintext-hash mismatch before importing it
into Loro. The audit chain thereby retains a keyed identity for an authored
plaintext while retaining its ciphertext, provided the signed header,
original content-record id and epoch, and corresponding content key remain
available. A full-history rotation snapshot's commitment is not comparable to
its constituent per-update commitments, so this does not replace the stronger
future design of per-update re-encryption with inner author signatures.

The initial suite is
`aes-256-gcm-hkdf-sha256-record-key`. A content writer supplies a UUIDv4
`contentRecordId`, commits the suite in the signed write header, and commits a
`nonceDomainHash` over the protocol version, organization id, object kind,
object id, content-key epoch, suite, and `contentRecordId`. The content record
domain is the input to per-record key derivation, and the encrypted record
carries a fresh random AES-GCM IV. Storage enforces uniqueness for both
`contentRecordId` and `nonceDomainHash` within the same object/content-key
epoch, while the random IV keeps accidental same-domain re-encryption from
reusing the same AEAD key/nonce pair before the duplicate write reaches server
storage. The invariant cannot vary: honest concurrent writers must be unable to
reuse the same AEAD key/nonce pair for two different plaintexts.

For additive changes, the document content key may be reused and wrapped to a
new target if the target set only grows. For shrink, subsequent writes require a
new document content-key epoch and a fresh baseline. Revocation remains
forward-only unless old ciphertext is re-encrypted.

### Content-Key And KEK Wrapping Suites

Content-key and KEK wraps do not use the content-record HKDF suite. The wrap
suite identifiers are:

- document content-key to container KEK:
  `tearleads.document.content-key-wrap.aes-256-gcm-container-kek`
- blob content-key to container KEK:
  `tearleads.blob.content-key-wrap.aes-256-gcm-container-kek`
- container KEK to user or managed-principal key:
  `tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm`
- container KEK to parent-container KEK:
  `tearleads.container-kek-wrap.aes-256-gcm-parent-kek`
- successor container KEK to predecessor container KEK:
  `tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek`

Document and blob content-key target envelopes carry `wrappingMetadata.suite`
and an AES-GCM IV. Container KEK wraps are an existing wire format without a
separate suite field: `recipientKind` selects the user/managed-principal
ML-KEM wrap path or the parent-container AES-GCM wrap path.

## Blob Content Keys

Blob targets derive from the union of active signed attachment bindings.

For each active binding:

1. verify the attachment event signature;
2. verify the referenced document manifest;
3. derive the document's linked container KEK targets.

The blob content key is wrapped to the union of those container KEK targets.
Clients and the API reject blob writes or attachment commits that omit targets
for other active bindings.

Blob encrypted bytes and blob key packages are separate records. The encrypted
blob record carries the encrypted payload and its metadata: blob id, byte
length, content-key epoch, content record id, nonce-domain hash, metadata hash,
IV, suite, and ciphertext. The blob content-key bundle lives in
`blob_content_key_epochs` and
`blob_content_key_targets`, and attachment listing/bind responses return that
bundle alongside server-visible binding metadata.

That separation lets key packages change without restaging immutable blob
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

If access shrink means future use should not depend on the old blob key, the
correct operation is blob replacement or content re-encryption, not silent
content-key epoch rotation.

## Local-First Create Intents

Local-first creation should use signed local intents, not fake access hashes.

Local schema should track:

- `local_intent_id`;
- intent type and canonical body;
- signer identity/device;
- local dependencies by remote manifest hash or local intent id;
- provisional encrypted payload;
- sync status;
- remote object id and remote manifest hash after acceptance.

A child under a local-only parent depends on the parent's local create intent.
Sync uploads intents topologically:

1. submit parent create against the latest verified remote parent manifest;
2. receive authoritative parent/child manifest and KEK target state;
3. re-encrypt or rewrap provisional child metadata if required;
4. submit child create using the authoritative parent result.

The API never accepts `local:` hashes as access preconditions. Local hashes are
client dependency markers only.

If the remote parent changed while offline, the client rebases the pending
intent by verifying the new parent manifest and re-signing or re-encrypting as
needed.

## Transparency And Checkpointing

Signed manifests prevent unauthorized mutation, but they do not alone prove
latest-state freshness. The protocol uses local monotonic checkpoints first,
with an optional transparency log for cross-client append-only proofs.

Minimum:

- clients durably pin each first-seen complete identity bundle;
- clients persist highest-seen principal policy version/hash per principal;
- clients persist highest-seen access manifest epoch/hash per object;
- clients refuse to move backwards without explicit recovery UX.

Production uses an exact Part B identity TOFU pin plus two checkpoints:

- `PrincipalPolicyCheckpoint`: `principalType`, `principalId`, `version`,
 `stateHash`.
- `AccessManifestCheckpoint`: `objectKind`, `organizationId`, `objectId`,
 `epoch`, `manifestHash`.

Verifier rules are fail-closed:

- lower version/epoch than the local checkpoint is rollback;
- same version/epoch with a different hash is equivocation;
- higher version/epoch is accepted only when the returned signed chain or
 predecessor proof extends the local checkpoint.

Stronger:

- append identity states, principal policy heads, and object manifest heads to
 an append-only Merkle log;
- return inclusion and consistency proofs with API responses;
- let clients gossip or compare signed tree heads across devices.

The transparency scaffold uses signed tree heads plus compact Merkle proofs.
Identity state heads, principal policy heads, and access manifest heads are
encoded as domain-separated transparency leaves. Inclusion proofs bind a leaf to
a signed tree head. Consistency proofs bind a newer signed tree head to a
previous pinned tree head. A first-contact client that has no pinned tree head,
gossip peer, or witness can still be shown a self-consistent split view.

Public blockchain anchoring is optional. It can timestamp an aggregate log root
and make server equivocation harder to hide, but it does not authorize object
grants, solve first-contact identity trust, or prevent withholding. If used,
anchor only aggregate tree roots, not object ids or metadata-bearing leaves.

## Client Verification API

All verification should live in a shared package used by both API tests and app
code.

Suggested entry points:

```ts
verifyIdentityStateCheckpoint(input): VerifiedIdentityState | VerificationError;
verifyPrincipalPolicyBundle(input): VerifiedPrincipalPolicy | VerificationError;
verifyAccessManifest(input): VerifiedAccessManifest | VerificationError;
verifyContainerKekState(input): VerifiedContainerKekState | VerificationError;
deriveDocumentKekTargets(input): DocumentKekTarget[] | VerificationError;
deriveBlobKekTargets(input): BlobKekTarget[] | VerificationError;
verifyWriteHeader(input): VerifiedWriteHeader | VerificationError;
verifyTransparencyProof(input): VerifiedTransparencyProof | VerificationError;
```

These functions should be deterministic and side-effect free. API routes may
use them for validation, but the security guarantee comes from app clients
running the same verification before encrypting or decrypting.

## Programmable Proof Obligations

Keying should treat verifier functions as the executable security
specification.
Each verifier returns a branded verified value, and later derivation functions
only accept those verified values. This keeps unverified API JSON from flowing
into encryption decisions by type accident.

Required proof obligations:

- The eventual Part C `VerifiedIdentityState` must prove that an identity state
 head is not older than the client's local checkpoint and bind that head to an
 accepted identity trust root.
- `VerifiedPrincipalPolicy` proves the group/org policy chain is signed,
 contiguous, projection-bound, payload-bound, and key-epoch-correct for any
 shrink transition.
- `VerifiedAccessManifest` proves the object graph transition was signed by a
 user/device authorized under the previous verified manifest.
- `VerifiedContainerKekState` proves each container KEK wrap is justified by
 the verified manifest, recipient key epoch, and parent KEK edge.
- `DocumentKekTarget[]` and `BlobKekTarget[]` prove the exact target set
 implied by the verified graph, not by an API-provided recipient list.
- `VerifiedWriteHeader` proves encrypted content metadata commits to the object
 id, manifest hash, content key epoch, target hash, ciphertext hash, and
 writer identity; that the signer had write access under the committed
 manifest state; and that the ciphertext used a unique, domain-separated
 encryption record id, nonce, or subkey for the object/content-key epoch.
- `VerifiedTransparencyProof` proves the response leaf is included in the
 signed tree head and, when a previous tree head is supplied, that the newer
 tree head extends the pinned checkpoint.

This creates two classes of guarantees:

- Impossible without key compromise or broken first-contact trust: forging a
 grant, adding a recipient target, swapping a recipient key, or authorizing a
 write target that was not signed by an authorized principal.
- Detectable under checkpoint/transparency assumptions: replaying an old valid
 state or showing split views to different clients.

Withholding data, refusing proofs, delaying publication, and returning no state
remain availability failures. Clients fail closed.

## API Attack Outcomes

| API behavior | outcome |
| --- | --- |
| Adds unauthorized object grant | Missing authorized signed access event; client refuses to encrypt. |
| Changes group/org projection rows | Signed policy projection/hash mismatch; fail closed. |
| Reuses principal key after membership shrink | Policy transition rejected by verifier. |
| Swaps recipient public key | Identity/principal key fingerprint mismatch; fail closed unless first-contact trust was never established. |
| Omits a linked container target | Derived target hash differs; write/read verification fails. |
| Drops blob targets for another active binding | Blob target derivation from signed bindings catches mismatch. |
| Replays older manifest | Local highest-seen checkpoint or transparency consistency proof rejects when client has seen newer state. |
| Shows split views | Detectable through transparency consistency/gossip/witnessing; otherwise still an availability/equivocation gap. |
| Withholds state or proofs | Availability failure; clients fail closed. |

## Storage State And Direction

Core server tables:

- `principal_states`
- `principal_state_payloads`
- `principal_membership_projection`
- `principal_epoch_keys`
- `principal_member_envelopes`
- `access_events`
- `access_manifests`
- `access_manifest_heads`
- `container_key_epochs`
- `container_key_wraps`
- `document_content_key_epochs`
- `document_content_key_targets`
- `document_content_write_headers`
- `blob_content_key_epochs`
- `blob_content_key_targets`
- `blob_content_write_headers`

Projection/cache tables include:

- `access_event_dependency_projection`
- `access_manifest_principal_head_projection`
- `access_manifest_document_link_projection`
- `document_container_links`
- `attachment_bindings`

Separate storage concerns:

- `identity_states` as a first-contact identity trust boundary
- transparency log leaves/checkpoints
- `client_checkpoint_receipts` or local-only checkpoint storage

Projection tables are caches. The verifier must be able to reject a projection
that does not match signed manifests.

## Scaling Model

The design relies on not propagating access changes into every descendant
document/blob row.

Expected costs:

| Operation | Expected write cost |
| --- | --- |
| Create container | `O(1)` plus parent manifest verification and one container KEK epoch. |
| Additive share on container | `O(new recipient key wraps)`; no document/blob rewrite. |
| Revoke on container | `O(remaining direct wrap targets for that container)` plus one new container KEK epoch; descendants rekey lazily before future writes. |
| Move container | `O(1)` manifest/key update for moved container, unless policy chooses eager descendant rekey. |
| Link document to container | `O(number of linked containers for that document)`, usually small. |
| Document write | `O(number of linked containers for that document)`, not `O(users)`. |
| Blob attach/write | `O(number of active document/container target domains for that blob)`, not `O(users)`. |

For tens of thousands of folders/documents and up to roughly 1000 users, this
is viable if these constraints hold:

- Most documents are linked to a small number of containers.
- Most blobs have a small number of active bindings.
- Container KEKs inherit through parent KEK edges so ancestor additive shares do
 not require descendant key rewrites.
- Group/organization grants target principal KEKs, not every user directly.
- The API maintains projection indexes for listing and search, but encryption
 decisions are made from verified manifests.

The scaling cliff to avoid is embedding expanded effective recipients or
descendant document references inside container manifests. A container manifest
should commit to direct grants and parent/key edges. It should not contain the
full subtree or all linked documents.

With 1000 users, direct user grants on a container are still acceptable for
small shares, but organization-wide sharing should go through the reserved
`Members` group or another group principal key. Otherwise an additive grant can
still be `O(1000)` key wraps, which is manageable occasionally but should not
be the default hot path.

The main residual cost is lazy rekey after revocation. A subtractive change on
a high-level container can force future writes in a large subtree to first
materialize post-revocation descendant KEK epochs. That work can be spread out
by background jobs or first-writer-wins lazy materialization. The security rule
is that future writes must not continue under a KEK chain reachable by the
revoked principal.

## Protocol Surface

The protocol covers:

1. Canonical encodings and shared verifier APIs for Keying objects.
2. Signed access event and manifest types for containers, document link sets,
 and attachment binding events.
3. Principal-policy state storage, admin-signer checks, member envelopes, and
 local checkpoint verifier primitives.
4. Container KEK epoch/wrap storage and target derivation.
5. Document create/sync with document KEK targets and signed write headers.
6. Signed document link/unlink manifests and multi-container target validation.
7. Blob attachment binding/detach with blob KEK targets and staged blob
 write headers.
8. Document audit entries, baseline checkpoints, attachment audit events, and
 audit-history verification for signed write paths.

Deployment boundaries:

1. Verifier outputs are required before encryption and decryption decisions;
 workflows that bypass them are outside the protocol guarantee.
2. Offline structural creation depends on signed local intents until the server
 accepts authoritative manifests and KEK targets.
3. Transparency log inclusion and consistency proofs are optional hardening
 around the core signed-state protocol.
4. First-contact identity trust depends on invitations, out-of-band
 verification, key transparency, or another external trust root.

## Required Invariants

- An honest client can derive document/blob key targets without trusting
 API-authored recipient lists.
- A forged object grant cannot make an honest client encrypt to a new
 recipient without an authorized signature.
- Additive share on an ancestor does not rewrite descendant document/blob
 content-key bundles.
- Subtractive change prevents future writes under KEK epochs reachable by the
 removed subject.
- Multi-linked documents require all linked container KEK targets.
- Blob writes and attachment commits cannot drop targets for other active
 signed bindings.
- A read-only recipient cannot produce a content write that passes
 `verifyWriteHeader`, even when they can decrypt the current content key.
- Concurrent/offline writers cannot reuse an AEAD key/nonce pair for two
 different content records under the same content-key epoch.
- Local child creation under a local-only parent queues without inventing a
 server access hash.
- Clients enforce exact durable identity pins and monotonic checkpoints for
 principal policies and object manifests.
- Regression coverage includes malicious API fixtures for forged grants,
 swapped keys, omitted targets, stale manifests, split projection rows, and
 key-epoch reuse after membership shrink.
