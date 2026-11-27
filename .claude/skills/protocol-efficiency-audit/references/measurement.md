# Measurement

Every number in the report comes from one of the sources below, taken at the
audited revision with a fresh SDK dist, and saved under
`<audit-directory>/measurements/`. A proposal whose saving is not reproduced
by one of them is labelled Estimated.

## Performance harness

`packages/performance` holds the repository's repeatable performance
experiments, run as root `perf:*` scripts. Its
[README](../../../../packages/performance/README.md) explains each one, and
its [results index](../../../../packages/performance/results/README.md) lists
every recorded run, newest first. Read the index while building the
baseline. A recorded result was measured at its own revision and tier: it
gives deployed costs and ranks leads, but only a run at the audited revision
makes a proposal Measured.

| Task | Measures | Use in this audit |
| --- | --- | --- |
| `bun run perf:provision` | Requests, phase times, and server timing for one fresh account's registration and login on a deployed tier; with `--cloudflare`, statements per request | `bootstrap-and-session`: deployed request count and server cost of registration |
| `bun run perf:seed` | One account seeded through the CLI, then recovered by a second process with empty stores, on a deployed tier; saves a structured JSON report and accepts `--cloudflare` for correlated `api.request.cost` logs | `bootstrap-and-session` and `discovery-and-hints`: how long a full recovery takes and, with `--cloudflare`, per-route statements and payload sizes |
| `bun run perf:canaries` | Requests, body bytes, WebSocket hint frames, and ceiling headroom per phase and endpoint for every app request-volume canary; `--payload-audit` adds pane/field/echo/redelivery/head-reread attribution and `--stacks` adds issuer stacks | Every slice: the [request and byte baseline](#request-and-byte-baselines) |
| `bun run perf:scenarios` | Requests, `409` conflicts, error codes, wire bytes, and optional API/SQLite/payload captures for every `packages/bob-and-alice` multi-party keying scenario | Multi-party access, revocation, shrink-carry, conflict-retry, and baseline staging slices not covered by app canaries |
| `bun run perf:rotations` | Scaled HTTP requests, `409`s, wire bytes, PostgreSQL traffic, and actor SQLite plans across `--rotations` and `--depth` for group shrinks, revocations, stale-writer repair, fresh-device hydration, and roster-vouched shares | Access-plane, keying, and recovery slices: how keyring and carry-batch traffic grows with rotation history and folder depth |
| `bun run perf:baselines` | Scaled HTTP/PostgreSQL/SQLite traffic and peak RSS across `--sizes-mb` (inline vs. `/baseline-stages`) and `--race` (`409` tail retry) for multi-linked document unlink rotations and fresh-reader sync | Document sync and baseline staging slices: segment overhead, stage resume efficiency, and paged reader hydration |
| `bun run perf:realtime` | Statements, rows, bytes, CPU, and memory per `known_containers` declaration and revalidation pass, by tree size, against a local database | `discovery-and-hints` and `bootstrap-and-session`: what interest declaration costs the hub per declared container |
| `bun run perf:realtime-contention` | How long other sockets' hints wait while those passes run | `discovery-and-hints` and `bootstrap-and-session`: whether a declaration or revalidation change shortens the hub's stalls |
| `bun run perf:reload` | Requests by route, settle time, PostgreSQL traffic, and local SQLite statements/plans for a returning client's reload, by account size, against a local database; supports `--ack-delay-ms` and `--peer-edits` | `bootstrap-and-session` and `discovery-and-hints`: which of a reload's requests still grow with the account, under delayed acks or peer edits, at sizes the restart canary does not reach |
| `bun run perf:inventory` | Static census of API Postgres tables/columns/indexes, client SQLite tables/columns/indexes, OpenAPI operations and unreferenced 2xx response fields, and canary budget ceilings/drift | `api-schema`, `local-schema`, and every slice: one-command baseline inventory and zero-reader leads |
| `bun run perf:database` | One warm driver exchange through Hyperdrive, against the same statements batched | Turning statements per request into production latency |

`perf:canaries`, `perf:reload`, and the realtime probes are local. They
write git-ignored reports under the measured checkout's
`.test_files/performance/`, and all but the canaries need a scratch
database; the audit request authorizes both. Copy every report the audit
cites into `measurements/`. Seeding a 10,000-folder tree takes over an hour;
reuse a seeded scratch database with `--reuse` when one exists, and record
which. `perf:provision` and `perf:seed` create persistent accounts and
`perf:database` deploys a temporary Worker on a deployed tier, so run them
only with the user's approval; otherwise cite the latest result and its
date.

## Request and byte baselines

The app's request-volume canaries drive the real application, SDK, and test
API through a proxied-request recorder
(`packages/app/test/helpers/proxiedApiRequestBudget.ts`). With the profile
environment on, each prints a `[dual-pane-request-metrics]` JSON line per
phase with the total, body bytes, sync intents, and per-endpoint counts, and
a detailed text profile naming repeated exact paths. `bun run
perf:canaries` finds every canary file that calls the recorder, runs each one
alone from `packages/app` with the profile on, and saves its phases, per
endpoint, as JSON and Markdown, with one log per file and its exit code and
wall time. Its
[README](../../../../packages/performance/README.md#request-volume-canaries)
lists the report's fields.

| Canary (`packages/app`) | Scenario |
| --- | --- |
| `src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx` | one small file upload |
| `src/shell/pane/tests/OrganizationBootstrapRequestVolume.test.tsx` | personal bootstrap; second organization |
| `src/shell/pane/tests/FolderMutationRequestVolume.test.tsx` | create, link, unlink, trash, restore |
| `src/shell/pane/tests/GroupMutationRequestVolume.test.tsx` | group create and member add |
| `src/shell/pane/tests/DeviceFirstOfflineRequestVolume.test.tsx` | offline writes and recovery |
| `src/shell/pane/tests/DualPaneProvider.activePeerRequestVolume.test.tsx` | peer reconciling an ungranted change (asserts counts only; it does not invoke the profile recorder, so `perf:canaries` skips it) |
| `src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx` | Admins enrollment and peer convergence |
| `src/shell/pane/tests/DualPaneProvider.sharing.test.tsx` | root share with attachment, post-share settle |
| `src/shell/pane/tests/PaneReconnectRequestVolume.test.tsx` | settled reconnect; reconnect after a peer's folder create |
| `src/shell/pane/tests/PaneRestartRequestVolume.test.tsx` | persisted pane restart; settled restarts by note and folder count |

Run them once per audited revision, in the background, from the measured
checkout:

```sh
bun run perf:canaries                                     # every canary, once
bun run perf:canaries --payload-audit                     # + pane/field/echo/redelivery/head-reread audit
bun run perf:canaries --canary Sharing --payload-audit --stacks
bun run perf:canaries --canary Sharing --samples 3        # ranges for bytes
bun run perf:canaries --baseline <report.json>            # and the changes
bun run perf:canaries --compare <before.json> <after.json>
```

`--canary` matches a canary's file name, ignoring case, and repeats; relative
report paths resolve from the repository root. All nine took 236 seconds on
2026-11-26; that run is in the
[results index](../../../../packages/performance/results/README.md), so a
baseline compared with it shows what changed since. The command exits
non-zero unless every run passed and printed a profile, and the report names
each canary that failed, timed out, or printed none. Every run now also
records delivered WebSocket hint frames per phase (`ws`) and asserted
budget ceilings beside measured totals (`budget`), flagging ceiling drift
automatically in the Markdown report. Copy the report's JSON,
Markdown, and log directory into `measurements/`, and the per-endpoint
tables into `measurements/baseline.md`; the issue reproduces them. When the
database audit runs at the same revision, run the canaries once for both with
`--statements --param-hash --client-statements --payload-audit`, as the
[combined audits guide](../../../../docs/developer/combined-efficiency-audits.md)
describes.

A canary that does not call the profile recorder contributes only the
ceilings asserted in its source; say so in the baseline rather than leaving
its row empty. The ceilings asserted inside each canary are the current
contract; a shipped proposal must lower them, so the report names the
ceiling each proposal changes.

The dual-pane canaries drive two panes (two users or devices) through one
recorder, so their per-endpoint counts sum both panes. A path repeated twice
may be one read per device rather than a re-read; attribute it with the probe
below before calling it waste.

`docs/request-budgets.md` holds no byte profiles; it explains how to print
them with `DUAL_PANE_REQUEST_PROFILE=1` and
`DUAL_PANE_REQUEST_PROFILE_DETAIL=1`. Base byte claims on several samples:
`--samples` runs each canary up to five times and reports every count as a
range. The sharing and Admins fixtures also assert body-byte ceilings.

Record request bytes beside response bytes in the baseline. On 2026-11-10
request bodies were larger than responses in every write scenario, and they
were signatures (about 6.2 KB each), not repeated fields.

## Pane and field attribution

Use the built-in payload audit instead of writing an external dump preload:

```sh
bun run perf:canaries --payload-audit
bun run perf:canaries --canary Sharing --payload-audit --stacks
```

`packages/performance/src/canaries/payloadAuditPreload.ts` reads every
proxied request from `listProxiedApiRequests()` once per phase (deduplicating
overlapping windows such as `test total` and resetting per test) and saves a
private JSONL trace beside the canary log plus an aggregated summary in the
canary report, with:

- the phase label, the pane as a per-run HMAC of the authorization header
  (never the header itself), method, path, query, status, body bytes, and the
  `x-known-manifests` citation header count;
- the byte size of each top-level field of the request and response body;
- for policy reads, the version and state hash the response carries, so an
  exact-head re-read by the same pane is counted explicitly;
- per response field, bytes of strings of 64 or more characters that the same
  request sent (echo), that the same pane already received earlier
  (redelivery), or that the same pane uploaded in an earlier request and
  downloaded again later (re-downloaded upload);
- with `--stacks`, filtered `fetch` issuer call stacks for every request so
  attribution is pinned by caller rather than log ordering.

Keep the raw JSONL traces in the private audit directory: they carry per-run
hashes and field sizes, while the published issue carries only aggregated
sizes, counts, and caller summaries.

## Suppression probes

Measure a removal by suppression where an existing option cannot disable
the request class: a preload outside the checkout that drops one class of
realtime frame, or answers one request class from what the pane already holds,
and re-runs the canary gives a before and after (folder to Trash 10 to 5)
where a trace gives an estimate. The canary's own assertions must still pass:
a suppression that breaks convergence measured nothing.

## Statements per request

`withDatabaseStatementCounter` in
`packages/api-shared/src/adapters/databaseStatementCounter.ts` counts ORM
statements inside a scope. Existing uses in
`packages/api/src/services/auth/registration.batching.test.ts` and
`packages/api/src/access/read/accessManifestBundles.test.ts` show the shape:
wrap the route or service call in the counter and assert or log
`counter.statements`. Write such probes outside the checkout, drive the real
route with `API_DATABASE=memory`, and record the count with the fixture size
it was taken at.

## Inventories

Run `bun run perf:inventory [--canaries <canary-report.json>]` once per
revision and copy its saved JSON and Markdown reports from
`.test_files/performance/` into `measurements/`. It automates:

- Routes: operations in `docs/openapi.json` by method and path, plus
  unreferenced 2xx JSON response field leads in client/app/cli production
  source.
- API tables, columns, and indexes: replayed in migration order across all
  SQL files in `packages/api-shared/drizzle/` (mapped to Drizzle schema
  symbols in `packages/api-shared/src/schema` and `packages/loro/src/server`).
- Client SQLite tables, columns, and indexes: `sqliteTable(` definitions
  under `packages/client-sdk/src/data/sqlite/schema` and
  `packages/app/src/document-projectors`.
- Canary budget ceilings and, with `--canaries`, measured-vs-ceiling drift.

Supplement the automated census with a manual **Mechanisms** tally: position
markers (cursor, watermark, commit LSN, version vector, lane check, discovery
sequence), idempotency receipts, tombstone tables, intent tables, checkpoint
tables, and audit ledgers, each with the tables and routes that implement it.
Count distinct mechanisms per job.

## Reader and writer census

For a table retirement, find its Drizzle export symbol in the schema module,
then search production source for that symbol:

```sh
rg -l --glob '!*.test.ts' --glob '!*.test.tsx' --glob '!**/test/**' \
  --glob '!*.testUtils.ts' --glob '!*.testFixtures.ts' --glob '!**/__tests__/**' \
  '\b<tableSymbol>\b' packages/api/src packages/api-shared/src
```

Agent shells may be zsh, which does not split an unquoted variable into
words: keep the globs literal as above or wrap the search in a shell function
taking the symbol as its argument, and never pass the globs through a
variable. Open each hit and classify it as a read site or a write site. A test helper
or fixture that the globs missed is not a production reader; drop it from
the census. For SDK tables,
search `packages/client-sdk/src` and `packages/app/src` for the symbol and for
the raw table name in SQL strings. A table with no production read site is a
retirement candidate; a table with one writer and one reader is a candidate
for folding into the reader's source. Record every site in the proposal's
evidence so a reviewer can re-run the census.

## Probes

A probe shows a saving on repository code rather than estimating it: a route
driven twice with and without a cited head, a statement count before and
after a query change made in the probe's own copy of a helper, or a canary
scenario re-run with one request class disabled by an existing option. Write
probes in the per-work-item directory, import repository modules by absolute
path, and run them with
`<repo-root>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
from the owning package directory. Never add probe files to the checkout and
never change constants or ceilings in the checkout to measure.

## What a measurement is not

- A passing canary at its ceiling is a contract, not evidence the ceiling is
  the minimum. A canary far below its ceiling is drift: report the measured
  count beside the ceiling so a shipped proposal lowers both.
- A request count is not a latency; `#2521` tracks timing instrumentation
  separately. Report counts and bytes and leave duration claims out unless
  measured, as the deployed-tier tasks in the
  [performance harness](#performance-harness) measure them.
- A fixture size is not production size. State the fixture size beside
  every count and say how the count scales with organization, tree, or
  history size when the code makes that clear.
- A canary path is not always a production path. The in-process test API
  uses PGlite and the in-memory object store; before counting a request or
  statement the canary shows, confirm the production configuration reaches
  it.
