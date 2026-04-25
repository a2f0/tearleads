# Security Guarantees

This document describes the security and validation invariants the current
system provides. It is intentionally scoped to the implemented behavior, not
the desired future model.

## Short Answer

Given an honest, uncompromised client, the system can detect forged or tampered
signed group and organization policy state when the signer identity key is
authentic and the client receives the referenced policy bundle.

The system does not yet provide a universal guarantee that an honest client can
detect every compromised-server behavior. A compromised server can still deny
service, omit state, replay older valid state, show split views to different
clients, substitute identity keys on first contact, or present a self-consistent
object grant view because object access manifests are not signed yet.

The practical confidentiality guarantee today is:

- The server cannot decrypt encrypted content without recipient private keys or
  unwrapped DEKs.
- The server cannot forge a valid signed group or organization policy state
  unless it controls an authorized policy signer key, can substitute the signer
  identity key trusted by the client, or can make the client accept invalid
  policy state.
- The server can still influence which object grants and recipient sets an
  honest client sees, because object grant state is API-authored rather than
  user-signed.

## Threat Model Assumptions

The current guarantees assume:

- The client code is honest and runs the implemented validation paths.
- User signing and encapsulation private keys are not compromised.
- Cryptographic primitives hold.
- Clients do not intentionally ignore policy validation failures.
- Server-side API and database code may be malicious, compromised, stale, or
  inconsistent.

The guarantees are relative to the authenticity of registered user identity
keys. Today, signer public keys are fetched from the server by `userId` and
checked against the fingerprint embedded in the signed state. That detects
response inconsistency, but it is not a full key-transparency or out-of-band
identity proof.

## Current Handshake

The current access and policy handshake has these layers:

1. User registration stores the user's signing key, encapsulation key, personal
   organization, root container, root metadata state, and the initial signed
   organization policy inside one registration transaction.
2. The initial organization policy must be version `1`, must target the new
   organization, must be signed by the registering user, and must project only
   the registering user as admin.
3. Later group and organization policy states are signed principal states. The
   server verifies the signature, state hash, projection root, encrypted payload
   hash, member count, previous-state link, and admin-signer rule before
   storing them.
4. Direct member envelopes for a principal are stored separately but must
   target the current principal state exactly. The API rejects missing,
   extra, or fingerprint-mismatched direct member envelopes.
5. Object access resolution records `accessEpoch`, `accessFingerprint`,
   `accessStateHash`, recipient envelopes, and referenced principal summaries.
   For group and organization grants, the summary includes the referenced
   principal type, id, version, key epoch, and state hash.
6. App clients fetch referenced principal policy bundles, verify them, and
   cache only bundles whose signed state chain matches the object reference.
7. App clients unwrap group or organization addressed object envelopes only
   through verified cached principal policies and valid member envelopes.
8. Writes that mutate encrypted object state include `expectedAccessStateHash`
   so stale access views are rejected by the API.

## Guarantees We Currently Have

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

The membership root is part of the signed state and signature input. The
current API does not accept a separate member list for independent
`membershipRoot` recomputation; the validated authorization projection is the
signed `projectionRoot` plus the supplied projection rows.

This means mutable projection rows are not authority by themselves. If the API
or database changes projection rows without a matching signed state, honest
clients reject the bundle.

### Admin-Signer Authorization

The signer rule is enforced against signed projection state:

- For an initial state, the signer must be an admin in that initial projection.
- For a successor state, the signer must be an admin in the previous signed
  projection.

This prevents the API from authorizing a policy transition merely by editing
current projection rows. A successor must chain from the previous signed state
and be signed by a user who was admin in that previous signed state.

### Principal Payload And Projection Binding

The principal state's `projectionRoot` must match the supplied projection. The
state's `payloadCiphertextHash` must match the supplied encrypted payload. The
state's `memberCount` must match the projection length.

The app repeats these checks on fetched policy bundles. A bundle with a
tampered projection, payload, state hash, or chain link is skipped and not
used for decryption.

### Member Envelope Binding

Principal member envelopes are required to match the current direct projection
exactly. The API checks:

- the envelope state hash equals the current principal state hash
- the envelope epoch equals the current principal key epoch
- each direct member has exactly one envelope
- no unknown member has an envelope
- each envelope's recipient key fingerprint matches the current recipient key

These checks bind the stored principal secret-key envelopes to the signed
direct member set. They do not make the server able to create valid wrapped
material for a new member without access to the principal secret key.

### Revocation Depends On Principal Key Rotation

`keyEpoch` and the principal key fingerprint are signed and participate in
object references to group and organization policy state. That lets clients
detect mismatches between an object reference and the policy/key epoch used to
decrypt it.

The current validation does not prove that every membership removal rotates
the principal key. If a removed member previously learned the old principal
secret key and a later state keeps the same principal key, that member can
still decrypt future object envelopes addressed to that unchanged key. Strong
post-removal confidentiality requires publishing a successor policy state with
a fresh principal key epoch and fresh member envelopes for the remaining
members.

### Managed Grants Fail Closed

Group and organization object grants now require a current signed principal
state. If a managed principal grant cannot be resolved to current signed state,
recipient resolution fails rather than degrading to unsigned expanded users.

This prevents unsigned group or organization membership rows from being enough
to create crypto recipients.

### Object Access State Hashes

`accessStateHash` is a deterministic commitment to the current object access
inputs used by the API:

- container hashes include container identity, ancestor container ids, grants,
  and referenced principal summaries
- document hashes include document identity, document grants, and linked
  container access-state hashes
- blob hashes include blob identity and linked document access-state hashes

Clients include `expectedAccessStateHash` on writes. The server rejects writes
that target a stale access state hash.

This gives stale-write detection and a stable reference point for encrypted
writes. It does not prove that the underlying object grants were authorized by
an end user.

### Content Confidentiality

Encrypted document, blob, and metadata content remains confidential from a
server that only has stored ciphertext and wrapped keys. The server needs a
recipient private key, a principal secret key, or an object DEK to decrypt.

When clients use verified principal policy bundles, a forged group or
organization policy state should fail closed before the client unwraps a
principal-addressed object envelope.

## What We Do Not Yet Guarantee

### No Universal Compromised-Server Detection

An honest client cannot categorically detect every compromised-server action.
The server can:

- refuse to return policy state or object data
- omit newer states or grants
- replay an older valid policy chain
- show different valid policy heads to different clients
- return a self-consistent object grant view that was not user-signed
- substitute signer or recipient public keys before a client has any trusted
  binding for those identities

The current validation turns many tampering attempts into fail-closed behavior,
but it is not a global transparency system.

### Rollback And Split-View Are Not Fully Solved

Principal state hash chains detect inconsistent chains. They do not, by
themselves, prove that the returned head is the latest head.

A server that has older valid signed states can replay an older valid chain
unless the client has an independent monotonic checkpoint, highest-seen
version/hash pin, or transparency log. The local policy cache stores one bundle
per principal and does not currently enforce "never go backwards" as a security
invariant.

### First-Contact Identity-Key Substitution

The app fetches signer public keys from the server by `userId` and verifies
that the returned key fingerprint matches the fingerprint embedded in signed
policy state.

That catches malformed responses. It does not, by itself, prove that the
server gave the client the real public key for a user the client has never
seen before. A compromised server that controls the first key lookup can
construct a coherent fake signer identity unless clients have a previously
pinned key, an out-of-band identity check, or a key-transparency mechanism.

### Object Grants Are Not User-Signed

Group and organization policy state is signed. Object access grants are not
currently signed access manifests.

`accessFingerprint` and `accessStateHash` are useful commitments, cache keys,
and stale-write guards. They are not authorization proofs. If the API process
is compromised, it can present a self-consistent object access view. Honest
clients can verify referenced group and organization policy bundles, but they
cannot yet independently prove that the object grant graph itself was approved
by an authorized user.

This is the biggest remaining gap for the specific question "can a compromised
server cause information disclosure by changing access state?" The server
should not be able to forge signed group or organization membership. However,
because object grants are still API-authored, a compromised server may be able
to make an honest writer encrypt future object key material to an unauthorized
recipient if the writer accepts the server-provided object grant view.

### Revocation Is Not Retroactive Without Rotation

Removing a member from a signed projection does not erase keys the member
already learned. Confidentiality after removal depends on rotating the
principal key and rewrapping future object keys to the new epoch. The signed
state format can represent this, but current validation does not enforce a
semantic rule that removals must increase `keyEpoch`.

### Audit State Is Not A Full Transparency Log

Document and attachment audit entries include access-state information and hash
links for verification, but the system does not yet provide an external
append-only transparency log for object grants, principal policy heads, or key
registry state.

Audit verification can detect inconsistencies in the returned history. It does
not prevent a server from withholding entries or presenting different valid
histories without an independent checkpoint.

### Availability Is Out Of Scope

The server can always deny service by withholding data, policy bundles,
recipient envelopes, or key lookup responses. The current security posture is
to fail closed when required cryptographic policy material is unavailable.

## Information-Disclosure Scenarios

### Forged Group Or Organization Membership

If the signer identity key is authentic and the client receives the referenced
policy bundle, the server should not be able to add a user to a group or
organization merely by editing database rows. The forged projection would not
match the signed `projectionRoot`, the signed state hash, the chain, or the
admin-signer rule.

Result: detected and fail closed.

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

If the server changes object grants and recomputes the object access hash, the
view can be self-consistent because object grants are not signed by users
today.

Result: not independently detectable by the client as unauthorized. The client
can detect stale views relative to a supplied `expectedAccessStateHash`, but
not prove that the new current object grant view was user-authorized.

### Substituted First-Contact Signer Key

If the client has never pinned or independently verified a user's signing key,
a compromised server can return a fake signing key and a fake policy chain that
is internally consistent with that fake key.

Result: not reliably detected without prior trust in the identity key binding.

## Current Invariant Summary

- Signed principal policy state is the authority for group and organization
  crypto membership.
- Unsigned group or organization membership rows are not sufficient to create
  managed-principal crypto recipients.
- Principal state transitions must be signed by an admin from the previous
  signed projection, except the initial state, whose signer must be admin in
  the initial projection.
- Principal policy bundles fetched by the app are verified before caching and
  skipped on validation failure.
- Principal member envelopes must match the current direct signed projection.
- Post-removal confidentiality requires principal key rotation; the current
  system records key epochs but does not enforce rotation semantics.
- Object writes are protected from stale access views with
  `expectedAccessStateHash`.
- Object access hashes commit to the API's current access view, but do not
  prove that the view was user-authorized.
- Rollback, split-view, first-contact key substitution, and signed object
  access manifests remain outside the current guarantee boundary.

## Direction For Stronger Guarantees

The next hardening layer should be a signed object access manifest. It should
bind object grants, referenced principal states, effective recipients,
`accessFingerprint`, `accessStateHash`, and epoch under an authorized user
signature. Clients should verify the manifest, expand recipients locally, and
refuse to encrypt unless the manifest and referenced principal policies are
valid.

For rollback and split-view resistance, clients should also remember
highest-seen principal policy versions and object manifest epochs, or publish
state heads to an append-only transparency log or independently auditable
checkpoint stream.
