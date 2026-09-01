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

Pins default to the canonical absolute `apiBaseUrl`, including its base path.
When a non-browser host uses a relative API URL, it must provide an absolute
`identityTrustDomain`; remote identity resolution fails closed if no stable,
host-controlled trust domain can be established.

## Scope And Lifecycle

TOFU detects server substitution after the first accepted sight in this trust
store. It does not authenticate a malicious first response or bootstrap trust
on a new device.

Pins survive SDK recreation, ordinary logout, remote-state reset, and
current-format local backup restore. Restore monotonically merges identity pins,
principal policy checkpoints, and access manifest checkpoints, and aborts on
overlapping conflicts. Older backup formats are rejected. Deliberately purging
or recreating the local database resets this security history and should be
presented to users as a security reset.
