# Durable User Identity Trust

The client SDK [pins](../glossary/principals.md#identity-pin) complete user identity
bundles. One internal gateway fetches the `/auth/user-identity/:userId`
resource, validates it, and returns canonical
[ML-DSA-87](../cipher-suites.md#ml-dsa-87-signatures) and
[ML-KEM-1024](../cipher-suites.md#ml-kem-1024-key-encapsulation) public keys
plus both computed SHA-256 fingerprints. Every signature-verification and
user-recipient encryption workflow uses it; organization directory responses are
never accepted as cryptographic key input.

[Identity links](../glossary/principals.md#identity-link) establish independent
trust anchors. Adding a contact, enrolling a new or disabled
[roster](../glossary/principals.md#organization-roster-entry) (organization)
user, and creating a roster profile document require a verified link or this
device's own keys. Existing Members can also be added to groups or receive
read, write, or admin folder shares through [roster vouching](#roster-vouching):
a signed history chain authenticates their complete identity bundle back to a
`self` or `link` anchor. The SDK has no public lookup by user ID that trusts
the server's first answer.

## Pinning

The first valid bundle for `(identityTrustDomain, userId)` is inserted into
SQLite in an immediate transaction. Later exact observations pass: a repeat
whose stored pin matches every key field, holds the candidate's signing key
alone, and ranks at or above its provenance is answered by one read in a
deferred transaction, without the write lock. Pins are never deleted, keys
never change, and provenance only rises, so that read returns what the
transaction would; every other case takes the transaction. Any change to
either key, either fingerprint, suite, or format produces a typed hard failure
before key use or a mutation request. The current user's local keypairs are
authoritative and seed the same pin during registration or login.

### Provenance

Each pin records how it was established:

- `self`: this device's own local keys (registration, login, or the signed-in
  user's own identity).
- `link`: a verified identity link.
- `observed`: the server's first answer for a user that signed state already
  references, such as a
  [policy](../glossary/principals.md#principal-policy-state) signer, a group
  member being verified, or a roster entry being displayed. Signature
  verification keeps pinning on first sight so that it never
  [fails closed](../glossary/access.md#fail-closed) for users the device has not
  met. Policy signers and group members are resolved before signatures are
  checked, so their first answers stay in memory: a member's is pinned only
  once its signed projection verifies and the answer matches that member's
  committed bundle, and policy signer resolution alone pins nothing.

Only `self` and `link` admit a user, apart from
[roster vouching](#roster-vouching), which never changes a pin. Verifying a
link whose keys match an `observed` pin raises that pin to `link`; provenance
never falls back, and an `observed` sight of a linked user leaves it `link`. A
link whose keys differ from the pin fails exactly as before, and neither the
keys nor the provenance change. A local database whose pin table lacks the
provenance column is obsolete: the SDK refuses it with "reset the local
database", and there is no migration.

The binding also holds in reverse: within a
[trust domain](../glossary/principals.md#identity-trust-domain), a signing key
is pinned to at most one user. The same immediate transaction refuses a pin that
would bind a known signing key to a different user, and a unique index on
`(identityTrustDomain, signingKeyFingerprint)` backs it. This is what stops a
server from answering a login on a device with no restored session by rebinding
the device's own key to another account.

Registration therefore pins only once the server has confirmed the new user,
and before anything is persisted under it. Pinning the requested id first would
leave a pin for an id the server may never accept — after a lost response, or
when a restored key is already registered — and that pin would then refuse the
key's real user at login. Registration also declines, before contacting the
server, when this device already binds the key to a user: the new user's pin
would be refused only after the server had created the account. The caller
falls back to login, as it does when a registration's response is lost.

After an environment reset, a device keeps its trust store while the server
forgets every key, so such a device can neither register nor log in until its
local app data is cleared, as the
[environment reset runbook](greenfield-reset.md) describes.

### Trust Domain Configuration

The SDK's [trust-domain resolver](../../packages/client-sdk/src/data/trustedUserIdentity/trustDomain.ts)
defaults to the canonical absolute `apiBaseUrl`, including its base path.
Browser hosts resolve relative API URLs against their location. A non-browser
host with a relative API URL must supply an absolute `identityTrustDomain`;
remote identity resolution fails closed without a stable domain.

The API's [deployment resolver](../../packages/api/src/apiIdentityTrustDomain.ts)
uses `API_IDENTITY_TRUST_DOMAIN`, falling back to `API_PUBLIC_ORIGIN`. Both API
and SDK domains must match exactly, including a deployment base path. Set the
explicit API domain for path-prefixed deployments: the public origin has no
path. Behind a reverse proxy, configure the client-visible URL, not an internal
listener or a forwarded request header. An SDK `identityTrustDomain` override
must name that same stable domain. Both use the shared
[`canonicalIdentityTrustDomain`](../../packages/crypto/src/identityTrustDomain.ts)
to remove trailing slashes and reject credentials, queries, and fragments.
The API requires HTTPS in production; only non-production composition may fall
back to a request URL's origin when no domain is configured. Never use that
fallback as a deployment trust anchor.

Local web and native clients sharing one API database must also use the same
canonical domain. The Android development default `http://10.0.2.2:3001`
differs from the web default `http://localhost:3001`; these are not interchangeable
identity scopes. For cross-device development, set every client's API URL
(`BUN_PUBLIC_API_BASE_URL` for web and Electrobun, `VITE_API_BASE_URL` for
Capacitor) and the API's `API_IDENTITY_TRUST_DOMAIN` to one URL reachable from
all of them, before creating identities or policies. Changing only the API's
domain does not change a client's identity scope. Existing commitments are not
rewritten when configuration changes.

## Scope And Lifecycle

Pinning detects
[server substitution](../security-guarantees/boundaries.md#first-contact-identity-key-substitution)
after the first accepted sight in this trust store. An `observed` pin does not
authenticate a malicious first response, so it cannot admit anyone;
independently exchanged identity links authenticate the supplied bundle before
it admits a user. A roster chain extends that trust, not the first-sight pin
alone, and relies on every vouching administrator's identity assertions.

Pins survive SDK recreation, ordinary logout, remote-state reset, and
current-format local backup restore. Restore monotonically merges identity pins,
principal policy [checkpoints](../glossary/sync.md#checkpoint), and
[access manifest](../glossary/access.md#access-manifest) checkpoints, and aborts
on overlapping conflicts, including a backup that binds a pinned signing key to
a different user. Pin keys never change on restore; an overlapping pin keeps the
higher provenance of the two, so a backup can raise `observed` to `link` but
never lower one. Older backup formats, including those without pin provenance,
are rejected. Deliberately purging or recreating the local database resets this
security history and should be presented to users as a security reset.

Local content backup restore does not establish a remote login. After
restoring data, the user signs in with the matching identity to resume sync.
Restored trust pins and checkpoints still constrain that login and subsequent
projections. The explicit sign-in is intentional: restoring content must not
silently select an account or resume a remote session. Identity recovery and
data restoration are separate user actions.

Password-protected backups authenticate their contents with AES-GCM. Opting out
of a password removes both encryption and integrity protection: anyone with the
file can read or modify it. Restore enforces the device's existing pin and
checkpoint conflict rules, but imports previously unseen trust scopes from
the backup. A modified unencrypted backup can therefore seed new trust pins or
checkpoints, or mark a pin as `link` or `self` and so admit that user,
especially on a fresh device. Such a restore relies on the user
trusting the file's origin and integrity; structural validation does not
authenticate its contents.

Encryption authenticates the file against the supplied password, not the
identity of its author. Users must trust the source of a backup in either
format. The restore UI highlights unencrypted files and labels their action
"Restore Unencrypted Backup" so the user explicitly chooses that restore.

## Identity Links

`await tearleads.userIdentities.createLink(appUrl)` creates a public permalink
from the current user's local keys and registered user ID. It performs no
remote identity lookup. Give the link to peers through an authenticated channel.
It is reusable for anyone verifying this exact identity; it grants no access.
`createLinkFor(userId, appUrl)` re-shares another user's link only from a
`link` or `self` pin (`null` otherwise), so an `observed` key never becomes a
link that a recipient would pin as `link`.

`await tearleads.userIdentities.verifyLink(link)` fetches through the identity
endpoint, validates both keys, checks the independently supplied bundle
fingerprint, and only then compares or inserts the durable pin with `link`
provenance (raising a matching `observed` pin). A foreign service is refused
before fetching. A mismatch, unavailable identity, or changed active identity
fails without inserting a pin. Existing conflicting pins remain unchanged.
Links do not override pin conflicts.

`userIdentities.resolveVerified(userId)` returns an existing pin only when its
provenance is `link` or `self`, without a network lookup; it returns `null` for
an `observed` pin, exactly as for an unknown user. The admission paths build on
it:

- Contacts: Add by Identity Link verifies the link first. Import Into Contacts
  (a roster user's ID sent to Contacts) imports only a link-verified user and
  otherwise opens the identity-link form.
- Roster: Add by Identity Link verifies the link, then adds the user to the
  [Members group](../glossary/principals.md#organization-members-group).
- Groups: the add-member field takes an identity link, or a roster user that a
  link already verified or a [roster chain](#roster-vouching) authenticates.
  An active directory row selects a candidate; it is not identity evidence.
  New or disabled Members enrollment still requires a direct `self`/`link` pin.
- Explorer: Share with Peer verifies the other pane's published identity link
  when available; otherwise the SDK requires roster-chain admission. A
  folder's New Share to a User accepts either path for read, write, or admin
  access.
- Org Manager: opening a roster user without a profile document creates one
  only for a link-verified user; otherwise it asks for their identity link.

The SDK enforces the same rule below the app. `organizations.addUserToGroup`
and a container store's `shareWithUser` throw `UnverifiedUserIdentityError`
(code `user_identity_unverified`) for a target whose pin is missing or only
`observed`, unless the signed Members chain authenticates the target. Chain
verification may fetch evidence but must finish before the mutation. A
group-add proof is bound to its exact Members head and active runtime; if a
retry finds the user absent, automatic enrollment rechecks direct `self`/`link`
admission. The demo's dual panes publish each pane's identity link and verify
the peer's when available.

If Members advances after a group-add roster proof but before its mutation,
the SDK refuses with retryable `ProjectionDependencyUnavailableError`, not a
demand for another identity link. A new caller attempt must prove admission
against the new head; the SDK does not silently reuse the stale proof. Share
admission is not head-bound: it authenticates the recipient against the
Members head current when admission runs, and the share does not recheck that
head before writing or on retry.

The v1 URL is `/app/contacts/import/<token>`. The token is unpadded canonical
base64url of the UTF-8 JSON array `[1, identityTrustDomain, userId, fingerprint]`.
The fingerprint is lowercase SHA-256 of this UTF-8 `JSON.stringify` result:

```ts
JSON.stringify([
  "tearleads.identity-link.v1", identityTrustDomain, userId,
  "ML-DSA-87", signingPublicKey, "ML-KEM-1024", encapsulationPublicKey
])
```

Public keys use canonical base64. JSON tuple order is fixed. The trust domain
is the canonical API base URL, including its base path. The web destination is
only a launch location: verification uses the configured API and never switches
servers based on a link. Algorithm changes require a new link format.

Contacts and Roster accept identity links for manual onboarding (Add by
Identity Link), and a group's add-member field accepts a pasted link for a user
who is not in the roster. The Contacts route retains the token through unlock,
registration, and sign-in; importing requires an explicit Verify and Add
action. Contacts (on your own entry and the compact list) and Org Manager
expose Share my identity link. Native hosts use the corresponding production or
staging web app; custom deployments may configure
`AppHostConfig.identityLinkWebUrl`, which sharing requires on a native host
with another API. Opening a received link works without it.

A link authenticates the exact identity bundle provided by its owner. It cannot
rotate an existing pin; conflicting keys remain a hard failure. This format
does not prove currentness,
revocation, or the freshness of signed policies;
[transparency](../keying-design/verification.md#transparency-and-checkpointing)
and currentness remain open in
[#2186](https://github.com/a2f0/tearleads/issues/2186). Link-verification errors
are shown to the user; a mismatched supplied link alone is not attributed as a
server security incident.

## Signed Member Identity Commitments

Every group and organization projection, including genesis, requires a
lowercase 64-character SHA-256 `identityBundleFingerprint` for each member.
It is the complete [identity-link tuple](#identity-links), computed by the
shared [bundle fingerprint helper](../../packages/crypto/src/userIdentityBundle.ts),
not a signing-key-only or encapsulation-key-only hash.

The [projection encoder](../../packages/crypto/src/principalState.ts) hashes
`userId`, `role`, and `identityBundleFingerprint` into the signed
`projectionRoot`. `membershipRoot` remains an ID-set commitment;
`memberEnvelopesRoot` still commits the encryption envelopes. The
[transition verifier](../../packages/crypto/src/keying/principalPolicyTransition.ts)
rejects a changed bundle for any continuing member, even if their role or the
principal's own key epoch changes. This does not introduce identity rotation.

The API [recomputes commitments](../../packages/api/src/workflows/principals/principalIdentityBundles.ts)
from registered public keys in its configured trust domain and checks envelope
key fingerprints. The SDK [checks commitments](../../packages/client-sdk/src/data/principals/principalIdentityCommitments.ts)
against gateway-resolved bundles during policy verification. These structural
checks do not themselves authenticate an `observed` identity; admission still
needs an independent anchor or the chain below.

Structural verification can use the gateway's scoped
`withPinnedIdentities(ids, verify, { publish })` capability. It reads existing
immutable pins in one transaction, chunking SQL within the bind budget, and
revalidates their key material and fingerprints before checking every
projection commitment. A member without a pin is compared using the identity
endpoint's validated candidate, held in memory. The gateway pins those
candidates as `observed` only when `verify` succeeds and the caller set
`publish`, which it does only after the projection's signed state verified.
Signer collection resolves signers and checks commitments in one such scope
before signatures, so it never publishes: a forged projection, a refused
member, or a refused signer (for example one whose served encapsulation key
contradicts its committed bundle) leaves no pin to block the corrected retry
or the honest identity link. The external-authority refusal classifier
likewise resolves signers without pinning them. Every successful verification
of a collected bundle then pins its signers and committed members, resolving
them again and rechecking each signer's signed fingerprint and committed
bundle, so an answer changed since verification is refused, and a later
substituted answer conflicts with the verified pin instead of becoming one.
Each publication also runs the calling operation's own lifetime check inside
every pin's write transaction, so a cancelled recovery pins nothing. Any
answer a scope did not publish, even one its check accepted, is evicted from
the endpoint cache, because the caller's signature check may still refuse it:
a retry or a later signer lookup reads the endpoint again. A history page
pins nothing, because a page is not yet proven to reach the expected head: a
forged but self-consistent prefix would otherwise pin a substituted identity
that blocks the corrected history. The signers of pages a recovery accepts
are recorded with the bundles their predecessors committed (a founder with no
predecessor, with the bundle its own signed projection commits) and published
only after the whole chain reaches its head, so a departed signer that
appears in no selected projection is still pinned; a recovery resumed from saved
progress publishes only the signers of pages it accepted itself. History
verification revision 4 makes progress and prefixes saved before these
bindings replay rather than resume. A scope
publishes all of its staged first sights in one write transaction, so a
conflict or cancellation on any of them pins none. Each page's first signer
is authorized only
by user ID against the last accepted state, and a member that state's
successor removes is not rechecked for continuity, so signer collection
requires every signer whose state links to a known predecessor to resolve to
the identity bundle that predecessor's signed projection committed; the chain
verifier's sealed progress carries the last accepted projection across pages
and resumes. Public and private
history selections recheck every projection they return, from fresh pages and
restored prefixes alike, and publish there: a restored prefix reads no page,
so a member substituted after it was verified cannot act under its cached
membership. Cached and freshly verified keying policies likewise recheck
their history's projections, not only the current one. A resolver wrapper,
such as the projection key cache, must forward `withPinnedIdentities`:
without it, a check before signatures falls back to ordinary resolution and
pins an unsigned member on first sight. The current user
always rechecks authoritative local keys. Database, account, or
runtime-generation changes invalidate the operation. The callback's resolver
is not a persistent cache.
Ordinary resolution, including access-event and document-writer signer
lookups, still fetches and compares candidates with durable pins. Inside a
scope, an existing pin is used as stored, so a conflicting served answer cannot
replace it. Neither path promotes an `observed` pin to an admission anchor.

This is a [reset-only format change](greenfield-reset.md#identity-bound-principal-format),
not a migration or fingerprint backfill. Accepting it does not authorize
resetting a deployed environment.

## Roster Vouching

The [recipient-admission gate](../../packages/client-sdk/src/client/organizations/recipientAdmission.ts)
first accepts a direct `self`/`link` pin. Otherwise it asks the
[Members-chain verifier](../../packages/client-sdk/src/workflows/organizations/memberships/rosterVouchedAdmission.ts)
to authenticate the target's full bundle. Without a pin, it checks the
identity endpoint's answer staged in memory, and pins it as `observed` only
once the chain authenticates that exact bundle, so a substituted answer leaves
no pin and a corrected retry or the honest link still succeeds. A historical
signer the chain needs but this device never pinned, such as a departed admin
seen only in older Members states, is staged the same way: its answer is
checked against its committed Members bundle and pinned only with the vouched
recipient. The verifier
checks:

1. The verified current Members projection must contain the target's exact
   bundle commitment, and its envelope must name the pinned encapsulation key.
2. Walk verified history back to the start of the target's current, unbroken
   membership. That state must commit the same bundle and be signed by someone
   else. Its served envelopes must match the signed root and member set, with
   the target's pinned encryption-key fingerprint.
3. Bind that signer's signed fingerprint and any committed member bundle to
   their pin. A `self`/`link` signer is an anchor, even without Members history.
   Otherwise find the signer's most recent membership segment strictly before
   the state they signed and authenticate its admitting signer in turn. A
   signer who has since departed can still vouch for an earlier admission.
4. Require the chain to reach an independent anchor. Cycles, self-admission,
   missing evidence, and exhausted bounds cannot authorize a recipient.
   Conflicting bundle commitments or signer fingerprints fail verification;
   pins are never replaced to trust another bundle.

The [history reader](../../packages/client-sdk/src/workflows/organizations/memberships/rosterAdmissionHistory.ts)
shares one backward page scan across the chain: at most 64 pages, each with at
most 32 entries. The chain verifier visits at most 64 distinct non-anchor
identities. These are local admission bounds, not a guarantee of total network
requests or that every valid historical chain fits. Missing or out-of-bounds
evidence calls for a direct identity link, never an override of conflicting pins.

The result permits group adds and read, write, and admin shares for existing
Members. New or disabled Members enrollment still requires the adding device's
direct `self`/`link` pin. Vouching does not persist chain provenance or raise an
`observed` pin: `resolveVerified` and `createLinkFor` remain direct-pin-only and
return `null` for a chain-admitted user without such a pin.

This is transitive trust in administrators, including their mistakes or
malice. An authenticated admin can vouch for a false identity, and later
admins can extend that trust; valid signatures do not prove that each admin
checked the right person. An observed-only chain with no independent anchor
cannot establish trust. No anchor-exchange workflow, cold-start rollback
protection, or fork-consistency guarantee is added: a device that has not seen
a removal may still accept an older, internally valid roster.
