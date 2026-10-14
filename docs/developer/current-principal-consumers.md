# Current principal-policy consumers

Org Manager label hydration and runtime metadata-root verification also use
paged current policies and require private history custody. Labels
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
projection. Directory discovery and cited recovery share one caller's batch. A
policy warmer is one workflow operation: every projection collection it verifies
shares one batch, so the operation discovers the directory once
([#2522](https://github.com/a2f0/tearleads/issues/2522)). A batch entry is
reused only while its producing lease is live, no organization read-model hint
has been applied since its reads began (a citation derived from a reused entry
keeps that entry's epoch), and no durable pin has moved past or forked from a
head it names; otherwise it is evicted and the later caller recovers again under
its own lease. The batch dies with its operation. Evidence a caller's policy
cache remembers carries the same binding: it is reused only by the operation
and hint epoch that produced it, so a cache shared across operations cannot
skip a later operation's discovery.
Local attempts use a separate offline key in that batch.
The discovery page passes through ordinary signature verification; continuation
reads remain bound to its exact current artifacts. Additional historical
directory or Admins citations use local proofs for the selected head, retaining
the source lifetime even when another batch advances the private prefix.
An unrelated server directory advance does not replace that batch's selected
view; every group dependency must still match it exactly. The next operation
discovers the advance, and mutations remain subject to the server's exact
predecessor CAS.
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

Both purge endpoints use bounded server preparation. A cold POST or proof GET
returns a validated `202` only after its transaction rolls back; durable
verification then advances by at most 32 signed entries per response. The client
repeats the identical request until it receives the terminal proof. It does not
retry network failures, ambiguous acknowledgements or `503` refusals as though
they were successful preparation. A coded preparation-unavailable `503` with
`committed: false` certifies rollback. Real HTTP tests clear all verification
hints at 64 and 128 versions, require preparation responses for both endpoints,
and check that each POST continuation leaves the document and purge event
unmodified.

The SDK authenticates paged public history and all terminal artifacts before
checking their currency. Baseline verification and page recovery do not advance
pins. The final purge commit admits the authenticated observations atomically
with document teardown, rechecks forks and local currency, and keeps its private
lease guard active through the outer SQLite commit. Unavailable proof connections
to newer durable pins trigger bounded private ancestry recovery: reuse authenticated
local history first, then use the ordinary authorized page endpoint when needed.
This cannot extend a terminal grant or admit the recovered newer heads. If neither
source is available, deletion is deferred. The 64/128-version HTTP fixtures enforce
responses below 90 KB, with no inline policy chains and no Full-history reads;
response size can still grow with distinct cited groups and container or
document evidence. Standalone purge/sync hosts must provide the private paged
resolver; there is no full-history wire fallback.

See [durable recovery](principal-history-recovery.md) for the underlying paging,
private custody, and checkpoint contracts.

## Request costs

The private paged runtime adds directory and group reads for metadata authority
and scoped projection recovery. Signed entries in a bare policy cache do not
carry organization, dependency and operation-lifetime bindings; they cannot
replace that recovery. A completed local stage of an exact pinned head needs no
confirmation read, and one workflow operation discovers the directory once, so
the remaining policy reads are one discovery read per operation and first reads
of heads new to the device. See the
[acceptance evidence](../principal-history-acceptance.md#ordinary-workflow-cost)
for the security tradeoff and measured byte costs.

The current app fixtures measure 41 requests for personal bootstrap and 16 for
creating and activating another organization, with ceilings of 43 and 16.
A cold Org Manager open uses three requests: one read-model read, one
organization-policy read and one Admins-policy read. An active peer reconciles
an ungranted group change with four policy/read-model requests and no container
or document fanout; its unchanged Admins stage needs no read.

Group creation/addition measured 7/40 requests for first enrollment and 6/8
for a later group. Creation ceilings are 10/9, addition ceilings 45/11, and
whole-pair ceilings 53/17. Public history reads are capped at 11/3 for the
pairs. First addition permits 10 organization-policy and 3 group-policy reads.
Completed mutation counts are unchanged; creation may also receive one validated
rollback preparation response with identical request bytes. These are local
fixed-cardinality measurements, not production benchmarks.

The Admins enrollment fixture measured 73–76 completed requests; its ceiling is
79, plus explicitly counted validated preparation continuations. It caps
organization-policy reads at 20, group-policy reads at 3 and public history
reads at 7. Body ceilings are 450,000 request bytes and 2,650,000 response
bytes. The root attachment-sharing fixture measured 65–66 requests and permits
74, with body ceilings of 380,000 request bytes and 2,250,000 response bytes.
The small Explorer upload fixture measured 10 calls and permits 11.

Folder mutation ceilings also include private current-policy reads:

| Operation | Request ceiling |
| --- | ---: |
| Create folder | 5 |
| Link document | 3 |
| Unlink document | 8 |
| Trash document | 10 |
| Trash folder | 12 |
| Restore folder | 13 |

The tests retain per-route limits and mutation-count assertions; the folder
workflows, whose heads are all completed locally, permit no public history or
group-policy reads. Sharing discovery reads across operations would need the
same organization, dependency, checkpoint and lifetime checks as scoped
recovery, plus a freshness argument the per-operation read now supplies.
