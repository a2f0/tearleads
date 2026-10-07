# Current principal-policy consumers

Org Manager label hydration and runtime metadata-root verification also use
paged current policies when the runtime provides private history custody. Labels
bind to the exact signed directory and group heads. Their current artifacts stay
paired with verified policies; they are never stored as fabricated full bundles.
Directory/Admins admission still checks durable pins, and name reads alone do
not advance other group checkpoints. Metadata roots select their exact older Admins
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
caller is still live. Local attempts share the caller batch under a separate
offline key.
An unrelated server directory advance does not replace that batch's selected
view; every group dependency must still match it exactly. A new batch discovers
the advance, and mutations remain subject to the server's exact predecessor CAS.
Group-name hydration supplies this same selected authority to metadata-root
verification, preserving its directory binding and lifetime instead of starting
an independent authority recovery for the name reader.
Metadata-key unwrapping also tries exact authenticated local citations before
online recovery, preserving checkpoint, dependency and caller-lifetime checks.
Built-in member addition/removal and group-grant revocation also use current
evidence and exact receipts; see [current
mutations](principal-current-mutations.md).
Built-in group creation walks signed directory names through current policies
and publishes the authenticated group genesis and directory successor together.
Group-history views select at most 32 rows from privately verified index proofs;
Org Manager offers older pages without fetching a complete group bundle. The
immediate predecessor remains verified for the boundary row's membership diff.
Missing or corrupted disposable page evidence can replay signed pages once
online; offline reads fail without changing durable pins. A pin change while a
page is being read invalidates the display result as a recovery race.
Creation/deletion outcome journaling, full organization-history views, direct
share adapters and hosts without the paged resolver still require further adoption.

See [durable recovery](principal-history-recovery.md) for the underlying paging,
private custody, and checkpoint contracts.

## Request costs

A cold Org Manager open now uses four requests: one read-model read, two
organization-policy reads and one Admins-policy read. Creating and activating
an additional organization uses 15 requests, including the same three cold
policy reads. An active peer reconciles an ungranted group change with eight
policy/read-model requests and no container or document fanout.

With bounded creation, display pages and exact local metadata evidence, a
completed group fixture measured first creation/addition at 17/70 requests and
later creation/addition at 15/20. The whole pairs used 87/35 requests, including
51/21 public history reads. These are local fixture measurements, not production
benchmarks. Existing whole-pair limits remain 118/49; creation allows 25/26 and
addition allows 93/27. Combined history limits remain 54/21.

Metadata-key unwrapping previously repeated directory/Admins/Members recovery
after its metadata authority had already selected those policies. The new local
preference eliminates those online repeats when exact private evidence is
available. Separate projection collections still recover public history, and
each mutation discovers a fresh directory before authoring its successor. This
remaining work stays tracked in #2448. Before local evidence reuse, first
creation used 53 requests.

The Admins mutation retains its 147 completed-request allowance, 84 completed
history reads and byte limits. One directory read replaces one group read. One
additional request is allowed only for a validated `202` history preparation
response, still capped at one. Without sharing directory discovery within the
mutation batch, this flow needed two extra completed requests.

Folder mutation limits remain unchanged. Full-bundle mutation consumers and
repeated discovery reads still need migration and deduplication under #2448.
