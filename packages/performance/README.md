# @tearleads/performance

An executable SDK host for small, repeatable experiments against staging and
production. It imports public SDK, SQLite, and PostgreSQL transport entry
points, plus the API's test runtime for the local realtime hub probes. The app,
SDK, and API do not depend on it.

Measured runs live in [results](results/README.md), one dated file per run.
This README describes the experiments and how to repeat them.

The [database round-trip experiment](database-experiment.md) separates connection
setup, repeated warm queries, batched queries, and server execution time through
the API's existing Hyperdrive binding. Run it with `bun run perf:database`.

The [realtime hub interest probe](#realtime-hub-interest-authorization) times
the hub's folder authorization against a local database. Run it with
`bun run perf:realtime`. The [contention probe](#realtime-hub-contention)
times how long that work makes other sockets wait. Run it with
`bun run perf:realtime-contention`.

The [document reload probe](#document-reload) counts the requests a returning
client makes when it reloads, as its account grows. Run it with
`bun run perf:reload`.

## Continuity seed round trip

```sh
bun run build:runtime
bun run perf:seed --env staging
bun run perf:seed --env production --trace
```

Each run creates one persistent test account in the selected environment. It
times registration separately, then measures the CLI seed and a second CLI
process recovering the same identity with empty document and blob stores.
The reader checks every fixture and compares the decrypted bytes in each slot.
The round-trip time includes both CLI startups, sign-ins and session revocations.
Each CLI phase uses one sign-in and has a 65-minute time limit. An expired
session fails the phase. A timeout or a missing or changed
fixture exits nonzero. The report goes to the terminal.
Keys travel over stdin and are discarded. This exercises the deployed API and
blob storage through the SDK. Browser rendering and OPFS require a web test.
See the [2026-11-20 production run](results/2026-11-20-continuity-seed-round-trip.md).

## Realtime hub interest authorization

[Issue #3272](https://github.com/a2f0/tearleads/issues/3272) asks what the
realtime hub spends when a socket declares a large folder tree, and again
each time it re-verifies that tree, every 2.5 to 5 minutes. This probe
measures both passes against a local scratch database. It needs no
deployment and no Cloudflare credentials.

```sh
createdb tearleads_realtime_probe
bun run build:packages
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_realtime_probe" \
  bun run perf:realtime --sizes 100,1000,10000 --samples 3
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_realtime_probe" \
  bun run perf:realtime --reuse --samples 3
```

The probe boots the API in its own process from `@tearleads/api/test-runtime`,
as the [bob-and-alice harness](../bob-and-alice/README.md) does, and registers
one account through the SDK. It then creates folders through the SDK's folder
store until the tree holds the largest size. The tree is breadth first, with
`--fanout` children per folder (default 10), so every folder carries the
signed manifests the app writes. Seeding is slow: a quarter of a second per
folder at first, slowing as the tree grows, so 10,000 folders took 76 minutes
on an M2 Pro. The run saves the seeded account to
`.test_files/performance/realtime-seed-<database>.json`. `--reuse` measures
that account again without seeding, which is how to compare a change against
the same tree.

For each size and sample, a fresh gateway from `createRealtimeGateway` opens
one socket for the account. The socket declares the first `size` containers of
the tree in one `known_containers` message: the root and the three system
containers registration provisions, then folders in creation order. The probe
waits for the acknowledgement, then fires the socket's revalidation tick,
which re-verifies every installed id as the hub's periodic pass does.
Pub/sub, the session store and the timers are stubbed out, so nothing else
runs during a pass. The authorization deadline is raised so a slow pass is
measured instead of cut off. Each row is compared with the deadline
production gives that many ids: 10 seconds per 100, at most 60.

`DATABASE_URL` must name a loopback host and a database, without TLS. The API
connects through a loopback TCP proxy that reads the PostgreSQL wire protocol
and counts statements, exchanges, rows and bytes in each direction.

| Field | What it measures |
| --- | --- |
| `durationMs` | From handing the gateway the message or tick until the pass completed |
| `authorizationMs` | Time inside the hub's database transaction and proof checks |
| `database.statements` | Simple queries and extended-protocol executes, including transaction control |
| `database.roundTrips` | ReadyForQuery messages: completed exchanges with PostgreSQL |
| `database.rows`, `bytesReturned` | Rows and every byte PostgreSQL sent back |
| `resources.cpuMs` | Process CPU, user plus system, across all threads |
| `resources.peakHeapDeltaBytes` | Peak sampled JavaScript heap above a collected baseline |
| `resources.peakRssDeltaBytes` | Peak sampled resident memory above that baseline, including buffers |
| `snapshot` | Characters and 16 KiB chunks of the hibernation snapshot the hub stores |
| `productionBudgetMs` | The deadline production gives a declaration of this many ids |

Statement, row and byte counts depend only on the tree, so they match
production for the same shape, once manifests carry verification markers the
process accepts. Without `DOCUMENT_SYNC_CURSOR_HMAC_KEY`, markers are keyed to
the process, so with `--reuse` the first declaration covering a folder
verifies it in full: 111 statements instead of 9 at 100 folders. So with
`--reuse`, compare a size's second and later samples, not its first. The
[contention probe](#realtime-hub-contention) measures that pass on purpose.

Durations and CPU do not match production. Bun's JavaScriptCore
runs the hub code here instead of workerd's V8, and a local PostgreSQL answers
in well under a millisecond, where the deployed hub waits about 5 ms per warm
exchange through Hyperdrive
([database round trip](results/2026-10-26-database-round-trip.md)). The
returned bytes also cross the network in production. Memory is sampled every
5 ms at event-loop turns, so a peak between two awaits is missed, and the
peaks are lower bounds. Bun's heap figure leaves out Buffer storage, which the
RSS figure includes. The process keeps pages it has touched, so a later sample
can report a smaller RSS increase than the first. CPU includes the proxy's
relay work, about 0.75 ms per MB returned on an M2 Pro. Reports are saved as
`.test_files/performance/realtime-<run>.json`. See the
[2026-11-25 results](results/2026-11-25-realtime-hub-interest.md) at 100,
1,000 and 10,000 folders.

## Realtime hub contention

The interest probe times one socket alone. #3272's concern is what that work
does to everything else on the hub. Every socket shares one global hub object,
which is single-threaded, so while it parses and checks one account's
bundles, other sockets' events wait, and two tabs on a large account run two
full passes. This probe measures both against the same local tree.

```sh
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_realtime_probe" \
  bun run perf:realtime-contention --reuse --samples 3
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_realtime_probe" \
  bun run perf:realtime-contention --reuse --sizes 1000,10000 --sockets 1,2,4
```

It boots the API as the interest probe does and reuses the account that
`perf:realtime` seeded in the same database (`--reuse`), or seeds one with
the same `--fanout`.

With `--reuse`, the first pass declares the largest size on one socket with
no verification marker the process accepts, so every manifest is verified in
full (`unmarked`). Production keys markers with
`DOCUMENT_SYNC_CURSOR_HMAC_KEY`. The probe unsets it, so the API keys them to
the process and the markers earlier runs stored never match. That pass is
what a hub pays after a secret rotation or a verification revision bump
retires every marker. The same secret also keys principal-history
protection and projection policy-history grants, which fall back to
process keys too. It runs once per process, whatever `--samples` says,
and also warms up the hub's code. Later passes use the markers it recorded.
Without `--reuse` there is no such pass: seeding marks each folder under the
process's key as it is written.

Then an idle control of one second runs once per sample, with only an
observing socket open.
After that, each size, socket count and sample gets a fresh gateway from
`createRealtimeGateway`. An observing socket for the same account declares the
tree's root alone. Then `--sockets` more sockets each declare the first
`--sizes` folders at the same moment, as tabs reconnecting together do. Once
every acknowledgement has arrived, every armed revalidation tick fires at
once, the worst alignment of their jittered timers. The observer's own
one-folder tick runs in that pass too.

Throughout each pass, the probe publishes a `document_update_created` hint for
the observer's folder through the gateway's `publish` every
`--hint-interval-ms` (default 10), and times each one until the observer's
socket receives it. A hint stands in for any event that reaches the hub while
it is busy: its timer cannot fire, nor its routing run, until the thread is
free, so its lag is how long another socket's work waited. Deadlines missed
during a stall are skipped, so one stall delays one hint. A hint already due
when the pass ends counts its wait so far, though it was never published.

| Field | What it measures |
| --- | --- |
| `durationMs` | From starting every socket's pass until the last one completed |
| `authorizationMs` | Each socket's authorization call, fastest first |
| `hints.p50Ms` to `hints.maxMs` | Hint lag: delivery time minus the time the hint was due |
| `hints.blockedMs` | Lag above one interval, summed: time hints spent queued behind the hub |
| `hints.sent`, `hints.delivered` | Hints published and received, plus one still due when the pass ended; they must match |
| `database`, `resources` | As in the interest probe, for the whole pass |

The interest probe's measurement boundary applies. Hint lag tracks the
longest synchronous stretch between two awaits, which depends on the engine:
Bun's JavaScriptCore here, workerd's V8 in production. Lag is clamped at zero,
since a timer can fire a fraction of a millisecond early. Reports are saved
as `.test_files/performance/realtime-contention-<run>.json`. See the
[2026-11-25 results](results/2026-11-25-realtime-hub-contention.md).

## Document reload

Issue #3256 found that every full page load re-synced every document. Its
phase 1 stopped that, and the
[pane canaries](../../docs/request-budgets.md#restart-and-reconnect) pin a
reload's requests at two and eight notes. This probe asks the same question at
sizes those fixtures do not reach: which of a reload's requests still grow,
and with what.

```sh
createdb tearleads_reload_probe
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_reload_probe" \
  bun run perf:reload
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_reload_probe" \
  bun run perf:reload --documents 100,1000 --per-folder 1000
```

It boots the API in this process, as the realtime probes do, and registers a
new account through the SDK on every run. For each `--documents` size, the
account grows to that many notes, `--per-folder` (default 10) to a folder
under its root. Folders and notes are created the way the app creates them,
through the device-first container store and `documentLinks().openDocument`,
in batches of 25, each note synced before the next batch starts.

A reload keeps what a browser profile keeps: the local SQLite database and
the key the app derives from its keyring for stored principal history. It
disposes the SDK and builds a new one over that database, restores the
identity and session, binds the device-first view to the root, as the
explorer does, and marks the server-events connection acknowledged, which
starts the HTTP catch-up. No socket is opened. The reload is counted until
the SDK's sync coordinator is idle and no request has started or finished for
`--quiet-ms` (default 1000).

Each size gets one `first` reload, the first after its notes were created,
then `--samples` (default 3) `settled` reloads with nothing changed. Growing
ends with the same quiet window, so no work the creates started is counted
against the first reload.

| Field | What it measures |
| --- | --- |
| `requests`, `byRoute` | The SDK's API requests, by route template, from `ApiRequestMetrics` |
| `settledMs` | From building the SDK until a request was last seen starting, running or finishing; the probe looks 25 ms after each time the sync coordinator is idle |
| `database` | PostgreSQL traffic through the counting proxy, as in the realtime probes |
| `localSql` | Statements the client ran against its local SQLite database |

Request counts should repeat on any machine; times will not, and against a
local API with no network they are lower bounds. The app shell's own startup
requests (`POST /auth/ws-ticket`, `GET /organization-memberships` and the
billing read) are not made. The account has no Contacts folder, which the
app's system bootstrap creates after sign-in, so nothing the app requests for
that folder is counted. Reports are saved as
`.test_files/performance/reload-<run>.json`. See the
[2026-11-26 results](results/2026-11-26-document-reload.md).

## Account provisioning

The [initial production baseline](results/2026-10-24-provisioning.md) records
three registrations and their correlated database and CPU measurements.

Build the workspace SDK before running so the experiment uses current source:

```sh
bun run build:packages
bun run perf:provision --env staging
bun run perf:provision --env production --samples 3 --cloudflare
```

The environment is required; there is no implicit production target. Each
sample creates a fresh identity, local database, remote account, and personal
organization. Samples run serially, one second apart. The default is one,
with a hard maximum of ten. There are no hidden warmups or parallel load tests.
The runner stops on the first failed sample, cancels HTTP at a 60-second sample
deadline, and exits nonzero on failure or interruption. The deadline cannot
preempt synchronous JavaScript or WASM. The SDK's normal transport retries are
included as separate attempts; the harness adds no retries.

**Remote accounts persist.** Login sessions are revoked after measurement.
Account and organization IDs remain in the report for operator follow-up.
Private keys and the local database are discarded. A lost registration response
can leave an account whose ID was never acknowledged; a failed login or logout
may leave a session until server expiry. The harness does not delete accounts,
purchase subscriptions, or exercise existing identities. Each account records
the current Privacy Policy and Terms of Service revision
(`LEGAL_TERMS_VERSION`), which the operator running the harness agrees to on
its behalf.

The scenario calls `identity.generate()`, `session.registerIdentity()`, and
`session.login(challenge)` on `Tearleads`, with the app's Trash system-container
specification. It measures logout separately. It uses the same encrypted SQLite
WASM engine with memory storage, and a memory blob store. It excludes browser
startup, OPFS, worker-message overhead, UI rendering, Contacts/self-contact
bootstrap, and background sync. Thus it diagnoses the registration path without
claiming to measure the entire browser onboarding experience.

## Cloudflare correlation

`--cloudflare` requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with
permission to tail the selected Worker. Use the existing credential loader:

```sh
bash -c '. terraform/scripts/common.sh; load_secrets_env staging && export_wrangler_env && bun run perf:provision --env staging --cloudflare'
```

For production, use `load_secrets_env prod` and `--env production`.
Credentials are inherited through the environment, never command arguments or
reports. Without this option, response-header timing requires no Cloudflare
credentials.

The runner opens a temporary
[Cloudflare tail session](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/tail/methods/create/)
before creating identities, using the same `trace-v1` protocol and header filter
as the repository's pinned Wrangler. Each API attempt carries random run and
request correlation headers. An exact client-side match discards unrelated
events, including subrequests. No API deployment or logging configuration change
is needed. The connection and tail session are closed afterward; the tail also
expires server-side if the process is killed.

Only numeric `api.request.cost` fields and correlation metadata reach disk.
Raw invocation URLs, headers, arbitrary console messages, exceptions, SQL,
request/response bodies, tokens, seeds, and keys are not saved. The runner waits
up to ten seconds for delayed invocation logs and records unmatched request IDs
and tail warnings. Missing logs are unavailable measurements, not zero cost.
Transport failures are also correlated: a lost response may follow a committed
registration, so an unmatched attempt does not establish whether it reached the
Worker.
CPU and invocation wall time are retained only if supplied by the tail; otherwise
use the response's `cf-ray`, timestamp, and Worker in Workers Logs to investigate.

## Reports and interpretation

Reports are written atomically after each sample to the ignored directory
`.test_files/performance/` at the repository root, with owner-only file
permissions. They contain the target, runtime, source revision and dirty flag,
individual phase spans and HTTP attempts, server API version, and a summary.
Inspect individual samples before interpreting p50/p95 from a small run. The
first sample includes cold process/connection behavior; subsequent samples use
fresh identities but can reuse the process, network connections, and WASM module.
The deployment and database caches are not reset.

| Measurement | Boundary |
| --- | --- |
| `setup` | Local SQLite WASM initialization and database opening |
| `identity` | Key generation and local root creation |
| `registration` | Artifact creation, registration HTTP, verification, local persistence |
| `login` | Proof of possession and session installation |
| `logout` | Session revocation; excluded from provisioning percentiles |
| `requests[].headersMs` | Dispatch until response headers or transport failure |
| `serverMs`, `databaseMs` | API `Server-Timing` total and summed database waits |
| `localSql` | Count/time of local executor calls across all phases; no SQL text |
| `cloudflare.events[].costs` | Server database statement count, waits, HTTP status |

Phase/request start offsets share one monotonic clock per sample. Time between
registration start and its first request is client preparation; time from its
last response headers to registration completion includes body transfer, parsing,
verification, and local persistence. HTTP time minus `serverMs` also contains
network, admission, and work outside the server timing boundary; it is not an
exact network latency measurement. Concurrent DB calls can sum to more than the
server duration. Workers clocks measure I/O waits, not CPU, so do not add DB,
server, and HTTP values as disjoint phases.

Start with the dominant registration request. Large DB wait plus many statements
suggests query/round-trip amplification; a few statements with large DB wait
suggests expensive queries or connection acquisition. Use a controlled repeat
after a change to distinguish those hypotheses. See
[API request cost](../../docs/developer/api-request-cost.md),
[measurement plan #2521](https://github.com/a2f0/tearleads/issues/2521), and merged
PRs [#2591](https://github.com/a2f0/tearleads/pull/2591) (client durations),
[#2592](https://github.com/a2f0/tearleads/pull/2592) (server database cost), and
[#2593](https://github.com/a2f0/tearleads/pull/2593) (SDK user timing).

The CLI temporarily instruments process-wide `fetch` because the SDK facade does
not expose a transport injection option. It restores it in `finally`; run this
as a dedicated serial process. Automated `test` runs use only local fixtures and
never contact staging or production. The live command is not a CI gate or a
cached Turbo task.

```sh
bun run check:package @tearleads/performance
```
