# Current principal-policy consumers

Org Manager label hydration and runtime metadata-root verification also use
paged current policies when the runtime provides private history custody. Labels
bind to the exact signed directory and group heads. Their current artifacts stay
paired with verified policies; they are never stored as fabricated full bundles.
Directory/Admins admission still checks durable pins, and name reads alone do not
advance other group checkpoints. Metadata roots select their exact older Admins
and Members citations, so an honest stale root remains distinguishable from a
forged reference. These paths retain offline recovery and operation-lifetime
checks. A caller that selected an exact current head can first recover matching
authenticated local artifacts, rechecking their history proofs, dependencies,
lease and durable pins. Missing evidence or a different cached current head uses
the bounded online reader; other verification failures remain failures. This
does not discover newer server state or replace live object authorization.
Metadata verification uses the organization head supplied by its live writer
projection. Directory recovery is shared within one caller's batch while keeping
the original lease guard; expiry requires a new batch even if a later caller is
still live. Local attempts share the caller batch under a separate offline key.
Discovery, label verification and metadata-root verification share that batch.
The discovery page is untrusted input to the ordinary signature verifier, and
continuation reads remain bound to its exact current artifacts. Additional
historical directory or Admins citations use authenticated local proofs for the
already selected head. They keep the source lease and cannot replace the batch's
directory with a newer private prefix. A new batch can discover a newer head.
Mutation builders, full policy-history views, direct
share adapters and hosts without the paged resolver still require further adoption.

See [durable recovery](principal-history-recovery.md) for the underlying paging,
private custody, and checkpoint contracts.

## Request costs

A cold Org Manager open uses three requests: one read-model read, one
organization-policy read and one Admins-policy read. Creating and activating
an additional organization uses 14 requests, including the same two cold
policy reads. An active peer reconciles an ungranted group change with five
requests: one read-model read, directory discovery plus its verified suffix,
and one suffix read each for Admins and the changed group. It has no container
or document fanout.

The group fixture measured first creation/addition at 24/82 requests and later
creation/addition at 20/26. Three history reads can finish between those
measurement windows, so the test also caps the complete pair. The first
add keeps its earlier 45-history and three-document-projection allowances,
so its total allowance is 86; later addition is capped at 26. Creation permits
24/20 because the three history reads may fall inside that phase. Whole pairs are
capped at 110 and 46, including any intervening reads. The history limits
remain 54 and 21. Before local evidence reuse, first creation used 53 requests.
These profiles explain the cold policy-read cost, not an overall latency claim.

The Admins mutation keeps its 147 completed-request allowance, 84 completed
history reads, and existing byte limits. One observed history preparation
response may add one call only when it is a valid `202` pending response;
the test caps that response at one. Other routes retain their limits.
Folder mutation limits remain unchanged. Full-bundle mutation consumers still
need migration under #2448. Current-policy consumers add bounded signed-policy
verification to the former read-model-only label path; these costs remain
explicit even after removing duplicate directory and Admins recovery.
