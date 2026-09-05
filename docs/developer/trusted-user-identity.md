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

Password-protected backups authenticate their contents with AES-GCM. Opting out
of a password removes both encryption and integrity protection: anyone with the
file can read or modify it. Restore still enforces the existing device's pin
and checkpoint conflict rules, but imports previously unseen trust scopes from
the backup. A modified unencrypted backup can therefore seed new trust pins or
checkpoints, especially on a fresh device. Such a restore relies on the user
trusting the file's origin and integrity; structural validation does not
authenticate its contents.

Encryption authenticates the file against the supplied password, not the
identity of its author. Users must trust the source of a backup in either
format. The restore UI highlights unencrypted files and labels their action
"Restore Unencrypted Backup" so the user explicitly chooses that restore.
