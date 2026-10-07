# Current policy reads during container sharing

The Containers workflows use private paged evidence for duplicate-share epoch
checks and confirmation that a container has the expected current group grant.
These reads discover the signed organization directory, verify its Admins
reference, and select the group's exact directory head. They do not require the
reader to be a group administrator; authoring a new group grant has a separate
authority check.

When a chosen name is supplied, the read binds it to the verified encrypted group
metadata before admitting the share's group checkpoint. Metadata verification can
advance its own verified container and reserved-group checkpoints. Grant
confirmation also binds
the caller's expected head, including its hash, version, key epoch, and key
fingerprint. A valid user-only container projection cannot confirm a group grant.
The container projection is verified against the admitted policy selections
before its grants are inspected.

The private custody lease spans recovery, metadata verification, atomic checkpoint
admission, and the consuming callback. Session expiry rejects completion, and an
escaped lifetime predicate becomes false when the callback ends. Pending principal
mutations are recovered before directory discovery when the host supplies the
recovery capability. Verified current artifacts and authenticated history progress
stay in private storage; these reads do not manufacture or persist full bundles.
A later legacy consumer can therefore need a network read for its full bundle.

Hosts that provide private custody and paged reads use this path. A failure after
selecting it propagates without retrying through the complete-bundle reader.
Hosts without the capability retain the existing complete-bundle path. Actual
share mutation planning and grant minting are separate adoption work; this change
covers the preliminary epoch read and post-mutation grant confirmation.

The verifier tests use real signed histories and SQLite with in-process page
transport, including encrypted-name recovery through the production metadata
reader and refusal of corrupt metadata evidence. Negative controls remove
name/head binding and introduce a fallback after page failure; each causes its
corresponding regression test to fail.
