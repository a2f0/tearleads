# Principal history availability

[`PrincipalHistory.tla`](./PrincipalHistory.tla) checks the availability contract
for both group and organization histories. Each counter summarizes a complete,
valid signed chain.
An authorized revocation remains enabled after ordinary updates cross the former
lifetime ceiling. Losing all verification progress does not prevent bounded
batches from walking the accepted history again.

| Model action or predicate | Production seam |
| --- | --- |
| `Commit` / `Revoke` | `storeVerifiedPrincipalStateInTransaction` validates the authorized successor and rotation commitments |
| `Recover` | `listGroupHistoryThroughHeads` batches history artifacts; `verifyPrincipalPolicySnapshot` walks the full signed chain |
| `LoseCaches` | `clearProcessVerificationMarkers` discards volatile manifest hints; `accessManifestVerifications` may be lost, and fresh SDK storage contains no recovered keys |
| `WriteAllowed` | `validatePrincipalStateIdentityFields` enforces exact representation without an artificial lifetime history budget |

The positive configuration crosses a small modeled ceiling for both principals.
Two negative controls restore the write cutoff or the cold traversal cutoff and
must violate `RevocationAvailable` or `RecoveryCanProgress`, respectively.
`MaxHistory` bounds exploration; a reserved successor allows revocation at that
bound. It is not a production history limit. The model checks enabled progress,
not eventual completion under an infinite sequence of restarts. With both caps
disabled the enabled-action invariants hold by construction; the negative
controls establish why either cutoff violates the contract.

This is separate from `ManifestHistory`: principal state versions and container
manifest history are different counters. Cryptographic validity, authorization,
rotation, exact numeric representation, storage, and resource consumption are
outside this abstraction. The API regression
`test/slow/principalHistoryAvailability.test.ts` seeds complete signed group and
organization chains through 16,384, submits the membership revocation through the
real compound endpoint, loses durable verification markers, and recovers an older
encrypted document with a fresh SDK database. `principalStateVersion.test.ts`
and `principalVersionStorage.test.ts` cover the wire/crypto and PostgreSQL
representation boundaries. Cold history cost remains linear; this model makes
no performance guarantee for arbitrarily large histories.

Run the full boundary scenario with
`bun run --cwd packages/api test:principal-history`. This opt-in suite serializes
the database backends because generating and cold-verifying 32,768 real signed
states is expensive. The default API suite runs the same workflow at 64 versions;
the default crypto and storage suites retain the numeric boundary regressions.

The [principal page model](./PrincipalHistoryPages.md) separately checks
publication of verified progress and retention of external-authority citations
across page boundaries.
