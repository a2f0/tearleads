# Current policies during container sharing

The Containers workflows use private paged evidence for duplicate-share epoch
checks, group-share planning, grant minting, and current-grant confirmation.
These reads discover the signed organization directory, verify its Admins
reference, and select the group's exact directory head. They do not require
the reader to be a group administrator; authoring a new group grant has a
separate authority check.

When a chosen name is supplied, the read binds it to the verified encrypted
group metadata before admitting the share's group checkpoint. Metadata
verification can advance its own verified container and reserved-group
checkpoints. Grant confirmation also binds the caller's expected head,
including its hash, version, key epoch, and key fingerprint. A valid user-only
container projection cannot confirm a group grant. The container projection is
verified against the admitted policy selections before its grants are
inspected.

The private custody lease spans recovery, metadata verification, atomic
checkpoint admission, and the consuming callback. Session expiry rejects
completion, and an escaped lifetime predicate becomes false when the callback
ends. Pending principal mutations are recovered before directory discovery
when the host supplies the recovery capability. Verified current artifacts and
authenticated history progress stay in private storage; these reads do not
manufacture or persist full bundles. A later legacy consumer can therefore
need a network read for its full bundle.

Hosts that provide private custody and paged reads use this path. A failure
after selecting it propagates without retrying through the complete-bundle
reader. Hosts without the capability retain the existing complete-bundle path.

An existing signed grant can be wrapped by a container administrator without
group or organization administration rights. A missing or changed grant enters
the Current group-mutation context, which checks fresh administrative
authority and the chosen encrypted name again. A concurrent rename therefore
refuses the mint. A new grant requires a chosen name; only an existing grant
may omit it. The planner repairs stale ancestors, selects the historical
citations needed by each container, and preserves retained recipient
envelopes. The compound commit uses the host's durable mutation journal and
exact receipt handling. Policy and container acknowledgements remain inside
the lease; background descendant recitations use the caller's session
lifetime. Hosts must support nested private custody leases during projection
verification.

The verifier tests use real signed histories and SQLite with in-process page
transport, including encrypted-name recovery through the production metadata
reader and refusal of corrupt metadata evidence. Negative controls remove
name/head binding and introduce a fallback after page failure; each causes its
corresponding regression test to fail. Runtime mutation tests also cover a
container-only administrator, exact compound acknowledgement retention,
expired callers, and substituted receipts. Removing fresh name verification
permits the rename-race commit and fails its test; disabling Current routing
fails the no-full-read grant-mint test.
