# Principal-policy history transport

The principal-policy GET route returns at most 32 historical entries per page,
plus the artifacts for one pinned signed head. The initial request chooses the
current head; subsequent requests send its `stateHash` and the returned
`historyPage.nextAfterVersion` as `afterVersion`. A null next cursor means the
entire prefix before that head has been delivered. A later policy update does
not move the requested pin. Every page rechecks current read authorization and
verifies the current policy before reading historical data; historical
membership does not restore revoked access. Each returned historical entry is
checked against the server's locally authenticated prefix and inclusion index;
see [incremental
verification](principal-history-pages.md#api-verified-progress).

The API client rejects head/artifact changes, gaps, reordered entries, repeated
cursors, and premature completion. Its authentication and cancellation context
spans the entire download. The explicit full-bundle collector assembles wire
pages for callers that request a complete bundle. Built-in runtime consumers
require private paged recovery; they never select that collector when recovery
is missing or fails.

`ApiClient.getPrincipalPolicyPages` exposes the same validated transport as a
pull-based async iterator. It can select an exact `stateHash` on its first
request or resume with saved current artifacts and an `afterVersion`. An
explicit initial `afterVersion` paired with an exact `stateHash` can extend a
locally verified prefix without old target artifacts; it cannot be combined with
`resume`. These inputs are transport hints; the API client does not authenticate
the omitted prefix. It retains a private copy of the pin, does not prefetch
while a consumer is working, and checks cancellation and identity changes after
the consumer resumes.

The SDK's `recoverPrincipalPolicyHistory` uses that iterator with the streaming
crypto verifier and durable `principal_history_stages` rows. Page entries and
index nodes are saved atomically with checked progress and its transport
position. A caller-owned local key authenticates the row's head, current
artifacts, cursor, completion state, organization, trust context, and reference
selection. The transaction compares prior progress before replacing it and gates
commit on the caller's current operation. A shared authenticated completed
prefix can serve new heads and selections; proof lookups select historical
entries and the current local checkpoint against its private verified root.
Cache loss permits one bounded genesis rebuild. The returned sparse
current-policy capability does not advance a trusted application checkpoint. See
the [recovery contract](developer/principal-history-recovery.md) for key
custody, lifetime guards and cache recovery.

## Preparation continuations

The principal-policy read, organization-policy write, and compound group-policy
commit require durable preparation of committed heads before doing cold history
work inside their operation transaction. Missing preparation rolls back that
entire transaction before a shared batch runs outside it. The response then has
status 202 and the strict JSON body

```json
{
  "code": "principal_history_preparation_pending",
  "committed": false,
  "progressToken": "<64 hex characters>"
}
```

The opaque token identifies a change in preparation caches; it is never
authorization evidence. A same-target attempt with no cache change returns a
terminal 503. Dependency changes are tracked by the client's repeated-token
guard too. Invalid prefixes drain oldest first, in bounded chunks, so damage
deep in an old subtree eventually rebuilds from genesis. The token includes the
oldest hint identity as well as the newest prefix, making that repair
observable.

Dependency continuations identify the required policy or strict Admins history.
When rollback removes a newly inserted successor, preparation uses its committed
predecessor; future citations and the successor are checked again on the next
attempt. Each final transaction repeats current authorization and head checks.
Each newly inserted successor has a separate one-entry verification allowance,
including later verification of that same head as a strict Admins authority.
Uncommitted cache hints publish only after a successful outer commit.

Cold server preparation runs after the application transaction rolls back. Each
database has two preparation workers per API process, with at most one active
page per principal. Waiting principals take turns between pages; a principal may
queue two requests, and the total queue holds at most 64. Waiting longer than
two seconds, or reaching either queue bound, returns a temporary 503 before that
preparation task runs. A later request can resume durable progress. This limits
preparation work in each process, not aggregate concurrency across replicas or
ordinary application transactions. Pages retain their entry, byte, and
elapsed-work budgets; one large entry remains an indivisible verification step.

When the preparation queue is full or its bounded attempt makes no progress,
policy PUT routes return HTTP 503 with the exact
`principal_history_preparation_unavailable` code and `committed: false`. This
refusal is emitted only after the operation transaction has rolled back. The
client validates that status-specific response before treating it as a known
failure; it does not retry automatically. Generic, malformed or intermediary 503
responses remain unknown outcomes, as do expired request lifetimes even when a
rollback response arrives. A later user retry starts a fresh operation.

Only a validated 202 permits an automatic retry of the same serialized request.
The API client validates it, preserves the original request bytes, and stops on
transport failure, cancellation, or an authentication-token change. A timeout
does not establish whether a mutation committed. Three consecutive identical
progress tokens stop the loop; unchanged progress delays the next attempt by
250 ms instead of 25 ms. Changing tokens do not consume a lifetime attempt
allowance, so history length has no retry ceiling. Clients and server must run
the same wire contract; there is no capability negotiation.

## Deadlines and unknown outcomes

Principal-policy reads have a 15-second response deadline, including reading and
decoding the response body. A validated preparation continuation or history page
starts a fresh read deadline on the next request; the deadline is not a lifetime
limit on a history download. A stalled read returns
`principal_history_request_timed_out` as a network failure, reports it once
unless error reporting is disabled, and releases its recovery operation. A GET
can restart once after its own successful session renewal or a recorded renewal
of the same session by another request; unrelated token replacements cannot
restart the read.

Submitted writes await acknowledgement without an implicit client timer, since a
large atomic commit may outlast the read budget. Caller cancellation and
explicit deadlines remain effective; a write interrupted by either returns
`principal_history_outcome_unknown`. Abort does not prove rollback, and the
client does not replay that write automatically. Writes invoke renewal without
replaying under a replacement token; an explicit 401 remains a definite,
retryable HTTP rejection. A token change or abort after submitting a write
returns `outcome-unknown`: the mutation may have committed, and the caller must
refresh state before retrying. Late responses cannot be applied under another
authentication context. Reads and writes accept abort signals; cancellation,
including during body decoding, does not report a network failure or show a
cancellation toast. Read timers bound the built-in fetch transport; custom host
callbacks must also settle or honor their cancellation signal.

A submitted write with a network failure, an unreadable or invalid
acknowledgement, a 408 or 499, or any other server/intermediary 5xx has an
unknown commit outcome. None of these failures permits automatic replay or a
claim that the operation rolled back. Only a valid 202 preparation response or
the validated `principal_history_preparation_unavailable` 503 proves rollback,
and only the 202 permits the continuation loop.

`ApiClient.putPrincipalPolicyResult` and `commitOrganizationGroupPolicyResult`
retain that classification for callers preserving authored requests. Their
convenience methods still return a value or null; default error callbacks report
the final outcome classification once, after transport errors are classified.
The HTTP acceptance probe independently enforces a 15-second deadline on every
request, including writes.

## Mutation acknowledgements

Successful principal writes return the exact accepted state, its current signed
artifacts, and the container mutation results. They do not return
`previousStates`. The server verifies the current artifacts against its
authenticated history progress, including on exact replay, without collecting or
serializing the whole prefix inside the write transaction. Final authorization
and head checks remain in that transaction. Response size therefore depends on
the current policy and container batch, rather than the number of retained
policy versions.

The SDK compares the accepted state, payload, grants, membership, envelopes, and
container results with the request it authored. After those checks, it appends
one accepted state to its authenticated durable prefix and index, without
rebuilding a complete bundle. A server-provided history array cannot replace
that prefix. This contract covers standalone policy writes, compound group and
organization commits, and group creation/deletion. Container and document
projections carry scoped paged public-history sources. See [compound commit
outcomes](developer/principal-policy-outcomes.md) for recovery after a committed
response is lost.

## Public projection history

`GET /principals/history` delivers public signed policy snapshots in pages of at
most 32 predecessor states, without payloads or member key envelopes. Its opaque
`grant` binds a user, an authorized object, an organization, and an exact
historical principal head. Each page rechecks current access to that object
inside a bounded history transaction; deleted groups need no live group row. The
server verifies each returned entry against its authenticated history index.
Grants use a separate HMAC domain derived from the configured cursor secret, or
a private random process key when no secret is configured. A process restart in
the latter mode invalidates old grants. The public development cursor key cannot
authorize these reads. A grant has no expiry because every read reauthorizes; it
never establishes a client checkpoint or permits access after revocation.

`ApiClient.getProjectionPolicyHistoryPages` accepts a source containing `head`
and `grant`, plus an optional caller-authenticated prefix offset. It shares the
15-second per-request deadline and preparation handling, validates exact head,
public artifacts and cursor continuity, and checks identity changes after each
consumer yield. The compact source builder checks every manifest citation
against the signed directory head and verified chain before issuing any grant.
It includes only the organization payloads needed for those bindings, with exact
references for selective client verification. Production projections carry these
sources and the SDK resolves them through private history recovery.

## Warm projection request cost

A completed local stage or prefix already authenticates every signed entry
through the exact head its caller pins, so recovery reads nothing for that head.
A read pinned to the head could only return the stored head bundle, whose
current artifacts are fixed by the signed state, or refuse. Public projection
sources skip their pinned read once their progress is complete, and private
exact-head recovery takes the same local path while online. An incomplete stage,
a new head, or lost proof material still reads the bounded pages it needs; each
returned head artifact is checked against the private root.

Server currency comes from the organization discovery read, a bare
`GET /principals/organization/:organizationId/policy` without `stateHash`. Every
workflow operation that needs private policy authority issues it once. It
selects the server-current directory head and applies live read authorization to
the organization policy. A group revocation rotates the group and commits a
directory successor with it, so the next operation recovers that successor.
Within one operation, later projection collections reuse its recovered directory
until an organization hint, a durable pin past a memoized head, or the end of
the producing lease evicts it; see [current-policy
consumers](developer/current-principal-consumers.md) for the batch rules.

Skipping the confirmation read removes only refusals of evidence the device
already verified: a 403 or 409 for a completed head, or served head bytes that
differ from the stored ones. It cannot admit an unverified head, bypass the
rollback, fork or checkpoint checks, or extend write authority, which the API
still decides against live state. Stored current artifacts that fail their
signed-history check discard the stage and replay signed history online once
rather than refusing (no-brick). The remaining policy reads are one discovery
read per operation and reads of heads that are new to the device. Provisioning
primes the founding heads the device signed, so a new organization's Admins and
Members heads are not new to it. Per-workflow budgets are listed under
[current-policy request
costs](developer/current-principal-consumers.md#request-costs).

## Measuring HTTP work

The slow principal-history [acceptance test](principal-history-acceptance.md)
uses a loopback HTTP proxy with a 15-second deadline through each response body.
It records the maximum response size and completed-request latency, and the
total and maximum per-request SQL statement count. An async-local counter covers
queries issued by the route and its preparation work, including transaction
controls on SQLite and PostgreSQL. A PostgreSQL statement represents a driver
query; connection setup and protocol messages are not counted. The logger
retains neither SQL text nor parameters. PGlite's native transaction controls
and Turso's transport setup are outside the ORM logger, so their counts cannot
be used as PostgreSQL round-trip evidence.

For this fixture's fixed member and grant cardinalities, each request must stay
below 1,024 statements. Mutation responses must stay below 200,000 bytes and
cold-recovery responses below 400,000 bytes. These are regression budgets for
history growth, not bounds for arbitrary policy sizes. Each run also records
initial, sampled peak, and final process RSS and JavaScript heap use, plus event
loop delay. These include the test client and fixture objects; final heap use is
not a post-GC retained-memory measurement and does not establish a server-only
memory bound. A passed short diagnostic does not replace the 16,384-version run.

Set `PRINCIPAL_HISTORY_ISOLATED_SERVER=1` to run the route and deadline proxy in
separate Bun processes. This mode requires networked PostgreSQL or an absolute
SQLite file path, shared only with the fixture process. It issues fixture
sessions in each server process; fixture signing/KEM keys and generated history
stay in the parent. After the first preparation response, it records memory,
kills the server with SIGKILL and starts a fresh process using the same database
and cursor secret. The prepared rows must survive unchanged, and the exact
authored mutation must finish once. Revoked-reader denial and cold decryption
use fresh server processes and real HTTP, with the same 15-second deadline.

This restart point is between requests, after a completed preparation response;
it does not exercise interruption inside the final commit. The regular API suite
runs a 64-version isolated SQLite case and checks that restart and cold recovery
were reached. Separate disconnect fixtures cover uncertain commit outcomes. The
fixture serializes parent database writes with completed server requests; it
assumes the server has no detached database writes. Later authored mutations can
reuse server caches until the next restart; revoked-reader and cold-recovery
phases each start a fresh server.

The isolated metrics include server-side caches, database adapters and the
loopback deadline proxy, excluding the SDK client and fixture objects. They
record sampled peaks and initial/final RSS and JavaScript heap after explicit GC
for each server process. RSS includes native allocations and need not shrink
after GC; neither a short run nor one allocator sample proves a universal memory
bound. A diagnostic invocation from [`packages/api`](../packages/api/) is:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=/tmp/history-probe.sqlite \
  PRINCIPAL_HISTORY_ISOLATED_SERVER=1 PRINCIPAL_HISTORY_THROUGH_VERSION=128 \
  bun test test/slow/principalHistoryAvailability.test.ts
```

Use a dedicated fixture database. Omit `PRINCIPAL_HISTORY_THROUGH_VERSION` for
the full 16,384-version case, or set `API_DATABASE=postgres` and `DATABASE_URL`
to run against a dedicated networked PostgreSQL database.
