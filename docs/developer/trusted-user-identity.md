# Durable User Identity Trust

The client SDK pins complete user identity bundles. One internal gateway
fetches the `/auth/user-identity/:userId` resource, validates it, and returns
canonical ML-DSA-87 and ML-KEM-1024 public keys plus both computed SHA-256
fingerprints. Every signature-verification and user-recipient encryption
workflow uses it; organization directory responses are never accepted as
cryptographic key input.

Identity links are the only way to admit another user. Adding a contact,
adding a roster (organization) user, adding a user to a group, sharing a folder
with a user, and creating a roster profile document all require an identity
that a verified [identity link](#identity-links), or this device's own keys,
established. The SDK has no public lookup by user ID that trusts the server's
first answer.

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
  references, such as a policy signer, a group member being verified, or a
  roster entry being displayed. Signature verification keeps pinning on first
  sight so that it never fails closed for users the device has not met.

Only `self` and `link` admit a user. Verifying a link whose keys match an
`observed` pin raises that pin to `link`; provenance never falls back, and an
`observed` sight of a linked user leaves it `link`. A link whose keys differ
from the pin fails exactly as before, and neither the keys nor the provenance
change. A local database whose pin table lacks the provenance column is
obsolete: the SDK refuses it with "reset the local database", and there is no
migration.

The binding also holds in reverse: within a trust domain, a signing key is
pinned to at most one user. The same immediate transaction refuses a pin that
would bind a known signing key to a different user, and a unique index on
`(identityTrustDomain, signingKeyFingerprint)` backs it. This is what stops a
server from answering a login on a device with no restored session by
rebinding the device's own key to another account.

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

Pins default to the canonical absolute `apiBaseUrl`, including its base path.
When a non-browser host uses a relative API URL, it must provide an absolute
`identityTrustDomain`; remote identity resolution fails closed if no stable,
host-controlled trust domain can be established.

## Scope And Lifecycle

Pinning detects server substitution after the first accepted sight in this
trust store. An `observed` pin does not authenticate a malicious first
response, so it cannot admit anyone; independently exchanged identity links
authenticate the supplied bundle before it admits a user.

Pins survive SDK recreation, ordinary logout, remote-state reset, and
current-format local backup restore. Restore monotonically merges identity pins,
principal policy checkpoints, and access manifest checkpoints, and aborts on
overlapping conflicts, including a backup that binds a pinned signing key to a
different user. Pin keys never change on restore; an overlapping pin keeps the
higher provenance of the two, so a backup can raise `observed` to `link` but
never lower one. Older backup formats, including those without pin provenance,
are rejected. Deliberately purging or
recreating the local database resets this security history and should be
presented to users as a security reset.

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
  Members group.
- Groups: the add-member field takes an identity link, or a roster user that a
  link already verified; otherwise it asks for the person's identity link.
- Explorer: Share with Peer verifies the other pane's published identity link
  before sharing.
- Org Manager: opening a roster user without a profile document creates one
  only for a link-verified user; otherwise it asks for their identity link.

The SDK enforces the same rule below the app. `organizations.addUserToGroup`
and a container store's `shareWithUser` throw `UnverifiedUserIdentityError`
(code `user_identity_unverified`) for a target whose pin is missing or only
`observed`, before any request. The demo's dual panes publish each pane's
identity link and verify the peer's before admitting it.

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

A link authenticates the exact identity bundle provided by its owner. Rotation
requires a new authenticated exchange. This format does not prove currentness,
revocation, or the freshness of signed policies; transparency and currentness
remain open in [#2186](https://github.com/a2f0/tearleads/issues/2186).
Link-verification errors are shown to the user; a mismatched supplied link
alone is not attributed as a server security incident.
