# Current principal-policy consumers

Org Manager label hydration and runtime metadata-root verification use paged
current policies and require private history custody. Labels bind to the exact
signed directory and group heads. Their current artifacts stay paired with
verified policies; they are never stored as fabricated full bundles.
Directory/Admins admission still checks durable pins. Name reads alone leave
other group checkpoints unchanged. Metadata roots select their exact older
Admins and Members citations, so an honest stale root remains distinguishable
from a forged reference. These paths retain offline recovery and
operation-lifetime checks. A caller that selected an exact current head can
first recover matching authenticated local artifacts, rechecking their history
proofs, dependencies, lease and durable pins. Missing evidence or a different
cached current head uses the bounded online reader; other verification failures
remain failures. This does not discover newer server state or replace live
object authorization. Metadata verification uses the organization head supplied
by its live writer projection.

## Operation recovery batch

Directory discovery and cited recovery share one caller's batch. Batches belong
to the database's principal-policy coordinator, keyed by an operation token. A
reconciliation pass (remote container hydration, document discovery) or a user
workflow (a document move's link and unlink legs) mints one token at its root,
and every warmer it creates with
`createRuntimePrincipalPolicyWarmer( runtime, { operation })` shares one batch,
so the pass discovers the directory once. A warmer created without a token is
its own operation. A batch entry is reused only while its producing lease is
live, no organization read-model hint has been applied since its reads began (a
citation derived from a reused entry keeps that entry's epoch), and no durable
pin has moved past or forked from a head it names; otherwise it is evicted and
the later caller recovers again under its own lease. The batch dies with its
token at the end of the pass or workflow. It is the only reuse of scoped
evidence: a caller's policy cache keeps bare verified policies and resolves
every scoped citation through the batch, so a cache shared across operations
cannot skip a later operation's discovery or bypass the batch's hint and pin
rules. Evidence handed out from the batch keeps its producer's lifetime
alongside the consumer's until it is used: projection admission rechecks that
composite and cancels a use whose producer has expired. Local attempts use a
separate offline key in that batch. The [recovery reuse
model](../../formal/container-keying/PrincipalRecoveryReuse.md) checks these
reuse bindings.

Discovery names the head of the device's completed verified directory prefix. An
`unchanged` reply naming exactly that head reuses the prefix, which recovery
authenticates and checks against the reloaded checkpoint like any completed
stage; any other reply, or a prefix that cannot be loaded, reads the first page
unconditionally. The model's `ConditionalDiscovery` action checks that rule:
trusting any `unchanged` reply breaks per-operation freshness. The discovery
page passes through ordinary signature verification; continuation reads remain
bound to its exact current artifacts.
Additional historical directory or Admins citations use local proofs for the
selected head, retaining the source lifetime even when another batch advances
the private prefix. An unrelated server directory advance does not replace that
batch's selected view; every group dependency must still match it exactly. The
next operation discovers the advance, and mutations remain subject to the
server's exact predecessor CAS.

Group-name hydration supplies this same selected authority to metadata-root
verification, preserving its directory binding and lifetime instead of starting
an independent authority recovery for the name reader. Metadata-key unwrapping
also tries exact authenticated local citations before online recovery,
preserving checkpoint, dependency and caller-lifetime checks.

## Group mutations and history views

Built-in member addition/removal and group-grant revocation also use current
evidence and exact receipts; see [current
mutations](principal-current-mutations.md). Built-in group shares use current
evidence for planning and grant minting; see
[sharing](principal-current-sharing.md). Built-in group creation walks signed
directory names through current policies one at a time and publishes the
authenticated group genesis and directory successor together. Recovery already
serializes each organization; the name walk keeps only one group current in
flight, so its latency grows with group count. Creation/deletion outcomes share
the durable operation journal.

Group-history views select at most 32 rows from privately verified index proofs;
Org Manager offers older pages without fetching a complete group bundle. The
immediate predecessor remains verified for the boundary row's membership diff.
Rows end at the requested reference even when recovery reuses a newer local
head. The internal recovery result keeps that head's current artifacts and
policy. Missing or corrupted disposable page evidence can replay signed pages
once online; offline reads fail without changing durable pins. A pin change
while a page is being read invalidates the display result as a recovery race. An
unavailable first history page preserves the independent local member list and
shows the history-unavailable view. Older-page failures remain explicit for
retry; integrity and storage failures still reject the details load.

Organization history selects the same 32-entry windows and authenticates
directory payloads against those exact private proofs. Roster-scoped public
sources recover only the required group citations, including deleted groups.
Each API page rechecks live roster access. One verified display page per
organization is cached in memory; the UI retains older rows only as requested.
Organization history requires the host's private paged resolver. The 32-entry
bound limits directory versions, not the number of groups cited by each
directory. Evidence bytes and public recovery work also grow with distinct cited
groups; the HTTP fixture exercises both one and eight ordinary groups.

## Stale heads and document purge

Stale container and inline document-rekey errors return at most 16 compact
principal heads. The API verifies current state with bounded history preparation
and discloses heads only for principals the requester may read. Built-in create
and sync workflows recover the signed evidence with the private paged resolver,
then refresh the parent projection before rebuilding a container create under
its original lifetime. This keeps public evidence sources current when the retry
admits newer policies. The hints themselves do not advance trust checkpoints.
Hosts without a paged resolver cannot consume these hints through a full-history
fallback. The wire field is `principalHeads`; API-client failures expose
`stalePrincipalHeads`.

Terminal document purge responses also use `policyEvidence`. Each source ends at
the cited group head or the first signed directory binding needed to
authenticate it. Recovery never selects the latest directory merely because it
exists. Every page reauthorizes the signed purge path and binds the original
reader, document and organization; a reader who had access at purge time may
recover the proof after later revocation or group/container deletion. No later
membership is disclosed through that grant.

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
lease guard active through the outer SQLite commit. Unavailable proof
connections to newer durable pins trigger bounded private ancestry recovery:
reuse authenticated local history first, then use the ordinary authorized page
endpoint when needed. This cannot extend a terminal grant or admit the recovered
newer heads. If neither source is available, deletion is deferred. The
64/128-version HTTP fixtures enforce responses below 90 KB, with no inline
policy chains and no full-history reads; response size can still grow with
distinct cited groups and container or document evidence. Standalone purge/sync
hosts must provide the private paged resolver; there is no full-history wire
fallback.

See [durable recovery](principal-history-recovery.md) for the underlying paging,
private custody, and checkpoint contracts.

## Request costs

The private paged runtime adds directory and group reads for metadata authority
and scoped projection recovery. Signed entries in a bare policy cache do not
carry organization, dependency and operation-lifetime bindings; they cannot
replace that recovery. A completed local stage of an exact pinned head needs no
confirmation read, and one pass or workflow operation discovers the directory
once, so the remaining policy reads are one discovery read per operation,
answered with a bare head when the device already holds it, and first reads of
heads new to the device. See the [acceptance
evidence](../principal-history-acceptance.md#ordinary-workflow-cost) for the
security tradeoff.

The app's request-volume tests enforce the budgets below, together with
per-route limits and mutation-count assertions. They are local fixed-cardinality
measurements, not production benchmarks.

`OrganizationBootstrapRequestVolume.test.tsx` measures 30 requests for personal
bootstrap with a ceiling of 31, and caps creating and activating another
organization at 6. Provisioning seeds discovery evidence for the profile
documents it signed and primes recovery of the founding policy heads, so neither
flow fetches those documents' writer projections or reads group policy history
for the founding heads.

A cold Org Manager open uses three requests: one read-model read, one
organization-policy read and one Admins-policy read
(`DualPaneProvider.groupsRequestVolume.test.tsx`). An active peer reconciles an
ungranted group change with four policy/read-model requests and no container or
document fanout; its unchanged Admins stage needs no read
(`DualPaneProvider.activePeerRequestVolume.test.tsx`).

`GroupMutationRequestVolume.test.tsx` measures 7 requests for creating the first
group and 6 for a later one, with ceilings of 10 and 9. First enrollment of a
peer measures 40 requests with a ceiling of 45; a later addition is capped at
11. The creation/addition pairs are capped at 53 and 17 requests, with at most
11 and 3 public history reads. First addition permits 10 organization-policy and
3 group-policy reads. Creation may also receive one validated rollback
preparation response with identical request bytes.

The Admins enrollment fixture in `DualPaneProvider.groupsRequestVolume.test.tsx`
measures 55 completed requests; its ceiling is 58, plus explicitly counted
validated preparation continuations. It caps organization-policy reads at 17,
group-policy reads at 3 and public history reads at 7, with body ceilings of
160,000 request bytes and 740,000 response bytes (0.67 MB measured). The root
attachment-sharing fixture in `DualPaneProvider.sharing.test.tsx` measures 59
requests and permits 66, with body ceilings of 130,000 request bytes and 560,000
response bytes (0.51 MB measured). Container mutation acknowledgements carry
hashes rather than echoes, which keeps the policy commit at about 73 KB.
Container mutations cite stored manifests by `{containerId, manifestHash}` and
principal policies by head rather than echoing path bundles or policies.

`ExplorerUploadRequestVolume.test.tsx` measures 6 calls and 29 KB received for a
small Explorer upload and permits 7 calls and 32,500 response bytes; its blob
stage costs three calls (initiate with the first part's upload source, the part
bytes, and the attachment bind that completes the stage and carries the
document's first content update).

`FolderMutationRequestVolume.test.tsx` sets these ceilings, which include
private current-policy reads:

| Operation | Request ceiling |
| --- | ---: |
| Create folder | 3 |
| Link document | 3 |
| Unlink document | 8 |
| Trash document | 9 |
| Trash folder | 11 |
| Restore folder | 12 |

The folder workflows, whose heads are all completed locally, permit no public
history or group-policy reads. Sharing discovery reads across passes would need
the same organization, dependency, checkpoint and lifetime checks as scoped
recovery, plus a freshness argument the per-pass read supplies. Document syncs
that a pass schedules through document stores still discover once per sync.
