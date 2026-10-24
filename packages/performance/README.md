# Performance experiments

`@tearleads/performance` is an executable SDK host for small, repeatable
experiments against staging and production. It imports public SDK and SQLite
adapter entry points. The app, SDK, and API do not depend on it.

The [initial production baseline](baseline.md) records three registrations and
their correlated database and CPU measurements.

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
purchase subscriptions, or exercise existing identities.

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
