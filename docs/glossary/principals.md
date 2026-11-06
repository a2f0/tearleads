# Glossary: Identity And Organizations

Part of the [glossary](../glossary.md).

## Identity Link

A public permalink that names one user's exact identity keys. It encodes the
identity trust domain (the API service), the user ID, and a SHA-256
fingerprint over a versioned, domain-separated tuple of both values plus the
user's ML-DSA-87 signing and ML-KEM-1024 encapsulation public keys. It holds no
secret and grants no access, so it can be shared and reused.

Verifying a link fetches the user's keys from the server, validates them, and
accepts them only if they hash to the link's fingerprint, before anything is
pinned. A server that substitutes keys therefore fails verification instead of
being trusted on first use. The link is only as trustworthy as the channel that
delivered it: exchange it through one you already trust (in person, or a
messenger whose contact you know). Once verified, the keys are recorded as an
[identity pin](#identity-pin) with `link` provenance. A link that disagrees
with an existing pin fails and changes nothing, and a link for another service
is refused before any fetch.

Only a `link` or `self` pin admits a user: adding a contact, a roster or group
member, or a share recipient. Copying another user's link re-shares it only
from such a pin, never from an `observed` one.

Related docs:

- [trusted-user-identity.md](../developer/trusted-user-identity.md#identity-links)
- [security-guarantees.md](../security-guarantees.md)

## Identity Pin

The durable, local record binding `(identityTrustDomain, userId)` to one
user's signing and encapsulation public keys. Pins are never deleted and their
keys never change; any later key change is a hard failure before key use. Each
pin records its provenance: `self` (this device's own keys), `link` (a
verified [identity link](#identity-link)), or `observed` (the server's first
answer for a user that signed state already references). Provenance only
rises. Within a trust domain a signing key is pinned to at most one user.

Related docs:

- [trusted-user-identity.md](../developer/trusted-user-identity.md#pinning)
- [trusted-user-identity.md](../developer/trusted-user-identity.md#provenance)

## Identity Trust Domain

The API service a user identity belongs to, written `identityTrustDomain`. It
defaults to the canonical absolute `apiBaseUrl`, including its base path; a
non-browser host with a relative API URL must supply an absolute
`identityTrustDomain`, and remote identity resolution
[fails closed](./access.md#fail-closed) when no stable, host-controlled trust
domain can be established. [Identity pins](#identity-pin) are keyed by
`(identityTrustDomain, userId)`, and within one trust domain a signing key is
pinned to at most one user. An [identity link](#identity-link) encodes its
trust domain; verification always uses the configured API, and a link for
another service is refused before any fetch.

Related docs:

- [trusted-user-identity.md](../developer/trusted-user-identity.md#pinning)
- [trusted-user-identity.md](../developer/trusted-user-identity.md#identity-links)
- [sdk-initialization.md](../developer/sdk-initialization.md#blob-storage-and-non-browser-hosts)

## Managed Principal

A group or [organization](#organization) whose membership and key epoch are
represented by a [signed principal policy chain](#principal-policy-state).
Managed-principal grants [fail closed](./access.md#fail-closed) when the policy
state or [member envelopes](./keys.md#member-envelope) needed for verification
are missing or stale.

Related docs:

- [access-plane.md](../access-plane.md#principals)
- [security-guarantees.md](../security-guarantees/properties.md#managed-grants-fail-closed)

## Organization

The top-level ownership and policy boundary for user data. Registration creates
a default organization, reserved `Admins` and `Members` groups, and a
[root container](./access.md#root-container). The organization row stores `adminGroupId`
and `memberGroupId`. Reachability through `Admins` is org-admin authority.
Reachability through `Members` is organization membership. Org-manager directory
lifecycle is stored in [organization roster entries](#organization-roster-entry)
so disabled users can remain visible after access removal. Organization policy
commits authority, not [container grants](./access.md#grant); org-manager
product roles come from the reserved groups.

Related docs:

- [container-dek-onboarding.md](../container-dek-onboarding.md)
- [protocol-specification.md](../protocol-specification/identity-and-policy.md#identity-and-session-handshake)

## Organization Admins Group

The reserved organization-scoped `Admins` group. Reachable users have
organization-admin authority, including admin-only org-manager mutations and
org-scoped [principal policy](#principal-policy-state) successor signing when
the API verifies that authority.

Related docs:

- [access-plane.md](../access-plane.md#principals)
- [security-guarantees.md](../security-guarantees/properties.md#admin-signer-authorization)

## Organization Members Group

The reserved organization-scoped `Members` group. Reachable users belong to the
organization. Active [roster entries](#organization-roster-entry) are
synchronized from this group's signed reachability, but disabled roster entries
may remain visible without granting access. `Admins` is not nested into
`Members` — principals contain only users — so the policy write instead rejects
any [managed principal](#managed-principal) naming a user who is not an active
roster entry, which keeps every admin an organization member.

Related docs:

- [organization-memberships.md](../organization-memberships.md)
- [access-plane.md](../access-plane.md#principals)

## Organization Read Model

The organization-scoped display and navigation data that the client keeps as
normalized SQLite [projections](./sync.md#projection-row) and reconciles from one
cursor-ordered feed, `GET /organizations/:organizationId/read-model`. Every
authoritative mutation that changes it advances the
[organization's](#organization) `organization_read_model_heads` cursor and, in
the same transaction, stamps each changed lane (directory, groups, group
memberships, grants, organization policy). A client without a cursor requests
an atomic snapshot; one with a cursor requests the lanes stamped after it. The
read model is not an authorization or cryptographic input: signed
[principal policies](#principal-policy-state), verified
[access manifests](./access.md#access-manifest), and
[checkpoints](./sync.md#checkpoint) remain authoritative. Sharing and
key-rotation probes therefore consume the organization policy's signed directory
of current group [heads](./sync.md#head), not the read model's group lane.

Related docs:

- [organization-read-model-sync.md](../organization-read-model-sync.md#authority-boundary)
- [organization-read-model-sync.md](../organization-read-model-sync.md#ordering-and-replay)
- [organization-read-model-sync.md](../organization-read-model-sync.md#snapshot-and-delta-contract)

## Organization Roster Entry

An organization-scoped product row that records directory lifecycle state for a
user. It stores server-visible routing/status metadata such as `status`,
`joinedAt`, `disabledAt`, `disabledByUserId`, and optional `profileDocumentId`.
It does not store plaintext profile fields such as email, first name, or last
name; those belong in [encrypted documents](./content.md#document).

Related docs:

- [access-plane.md](../access-plane.md#principals)
- [container-dek-onboarding.md](../container-dek-onboarding.md#adding-users-to-an-organization)

## Principal

An entity that can receive access or key material. Users are principals with
registered signing and encapsulation keys; groups and organizations are
[managed principals](#managed-principal) with
[signed policy state](#principal-policy-state).

Related docs:

- [access-plane.md](../access-plane.md#principals)
- [keying-design.md](../keying-design/overview.md#identity-and-principal-policy)

## Principal Policy State

The signed state chain for a [managed principal](#managed-principal). It commits
to membership, projection roots, [key epoch](./keys.md#epoch), encrypted payload
hash, signer, and predecessor state so clients can verify group or organization
authority.

Related docs:

- [protocol-specification.md](../protocol-specification/identity-and-policy.md#principal-policy-protocol)
- [security-guarantees.md](../security-guarantees/properties.md#principal-policy-integrity)
