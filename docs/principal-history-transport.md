# Principal-policy history transport

The principal-policy GET route returns at most 32 historical entries per page,
plus the artifacts for one pinned signed head. The initial request chooses the
current head; subsequent requests send its `stateHash` and the returned
`historyPage.nextAfterVersion` as `afterVersion`. A null next cursor means the
entire prefix before that head has been delivered. A later policy update does
not move the requested pin. Every page rechecks current read authorization and
verifies the current policy before reading historical data; historical membership
does not restore revoked access. Each returned historical entry is checked
against the server's locally authenticated prefix and inclusion index.

The API client rejects head/artifact changes, gaps, reordered entries, repeated
cursors, and premature completion. Its authentication and cancellation context
spans the entire download. The full-bundle adapter still collects all wire pages
for existing SDK consumers. The incremental iterator supports durable recovery,
but other embedded-history responses remain separate work for #2442 / #2448.

`ApiClient.getPrincipalPolicyPages` exposes the same validated transport as a
pull-based async iterator. It can select an exact `stateHash` on its first request
or resume with saved current artifacts and an `afterVersion`. An explicit initial
`afterVersion` paired with an exact `stateHash` can extend a locally verified
prefix without old target artifacts; it cannot be combined with `resume`. These
inputs are
transport hints; the API client does not authenticate the omitted prefix. It
retains a private copy of the pin, does not prefetch while a consumer is working,
and checks cancellation and identity changes after the consumer resumes.

The SDK's `recoverPrincipalPolicyHistory` uses that iterator with the streaming
crypto verifier and durable `principal_history_stages` rows. Page entries and
index nodes are saved atomically with checked progress and its transport position.
A caller-owned local key authenticates the row's head, current artifacts, cursor,
completion state, organization, trust context, and reference selection. The
transaction compares prior progress before replacing it and gates commit on the
caller's current operation. A shared authenticated completed prefix can serve new
heads and selections; proof lookups select historical entries and the current
local checkpoint against its private verified root. Cache loss permits one
bounded genesis rebuild. The returned sparse current-policy capability does not
advance a trusted application checkpoint. See the
[recovery contract](developer/principal-history-recovery.md) for key custody,
lifetime guards, cache recovery, and remaining integration limits.

Cold server preparation runs after the application transaction rolls back. Each
database has two preparation workers per API process, with at most one active
page per principal. Waiting principals take turns between pages; a principal may
queue two requests, and the total queue holds at most 64. Waiting longer than two
seconds, or reaching either queue bound, returns a temporary 503 before that
preparation task runs. A later request can resume durable progress. This limits
preparation work in each process, not aggregate concurrency across replicas or
ordinary application transactions. Pages retain their existing entry, byte, and
elapsed-work budgets; one large entry remains an indivisible verification step.

Principal-policy reads have a 15-second response deadline, including reading and
decoding the response body. A validated preparation continuation or history page
starts a fresh read deadline on the next request; the deadline is not a lifetime
limit on a history download. A stalled read returns
`principal_history_request_timed_out` as a network failure, reports it once unless
error reporting is disabled, and releases its recovery operation. Caller
cancellation remains silent.

Submitted writes await acknowledgement without an implicit client timer, since
a large atomic commit may outlast the read budget. Caller cancellation and
explicit deadlines remain effective; a write interrupted by either returns
`principal_history_outcome_unknown`. Abort does not prove rollback, and the client
does not replay that write automatically. Authentication identity checks remain
in effect across all rounds. The real HTTP acceptance probe independently enforces
a 15-second deadline on every request, including writes. Read timers bound the
built-in fetch transport; custom host callbacks must also settle or honor their
cancellation signal.

A submitted write with a network failure, an unreadable or invalid acknowledgement,
or a server/intermediary 5xx, 408, or 499 has an unknown commit outcome. None of
these failures
permits automatic replay or a claim that the operation rolled back. Only a valid
202 preparation response proves rollback and permits the continuation loop.

`ApiClient.putPrincipalPolicyResult` and `commitOrganizationGroupPolicyResult`
retain that classification for callers preserving authored requests. Their
convenience methods still return a value or null; default error callbacks report
the final outcome classification once, after transport errors are classified.

`GET /principals/history` delivers public signed policy snapshots in pages of
at most 32 predecessor states, without payloads or member key envelopes. Its
opaque `grant` binds a user, an authorized container or document, an
organization, and an exact historical principal head. Each page rechecks
current access to that object inside a bounded history transaction; deleted
groups need no live group row. The server verifies each returned entry against
its authenticated history index. Grants use a separate HMAC domain derived
from the configured cursor secret, or a private random process key when no
secret is configured. A process restart in the latter mode invalidates old
grants. The public development cursor key cannot authorize these reads. A
grant has no expiry because every read reauthorizes; it never establishes a
client checkpoint or permits access after revocation.

`ApiClient.getProjectionPolicyHistoryPages` accepts a source containing `head`
and `grant`, plus an optional caller-authenticated prefix offset. It shares
the 15-second per-request deadline and preparation handling, validates exact
head, public artifacts and cursor continuity, and checks identity changes
after each consumer yield. The compact source builder checks every manifest
citation against the signed directory head and verified chain before issuing
any grant. It includes only the organization payloads needed for those bindings,
with exact references for selective client verification. Production projections
carry these sources and the SDK resolves them through
private history recovery. Resource scheduling, durable client mutation recovery
and the full transport acceptance run remain tracked in
[#2448](https://github.com/a2f0/tearleads/issues/2448).

When the preparation queue is full or its bounded attempt makes no progress,
policy PUT routes return HTTP 503 with the exact
`principal_history_preparation_unavailable` code and `committed: false`. This
refusal is emitted only after the operation transaction has rolled back. The
client validates that status-specific response before treating it as a known
failure; it does not retry automatically. Generic, malformed or intermediary
503 responses remain unknown outcomes, as do expired request lifetimes even
when a rollback response arrives. A later user retry starts a fresh operation.

## Warm projection request cost

A completed local prefix avoids replaying historical signatures, but online
projection recovery still fetches the pinned head once per source. That read
validates the returned public head artifacts and rechecks the grant's live
object access. It does not download the completed prefix again. The fixed
15-second response-body deadline also applies to document and container
writer-projection GETs.

This deliberately preserves those checks in the first compact-wire release.
The app's single-file upload fixture grows from 10 to 28 requests (18 public
history reads), personal-organization bootstrap from 30 to 64 (34 such reads),
and additional-organization bootstrap from 9 to 12. The Admins-group mutation
fixture adds 78–84 public history reads, measuring 136–144 total requests against
its prior 63-request allowance. Those are measured request
counts, not latency benchmarks. Serial round trips can increase warm-operation
latency, especially on mobile links; the change does not claim a warm-path
performance improvement. In exchange, projection responses no longer embed
complete principal histories, and cold verification progresses across bounded
requests instead of one history-sized response.

The settled folder workflow adds 8 history reads to create, 10 to link, 30 to
unlink, 34 to move a document to Trash, 12 to move a folder to Trash, and 14 to
restore it. Its prior non-history route budgets remain unchanged. Group creation
adds 9 reads; adding the first roster peer to a custom group adds 42, and adding
an existing peer adds 9. The first add also allows one fresh document projection
when a concurrent policy advance invalidates the create-time proof. Mutation
counts remain exact, including the single committed compound folder create.
The root attachment-sharing fixture adds 70 public history reads (116–118 total
requests); its existing mutation, projection and aggregate byte caps are retained.

Reusing a head check for an entire runtime lifetime would also reuse an earlier
access result and stop inspecting subsequent returned head artifacts. This
release keeps the existing online refusal, artifact validation, and lifetime
checks explicit. Batching exact source heads while reauthorizing their object
scope is the intended follow-up for reducing these round trips; it remains part
of #2448, alongside the remaining mutation-consumer and resource work.

## Measuring HTTP work

The slow principal-history acceptance test uses a loopback HTTP proxy with a
15-second deadline through each response body. It records the maximum response
size and completed-request latency, and the total and maximum per-request SQL
statement count. An async-local counter covers queries issued by the route and
its preparation work, including transaction controls on SQLite and PostgreSQL.
A PostgreSQL statement represents a driver query; connection setup and protocol
messages are not counted. The logger retains neither SQL text nor parameters.
PGlite's native transaction controls and Turso's transport setup are outside the
ORM logger, so their counts cannot be used as PostgreSQL round-trip evidence.

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
SQLite file path, shared only with the fixture process. It issues fixture sessions
in each server process; fixture signing/KEM keys and generated history stay in the
parent.
After the first preparation response, it records memory, kills the server with
SIGKILL and starts a fresh process using the same database and cursor secret. The
prepared rows must survive unchanged, and the exact authored mutation must finish
once. Revoked-reader denial and cold decryption use fresh server processes and
real HTTP, with the same 15-second deadline.
This restart point is between requests, after a completed preparation response;
it does not exercise interruption inside the final commit. The regular API suite
runs a 64-version isolated SQLite case and checks that restart and cold recovery
were reached. Separate disconnect fixtures cover uncertain commit outcomes.
The fixture serializes parent database writes with completed server requests; it
assumes the server has no detached database writes. Later authored mutations can
reuse server caches until the next restart; revoked-reader and cold-recovery
phases each start a fresh server.

The isolated metrics include server-side caches, database adapters and the
loopback deadline proxy, excluding the SDK client and fixture objects. They
record sampled peaks and initial/final RSS and JavaScript heap after explicit GC
for each server process. RSS includes native allocations and need not shrink
after GC; neither a short run nor one allocator sample proves a universal memory
bound. A diagnostic invocation from `packages/api` is:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=/tmp/history-probe.sqlite \
  PRINCIPAL_HISTORY_ISOLATED_SERVER=1 PRINCIPAL_HISTORY_THROUGH_VERSION=128 \
  bun test test/slow/principalHistoryAvailability.test.ts
```

Use a dedicated fixture database. Omit `PRINCIPAL_HISTORY_THROUGH_VERSION` for the
full 16,384-version case, or set `API_DATABASE=postgres` and `DATABASE_URL` to run
against a dedicated networked PostgreSQL database.
