# @tearleads/performance

An executable SDK host for small, repeatable experiments against staging and
production. It imports public SDK, SQLite, and PostgreSQL transport entry
points, plus the API's test runtime for the local realtime hub probe. The app,
SDK, and API do not depend on it.

The [initial production baseline](baseline.md) records three registrations and
their correlated database and CPU measurements.

The [database round-trip experiment](database-experiment.md) separates connection
setup, repeated warm queries, batched queries, and server execution time through
the API's existing Hyperdrive binding. Run it with `bun run perf:database`.

The [realtime hub interest probe](#realtime-hub-interest-authorization) times
the hub's folder authorization against a local database. Run it with
`bun run perf:realtime`.

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

One production run on 2026-11-20 took 5.79 s to provision the account,
152.97 s to seed it and 39.71 s to verify it. The 192.68 s round trip
recovered 25 documents and 24 attachments (9,604,560 plaintext bytes),
including the circular saw, drill and refrigerator photos and receipts.

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
production for the same shape. Durations and CPU do not. Bun's JavaScriptCore
runs the hub code here instead of workerd's V8, and a local PostgreSQL answers
in well under a millisecond, where the deployed hub waits about 5 ms per warm
exchange through Hyperdrive ([database baseline](database-baseline.md)). The
returned bytes also cross the network in production. Memory is sampled every
5 ms at event-loop turns, so a peak between two awaits is missed, and the
peaks are lower bounds. Bun's heap figure leaves out Buffer storage, which the
RSS figure includes. The process keeps pages it has touched, so a later sample
can report a smaller RSS increase than the first. CPU includes the proxy's
relay work, about 0.75 ms per MB returned on an M2 Pro. Reports are saved as
`.test_files/performance/realtime-<run>.json`.

### Results, 2026-11-25

One run on an M2 Pro with Bun 1.4.2 and PostgreSQL 17.12 measured three
samples per size, with `--fanout 10`, from `6bd2c5c17` plus this probe. CPU
and duration are medians; peak heap is the largest sample. The first
100-folder declaration took 115 ms of CPU before the code was warm, which
leaves its median unaffected.

| Folders | Pass | Statements | Rows | Returned | CPU | Duration | Peak heap | Snapshot |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | Declaration | 9 | 113 | 1.3 MiB | 20 ms | 41 ms | not sampled | |
| 100 | Revalidation | 9 | 113 | 1.3 MiB | 20 ms | 30 ms | not sampled | 26 KB, 2 chunks |
| 1,000 | Declaration | 10 | 1,013 | 12.5 MiB | 155 ms | 170 ms | 18 MiB | |
| 1,000 | Revalidation | 10 | 1,013 | 12.5 MiB | 145 ms | 175 ms | 43 MiB | 300 KB, 19 chunks |
| 10,000 | Declaration | 28 | 10,013 | 124.8 MiB | 1,489 ms | 2,475 ms | 397 MiB | |
| 10,000 | Revalidation | 28 | 10,013 | 124.8 MiB | 1,502 ms | 1,422 ms | 411 MiB | 3.4 MB, 208 chunks |

Every statement was its own round trip. The 100-folder heap peaks fell
between samples.

- **Statements are not the cost.** The batched path read grows from 9 to 28
  statements across a hundredfold increase in folders. In production, 28
  exchanges at about 5 ms each add roughly 0.15 s.
- **Bytes and CPU grow with every folder.** Each folder returns about 13 KB of
  manifest bundles and costs about 0.15 ms of CPU. At 10,000 folders that is
  125 MiB from PostgreSQL and 1.5 s of CPU on the hub's single thread.
- **Revalidation costs as much as connecting.** A revalidation pass repeats
  the whole declaration's reads and checks, every 2.5 to 5 minutes, for each
  open socket.
- **Memory, not the deadline, looks like the limit at 10,000.** The local
  passes finished in 1.3 to 6.1 s, far inside the 60 s budget, even after
  adding production's round trips. But the rows alone are 125 MiB, and Bun's
  heap rose 325 to 411 MiB during the pass. A Workers isolate, which hosts the
  hub, is limited to 128 MB. JavaScriptCore and V8 count memory differently,
  so this does not prove the hub fails at 10,000 folders. It does make memory
  the likeliest failure, ahead of the deadline.
- **The snapshot is larger than the issue's estimate.** It is 3.4 MB in 208
  chunks at 10,000 folders, against an estimated 2 MB.

Durations at 10,000 folders varied from 1.3 to 6.1 s while CPU stayed between
1.4 and 1.9 s. The rest was waiting outside the process, mostly on PostgreSQL.

## Account provisioning

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
