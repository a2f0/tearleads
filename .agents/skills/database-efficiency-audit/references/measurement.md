# Measurement

Every number in the report comes from one of the sources below, taken at the
audited revision with a fresh SDK dist, and saved under
`<audit-directory>/measurements/`. A saving no source reproduces is Traced or
Estimated.

## Performance harness

`packages/performance` holds the repository's repeatable performance
experiments, run as root `perf:*` scripts. Its
[README](../../../../packages/performance/README.md) explains each one, and
its [results index](../../../../packages/performance/results/README.md) lists
every recorded run, newest first. Read the index while building the
baseline. A recorded result was measured at its own revision and tier: it
gives production unit costs and ranks leads, but only a run at the audited
revision makes a proposal Measured.

| Task | Measures | Use in this audit |
| --- | --- | --- |
| `bun run perf:realtime` | Statements, round trips, rows, and bytes per realtime hub interest pass, counted at the PostgreSQL wire of a local database | The hub's container-interest reads (`realtime/containerInterest*`) in `api-access-and-projections`. They never reach `api.request.cost` or the canaries |
| `bun run perf:realtime-contention` | How long other sockets wait while those passes run | Whether a statement or row saving there also shortens the hub's stalls |
| `bun run perf:reload` | PostgreSQL traffic and the client's local SQLite statements for one returning client's reload, by account size, against a local database | `client-sync-persistence` and `api-listings-and-sync-reads`: how a reload's statements on both sides grow with the account. The app canaries have no client statement hook |
| `bun run perf:database` | One warm driver exchange through Hyperdrive, against the same statements batched in one exchange | Turning a serial round-trip saving into production latency |
| `bun run perf:provision --cloudflare` | Statements and database wait per registration and login request on a deployed tier | Production statements per request in `api-auth-and-registration`, beside the PGlite capture |

The realtime probes and `perf:reload` are local. They create a scratch
database and write git-ignored reports under the measured checkout's
`.test_files/performance/`; the audit request authorizes both. Copy every
report the audit cites into `measurements/`. Seeding a 10,000-folder tree
takes over an hour; reuse a seeded scratch database with `--reuse` when one
exists, and record which.
`perf:database` deploys a temporary Worker and `perf:provision` creates
persistent accounts on a deployed tier, so run them only with the user's
approval; otherwise cite the latest result and its date.

Statements inside one transaction run serially, so each one removed there
saves one exchange. Multiply by the warm exchange cost in the latest
`perf:database` result (about 5 ms in production on 2026-10-26) to state a
latency, labelled Estimated unless the change itself was measured.

## Inventories

Take these once per revision:

- **API tables and indexes per dialect:** `CREATE TABLE` statements,
  the indexes their `PRIMARY KEY` and `UNIQUE` constraints create, and
  `CREATE [UNIQUE] INDEX` statements in
  `packages/api-shared/drizzle/0000_greenfield_baseline.sql`. Constraint
  indexes count: they can cover a narrower index or serve a query. Record
  each index's table, columns, uniqueness, and partial predicate.
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
calls with the SQL text and parameters, and which hands each statement to
any observer registered through `@tearleads/api-shared/statement-observer`.
The performance package's
[capture preload](../../../../packages/performance/src/statements/capturePreload.ts)
registers one and appends a JSON line per statement; the
[README](../../../../packages/performance/README.md#statement-capture) lists
the record fields. Run it through the harness, from the measured checkout:

```sh
# API tests, from packages/api, on PGlite unless API_DATABASE is set
bun run perf:statements --package api --file <test file> --param-hash
# One test of that file: Bun's -t pattern
bun run perf:statements --package api --file <test file> --name <test>
# App canaries with the request profile, one capture per canary
bun run perf:canaries --statements --param-hash
# A saved capture, summarized again
bun run perf:statements --summarize <capture.jsonl>
```

Each run puts the package's own `bunfig.toml` preloads before the capture
and saves, under `.test_files/performance/`, the capture, a summary as JSON
and Markdown, and the test output. The summary counts statements per label
and per canary phase, ranks the most repeated normalized statements, and,
with `--param-hash`, lists same-key repeats. Copy what the audit cites into
`measurements/`. A probe that runs `bun test` itself passes the preload by
path after the package's own, with `PERF_STATEMENTS_OUT` naming the
capture file, as the preload's header comment shows.

Labels are global, not async-context scoped: background work that outlives
a test (sync pumps, timers; see `packages/app/happydom.ts`) is attributed to
whichever test runs next. Use per-test totals as evidence only from a run
of one test (`--name`). A probe sets `globalThis.sqlCaptureLabel` around the
call it measures, after awaiting any background work its setup started, and
clears it after, so fixture setup is labelled separately. Bind values are
never recorded. With `--param-hash` each record also carries a
short hash of its values, which proves that a repeated statement reads the
same key rather than a different one; keep the hashes in the scratch
directory, never in the issue. Transaction controls reach the logger only on
`API_DATABASE=postgres`: PGlite's native transaction method
bypasses it, so a PGlite capture (including every canary) has no
transaction count. For a question the summary does not answer, query the
capture with `jq`, for example the most repeated statements for one label:

```sh
jq -r 'select(.label == "<label>") | .sql | gsub("\\s+"; " ")' <file> \
  | sort | uniq -c | sort -rn | head -20
```

Each record carries `request`, a number for the request it ran in, and the
summary counts same-key repeats within one request: a per-phase total hides
one key read twice inside a request. On 2026-11-10 the first auditor to
group a capture by request found the single-walk and listing-lane repeats.
The number comes from the request-cost middleware's statement counter, so a
test that wraps requests in a counter of its own merges them into one.
`API_REQUEST_COST_LOG=true` also makes the API print one `api.request.cost`
line per request with its route and statement count (see
`docs/developer/api-request-cost.md`).

`jq -r` prints multi-line SQL across several lines, so `jq -r ... | wc -l`
over-counts; count records with `jq -c` or `jq -s length`. Agent shells may
be zsh, which does not split an unquoted variable into words: run a file
list or a set of globs through a shell function or a `for` loop over
literal arguments, never `rg $GLOBS`.

The counter alone, `withDatabaseStatementCounter(counter, work)`, counts
without text. Its scope must contain the awaited work: pass an `async`
function that awaits the query. A bare Drizzle builder returned from the
callback executes after the scope has closed and counts zero. Like the
capture, it sees transaction controls on Postgres but not on PGlite, so a
Postgres count runs higher by each transaction's control statements (one per
request in the document budget below). To assert an exact count for work
inside one transaction, open the counter inside the transaction callback,
as `packages/api/src/workflows/signerPublicKey.test.ts` does. Whole-request
ceilings, with their measurements in a comment, are in
`packages/api/src/workflows/documents/mutations/documentStatementBudget.test.ts`.

## Scenario set

Capture once per revision, in the background, and keep one log and one
capture file per run. When the protocol audit runs at the same revision,
run the canaries once for both with
`bun run perf:canaries --statements --param-hash`: each canary's log holds
the request profile, its capture the statements, and the report adds
statements per phase. Keep `--param-hash` on that shared pass: without the
hashes neither audit can split a repeated statement into same-key and
different-key reads afterwards.

- The request-volume canaries `perf:canaries` runs, listed in the
  `protocol-efficiency-audit` measurement reference (upload, organization
  bootstrap, folder and group mutations, device-first offline, groups,
  sharing, reconnect, restart), with `--statements`. They drive the real SDK
  against the in-process test API on PGlite, so their statement mix
  approximates production. Statements between two `phaseEnd` markers
  include any setup the canary ran before the phase started; use a probe
  for exact per-operation numbers.
- The API statement-budget tests from the inventory, through
  `perf:statements`, for registration, read-model, projection, and
  verification-marker counts.

Record per scenario: total statements, statements per request where the
phase gives a request count, and the top repeated normalized statements.
Count transactions only from a local Postgres capture of the same
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
and the first call on a connection also runs the schema ensure. A preload
that wraps the executor for a whole test run needs a recursion guard (its
own writes must not be captured) and a line cap: an unguarded one wrote a
34 GB file on 2026-11-10. Because
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
- **API PGlite.** Run `explain` (`API_DATABASE=memory`) over the captured
  statement with `db.execute`. PGlite's plans on tiny tables say little about
  scale, so plan tests check the statement shape the index depends on, as
  `packages/api/src/access/read/currentPrincipalHeadsPlan.test.ts` does.
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
- the plan for each such query with and without the index, on Postgres or
  on client SQLite;
- the write paths that maintain it, since every index costs each insert and
  any update of its columns.

## Probes

Write probes in the per-work-item directory, never in the checkout. Import
repository modules by absolute path, including third-party packages such
as `drizzle-orm` (`<REPO_ROOT>/packages/api-shared/node_modules/drizzle-orm/index.js`),
because a bare specifier does not resolve from outside the checkout. Run
them with `<REPO_ROOT>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
from the owning package directory with the package's preloads. Never change
constants, ceilings, or schema in the checkout to measure. A probe reads
every path it uses from environment variables rather than hard-coding them:
its output path, its scratch database name, and its inputs (a schema dump,
fixture ids resolved from a database). A verification re-run then writes
beside the auditor's evidence instead of over it, and a copied probe does
not fail on a path that existed only in the auditor's directory. Give every
run, re-runs included, a
fresh scratch database: rows left by another probe skew counts and buffers
and can fail a purge test that passes on a fresh database. Remove scratch
files with a guarded path (`rm -rf -- "${PROBE_DIR:?}"`), never a bare
variable that could expand to nothing.

## What a measurement is not

- A passing statement-budget test at its ceiling is a contract, not
  evidence that the ceiling is the minimum.
- A statement count is not a latency. Report counts and say whether the
  statements are serial (inside a transaction or awaited in sequence) or
  concurrent; claim latency only when measured, or derive it from
  `perf:database` as the [performance harness](#performance-harness)
  section describes and label it Estimated.
- A fixture size is not production size. State it beside every count and
  plan, and say how the count scales with organization, tree, or history
  size when the code makes that clear.
