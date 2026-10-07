# Current principal-policy consumers

Org Manager label hydration and runtime metadata-root verification also use
paged current policies when the runtime provides private history custody. Labels
bind to the exact signed directory and group heads. Their current artifacts stay
paired with verified policies; they are never stored as fabricated full bundles.
Directory/Admins admission still checks durable pins, and name reads alone do
not
advance other group checkpoints. Metadata roots select their exact older Admins
and Members citations, so an honest stale root remains distinguishable from a
forged reference. These paths retain offline recovery and operation-lifetime
checks. A caller that selected an exact current head can first recover matching
authenticated local artifacts, rechecking their history proofs, dependencies,
lease and durable pins. Missing evidence or a different cached current head uses
the bounded online reader; other verification failures remain failures. This
does not discover newer server state or replace live object authorization.
Metadata verification uses the organization head supplied by its live writer
projection. Directory discovery and cited recovery share one caller's batch,
keeping the original lease guard; expiry requires a new batch even if a later
caller is
still live. Local attempts share the caller batch under a separate offline key.
An unrelated server directory advance does not replace that batch's selected
view; every group dependency must still match it exactly. A new batch discovers
the advance, and mutations remain subject to the server's exact predecessor CAS.
Built-in member addition/removal and group-grant revocation also use current
evidence and exact receipts; see [current
mutations](principal-current-mutations.md).
Group creation/deletion, full policy-history views, direct share adapters and
hosts without the paged resolver still require further adoption.

See [durable recovery](principal-history-recovery.md) for the underlying paging,
private custody, and checkpoint contracts.

## Request costs

A cold Org Manager open now uses four requests: one read-model read, two
organization-policy reads and one Admins-policy read. Creating and activating
an additional organization uses 15 requests, including the same three cold
policy reads. An active peer reconciles an ungranted group change with eight
policy/read-model requests and no container or document fanout.

With current membership orchestration and shared directory discovery, the group
fixture measured first creation/addition at 22–25/86–93 requests and later
creation/addition at 23–26/20–23. Three history reads can move across those
measurement windows.
Whole-pair limits are 118/49. Creation allows 25/26; addition allows 93/27.
The first add uses 39–42 history and 14–16 organization-policy reads, with its
45-history allowance unchanged. Its completed-request cap rises by four because
subsequent projection collections independently recover directory/Admins/Members
evidence after the current-only Members acknowledgement. This remaining repeated
recovery is not eliminated by sharing the mutation's own authority for name
checks.
Later creation rediscovers directory/Admins after a current-only acknowledgement;
the 23-create + 3-boundary + 23-add pair raises its cap by one. History limits remain
54/21. These costs remain tracked for deduplication in #2448. Before local
evidence reuse, first creation used 53 requests.

The Admins mutation retains its 147 completed-request allowance, 84 completed
history reads and byte limits. One directory read replaces one group read. One
additional request is allowed only for a validated `202` history preparation
response, still capped at one. Without sharing directory discovery within the
mutation batch, this flow needed two extra completed requests.

Folder mutation limits remain unchanged. Full-bundle mutation consumers and
repeated discovery reads still need migration and deduplication under #2448.
