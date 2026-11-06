# Keying Design: Container KEKs

Part of the [keying design](../keying-design.md).

## Container KEK Hierarchy

Each container has a current container KEK epoch.

Container KEKs are wrapped to:

- direct user identity/device encapsulation key epochs;
- group or organization principal key epochs;
- the parent container KEK epoch when inherited access should flow downward.

Documents and blobs wrap content keys to current container KEK targets, not
directly to every effective user.

### Why Parent KEK Edges Exist

If child containers always wrap their KEK to the parent container KEK, an
additive share on an ancestor can be one new wrap of the ancestor KEK. The new
recipient follows the existing KEK chain to descendant content. That is the
main fanout win.

The tradeoff: compromising an ancestor KEK compromises the subtree that
inherits from it. That matches inherited access semantics, but it must be
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

The
[**predecessor bridge**](../glossary/keys.md#container-kek-predecessor-bridge)
is the append-only log entry: the immediately preceding KEK encrypted under the
new KEK, binding the container id and both committed epoch ids as AES-GCM
additional data. It is written exactly once by the rotator — the only party the
protocol guarantees held both keys — and is never rewritten by any later
rotation. The bridge's wrapping suite and version are persisted per row so a
suite change is representable.

The [**sealed keyring**](../glossary/keys.md#container-kek-keyring) is the snapshot
read path: the container's complete predecessor key history — one fixed-width
record per epoch, in ascending order — AEAD-sealed under the new KEK. A client
that unwraps the current KEK opens the keyring in one decrypt and holds every
retained historical KEK; no chain walk occurs on the hot path. Entry ordinal `i`
is key epoch `i + 1`, so the sealed ciphertext length for key epoch `n` is an
equality (`8 + (n - 1) * 64 + 16` bytes), which the server enforces at write
time on a blob it cannot decrypt and clients enforce again after opening. Each
recovered entry is verified against its material-committing epoch id before use.

Initial epochs have every rotation-artifact field null; later epochs have all
of them populated (a database check constraint enforces the all-or-none
shape). The keyring is derived, rebuildable state; the bridge log is ground
truth.

Container KEK epochs use ids of the form
`tearleads.container-kek.v2.sha256:<hash>`. The domain-separated hash commits to
version 2, the container id, numeric KEK epoch, and the canonical ML-KEM wrapping
public key deterministically derived from the 32-byte KEK. Servers and child-only
writers verify the published key against this commitment without an ancestor
secret. KEK holders derive that same public key from recovered material and check
the commitment independently. Only the v2 format is accepted.

The wrapping public-key cache is bounded to 128 entries and indexed by container
id plus a process-local HMAC token of the key bytes. A second cache retains up to
65,536 public material-id commitments, keyed by container, numeric epoch, and the
same token. Neither cache retains KEKs, private wrapping keys, or derivation
seeds; temporary copies and token buffers are zeroized. The non-extractable HMAC
key is generated once per process, so tokens cannot be correlated across runs.

Every epoch-creating child event has an explicit signed parent citation.
`container.rekey` and `container.revoke` include `parentManifestHash` in their
bodies, naming the current parent used to wrap the new epoch (null for roots).
The derived state retains that citation for historical recovery. Selection uses
that exact hash; withholding the cited head causes a missing-dependency refusal.
The crypto verifier also handles two cited heads of the same parent as defense
in depth; the API and SDK reject such duplicate-container dependency lists.

### Container Key Wrap Row

```ts
type ContainerKeyWrap = {
 containerKeyEpochId: string;
 recipientKind: "user" | "group" | "container";
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
container key epoch, or manifest hash does not match the verified graph, and
wraps that decrypt to different KEK material than the signed epoch id commits
to.

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

Lazy descendant [rekey](../glossary/keys.md#rekey) is acceptable, but writes must
[fail closed](../glossary/access.md#fail-closed): if a document write targets a
container whose current key epoch is still reachable through a revoked ancestor
key, a post-revocation descendant KEK epoch must be materialized before the
write is accepted.

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
historical KEK; reading history needs no old user/principal envelope. Revocation
remains forward-only because a user who possessed an old KEK may retain it, but
a current user does not depend on a retained device, an old principal key, or a
document rebaseline to read retained history. Fresh baselines remain a sync
optimization and content-key [rotation](../glossary/keys.md#rotate) mechanism,
not a key-recovery or liveness dependency.

This also exposes retained-history metadata to every current member even before
decryption: keyring size (and therefore rotation count), material-committing
epoch ids, access-manifest hashes, and parent epoch references. The design
accepts that metadata disclosure as part of history-inclusive access; only the
old plaintext KEKs and content remain sealed.

Reads and recovery projections may contain descendants pinned to historical
parent KEK epochs. The verifier reconstructs that epoch's binding from the
parent's complete verified signed manifest lineage, including its creation
event's parent citation. Missing history, unrelated epochs, and forged bindings
fail verification. The projection needs no additional historical epoch records.
The current parent's sealed keyring supplies the historical key needed to open
the child. Future writes still require current parent epochs throughout the
path: lazy descendant rekey must complete before accepting new content. SDK
write planners enforce this before encrypting or wrapping new material, even
if the API supplies a valid recovery projection. The API checks the full parent
path before accepting new container epochs; parent-first repairs remain valid.

History delivery is **one round trip and one decrypt** regardless of rotation
count; walking the bridge log needs one dependent unwrap per epoch. The
work is still linear: the sealed blob is 64 bytes per retained epoch, so
transfer, AEAD processing, and per-entry material-id verification all grow with
epoch count. The difference is shape — one bulk decrypt plus independent entry
checks in batches of 16 that yield to the event loop, rather than a chain where
each unwrap gates the next. At the epoch cap the sealed keyring is about 4 MB,
which is why the kek-log serves at most one historical keyring per request.
Rotation pays the linear cost instead — the rotator opens the previous keyring
and re-seals it plus the retiring key under the new KEK — which is one decrypt,
one seal, and 64 bytes per retained epoch.

The v2 material check derives an ML-KEM public key on a cache miss. The compact
commitment cache covers one full history at the protocol epoch cap;
interleaved histories larger than the cache evict entries. Cold work is linear
and can take tens of seconds near the 65,536-epoch cap. Bounded batches prevent
an unbounded burst of pending derivations and keep the event loop responsive.
Verification before re-sealing is intentional: skipping unused entries would
let an honest rotation launder poisoned history into its new signed commitment.

There is deliberately no depth cap and no truncation: the keyring for epoch
`n` must contain exactly `n - 1` entries, over- and under-length payloads are
rejected by the same equality, and a keyring that omits an epoch fails the
structural entry-count check. The `MAX_CONTAINER_KEY_EPOCH` write-time bound
(65536) is a runaway-rotation backstop sized to be unreachable by legitimate
use, enforced when a rotation is accepted — never against existing data — so
it can never make retained ciphertext unreadable. Every keying bound and what
lies past it is tabulated in [limits.md](../limits.md#container-keying).

Every keyring entry is checked twice on the read path: against the material-id
its ordinal commits to, and — for any epoch the projection's signed material
names — against that committed epoch id. The second check stops a
self-consistent forgery: a poisoned keyring can mint a fresh key with an id
that commits to it, which the first check alone would accept. Rotations apply
the same material check before re-sealing, so an honest rotator never launders
history it did not verify.

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

The bridge log has no repair story of its own, so it is never rewritten. A
bridge that fails to decrypt severs log-based recovery for the epochs below it,
but every epoch's recipient wraps are retained forever (cross-epoch wraps are
never deleted; this is a stated protocol invariant, not an implementation
accident) and are served by the kek-log alongside the bridges. A member holding
a **direct user** envelope at epoch `i` can therefore recover `K_i` from their
identity keys plus server state, written by the epoch-`i` rotator and
untouchable by any later writer, and re-anchor a repair rekey from there.

That backstop has one documented bound. A **group- or organization-addressed**
envelope additionally requires the principal secret key for the key epoch it was
addressed to, which resolves only through principal-policy bundles the client
can reach; after a principal key rotation a pristine client cannot reach the
older ones. The client fails closed with a distinct
`HistoricalWrapUnavailableError` (reason `principal-key-unreachable`) rather
than reporting corruption, so the condition is diagnosable. The API serves no
historical principal-key envelopes by design
([protocol-specification.md](../protocol-specification/container-access.md#container-access-and-kek-protocol)).
The only wholly unrecoverable case is a sole-ever member destroying their own
history.
[`formal/container-keying/KeyringReachability.tla`](../../formal/container-keying/KeyringReachability.tla)
model checks this composition: the log alone recovers everything while bridges
are intact, severance damage is bounded to epochs below the broken link, an
honest current keyring implies full recoverability, and retained wraps backstop
a poisoned snapshot.

The server cannot prove that sealed rotation artifacts actually decrypt to the
keys their ids commit to. An authorized writer that deliberately signs
well-formed but undecryptable ciphertext can deny access to older history up
to the limits above. The supported clients round-trip both artifacts while
constructing mutations, but this is not an availability guarantee against a
malicious writer. Database backup only repairs later storage damage; it cannot
repair deliberately invalid ciphertext that was originally accepted.

A container move creates fresh successor KEK material as well as a new epoch
identity because the parent binding changes. It carries the same two rotation
artifacts as rekeys and revocations: the write-once bridge and the re-sealed
keyring.
