# Security Guarantees

This document describes the security and validation invariants of the
Tearleads protocol.

For shared protocol terminology, see [glossary.md](./glossary.md).

## Short Answer

Given an honest, uncompromised client, the system can detect forged or tampered
signed group and organization policy state when the signer identity key is
authentic and the client receives the referenced policy bundle.

The system does not provide a universal guarantee that an honest client can
detect every compromised-server behavior. A compromised server can still deny
service, omit state, replay older valid state when the client has no
checkpoint, show split views to different clients without gossip or
witnessing, or substitute identity keys on first contact.

The confidentiality boundary is:

- The server cannot decrypt encrypted content without recipient private keys
 or unwrapped DEKs.
- The server cannot forge a valid signed group or organization policy state
 unless it controls an authorized policy signer key, can substitute the signer
 identity key trusted by the client, or can make the client accept invalid
 policy state.
- The server cannot make an honest client accept object grants or recipient
 targets that are not justified by signed access manifests and verified
 principal policy heads.

## Threat Model

The security properties assume:

- The client code is honest and runs the implemented validation paths.
- User signing and encapsulation private keys are not compromised.
- Cryptographic primitives hold.
- Clients do not intentionally ignore policy validation failures.
- Server-side API and database code may be malicious, compromised, stale, or
 inconsistent.

The properties are relative to the authenticity of registered user identity
keys. Signer public keys are fetched from the server by `userId` and checked
against the fingerprint embedded in signed state. That detects response
inconsistency, but it is not a full key-transparency or out-of-band identity
proof.

## Protocol Handshake

The access and policy handshake has these layers:

1. User registration stores the user's signing key, encapsulation key, personal
 organization, reserved `Admins` group, reserved `Members` group, root
 container, root metadata state, optional roster-profile bootstrap material,
 and initial signed principal policies inside one registration transaction.
2. The initial `Admins` policy must project the registering user as the sole
 admin. The initial `Members` policy must project the registering user as
 admin and the `Admins` group as a member. The initial organization policy must
 be version `1`, must target the new organization, must be signed by the
 registering user, and must project only the registering user as admin.
3. Later group and organization policy states are signed principal states. The
 server verifies the signature, state hash, projection root, encrypted payload
 hash, member count, previous-state link, and admin-signer rule before storing
 them.
4. Direct member envelopes for a principal are stored separately but must
 target the active principal state exactly. The API rejects missing, extra, or
 fingerprint-mismatched direct member envelopes.
5. Access changes are represented as signed access events and derived access
 manifests. Manifests bind the object, organization, epoch, predecessor hash,
 event hash, structural hash, grant root, referenced principal heads, and
 key-target hash.
6. App clients fetch referenced principal policy bundles, verify them, and
 cache only bundles whose signed state chain matches the object reference.
7. App clients unwrap group or organization addressed object envelopes only
 through verified cached principal policies, valid member envelopes, and signed
 access manifests.
8. Writes commit to the verified access manifest hash and derived recipient
 target hash so stale or forged access views fail verification.
9. The shared crypto verifier exposes local checkpoint checks for identity
 state heads, principal policy heads, and access manifest heads.

## Security Properties

### Principal Policy Integrity

For group and organization policy state, the signed state binds:

- principal type and id
- version
- previous state hash
- key epoch
- principal encapsulation public key and key fingerprint
- membership mode
- membership root
- projection root
- encrypted payload ciphertext hash
- member count
- signer user id
- signer user key fingerprint
- signature timestamp

The server validates this before storage. The app validates it again before
caching a referenced policy bundle. The app also verifies the whole returned
chain, including contiguous versions, previous-state links, per-entry
projection roots, per-entry member counts, and per-entry signatures.

The membership root is part of the signed state and signature input. The API
does not accept a separate member list for independent `membershipRoot`
recomputation; the validated authorization projection is the signed
`projectionRoot` plus the supplied projection rows.

This means mutable projection rows are not authority by themselves. If the API
or database changes projection rows without a matching signed state, honest
clients reject the bundle.

### Admin-Signer Authorization

The signer rule is enforced against signed projection state:

- For an initial state, the signer must be an admin in that initial projection.
- For a successor state, the signer must be an admin in the previous signed
 projection.
- For an org-scoped successor state, the API may also authorize the signer by
 proving reachability through the organization's reserved `Admins` group.

This prevents the API from authorizing a policy transition merely by editing
projection rows. A successor must chain from the previous signed state and be
signed by either a user who was admin in that previous signed state or a user
whose external org-admin authority is itself derived from signed `Admins`
group state. External org-admin authorization does not apply to initial
principal states.

### Principal Payload And Projection Binding

The principal state's `projectionRoot` must match the supplied projection. The
state's `payloadCiphertextHash` must match the supplied encrypted payload. The
state's `memberCount` must match the projection length.

The app repeats these checks on fetched policy bundles. A bundle with a
tampered projection, payload, state hash, or chain link is skipped and not used
for decryption.

### Member Envelope Binding

Principal member envelopes are required to match the active direct projection
exactly. The API checks:

- the envelope state hash equals the active principal state hash
- the envelope epoch equals the active principal key epoch
- each direct member has exactly one envelope
- no unknown member has an envelope
- each envelope's recipient key fingerprint matches the active recipient key

These checks bind the stored principal secret-key envelopes to the signed
direct member set. They do not make the server able to create valid wrapped
material for a new member without access to the principal secret key.

### Revocation Depends On Principal Key Rotation

`keyEpoch` and the principal key fingerprint are signed and participate in
object references to group and organization policy state. That lets clients
detect mismatches between an object reference and the policy/key epoch used to
decrypt it.

Validation records and checks key epochs, but membership removal only protects
subsequent object envelopes when the principal key rotates. If a removed member
previously learned the old principal secret key and a later state keeps the
same principal key, that member can still decrypt later object envelopes
addressed to that unchanged key. Strong post-removal confidentiality requires
publishing a successor policy state with a fresh principal key epoch and fresh
member envelopes for the remaining members.

### Managed Grants Fail Closed

Group and organization grants require an active signed principal state. If a
managed principal grant cannot be resolved to active signed state, recipient
resolution fails rather than degrading to unsigned expanded users.

This prevents unsigned group or organization membership rows from being enough
to create crypto recipients.

### Signed Access Manifests

Access manifests are deterministic, signed commitments to the access state used
for key derivation:

- container manifests include container identity, parent edge, metadata
 document identity, direct grants, referenced principal heads, predecessor
 hash, and key target hash
- document link-set manifests include document identity, linked containers,
 predecessor hash, and key target hash
- attachment, document, and blob key targets are derived from verified
 manifests rather than API-provided recipient lists

Clients should commit writes to the verified manifest hash and derived target
hash. Projection hashes may still be useful cache keys, but they are not the
authorization source.

### Content Confidentiality

Encrypted document, blob, and metadata content remains confidential from a
server that only has stored ciphertext and wrapped keys. The server needs a
recipient private key, a principal secret key, or an object DEK to decrypt.

The content-record suite `aes-256-gcm-hkdf-sha256-record-key` applies only to
document and blob payload records. Document and blob content-key wraps use
explicit `tearleads.*.content-key-wrap.aes-256-gcm-container-kek` suites, while
container KEK wraps use either ML-KEM-1024 plus AES-GCM for principal
recipients or AES-GCM under the parent container KEK.

For app-created container KEK epochs with a
`tearleads.container-kek.v1.sha256:<hash>` id, clients verify that the
decrypted KEK material matches the signed epoch id before using that KEK to
wrap document or blob content keys. Legacy non-prefixed KEK epoch ids remain
readable, but only prefixed ids carry this material commitment.

When clients use verified principal policy bundles, a forged group or
organization policy state should fail closed before the client unwraps a
principal-addressed object envelope.

## Boundaries

### No Universal Compromised-Server Detection

An honest client cannot categorically detect every compromised-server action.
The server can:

- refuse to return policy state or object data
- omit newer states or grants
- replay an older valid policy chain
- show different valid policy heads to different clients
- return projection rows that do not match the signed access manifests
- substitute signer or recipient public keys before a client has any trusted
 binding for those identities

Validation turns many tampering attempts into fail-closed behavior, but it is
not a global transparency system unless clients also pin or witness tree heads.

### Rollback And Split-View

Principal state hash chains detect inconsistent chains. They do not, by
themselves, prove that the returned head is the latest head.

A server that has older valid signed states can replay an older valid chain
unless the client has an independent monotonic checkpoint, highest-seen
version/hash pin, or transparency log. The shared verifier rejects rollbacks
and same-version hash conflicts for identity heads, principal policy heads, and
access manifest heads when the caller supplies the local checkpoint.

### First-Contact Identity-Key Substitution

The app fetches signer public keys from the server by `userId` and verifies
that the returned key fingerprint matches the fingerprint embedded in signed
policy state.

That catches malformed responses. It does not, by itself, prove that the
server gave the client the real public key for a user the client has never seen
before. A compromised server that controls the first key lookup can construct a
coherent fake signer identity unless clients have a previously pinned key, an
out-of-band identity check, or a key-transparency mechanism.

### Projection Rows Are Not A Security Boundary

Group and organization policy state is signed. Access grants are represented by
signed access events and derived access manifests in the verifier. Projection
rows such as manifest heads, principal-head projections, document-link
projections, and target caches remain indexing aids only.

If the API process is compromised, it may still return a self-consistent
projection view. Honest clients must derive encryption targets from verified
manifests and verified principal policies, not from projection rows. A client
that accepts projection rows as authority can still be tricked into encrypting
to the wrong recipient set.

### Revocation Is Not Retroactive Without Rotation

Removing a member from a signed projection does not erase keys the member
already learned. Confidentiality after removal depends on rotating the
principal key and rewrapping subsequent object keys to the new epoch. The
signed state format can represent this, but validation does not enforce a
semantic rule that removals must increase `keyEpoch`.

### Transparency Requires A Pinned View Or Witnessing

The shared verifier has signed tree-head, inclusion-proof, and consistency
proof primitives for identity state heads, principal policy heads, and access
manifest heads. These prove that a returned leaf is in a signed log view and
that a newer log view extends a previous pinned tree head.

They do not, by themselves, prevent withholding or first-contact split views. A
client with no prior tree head, witness, gossip peer, or external checkpoint
can still be shown a self-consistent signed log view that differs from another
client's view.

### Availability Is Out Of Scope

The server can always deny service by withholding data, policy bundles,
key-target envelopes, or key lookup responses. The protocol fails closed when
required cryptographic policy material is unavailable.

## Information-Disclosure Scenarios

### Forged Group Or Organization Membership

If the signer identity key is authentic and the client receives the referenced
policy bundle, the server should not be able to add a user to a group or
organization merely by editing database rows. The forged projection would not
match the signed `projectionRoot`, the signed state hash, the chain, or the
admin-signer rule.

Result: detected and fail closed.

### Forged Organization Roster Membership

Org-manager directory lifecycle is stored in `organization_roster_entries`.
Active roster state is synchronized from users reachable through the reserved
`Members` group, and disabled rows may remain visible after access removal.
Because `Admins` is nested into `Members`, admins appear as active organization
members through the same signed reachability path.

If roster or projection rows are edited directly, server-side directory and
listing surfaces can be distorted, but those rows are still not cryptographic
authority. Verified policy consumers must reject forged access unless the
signed `Members` policy state, chain, projection root, and admin-signer rule
also verify.

Result: fail closed for verified policy consumers; mutable directory or
projection rows alone are not authority.

### Tampered Principal Payload

If the encrypted principal payload is changed, the ciphertext hash no longer
matches the signed `payloadCiphertextHash`.

Result: detected and fail closed.

### Tampered Principal Key

If the principal encapsulation public key is changed, the key fingerprint no
longer matches the signed state, or the state signature no longer verifies.

Result: detected and fail closed.

### Replayed Older Principal State

If the replayed state is internally valid, signatures and hash-chain checks can
still pass.

Result: not reliably detected unless the client has remembered a newer
version/hash or checks an external transparency source.

### Forged Object Grant View

If the server changes projection rows and recomputes projection hashes, an
honest client should reject the view unless the signed access manifest, event,
referenced principal policies, predecessor checkpoint, and derived target hash
all verify.

Result: detected and fail closed for clients that require the verifier outputs
before encrypting. Clients that trust projection rows directly remain outside
this guarantee.

### Substituted First-Contact Signer Key

If the client has never pinned or independently verified a user's signing key,
a compromised server can return a fake signing key and a fake policy chain that
is internally consistent with that fake key.

Result: not reliably detected without prior trust in the identity key binding.

## Invariant Summary

- Signed principal policy state is the authority for group and organization
 crypto membership.
- Unsigned group or organization membership rows are not sufficient to create
 managed-principal crypto recipients.
- Principal state transitions must be signed by an admin from the previous
 signed projection, except the initial state, whose signer must be admin in the
 initial projection.
- Org-scoped successor states may also be signed by a user reachable through
 the organization's reserved `Admins` group.
- Organization membership is verified from the reserved `Members` group, not
 from mutable roster rows or product roles on the organization principal.
- Principal policy bundles fetched by the app are verified before caching and
 skipped on validation failure.
- Principal member envelopes must match the active direct signed projection.
- Post-removal confidentiality requires principal key rotation; the protocol
 records key epochs but does not enforce rotation semantics.
- Signed access manifests are the authority for object grant and document-link
 state used by key derivation.
- Object writes commit to the verified access manifest hash and derived target
 hash.
- Local checkpoints can detect replayed older identity, principal policy, and
 access manifest heads after a client has seen newer state.
- First-contact key substitution, withholding, and split views without a
 pinned checkpoint, witness, or gossip peer remain outside the guarantee
 boundary.

## Strengthening The Boundary

Every API response and app workflow that drives encryption should require the
signed manifest, verified referenced principal policies, local checkpoint
comparison, and derived target hash before encrypting or decrypting.

For stronger split-view resistance, clients should persist transparency tree
checkpoints and compare signed tree heads through device sync, gossip,
witnesses, or an independently auditable checkpoint stream.
