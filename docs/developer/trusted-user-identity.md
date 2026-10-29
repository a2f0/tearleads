# Durable User Identity Trust

The client SDK applies trust on first use (TOFU) to complete user identity
bundles. `tearleads.userIdentities.resolve(userId)` fetches the
`/auth/user-identity/:userId` resource, validates it, and returns canonical
ML-DSA-87 and ML-KEM-1024 public keys plus both computed SHA-256 fingerprints.
Every signature-verification and user-recipient encryption workflow uses the
same internal gateway; organization directory responses are never accepted as
cryptographic key input.

## Pinning

The first valid bundle for `(identityTrustDomain, userId)` is inserted into
SQLite in an immediate transaction. Later exact observations pass. Any change
to either key, either fingerprint, suite, or format produces a typed hard
failure before key use or a mutation request. The current user's local keypairs
are authoritative and seed the same pin during registration or login.

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

TOFU detects server substitution after the first accepted sight in this trust
store. TOFU alone does not authenticate a malicious first response or bootstrap
trust on a new device; independently exchanged identity links do authenticate
the supplied bundle before its first pin.

Pins survive SDK recreation, ordinary logout, remote-state reset, and
current-format local backup restore. Restore monotonically merges identity pins,
principal policy checkpoints, and access manifest checkpoints, and aborts on
overlapping conflicts, including a backup that binds a pinned signing key to a
different user. Older backup formats are rejected. Deliberately purging or
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
checkpoints, especially on a fresh device. Such a restore relies on the user
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
fingerprint, and only then compares or inserts the durable pin. A foreign
service is refused before fetching. A mismatch, unavailable identity, or changed
active identity fails without inserting a pin. Existing conflicting pins remain
unchanged. The Add by Identity Link actions finish verification before changing
Contacts or Roster. Links do not override pin conflicts.

`userIdentities.resolvePinned(userId)` reads an existing durable pin without a
network lookup or first-use trust. Import Into Contacts (which sends a roster
user's ID to Contacts) and adding a roster user to a group reuse any existing
pin, regardless of how or when it was established, and ask for an identity
link when none exists.
`userIdentities.resolve` establishes TOFU pins, and Explorer sharing, signer
lookups, and Org Manager's roster profiles use it: when an admin opens a roster
user that has no profile document, Org Manager resolves that user to create
one. A pin created by one of these flows can therefore be reused for a contact
import or group membership without exchanging a link. This preserves
continuity with the earlier accepted key; it does not establish out-of-band
authentication.

Pin provenance is not stored, so `resolvePinned` cannot assert that a link was
ever verified. Hosts that require an authenticated exchange for every admission
must use `verifyLink`, even when a pin already exists. The Add by Identity Link
actions do this. An unpinned directory row must supply a link; directory
projections alone grant no trust.

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
