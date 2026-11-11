# Keying Design: Overview

Part of the [keying design](../keying-design.md).

## Design Properties

- Additive sharing avoids per-document and per-blob recipient fanout.
- Encryption targets are derived from verified signed access state, not from
 server-provided recipient lists.
- Access and key state are verified through shared protocol code rather than UI
 convention.
- Server-visible structure remains the input to access derivation.
- End-to-end encryption is preserved: the server stores ciphertext and wrapped
 keys, not plaintext [content keys](../glossary/keys.md#content-key).
- Revocation is forward-looking unless content is re-encrypted.
- Local-first creation uses signed local intents rather than fake server access
 hashes.

## Boundaries

- The protocol does not retroactively revoke bytes or keys already
 distributed.
- The protocol does not hide [container](../glossary/access.md#container),
 [document](../glossary/content.md#document), or
 [blob](../glossary/content.md#blob) structure from the server.
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

The API can store and project these planes, but an honest client must be able
to verify each plane's authority independently.

## Threat Model

Assume:

- client code is honest and runs the verifier;
- user/device signing keys and private encapsulation keys are uncompromised;
- cryptographic primitives hold;
- the API, database, object storage, cache, and read replicas may be malicious,
 stale, or inconsistent.

The server may still deny service, omit data, or delay publication; the keying
protocol makes those attacks availability failures, not silent confidentiality
failures.

## Identity And Principal Policy

Principal policy uses the signed group/organization model with two rules.

First, any [principal](../glossary/principals.md#principal) transition that
removes a reader, demotes a role that can read, or disables a member must
advance the principal key
[epoch](../glossary/keys.md#epoch). Clients and the API both reject shrinking policy
transitions that reuse the old principal key epoch. Removing a container grant
must advance it too, since wraps sealed to the old key are retained; both
enforce that. A continuing member's identity bundle is immutable even across
principal-key rotation; changing user identity keys is not a supported policy
transition.

Second, user identity keys need an authority outside mutable API rows, such as:

- out-of-band key verification or invitation links that bind `userId` to an
 identity signing key fingerprint;
- organization-admin signed invitations that name the recipient identity key;
- an append-only identity transparency log with client checkpoint pinning;
- a combination of the above.

Production clients implement the first option as
[identity links](../developer/trusted-user-identity.md#identity-links): a link
binds the user ID, [trust domain](../glossary/principals.md#identity-trust-domain),
algorithms, and both public keys. Such a link or the device's own keys establish
an independent [pin](../glossary/principals.md#identity-pin). Existing Members
may also receive group membership and read, write, or admin shares through
[signed Members history](../developer/trusted-user-identity.md#roster-vouching)
that reaches an independent pin. This is transitive trust in every vouching
admin, not protection against a careless or malicious admin's false binding.
New or disabled Members enrollment, contacts, and roster profiles still need
direct `self`/`link` trust. Chain admission never upgrades pin
[provenance](../developer/trusted-user-identity.md#provenance). Signer resolution
still pins on first sight; without an independent anchor, a self-consistent
chain does not authenticate those keys or prove currentness.

All group and organization projections, including genesis, require
`identityBundleFingerprint`: the lowercase SHA-256 of the complete identity-link
tuple. The signed `projectionRoot` commits it alongside user ID and role;
`membershipRoot` still commits only the member IDs. See
[commitment semantics and reset scope](../developer/trusted-user-identity.md#signed-member-identity-commitments).

[Organization](../glossary/principals.md#organization) administration uses
reserved groups: `Admins` authorizes admins, and `Members` drives the roster.
`Admins` is not nested into `Members`; instead a
[managed principal](../glossary/principals.md#managed-principal) may name only active
[roster entries](../glossary/principals.md#organization-roster-entry). The signed
organization payload binds both IDs, and `Admins` contains only `admin` users.
Each signed principal state uses a null `externalAuthority` for direct
authorization or the exact Admins [head](../glossary/sync.md#head) for external
authorization. Citations match exact signed Admins states without in-chain
rollback; only API commits require the current head.
Display/[read-model](../organization-read-model-sync.md) projections never
provide keying inputs.
