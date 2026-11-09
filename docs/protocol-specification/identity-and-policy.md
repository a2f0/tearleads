# Protocol Specification: Identity And Policy

Part of the [protocol specification](../protocol-specification.md).

## Identity And Session Handshake

Registration is a
[bootstrap protocol](../container-dek-onboarding.md#registration-flow), not only
an account create call. `POST /auth/register` submits:

- `userId`, `organizationId`, and `rootContainerId`
- signing and encapsulation public keys, each as canonical padded base64 of
  its fixed-length bytes
- the initial reserved [`Admins` group](../glossary/principals.md#organization-admins-group)
  policy and direct [member envelope](../glossary/keys.md#member-envelope)
- the initial reserved
  [`Members` group](../glossary/principals.md#organization-members-group)
  policy, holding the registering user
- the initial signed [organization](../glossary/principals.md#organization)
  policy state and direct member envelope
- signed create requests for the [root container](../glossary/access.md#root-container),
  its metadata document, and the organization metadata container
- optional create requests for the organization profile document, the
  roster-profile container and document, and initial system containers

The API validates the user key fingerprints, creates the user, organization,
reserved groups, initial principal policies, and every requested container, KEK
state, and metadata or profile document in one transaction, then returns a login
challenge. The initial `Admins` policy must project the registering user as the
sole admin. The initial `Members` policy must project the registering user as
admin. The initial organization policy must target the new organization, be
version `1`, use key epoch `1`, be signed by the registering user, project only
the registering user as admin, and carry a version-2 authority descriptor
committing the exact initial heads of both reserved groups.

The response returns each created container and document head, each acknowledged
by hash as described under container mutation conflicts below. The client checks
every one against the request it signed before pinning it as a local
verification [checkpoint](../glossary/sync.md#checkpoint). The acknowledged
heads of the roster and organization profile documents also seed discovery
evidence, and the founding policy heads seed verified
[recovery progress](../developer/principal-history-recovery.md), so the device
fetches neither those documents' writer projections nor the founding groups'
history. Each created container whose acknowledged head equals the epoch-1
create the registering identity signed also seeds the immutable destination
role (creator, metadata document, system slot, fixed parent and path root)
that hydration would otherwise verify from a writer projection: the
acknowledged root, the organization metadata root, and the system children of
that root. Seeded roles authorize nothing; their reuse still rechecks the
session-root creator, and a mismatch seeds nothing, so hydration verifies
online. A container's writer projection is read on its first write. Creating
an additional organization follows the same rule.

`organizations.adminGroupId` is the reserved org-admin authority. Reachability
through it grants org-admin behavior. `organizations.memberGroupId` is the
reserved [org-membership](../organization-memberships.md) authority. Reachability
through it drives active roster state; disabled
[roster rows](../glossary/principals.md#organization-roster-entry) can remain visible
without access. The organization principal policy remains signed principal
state, but it is not the product role source for org-manager.

[Organization read-model](../organization-read-model-sync.md) and data-usage
denials use `organization_presentation_access_denied` on both the existing `403`
access denial and `404` missing-organization responses. The code gives clients
exact authority to hide and purge that requester's local presentation projection
without matching diagnostic text. An uncoded, malformed, or unknown failure is
ambiguous: clients report it and retain last-known-good data.

A warm organization read-model client discards its opaque cursor and requests a
fresh snapshot only for the exact `400 organization_read_model_cursor_invalid`
failure. Other `400` responses, missing or malformed codes, unknown codes, and
the cursor code on another status retain the last-known-good projection and are
reported instead of triggering reset behavior. Only a valid cursor ahead of the
head converges through a `200` snapshot; others get a delta.

Authentication uses challenge signing:

1. `POST /auth/challenge` stores a short-lived challenge for a registered
   signing-key fingerprint.
2. `POST /auth/verify` verifies the signature (canonical padded base64 of the
   [ML-DSA-87](../cipher-suites.md#ml-dsa-87-signatures) signature bytes) over
   the challenge and this API's origin, then issues a session token and its
   first single-use, sixty-second websocket ticket; later connects mint one with
   `POST /auth/ws-ticket`.
3. `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`, and
   `POST /auth/logout` manage authenticated session tokens.
4. Authenticated mutation routes require the session user and fingerprint to
   match the signer fields embedded in signed access events or write headers.

A `401 session_refresh_required` response means the bearer token identified a
missing, expired, or invalid stored session and permits the client to renew and
replay a replayable request. Missing or malformed bearer credentials remain an
uncoded terminal `401`; clients never infer refresh behavior from `error` text.

The session authenticates the transport caller. Signed access events, principal
states, and write headers are the protocol proofs that bind mutations and
content records to cryptographic authority.

## Principal Policy Protocol

Groups and organizations are managed by signed principal-state chains. The
generic policy `PUT` accepts organization successors only; standalone group
writes fail closed because they cannot advance the signed group directory.
Organization-group successors use
`PUT /organizations/:organizationId/groups/:groupId/policy-commit`, which
atomically stores the group successor and an organization-policy successor
whose authority descriptor commits the new exact group head.
Group creation uses the same rule: `POST /organizations/:organizationId/groups`
stores the group row, initial group policy, and matching organization-policy
successor in one transaction, or stores none of them.

These writes, group deletion, and the organization policy `PUT` acknowledge
each policy they stored by its head, the server-assigned `createdAt` of the
state and payload, and the hash-form container mutation acknowledgements; they
never echo the signed request. The author refuses an acknowledgement whose head
differs from the one its own signed state commits to, rebuilds the acknowledged
current from that state and its artifacts, and verifies the signature and
successor rule on those bytes before retaining it
([mutation acknowledgements](../principal-history-transport.md#mutation-acknowledgements)).
An exact replay of a committed request returns the same heads from its
actor-bound receipt after rechecking organization administrator access.

A state commits the [principal](../glossary/principals.md#principal) identity,
version and predecessor, key epoch and encapsulation key, membership/projection/envelope
roots, payload hash, member count, signer identity, and timestamp. The API
verifies those commitments, signature, chain, and admin-signer rule before
atomically storing the state, payload, projection, and exact envelope set.
Initial signers are admins in the new projection; successor signers are admins
in the prior projection or, for org-scoped updates, independently proven members
of the reserved `Admins` group. Clients verify the complete bundle again before
caching or key use.

Public keys and envelope fields use canonical base64 and exact
[ML-KEM-1024](../cipher-suites.md#ml-kem-1024-key-encapsulation) sizes: 1568-byte
public keys/ciphertexts and a 3184-byte wrapped secret plus AES-GCM tag.
Envelopes cover the direct projection one-to-one and bind each member id,
recipient fingerprint, KEM ciphertext, and wrapped key. The root does not commit
active state; separate policy validation binds the principal and key epoch.
Principal-state signing and hashing use the domain `tearleads.principal-state`.

`memberEnvelopesRoot` is mandatory; a state missing it, required policy
material, or envelope material fails closed.

`GET /principals/:principalType/:principalId/policy` serves one pinned head
in pages ([history transport](../principal-history-transport.md)). Every read
applies live read authorization and verifies the current policy first. An
unpinned discovery read may name the head the client holds with `ifVersion`
and `ifStateHash`; when that is the live head, the reply is
`{unchanged: true, head}` and carries no artifacts, otherwise it is the first
page. The reply proves only freshness: the client authenticates the held head
from its own verified history and re-reads unconditionally on any other reply.
