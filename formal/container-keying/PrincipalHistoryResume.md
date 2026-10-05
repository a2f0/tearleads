# Authenticated principal-history resumption

[`PrincipalHistoryResume.tla`](./PrincipalHistoryResume.tla) checks that restoring
locally protected progress cannot invent a checked prefix, substitute its
verification scope, or forget an observed external-authority citation. A saved
prefix may be older than the live one; restoring it repeats work and must not be
confused with a monotonic application checkpoint or a completed operation.

| Model action or predicate | Production seam |
| --- | --- |
| `VerifyPage` | `PrincipalPolicyHistoryVerifierImpl.append` publishes an accepted page; page validation is covered by the page model |
| `Save` | `exportProgress` captures accepted private state before asynchronous encryption |
| `Crash` | Discarding `PrincipalPolicyHistoryVerifierImpl` loses its volatile progress |
| `Restore` | `openPrincipalHistoryProgress`, `normalizeAuthenticatedPrincipalHistoryProgress`, and the private constructor authenticate and restore saved state |
| `ProgressBinding` | `ownPrincipalHistoryProgressProtection` binds the local key, verification revision, operation context, scope, checkpoint, and requested references |
| `AuthorityProgress` | Restoration preserves `latestAuthority`, including after an uncited page |

Three negative controls accept unauthenticated state, ignore the verification
binding, or forget the saved authority. They must violate `NoInventedProgress`,
`ProgressBinding`, and `AuthorityProgress`, respectively.

The model assumes the local protection key is private and cryptographic
verification of each page is correct. Equality of saved/offered data abstracts
unforgeable authenticated encryption; it is not a cryptographic proof. One
opaque binding abstracts all input fields and the local operation context.
Runtime tests exercise those fields and real encryption separately.

Concurrent calls, byte limits, storage transactions, replay ordering, key
custody, current authorization, and HTTP deadlines remain outside this model.
In particular, it does not prove that a saved prefix is current, that a database
write persisted it, or that restoring old progress cannot repeat work. Clients
must still pin an exact final head and protect monotonic checkpoint publication;
API and SDK integration remains in #2448.
