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
keys. The client fetches each complete user identity through one strict gateway,
checks both key fingerprints, and durably pins the exact bundle by trust domain
and `userId`. Later substitutions hard-fail, and policy verification also checks
the signing fingerprint embedded in signed state. The first accepted response
is still TOFU, not a key-transparency or out-of-band identity proof.

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
 server verifies the signature, state hash, projection and envelope roots,
 encrypted payload hash, member count, previous-state link, and admin-signer
 rule before storage.
4. The signed state commits the exact direct-member envelope set. State,
 payload, projection, and envelopes are accepted atomically; the API rejects
 missing, extra, altered, or fingerprint-mismatched envelopes.
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
9. Clients persist exact full-bundle identity pins and monotonic checkpoints for
 principal policy heads and access manifest heads.

## Security Properties

### Principal Policy Integrity

A principal signature binds its type/id, version and predecessor, key epoch and
encapsulation key, membership/projection/envelope roots, encrypted payload
hash, member count, signer identity, and timestamp. The server validates this
before storage; clients revalidate the complete contiguous chain before
caching or key use. Projection rows are therefore not authority by themselves:
changing them without a matching signed state causes rejection.

### Admin-Signer Authorization

Every signed principal-state header includes `externalAuthority`. It is `null`
for a signer authorized directly by the initial or preceding projection. An
externally authorized organization-group state instead commits the exact
reserved `Admins` policy head. The API accepts only its current exact head and
a direct `admin` signer; organization and Admins states cannot cite it.

Client verification resolves every non-null citation to that exact Admins
history entry and tests its projection, rather than unioning historical admins.
Historical child states may cite historical exact heads. Every child successor
newer than a local checkpoint must instead cite the fetched, verified current
Admins head, and cited heads cannot roll back within a chain. Thus a removed
admin cannot append after the client checkpoints the child policy.

A cold client has no cross-object ordering checkpoint, so the two signed
histories do not prove a historical Admins head was current when cited. Honest
writes enforce this; detecting a malicious first-contact stale view needs
cross-object transparency, witnessing, or gossip.

The signed organization descriptor selects `Admins`; display and read-model
projections never authorize policy or keying. Root and metadata repairs use
verified grants.

There is no legacy or unsigned fallback. Pre-contract signed state must be reset
and its organization reprovisioned, not translated.

### Principal Payload And Projection Binding

The principal state's `projectionRoot` must match the supplied projection. The
state's `payloadCiphertextHash` must match the supplied encrypted payload. The
state's `memberCount` must match the projection length. Its
`memberEnvelopesRoot` must match the canonical exact envelope set.

The app repeats these checks on fetched policy bundles. A bundle with a
tampered projection, payload, state hash, or chain link is skipped and not used
for decryption.

### Member Envelope Binding

The signed `memberEnvelopesRoot` commits one canonical envelope per direct
member: identity, active state/epoch, recipient fingerprint, KEM ciphertext,
and wrapped key. Exact ML-KEM-1024/AES-GCM formats are enforced, and state,
payload, projection, and immutable envelopes commit in one transaction. The
server still cannot create a valid new wrap without the principal secret key.

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
container KEK wraps use ML-KEM-1024 plus AES-GCM for principals or AES-GCM
under a parent or successor KEK. Rotations use the
`tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek` suite for their
immediate predecessor. Current clients must verify that chain through epoch 1.
Each rotation event signs the canonical predecessor-bridge hash; AES-GCM also
binds the container and predecessor/successor epoch ids during decryption.
Failure to decrypt a historical bridge makes that history unavailable but does
not invalidate an independently verified current KEK; current-epoch reads can
continue while operations that require the damaged epoch fail explicitly.
The API preserves that liveness for direct container projections, descendant
paths, and mutation responses by returning the verified current KEK plus the
maximal authenticated predecessor prefix; the client detects any missing suffix
from the signed current epoch number.
This deliberately changes compromise amplification: possession of the current
container KEK also reveals every retained predecessor KEK through the bridge
chain. That is the cost of history-inclusive current access. It does not weaken
forward revocation—a user who lacks a post-revocation KEK still cannot derive
that KEK or later epochs—but current-key compromise exposes retained historical
content for that container. Current members also learn retained-history
metadata—including chain length, epoch ids and numbers, access-manifest hashes,
and parent epoch references—even though bridge encryption still protects the
old plaintext keys.

All container KEK epochs use a
`tearleads.container-kek.v1.sha256:<hash>` id, clients verify that the
decrypted KEK material matches the signed epoch id before using that KEK to
wrap document or blob content keys. Non-prefixed ids are rejected because they
do not commit to the decrypted key material.

When clients use verified principal policy bundles, a forged group or
organization policy state should fail closed before the client unwraps a
principal-addressed object envelope.

### Local At-Rest Key Wrapping

The SDK local keyring is a host-facing at-rest key management layer. It stores
a manifest containing a wrapped account-root secret and derives local SQLite,
blob-store, identity-persistence, and custom-purpose keys from that root. The
manifest is not itself a keychain; confidentiality depends on the host
`WrappingKeyKeystore` implementation, such as a browser, desktop, iOS, or
Android secure-storage primitive.

The wrapped account-root envelope binds its purpose and normalized scope as
authenticated context. A manifest for one namespace, account id, or signing
fingerprint should not unwrap under another scope. The memory keystore and
manifest store exported by the SDK are test/development helpers only and do
not provide durable platform protection.

PIN-code local keyring support is an optional wrapper over a host keystore. In
that mode, the account-root secret is wrapped by the inner keystore and then
the inner envelope is encrypted with a PBKDF2-SHA256/AES-GCM key derived from
the supplied PIN. Reopening the local session requires both the host wrapping
key and the PIN; the default browser local keyring does not require a PIN.

This local keyring protects local database and blob-store keys at rest on the
client device. It does not change server-side access authorization, signed
manifest verification, content-key bundle validation, or remote ciphertext
confidentiality.

## Boundaries

### No Universal Compromised-Server Detection

The server can withhold data, omit newer state, replay valid history, show split
views, return projections inconsistent with signed manifests, or substitute
identity keys on first contact. Validation makes many of these fail closed, but
is not global transparency unless clients pin or witness tree heads.

### Rollback And Split-View

Principal state hash chains detect inconsistent chains. They do not, by
themselves, prove that the returned head is the latest head.

A server that has older valid signed states can replay an older valid chain
unless the client has an independent monotonic checkpoint, highest-seen
version/hash pin, or transparency log. Production clients persist checkpoints
and reject rollbacks or same-version hash conflicts for principal policy and
access manifest heads. User identity trust currently uses an exact durable
full-bundle TOFU pin: any later change to either public key, fingerprint, suite,
or format is rejected.

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
principal key and rewrapping subsequent object keys to the new epoch. Policy
validation therefore requires a membership-shrinking transition to advance the
key epoch and change its encapsulation key.

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
- Post-removal confidentiality requires principal key rotation; policy
 validation enforces a new key epoch and encapsulation key on shrink.
- Signed access manifests are the authority for object grant and document-link
 state used by key derivation.
- Object writes commit to the verified access manifest hash and derived target
 hash.
- Durable full-bundle identity pins detect identity changes after first use;
 local checkpoints detect replayed or conflicting principal policy and access
 manifest heads after a client has seen newer state.
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
