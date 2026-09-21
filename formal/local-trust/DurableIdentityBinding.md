# Durable identity binding

[`DurableIdentityBinding.tla`](./DurableIdentityBinding.tla) covers finding 3
in #2329: a new session must not let the API bind a previously pinned signing
fingerprint to another user in the same trust domain.

`Login` models the immediate transaction in
`compareOrInsertTrustedUserIdentityPin` and publication after `pinLocal`
succeeds. The existing user pin must match, and the reverse fingerprint lookup
must not name another user. The unique SQLite index enforces the same reverse
mapping for concurrent database clients. `Reboot` discards session
acknowledgments while retaining all pins. Refused attempts leave state unchanged.

The bounded configuration explores two domains, users, and fingerprints. It
checks immutable pins, an injective fingerprint mapping within each domain,
and that published sessions match durable pins. Disabling the reverse check
reproduces a login, reboot, and second login that assigns one fingerprint to
two users. Different trust domains remain independent.

This models transactional persistence as atomic. It does not prove SQL locking,
cryptographic fingerprint validation, first-contact identity authenticity, or
disk integrity. Runtime tests cover concurrent adapters, session recreation,
incident reporting, and rejection before authentication publication.
