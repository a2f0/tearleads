# Security Guarantees: Overview

Part of the [security guarantees](../security-guarantees.md).

## Short Answer

Given an honest, uncompromised client, the system can detect forged or tampered
signed group and organization
[policy state](../glossary/principals.md#principal-policy-state) when the signer
identity key is authentic and the client receives the referenced policy bundle.

The system does not provide a universal guarantee that an honest client can
detect every compromised-server behavior. A compromised server can still deny
service, omit state, replay older valid state when the client has no
[checkpoint](../glossary/sync.md#checkpoint), show split views to different clients
without gossip or witnessing, or substitute identity keys on first contact with
a user whose [identity link](../glossary/principals.md#identity-link) the client
has not verified.

The confidentiality boundary is:

- The server cannot decrypt encrypted content without recipient private keys
  or unwrapped [DEKs](../glossary/keys.md#dek).
- The server cannot forge a valid signed group or organization policy state
  unless it controls an authorized policy signer key, can substitute the signer
  identity key trusted by the client, or can make the client accept invalid
  policy state.
- The server cannot make an honest client accept object grants or recipient
  targets that are not justified by signed
  [access manifests](../glossary/access.md#access-manifest) and verified
  [principal](../glossary/principals.md#principal) policy [heads](../glossary/sync.md#head).

## Threat Model

The security properties assume:

- The client code is honest and runs the implemented validation paths.
- User signing and encapsulation private keys are not compromised.
- Cryptographic primitives hold.
- Clients do not intentionally ignore policy validation failures.
- Server-side API and database code may be malicious, compromised, stale, or
  inconsistent.

The properties are relative to the authenticity of registered
[user identity keys](../developer/trusted-user-identity.md). The client fetches
each complete user identity through one strict gateway, checks both key
fingerprints, and durably [pins](../glossary/principals.md#identity-pin) the
exact bundle by [trust domain](../glossary/principals.md#identity-trust-domain)
and `userId`. The reverse signing-fingerprint-to-user binding is also unique
within that trust domain and checked in the same durable transaction. A new
session without restored acknowledgments cannot bind a known signing identity to
a different user. Later substitutions hard-fail, and policy verification also
checks the signing fingerprint in signed state. Verifying signed state pins a
referenced user on first sight (`observed`); only an independently exchanged
identity link (`link`) or the device's own keys (`self`) admit a user as a
contact, roster or group member, or share recipient. A group member or share
recipient can also be admitted by the organization's signed roster when an
admin this device verified signed the Members state that admitted them, for the
encryption key that state commits. Neither mechanism proves global
currentness.

## Root And System Destinations

Directory listing fields cannot establish a Trash, Contacts, or root role.
The SDK verifies the [container](../glossary/access.md#container) projection before
adopting those destinations, then takes the slot and parent edge from its signed
manifest. Local pre-login content merges only into the session's root id in the
expected [organization](../glossary/principals.md#organization), and only if
that root's epoch-1 `container.create` was signed by the session user (the login
response naming it is unsigned; every acknowledged organization was created by
the user). That creator check holds at the reconciliation boundary itself, from
the role remote hydration verified and cached (a local refresh never fetches; an
uncached role leaves the merge pending), so a root this device hydrated earlier
as another user's shared container is refused as a `signer_mismatch` incident and
never merged, whichever path reaches it. A later login may repeat an
acknowledged root or report it purged; a different root id is refused as an
incident. The default organization is not bound, since a purged personal one is
legitimately replaced. Only a root administrator may create a signed system
slot. Additional grantees are allowed: sharing a legitimate Trash must not
disable deletion. A create acknowledgement persists the client-signed slot and
refuses a differing echo. The app selects a foreign organization's Trash only by
a slot the viewer can derive; another identity's Trash is reported unavailable,
never matched by name.

Every folder's metadata document id comes from its signed manifest, never from
the listing. A held folder keeps its organization and metadata document unless
the session user's own signed `container.create` re-homed it, as purged
organization recovery does under existing ids, or the held organization's
pinned founder created the destination and signed a continuous
[replacement chain](../developer/billing-purge-recovery.md) binding its
organization and root genesis. An organization a folder left is recorded and
never binds it again. Other conflicts are refused as incidents before pins or
role caching, keeping the row, queued edits and checkpoints; an unbound folder
binds only to its own user's create. Transactions recheck the durable binding.

## Recovery Key Disclosure

Identity Manager's recovery QR contains the plaintext recovery phrase. It is
generated and decoded locally, with the same acknowledgement as revealing the
phrase. Scanning stages a validated phrase for the existing restore/login flow.
Validation proves the phrase's format and checksum, not its ownership; users
must scan their own backup, since restoring another person's QR selects that
person's identity. Revealed keys are hidden and staged restore phrases are
cleared on page hiding or backgrounding, but this cannot prevent screenshots or
photographs. A native camera capture uses a temporary file that the adapter
deletes before returning the photo for decoding; deletion failures are
reported and the capture is rejected. Any retained image of the QR grants
the same identity access as the recovery phrase itself.

## Protocol Handshake

The access and policy handshake has these layers:

1. [User registration](../container-dek-onboarding.md#registration-flow) stores
   the user's signing key, encapsulation key, personal organization,
   [reserved `Admins` group](../glossary/principals.md#organization-admins-group),
   [reserved `Members` group](../glossary/principals.md#organization-members-group),
   [root container](../glossary/access.md#root-container), root metadata state,
   optional roster-profile bootstrap material, and initial signed principal policies
   inside one registration transaction.
2. The initial `Admins` policy must project the registering user as the sole
   admin. The initial `Members` policy must project the registering user as an
   admin. The initial organization policy must be version `1`, must target the
   new organization, must be signed by the registering user, must project only
   the registering user as admin, and its version-2 authority descriptor must
   commit the exact initial `Admins` and `Members` policy heads.
3. Later group and organization policy states are signed principal states. The
   server verifies the signature, state hash, projection and envelope roots,
   encrypted payload hash, member count, previous-state link, and admin-signer
   rule before storage.
4. The signed state commits the exact
   [direct-member envelope](../glossary/keys.md#member-envelope) set. State, payload,
   projection, and envelopes are accepted atomically; the API rejects missing,
   extra, altered, or fingerprint-mismatched envelopes.
5. Access changes are represented as signed
   [access events](../glossary/access.md#access-event) and derived access manifests.
   Manifests bind the object, organization, [epoch](../glossary/keys.md#epoch),
   predecessor hash, event hash, structural hash, grant root, referenced
   principal heads, and [key-target hash](../glossary/keys.md#target-hash).
6. Clients verify [historical policy proofs](../projection-policy-evidence.md),
   including retained membership/grant metadata for authorized object readers,
   and fetch and cache verified full current policies for key unwrapping.
7. App clients unwrap group or organization addressed object envelopes only
   through verified cached principal policies, valid member envelopes, and signed
   access manifests.
8. Writes commit to the verified access manifest hash and derived recipient
   target hash so stale or forged access views fail verification.
9. Clients persist exact full-bundle identity pins and monotonic checkpoints for
   principal policy heads and access manifest heads.
10. Terminal trust-boundary verification failures are appended to a local
    security-incident ledger before the workflow rethrows them. The ledger is not
    part of remote-state reset and contains typed codes and object references, not
    exception text or decrypted data.
