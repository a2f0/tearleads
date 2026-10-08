# Current principal-policy consumers

Org Manager label hydration and runtime metadata-root verification also use
paged current policies when the runtime provides private history custody. Labels
bind to the exact signed directory and group heads. Their current artifacts stay
paired with verified policies; they are never stored as fabricated full bundles.
Directory/Admins admission still checks durable pins. Name reads alone leave
other group checkpoints unchanged. Metadata roots select their exact older Admins
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
caller is still live. Local attempts use a separate offline key in that batch.
The discovery page passes through ordinary signature verification; continuation
reads remain bound to its exact current artifacts. Additional historical
directory or Admins citations use local proofs for the selected head, retaining
the source lifetime even when another batch advances the private prefix.
An unrelated server directory advance does not replace that batch's selected
view; every group dependency must still match it exactly. A new batch discovers
the advance, and mutations remain subject to the server's exact predecessor CAS.
Group-name hydration supplies this same selected authority to metadata-root
verification, preserving its directory binding and lifetime instead of starting
an independent authority recovery for the name reader.
Metadata-key unwrapping also tries exact authenticated local citations before
online recovery, preserving checkpoint, dependency and caller-lifetime checks.
Built-in member addition/removal and group-grant revocation also use current
evidence and exact receipts; see [current mutations](principal-current-mutations.md).
Built-in group creation walks signed directory names through current policies
one at a time and publishes the authenticated group genesis and directory
successor together. Recovery already serializes each organization; the name walk
keeps only one group current in flight, so its latency grows with group count.
Group-history views select at most 32 rows from privately verified index proofs;
Org Manager offers older pages without fetching a complete group bundle. The
immediate predecessor remains verified for the boundary row's membership diff.
Rows end at the requested reference even when recovery reuses a newer local
head. The internal recovery result keeps that head's current artifacts and policy.
Missing or corrupted disposable page evidence can replay signed pages once
online; offline reads fail without changing durable pins. A pin change while a
page is being read invalidates the display result as a recovery race. An
unavailable first history page preserves the independent local member list and
shows the existing history-unavailable view. Older-page failures remain explicit
for retry; integrity and storage failures still reject the details load.
Creation/deletion outcomes share the durable operation journal. Organization
history now selects the same 32-entry windows and authenticates directory payloads
against those exact private proofs. Roster-scoped public sources recover only the
required group citations, including deleted groups. Each API page rechecks live
roster access. One verified display page per organization is cached in memory;
the UI retains older rows only as requested. Built-in group shares use Current
evidence for planning and grant minting; see [sharing](principal-current-sharing.md).
Organization history requires the host's private paged resolver.
The 32-entry bound limits directory versions, not the number of groups cited by
each directory. Evidence bytes and public recovery work also grow with distinct
cited groups; the HTTP fixture exercises both one and eight ordinary groups.

Stale container and inline document-rekey errors return at most 16 compact
principal heads. The API verifies current state with bounded history preparation
and discloses heads only for principals the requester may read. Built-in create
and sync workflows recover the signed evidence with the private paged resolver,
then refresh the parent projection before rebuilding a container create under
its original lifetime. This keeps public evidence sources current when the retry
admits newer policies. The hints themselves do
not advance trust checkpoints. Hosts without a paged resolver cannot consume
these hints through a full-history fallback. The wire field is `principalHeads`;
API-client failures expose `stalePrincipalHeads`, replacing `stalePrincipalPolicies`.

Terminal document purge responses also use `policyEvidence`, replacing
`principalPolicySnapshots`. Each source ends at the cited group head or the first
signed directory binding needed to authenticate it. Recovery never selects the
latest directory merely because it exists. Every page reauthorizes the signed
purge path and binds the original reader, document and organization; a reader
who had access at purge time may recover the proof after later revocation or
group/container deletion. No later membership is disclosed through that grant.

The SDK authenticates paged public history and all terminal artifacts before
checking their currency. Baseline verification and page recovery do not advance
pins. The final purge commit admits the authenticated observations atomically
with document teardown, rechecks forks and local currency, and keeps its private
lease guard active through the outer SQLite commit. Unavailable proof connections
to newer durable pins defer deletion. The 64/128-version HTTP fixtures enforce
responses below 90 KB, with no inline policy chains and no Full-history reads;
response size can still grow with distinct cited groups and container or
document evidence. Standalone purge/sync hosts must provide the private paged
resolver; there is no full-history wire fallback.

See [durable recovery](principal-history-recovery.md) for the underlying paging,
private custody, and checkpoint contracts.

## Request costs

A cold Org Manager open uses three requests: one read-model read, one
organization-policy read and one Admins-policy read. Creating and activating
an additional organization uses 14 requests, including the same two cold
policy reads. An active peer reconciles an ungranted group change with five
policy/read-model requests and no container or document fanout.

With bounded creation, display pages and exact local metadata evidence, a
completed group fixture measured first creation/addition at 17/70 requests and
later creation/addition at 15/20. The whole pairs used 87/35 requests,
including 51/21 public history reads. These are local fixture measurements,
not production benchmarks. Whole-pair limits are tightened from 110/46 on the
base to 92/38; creation allows 20/18 and addition allows 75/23. Margins permit
three boundary reads per phase, with five extra reads for first-enrollment
proof discovery. The pair cap prevents those margins from accumulating.
Creation may additionally receive one validated rollback preparation response
with identical request bytes; completed mutation counts and the raw whole-pair
limit remain unchanged. Combined history limits remain 54/21. Earlier
intermediate limits of 118/49 were reduced after measuring local-evidence
reuse.

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
