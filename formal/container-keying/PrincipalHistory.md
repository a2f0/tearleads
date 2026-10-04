# Principal history availability

`PrincipalHistory.tla` checks the availability contract for both group and
organization histories. Each counter summarizes a complete, valid signed chain.
An authorized revocation remains enabled after ordinary updates cross the former
lifetime ceiling. Losing all verification progress does not prevent bounded
batches from walking the accepted history again.

The positive configuration crosses a small modeled ceiling for both principals.
Two negative controls restore the write cutoff or the cold traversal cutoff and
must violate `RevocationAvailable` or `RecoveryCanProgress`, respectively.
`MaxHistory` bounds exploration; a reserved successor allows revocation at that
bound. It is not a production history limit. The model checks enabled progress,
not eventual completion under an infinite sequence of restarts.

This is separate from `ManifestHistory`: principal state versions and container
manifest history are different counters. Cryptographic validity, authorization,
rotation, exact numeric representation, storage, and resource consumption are
outside this abstraction. The API regression
`principalHistoryAvailability.test.ts` seeds complete signed group and
organization chains through 16,384, submits the membership revocation through the
real compound endpoint, loses durable verification markers, and recovers an older
encrypted document with a fresh SDK database. `principalStateVersion.test.ts`
and `principalVersionStorage.test.ts` cover the wire/crypto and PostgreSQL
representation boundaries. Cold history cost remains linear; this model makes
no performance guarantee for arbitrarily large histories.
