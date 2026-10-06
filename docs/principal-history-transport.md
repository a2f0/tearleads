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

Each principal-policy HTTP request has a 15-second response deadline, including
reading and decoding the response body. A validated preparation continuation or
history page starts a fresh deadline on the next request; the deadline is not a
lifetime limit on a history download. A stalled read returns
`principal_history_request_timed_out` and releases its recovery operation. A
submitted mutation that times out returns `principal_history_outcome_unknown`:
abort does not prove rollback, and the client does not replay that write
automatically. Caller cancellation and authentication identity checks remain in
effect across all rounds. These timers bound the built-in fetch transport;
custom host callbacks must also settle or honor their cancellation signal.

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
