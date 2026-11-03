# Current policies during container sharing

The [Containers](../subsystems.md) workflows use
[private paged evidence](./principal-history-recovery.md#runtime-use) for
duplicate-share [epoch](../glossary.md#epoch) checks, group-share planning,
[grant](../glossary.md#grant) minting, and current-grant confirmation. These
reads discover the signed [organization](../glossary.md#organization) directory,
verify its [Admins](../glossary.md#organization-admins-group) reference, and
select the group's exact directory [head](../glossary.md#head). They do not
require the reader to be a group administrator; authoring a new group grant has
a separate authority check.

When a chosen name is supplied, the read binds it to the verified encrypted
group metadata before admitting the share's group
[checkpoint](../glossary.md#checkpoint). Metadata verification can advance its
own verified container and reserved-group checkpoints. Grant confirmation also
binds the caller's expected head, including its hash, version, key epoch, and
key fingerprint. A valid user-only [container](../glossary.md#container)
projection cannot confirm a group grant. The container projection is verified
against the admitted policy selections before its grants are inspected.

The [private custody lease](./principal-history-recovery.md#key-custody) spans
recovery, metadata verification, atomic checkpoint admission, and the consuming
callback. Session expiry rejects completion, and an escaped lifetime predicate
becomes false when the callback ends.
[Pending principal mutations](./principal-policy-outcomes.md#durable-principal-requests)
are recovered before directory discovery when the host supplies the recovery
capability. Verified current artifacts and authenticated history progress stay
in private storage; these reads do not manufacture or persist full bundles.

Runtime sharing requires private custody and paged reads. Missing custody or
pages refuses the operation; a recovery failure propagates without selecting a
complete-bundle reader.

An existing signed grant can be wrapped by a container administrator without
group or organization administration rights. A missing or changed grant enters
the [Current group-mutation context](./principal-current-mutations.md), which
checks fresh administrative authority and the chosen encrypted name again. A
concurrent rename therefore refuses the mint. A new grant requires a chosen
name; only an existing grant may omit it. The planner repairs stale ancestors,
selects the historical citations needed by each container, and preserves
retained recipient envelopes. Built-in clients submit the compound commit
through their durable mutation journal and exact receipt handling. Standalone
hosts own transport and outcome recovery, including the optional
pending-recovery callback. Policy and container acknowledgements remain inside
the lease; background
[descendant recitations](../security-guarantees.md#held-descendant-re-citation)
use the caller's session lifetime. Hosts must support nested private custody
leases during projection verification. Without a caller predicate, background
scheduling stays active by default; hosts supply a predicate to cancel it when
their session changes.

The verifier tests use real signed histories and SQLite with in-process page
transport, including encrypted-name recovery through the production metadata
reader and refusal of corrupt metadata evidence. Negative controls remove
name/head binding and introduce a fallback after page failure; each causes its
corresponding regression test to fail. Runtime mutation tests also cover a
container-only administrator, exact compound acknowledgement retention,
expired callers, and substituted receipts. Removing fresh name verification
permits the rename-race commit and fails its test; disabling Current routing
fails the no-full-read grant-mint test.

A held-child regression also checks that a successful share without a caller
predicate still starts descendant recitation after the private lease ends.
Using the expired lease as that background guard fails the regression.
