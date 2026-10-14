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

Keep one log per canary with its exit code and wall time. Extract the
per-endpoint tables into `measurements/baseline.md`; the issue reproduces them.
A canary that does not call the profile recorder contributes only the ceilings
asserted in its source; say so in the baseline rather than leaving its row
empty. The ceilings asserted inside each canary are the current contract; a
shipped proposal must lower them, so the report names the ceiling each proposal
changes.

`docs/request-budget-closeout.md` holds ten-run byte profiles per endpoint
for the sharing and Admins scenarios. Reuse them for byte claims unless the
response shape changed since; say which.

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

Open each hit and classify it as a read site or a write site. A test helper
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
  the minimum.
- A request count is not a latency; `#2521` tracks timing instrumentation
  separately. Report counts and bytes and leave duration claims out unless
  measured.
- A fixture size is not production size. State the fixture size beside
  every count and say how the count scales with organization, tree, or
  history size when the code makes that clear.
