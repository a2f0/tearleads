# Measurement

Every number in the report comes from one of the sources below, taken at the
audited revision with a fresh SDK dist, and saved under
`<audit-directory>/measurements/`. A proposal whose saving is not reproduced
by one of them is labelled Estimated.

## Request and byte baselines

The app's request-volume canaries drive the real application, SDK, and test
API through a proxied-request recorder
(`packages/app/test/helpers/proxiedApiRequestBudget.ts`). With the profile
environment on, each prints a `[dual-pane-request-metrics]` JSON line per
phase with the total, body bytes, sync intents, and per-endpoint counts, and
a detailed text profile naming repeated exact paths.

| Canary (`packages/app`) | Scenario |
| --- | --- |
| `src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx` | one small file upload |
| `src/shell/pane/tests/OrganizationBootstrapRequestVolume.test.tsx` | personal bootstrap; second organization |
| `src/shell/pane/tests/FolderMutationRequestVolume.test.tsx` | create, link, unlink, trash, restore |
| `src/shell/pane/tests/GroupMutationRequestVolume.test.tsx` | group create and member add |
| `src/shell/pane/tests/DeviceFirstOfflineRequestVolume.test.tsx` | offline writes and recovery |
| `src/shell/pane/tests/DualPaneProvider.activePeerRequestVolume.test.tsx` | peer reconciling an ungranted change (asserts counts only; it does not invoke the profile recorder, so it yields no per-endpoint or byte table) |
| `src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx` | Admins enrollment and peer convergence |
| `src/shell/pane/tests/DualPaneProvider.sharing.test.tsx` | root share with attachment, post-share settle |

Run them once per audited revision, in the background, from `packages/app`:

```sh
DUAL_PANE_REQUEST_PROFILE=1 DUAL_PANE_REQUEST_PROFILE_DETAIL=1 \
  bun test <canary file>
```

Keep one log per canary with its exit code and wall time. When the database
audit runs at the same revision, run the canaries once for both, with its SQL
capture preload beside the profile variables; one pass of all eight took about
two minutes on 2026-10-30. Extract the
per-endpoint tables into `measurements/baseline.md`; the issue reproduces them.
A canary that does not call the profile recorder contributes only the ceilings
asserted in its source; say so in the baseline rather than leaving its row
empty. The ceilings asserted inside each canary are the current contract; a
shipped proposal must lower them, so the report names the ceiling each proposal
changes.

The dual-pane canaries drive two panes (two users or devices) through one
recorder, so their per-endpoint counts sum both panes. A path repeated twice
may be one read per device rather than a re-read; attribute it with the probe
below before calling it waste.

`docs/request-budgets.md` holds no byte profiles; it explains how to print
them with `DUAL_PANE_REQUEST_PROFILE=1` and
`DUAL_PANE_REQUEST_PROFILE_DETAIL=1`. Measure several runs for byte claims; the
sharing and Admins fixtures also assert body-byte ceilings.

## Pane and field attribution

The recorder already keeps every proxied request with its URL, method,
status, authorization header, and full request and response bodies:
`listProxiedApiRequests()` in `packages/app/test/helpers/mswServer.ts`. A
preload outside the checkout can read them without changing repository code.
Wrap `console.info` as the database audit's capture preload does; at each
`[dual-pane-request-metrics]` line, take the last `total` requests from
`listProxiedApiRequests()` (import it by absolute path) and append one JSON
line per request to a file named by an environment variable, with:

- the phase label, the pane as a short hash of the authorization header
  (never the header itself), method, path, query, status, and body bytes;
- the byte size of each top-level field of the request and response body;
- for policy reads, the version and state hash the response carries, so a
  re-read of a head the same pane already holds is visible;
- per response field, the bytes of strings of 64 or more characters that the
  same request sent (an echo) or that the same pane already received earlier
  (a redelivery).

Track requests by their index in the recorder list and process each once:
some canaries print an overall window (the sharing canary's `test total`)
that overlaps earlier phases, and counting it again would report every
response in it as a redelivery. Reset that index and the per-pane history in
a `beforeEach`: `resetMockServer()` clears the recorder between tests, so
indexes restart in each test.

Run it like the profile, from `packages/app`:

```sh
DUAL_PANE_REQUEST_PROFILE=1 REQUEST_DUMP_OUT=<file> bun test \
  --preload ./happydom.ts --preload <dump.ts> <canary file>
```

On 2026-10-30 this made three proposals Measured, settled which repeats were
per pane, and refuted a candidate cheaply. Keep the dumps in the audit
directory: they hold request bodies, so the issue carries only sizes and
counts.

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

Take these once per revision and save the outputs:

- Routes: operations in `docs/openapi.json` by method and path.
- API tables: `CREATE TABLE` statements in
  `packages/api-shared/drizzle/0000_greenfield_baseline.sql`.
- SDK tables: the string argument following each `sqliteTable(` call under
  `packages/client-sdk/src/data/sqlite`, excluding test files.
- Mechanisms: position markers (cursor, watermark, commit LSN, version
  vector, lane check, discovery sequence), idempotency receipts, tombstone
  tables, intent tables, checkpoint tables, and audit ledgers, each with the
  tables and routes that implement it. Count distinct mechanisms per job.

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
  measured.
- A fixture size is not production size. State the fixture size beside
  every count and say how the count scales with organization, tree, or
  history size when the code makes that clear.
