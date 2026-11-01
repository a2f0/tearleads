# Durable identity binding

[`DurableIdentityBinding.tla`](./DurableIdentityBinding.tla) checks that a new
session cannot let the API bind a previously pinned signing fingerprint to
another user in the same trust domain, and that only a pin established by an
identity link or this device's own keys admits a user (#2695).

| Model action or predicate | Production seam |
| --- | --- |
| `Login` / `CheckPinCompare` | `compareOrInsertTrustedUserIdentityPin` compares or inserts the pin in one immediate transaction; an exact repeat of a sole-owner pin is answered by one read in a deferred transaction |
| `CheckReverseBinding` | `compareOrInsertTrustedUserIdentityPin` refuses a signing key already bound to another user; `trustedUserIdentityPins` backs it with a unique index |
| `Reboot` | `SessionIdentityAcknowledgments` holds only in-memory acknowledgments, while `trustedUserIdentityPins` persist |
| `SigningFingerprintsHaveOneUser` | `loadTrustedUserIdForSigningKey` finds at most one user per signing key |
| `PinCompare` / `RaiseProvenanceOnly` / `ProvenanceOnlyRises` | `compareOrInsertTrustedUserIdentityPin` keeps the stored keys and raises only `provenance`, by `provenanceRank`, never lowering it |
| `Login` | `pinLocal` pins the user's own local keys as `self` |
| `Resolve` | `resolve` pins a server answer as `observed`; `verifyLink` compares an independently received identity link and pins it as `link` |
| `Admit` / `CheckAdmissionProvenance` | `requireVerified` and `resolveVerified` read the pin without writing it and refuse `observed` with `UnverifiedUserIdentityError` |
| `AdmittedUsersAreLinked` | contact drafts and import admit through `resolveVerified`; roster import, group add, and folder share through `requireVerified` |

`Login` models the immediate transaction in
`compareOrInsertTrustedUserIdentityPin` and publication after `pinLocal`
succeeds. The existing user pin must match, and the reverse fingerprint lookup
must not name another user. A repeat whose stored pin already matches, holds
the key alone, and ranks at or above the candidate's provenance writes nothing,
so its committed read is the same `Login` step with no state change. The unique
SQLite index enforces the same reverse mapping for concurrent database clients.
`Reboot` discards session acknowledgments while retaining all pins. Refused
attempts leave state unchanged.

`PinCompare` is the shared compare-or-insert: `Login` runs it with `self`
provenance and then publishes the session, and `Resolve` runs it with
`observed` (a server answer for a user signed state references) or `link` (a
verified identity link) without publishing anything. Matching keys keep the
stored row and raise its provenance when the candidate ranks higher
(`observed` < `link` < `self`); keys never change. `Admit` models admission
(contact, roster import, group add, folder share): it reads the pin and
requires `link` or `self` provenance.

The bounded configuration explores two domains, users, and fingerprints. It
checks immutable pins, an injective fingerprint mapping within each domain,
that published sessions match durable pins, that provenance only rises
(`ProvenanceOnlyRises`), and that every admitted user is pinned by a link or
the device's own keys (`AdmittedUsersAreLinked`). Disabling the reverse check
reproduces a login, reboot, and second login that assigns one fingerprint to
two users. Disabling the compare (`CheckPinCompare = FALSE`) lets a login
presenting another key replace a user's pin, violating `PinsNeverChange`, so
that property no longer holds by construction. Admitting on any pin
(`CheckAdmissionProvenance = FALSE`, control `admission-accepts-observed-pin`)
admits a user the device only observed from the server, violating
`AdmittedUsersAreLinked`. Writing the candidate's provenance over the stored
one (`RaiseProvenanceOnly = FALSE`, control `observed-lowers-linked-pin`) lets
a later server answer demote a linked pin, violating `ProvenanceOnlyRises`.
`service.provenance.test.ts` covers the same rules in the SDK. Different trust
domains remain independent.

This models transactional persistence as atomic. It does not prove SQL locking,
cryptographic fingerprint validation, first-contact identity authenticity, or
disk integrity. Runtime tests cover concurrent adapters, session recreation,
incident reporting, and rejection before authentication publication.

`Login` and `Resolve` are the only actions that write pins. Registration and
backup restore also write them and are not modeled; each is held to the same
rule in code instead. Registration pins only after the server confirms the
new user, so it behaves like a confirmed login, and restore refuses a backup
that binds a pinned key to another user. Their tests cover both.
