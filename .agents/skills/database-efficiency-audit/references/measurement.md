# Measurement

Every number in the report comes from one of the sources below, taken at the
audited revision with a fresh SDK dist, and saved under
`<audit-directory>/measurements/`. A saving no source reproduces is Traced or
Estimated.

## Inventories

Take these once per revision:

- **API tables and indexes per dialect:** `CREATE TABLE` statements,
  the indexes their `PRIMARY KEY` and `UNIQUE` constraints create, and
  `CREATE [UNIQUE] INDEX` statements in
  `packages/api-shared/drizzle/0000_greenfield_baseline.sql` (Postgres) and
  `packages/api-shared/drizzle-sqlite/0000_greenfield_baseline.sql`
  (SQLite and Turso). Constraint indexes count: they can cover a narrower
  index or serve a query. Record each index's table, columns, uniqueness, and
  partial predicate, and flag any index present in one dialect only.
- **Client tables and indexes:** `sqliteTable(`, `index(`, and
  `uniqueIndex(` under `packages/client-sdk/src/data/sqlite` and
  `packages/app/src/document-projectors`, excluding tests. DDL is rendered
  by `defineSqlTableSchema` in
  `packages/client-sdk/src/data/sqlite/sqlTableSchema.ts`, which also
  enforces required columns.
- **Existing budgets and plans:** non-snapshot tests that call
  `withDatabaseStatementCounter` (`rg -l withDatabaseStatementCounter packages/api/src`),
  API plan tests (`rg -l 'explain query plan' packages/api/src`), and client
  plan tests (`rg -il 'EXPLAIN QUERY PLAN' packages/client-sdk/src`). Record
  each ceiling and asserted index; they are the current contract and a
  shipped proposal ratchets them.

## Statement capture on the API

Every API dialect logs statements through one object,
`databaseStatementLogger` in
`packages/api-shared/src/adapters/databaseStatementCounter.ts`, which Drizzle
calls with the SQL text and parameters. A Bun preload outside the checkout
can wrap it to record each statement without changing repository code. Write
this file into the audit directory, replacing `<REPO_ROOT>`:

```ts
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { beforeEach } from "bun:test";
import { databaseStatementLogger } from "<REPO_ROOT>/packages/api-shared/src/adapters/databaseStatementCounter.ts";

const out = process.env.SQL_CAPTURE_OUT;
if (!out) throw new Error("SQL_CAPTURE_OUT is required");
const hashParams = process.env.SQL_CAPTURE_PARAM_HASH === "1";
const capture = globalThis as { sqlCaptureLabel?: string };
let testNumber = 0;
const write = (entry: object) =>
  appendFileSync(out, `${JSON.stringify(entry)}\n`);
const paramHash = (params: unknown[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(params, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    )
    .digest("hex")
    .slice(0, 12);

beforeEach(() => {
  testNumber += 1;
  capture.sqlCaptureLabel = undefined;
});

const count = databaseStatementLogger.logQuery;
Object.assign(databaseStatementLogger, {
  logQuery(query?: string, params?: unknown[]) {
    write({
      label: capture.sqlCaptureLabel ?? `test-${testNumber}`,
      sql: query ?? "<transaction control>",
      params: params?.length ?? 0,
      ...(hashParams && params ? { paramHash: paramHash(params) } : {}),
    });
    count.call(databaseStatementLogger);
  },
});

// Request-volume canaries print one metrics line per phase; mark its end.
const info = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const [first] = args;
  const prefix = "[dual-pane-request-metrics] ";
  if (typeof first === "string" && first.startsWith(prefix)) {
    const metrics = JSON.parse(first.slice(prefix.length));
    write({ phaseEnd: metrics.label, requests: metrics.total });
  }
  info(...args);
};
```

Name the package's own `bunfig.toml` preloads first so they run before the
capture whatever Bun does with the configured list:

```sh
# API tests, from packages/api
SQL_CAPTURE_OUT=<file> API_DATABASE=memory bun test \
  --preload ./test/preload.ts --preload <capture.ts> <test file>
# App canaries, from packages/app (the in-process test API loads the same module)
DUAL_PANE_REQUEST_PROFILE=1 SQL_CAPTURE_OUT=<file> bun test \
  --preload ./happydom.ts --preload <capture.ts> <canary file>
```

Labels are global, not async-context scoped: background work that outlives
a test (sync pumps, timers; see `packages/app/happydom.ts`) is attributed to
whichever test runs next. Use per-test totals as evidence only from a run
of one test (`-t`). A probe sets `globalThis.sqlCaptureLabel` around the
call it measures, after awaiting any background work its setup started, and
clears it after, so fixture setup is labelled separately. Bind values are
never recorded. With `SQL_CAPTURE_PARAM_HASH=1` each entry also carries a
short hash of its values, which proves that a repeated statement reads the
same key rather than a different one; keep the hashes in the scratch
directory, never in the issue. Transaction controls reach the logger only on
`API_DATABASE=sqlite` and `postgres`: PGlite's native transaction method
bypasses it, so a PGlite capture (including every canary) has no
transaction count. Summarize with `jq`, for example the most repeated
statements for one label:

```sh
jq -r 'select(.label == "<label>") | .sql | gsub("\\s+"; " ")' <file> \
  | sort | uniq -c | sort -rn | head -20
```

`jq -r` prints multi-line SQL across several lines, so `jq -r ... | wc -l`
over-counts; count records with `jq -c` or `jq -s length`. Agent shells may
be zsh, which does not split an unquoted variable into words: run a file
list or a set of globs through a shell function or a `for` loop over
literal arguments, never `rg $GLOBS`.

The counter alone, `withDatabaseStatementCounter(counter, work)`, counts
without text. Its scope must contain the awaited work: pass an `async`
function that awaits the query. A bare Drizzle builder returned from the
callback executes after the scope has closed and counts zero. Like the
capture, it sees transaction controls on SQLite but not on PGlite, so a
SQLite count runs higher by each transaction's control statements (one per
request in the document budget below). To assert an exact count for work
inside one transaction, open the counter inside the transaction callback,
as `packages/api/src/workflows/signerPublicKey.test.ts` does. Whole-request
ceilings, with PGlite and SQLite measurements in a comment, are in
`packages/api/src/workflows/documents/mutations/documentStatementBudget.test.ts`.

## Scenario set

Capture once per revision, in the background, and keep one log and one
capture file per run. When the protocol audit runs at the same revision,
run the canaries once for both: set `DUAL_PANE_REQUEST_PROFILE=1` and
`DUAL_PANE_REQUEST_PROFILE_DETAIL=1` beside the capture preload, so one log
holds the request profile and one file the statements (about two minutes
for all eight on 2026-10-30).

- The eight request-volume canaries listed in the `protocol-efficiency-audit`
  measurement reference (upload, organization bootstrap, folder and group
  mutations, device-first offline, active peer, groups, sharing), under the
  capture preload. They drive the real SDK against the in-process test API
  on PGlite, so their statement mix approximates production. Statements
  between two `phaseEnd` markers include any setup the canary ran before
  the phase started; use a probe for exact per-operation numbers.
- The API statement-budget tests from the inventory, under the preload, for
  registration, read-model, projection, and verification-marker counts.

Record per scenario: total statements, statements per request where the
phase gives a request count, and the top repeated normalized statements.
Count transactions only from a SQLite or local Postgres capture of the same
test, and mark the count unavailable for PGlite; an unexplained count is a
transaction-scope lead. Compare the canary top ten with the PlanetScale
Insights top ten; agreement confirms the canaries exercise the production
hot path, and disagreement is itself a lead.

## Statement capture on the client

There is no client statement counter. Every SDK statement, including
transaction control and schema ensures, passes through `createExecSql` in
`packages/client-sdk/src/data/sqlite/sqlExec.ts`, and each one is a separate
worker message: `packages/sqlite-worker/src/types.ts` has no batch request.
A probe in `packages/client-sdk` builds its own executor around a real
SQLite wasm database from `createTestExecSql` in
`packages/test-utils/src/createTestExecSql.ts` and records every call, as
`packages/client-sdk/src/data/persistence/principalHistory/principalHistoryStageRetention.plan.test.ts`
does. Use a fresh executor per measurement: executors are cached per client,
and the first call on a connection also runs the schema ensure. Because
the app canaries have no client hook, how often an SDK operation runs in a
real flow is not measured; report client savings per operation and list
the frequency under Not measured.

## Query plans

At fixture sizes a planner may scan a table it would search at scale, so a
plan proves whether an index **can** serve a query, and a scaled fixture
proves whether it **does**.

- **API Postgres, local.** Create a scratch database
  (`createdb -h localhost -p 5432 tearleads_db_audit_<short-sha>`), run the
  probe from `packages/api` with `API_DATABASE=postgres` and
  `DATABASE_URL=postgres://localhost:5432/<that database>` (the test preload
  migrates it), capture the statement, and run `EXPLAIN (COSTS OFF)` after
  `SET enable_seqscan = off` to test eligibility. For a High claim, grow the
  fixture through the API's own helpers in a loop, `ANALYZE`, and run
  `EXPLAIN (ANALYZE, BUFFERS)` on reads only. Drop the scratch database
  afterwards. Never point a probe at a database you did not create.
- **API PGlite and SQLite.** Run `explain` (PGlite, `API_DATABASE=memory`)
  or `explain query plan` (`API_DATABASE=sqlite`) over the captured
  statement with `db.execute`, as
  `packages/api/src/services/containers/listContainerRowsPlan.test.ts` does.
  An index proposal shows both dialects.
- **Client SQLite.** `EXPLAIN QUERY PLAN` through `createTestExecSql`. A
  `SCAN` of a growing table or `USE TEMP B-TREE` for an `ORDER BY` marks a
  missing or mis-ordered index.
- **Production statistics.** See `planetscale.md` for `hypopg` and the
  limits of small production data.

## Index census

For an index drop or addition, record:

- the leading columns and uniqueness, and whether it backs a constraint,
  an `ON CONFLICT` target, or a foreign key;
- every production query that filters, joins, or orders by those columns
  (`rg` for the Drizzle column symbols and for raw SQL naming the table),
  excluding tests and fixtures;
- the plan for each such query with and without the index, on both API
  dialects or on client SQLite;
- the write paths that maintain it, since every index costs each insert and
  any update of its columns.

## Probes

Write probes in the per-work-item directory, never in the checkout. Import
repository modules by absolute path, including third-party packages such
as `drizzle-orm` (`<REPO_ROOT>/packages/api-shared/node_modules/drizzle-orm/index.js`),
because a bare specifier does not resolve from outside the checkout. Run
them with `<REPO_ROOT>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
from the owning package directory with the package's preloads. Never change
constants, ceilings, or schema in the checkout to measure. A probe reads its
output path and scratch database name from environment variables rather
than hard-coding them, so a verification re-run writes beside the
auditor's evidence instead of over it. Give every run, re-runs included, a
fresh scratch database: rows left by another probe skew counts and buffers
and can fail a purge test that passes on a fresh database. Remove scratch
files with a guarded path (`rm -rf -- "${PROBE_DIR:?}"`), never a bare
variable that could expand to nothing.

## What a measurement is not

- A passing statement-budget test at its ceiling is a contract, not
  evidence that the ceiling is the minimum.
- A statement count is not a latency. Report counts and say whether the
  statements are serial (inside a transaction or awaited in sequence) or
  concurrent; claim latency only when measured.
- A fixture size is not production size. State it beside every count and
  plan, and say how the count scales with organization, tree, or history
  size when the code makes that clear.
