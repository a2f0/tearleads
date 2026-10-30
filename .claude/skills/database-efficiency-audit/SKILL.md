---
name: database-efficiency-audit
description: Audit Tearleads database work on the API (PlanetScale Postgres in production; PGlite, SQLite, and Turso in tests) and in the client SDK's SQLite for statement amplification, batchable round trips, and missing, redundant, or unused indexes, using PlanetScale Insights and schema recommendations as leads and measured statement captures and query plans as evidence, in small resumable batches that end in a GitHub issue of ranked proposals. Use for a requested database performance, indexing, or query-batching audit, not a single-diff review or a protocol redesign.
---

# Database Efficiency Audit

Audit how Tearleads talks to its databases:

- **API persistence** in `packages/api` and `packages/api-shared`. Production
  and staging run PlanetScale Postgres behind Cloudflare Hyperdrive; tests
  and local development run PGlite (`API_DATABASE=memory`), Bun SQLite, or
  Turso. The Drizzle schema in `packages/api-shared/src/schema` serves every
  dialect.
- **Client persistence** in `packages/client-sdk/src/data`, executed by
  SQLite wasm in `packages/sqlite-worker`, plus the app's client projection
  tables under `packages/app/src/document-projectors`.

The audit asks whether each operation issues more statements, round trips,
rows read, or index maintenance than its result requires. Its companions ask
different questions: `protocol-security-audit` whether the protocol is safe,
and `protocol-efficiency-audit` whether the protocol does more work than its
guarantees require. That skill owns tables as mechanisms (retiring or folding
a table), routes, and response shapes. This one owns the physical layer:
statements, query shape, transaction scope, plans, and indexes.

Four rules frame every proposal:

- **Behavior is preserved.** Same rows, same results, same transaction
  atomicity and isolation, same lock acquisition order. A read that verifies
  a signed artifact, a commit guard (a conditional write or compare-and-set),
  and every bound in `docs/limits.md` stay. A proposal that would change
  what the protocol stores or sends is a **protocol lead**: record it for
  `protocol-efficiency-audit` and never rank it here.
- **Dialect parity.** An API index or query change must work on Postgres,
  PGlite, SQLite, and Turso, and keep `packages/api-shared/src/schemaParity.test.ts`
  green. #2536 declined a GIN index for this reason. Client changes must
  respect the SQLite bind budget in
  `packages/client-sdk/src/data/sqlite/sqliteBindBudget.ts`.
- **Greenfield.** Change the Drizzle definitions and regenerate both API
  baselines (`db:generate`, `db:generate:sqlite` in `packages/api-shared`);
  client schema changes fail the local shape check and ship with the
  coordinated reset in `docs/developer/api-persistence.md`. No migrations,
  backfills, dual reads, or rollout flags. Any baseline change, an index
  drop included, means each deployed tier's database is re-initialized when
  it ships; say so in the proposal.
- **Measure before claiming.** A saving is a number from a statement capture,
  a query plan, or a probe at the audited revision. Production telemetry
  ranks where to look; it does not prove a saving on code it never ran.

Waste is measured in five units: statements per operation (an API request,
an API transaction, or an SDK operation), database round trips on the
critical path, rows read per row returned, indexes maintained per write, and
worker round trips on the client. Fewer requests over HTTP are not this
skill's unit; a proposal whose main saving is a request is a protocol lead.

The completed audit delivers a report of ranked, independently verified
proposals and a GitHub issue. Each batch delivers a coverage checkpoint and
the proposals verified so far. An audit request authorizes read-only
analysis of the checkout, existing tests, scratch probes and scratch
databases outside the checkout, and read-only PlanetScale access as
described in [`references/planetscale.md`](references/planetscale.md). Do not
apply DDL to a PlanetScale branch, dismiss a recommendation, implement a
proposal, create an implementation branch, push, or open a PR as part of the
audit. Confirm before creating the issue unless the user already asked for
one. The repository is public: the issue carries normalized SQL, counts, and
plans, never row data, credentials, role names, or hostnames.

## Arguments

- Optional focus: slice names from [`references/slices.md`](references/slices.md),
  `api`, or `client`. Defaults to queuing every slice, processing one batch
  per invocation.
- `resume [checkpoint-path]`: continue the saved audit at its pinned revision.
- `full`: process the whole requested scope in this invocation. Without
  `full`, stop after the batch even if work remains.
- `snapshot <directory>`: reuse a saved PlanetScale snapshot instead of
  capturing one. `no-planetscale`: audit from the checkout alone.
- Optional extra exclusions and an optional revision. A new audit defaults
  to committed `HEAD`; resume uses the checkpoint's revision.

Read [`references/batching.md`](references/batching.md) before starting. It
defines the work limits, durable checkpoint, and resume validation.

## Out of scope by default

Billing webhook processing and root administration routes (billing reads on
an ordinary request's path stay in scope); the website; R2 blob object
storage; the realtime hub's and key/value store's Durable Object storage;
Loro document engine internals; cryptographic cost; connection-pool and
Hyperdrive tuning beyond what a statement count implies; and anything
`docs/security-guarantees.md` lists as an accepted residual.

## 1. Establish the baseline

Run noisy builds, tests, and probes through `agent-tool run -- <command>`
from the checkout's `node_modules/.bin`, keep logs in the audit directory,
and inspect bounded excerpts with `bun run agent:logs <path>`.

1. Create or load the checkpoint as described in `references/batching.md`.
   Record `git rev-parse HEAD` and dirty paths. Audit committed code only:
   when the requested revision is not `HEAD`, or dirty paths touch anything
   a probe would read, measure from a separate clean worktree at that
   revision, with `bun install`, the Electrobun devkit prepare step, and
   the SDK build run there first.
2. If `packages/client-sdk/dist` is older than the SDK source, rebuild it
   once with `bun run agent:run -- bun run --filter='@tearleads/client-sdk' build`.
   API tests import the SDK from `dist` and silently use a stale build.
3. Build the inventories in
   [`references/measurement.md`](references/measurement.md): API tables and
   indexes per dialect, client tables and indexes, and the existing
   statement-budget and query-plan tests with their ceilings. Record counts;
   the issue reports them.
4. Capture the statement baseline once per audited revision: run the
   scenario set in `references/measurement.md` under the SQL-capture
   preload, and save per-scenario statement counts and the most repeated
   normalized statements.
5. Collect PlanetScale evidence (step 2) unless `no-planetscale` was given.
6. Build a compact known-dispositions index: the request budgets and design
   decisions in `docs/request-budgets.md` and
   `docs/principal-history-transport.md`, the table and index decisions in
   #2522 and its PRs (#2524 to #2541, including its declined items 7, 22,
   27, 35, 36, and 37), project memory, and earlier database audit issues
   (#2544, with its comments, and what #2546 shipped from it). A
   disposition is context for an auditor, not a reason to skip a
   candidate.

## 2. Collect PlanetScale evidence

Follow [`references/planetscale.md`](references/planetscale.md). In short:
read each tier's service token from `.secrets/<tier>/planetscale.env` (`prod`
or `staging`); snapshot schema recommendations, Query Insights patterns, and
`pg_stat_*` views for `tearleads-prod` and `tearleads-staging` into a
timestamped snapshot directory; delete the temporary read-only role at once;
and record which revision the databases were deployed from (from the deploy
record or the session that ran it; otherwise infer it from the deployed table
set).

Then map every recommendation and Insights pattern to the audited revision:
**live** (the table, index, and query still exist), **moved** (the same
query now runs under another name or table), or **stale** (retired since the
deploy). Only live and moved leads enter the queue. A greenfield reset
destroys both databases and their telemetry: when one is pending, capture
first, and audit from the snapshot afterwards.

Production data is small. With tens of users, the planner seq-scans tables
it would index at scale, and an index with zero scans may still be the only
one that serves a query once the table grows. Treat call counts,
rows-read-per-returned, and redundant-index structure as the reliable
signals; prove an index's value with a plan on the audited schema, not with
production scan counts.

## 3. Run the selected batch

Select one queued work item using `references/batching.md`. Launch one
read-only `general-purpose` auditor with the Agent tool, using the brief in
[`references/auditor-brief.md`](references/auditor-brief.md), its waste
classes, and only the selected section of `references/slices.md`. Fill the
work limits, exact scope, the slice's PlanetScale leads, and its baseline
rows. Give it a private directory for notes and probes and the shared
measurement directory separately.

Do not launch all slices, spawn nested auditors, or repeat the auditor's
searches. In `full` mode the coordinator may run up to three auditors
concurrently; it still verifies candidates one at a time.

## 4. Verify every proposal

Auditors over-count savings and under-count what a change must preserve.
Nothing reaches the ranked proposals on an auditor's word alone. Verify at
most two distinct proposals per default batch; keep the rest pending.

- Work High-impact proposals and proposals from the Insights top ten first.
- Re-read the cited code on the production call path, including the
  transaction or executor it runs under. Inside a transaction every
  statement is serial on one connection (`gatherWithExecutor` in
  `packages/api-shared/src/adapters/executor.ts`); outside it, independent
  reads can fan out across the request pool.
- Re-derive the saving with a statement capture of the operation before
  and after the change, made in the probe's own copy of the query or
  helper. For an index, show the plan on the audited schema with and
  without it, on Postgres and on SQLite.
- Check each rule: behavior (results, atomicity, isolation, lock order,
  verification reads, commit guards), dialect parity, and bounds. A
  proposal that reorders statements inside a transaction names every lock
  it takes and the concurrency test that covers the order. A loop that
  loads one row at a time may be the memory bound behind a byte ceiling in
  `docs/limits.md`; a set load must keep it, or the proposal is a limits
  decision rather than a saving.
- Generalize each confirmed proposal across twin paths (documents and
  blobs, containers and documents, groups and organizations, API and client)
  and merge proposals that reshape the same query.
- Drop proposals that only move work: a statement removed here that becomes
  an equal statement elsewhere in the same operation.

Label each surviving proposal:

| Label | Meaning |
| --- | --- |
| Measured | Saving reproduced at the audited revision by a capture, plan, or probe |
| Observed | Frequency or cost seen in PlanetScale telemetry, mapped to live code; saving not yet reproduced |
| Traced | Production call path re-read; saving derived by counting on it |
| Estimated | One auditor's estimate only; pending verification |

Impact:

- **High:** removes a quarter or more of the statements of a measured
  operation on an ordinary path (registration, document create or sync,
  container mutation, a listing, policy or projection reads), turns a
  per-row statement loop into a constant number of statements, or halves a
  pattern in the Insights top ten by count or total time.
- **Medium:** removes a tenth or more of a measured operation's
  statements; adds an index that turns a scan proportional to a growing
  table into an index search, shown by plan; or drops three or more
  redundant indexes on write-hot tables.
- **Low:** a smaller measured saving, a redundant index on a cold table, or
  a code-only simplification.

Mark a High that holds only on a rare path (organization purge, remote
reset, stage cleanup, retention) as **High (rare)** and rank it after the
High proposals on ordinary paths: the per-row-loop rule makes such paths
High although they seldom run.

Risk, reported beside impact: **Low** reshapes a read or adds or drops an
index with no change to transaction scope or lock order; **Medium** changes
statement order or scope inside a transaction, an isolation-dependent read,
or a client transaction boundary; **High** removes or reorders a
verification read, a commit guard, or a lock, changes a purge or delete
path, or changes an isolation-dependent read whose timing a Postgres
concurrency test pins. Running on a path a concurrency test covers does not
by itself make a proposal High. Any proposal on such a path names the test,
and its implementation must carry the `test:postgres-concurrency` result.

## 5. Check precedence and dependencies

For each verified proposal:

1. Name the statement-budget and query-plan tests whose ceilings or
   assertions it changes, so a shipped proposal ratchets them.
2. Name the concurrency tests in `scripts/checks/testPostgresConcurrency.sh`
   that cover its locks, and the security findings (#2266, #2329, #2365,
   #2485, #2491) whose fixes touch the same reads or guards, with why each
   stays fixed.
3. List the docs it changes (`docs/limits.md`, `docs/developer/api-persistence.md`,
   subsystem docs) and the formal models in `formal/models.md` whose
   assumptions name the statements or locks it changes. Do not modify
   models; name the follow-up.
4. Name the implementation path: Drizzle's query builder, the builder
   with a short `sql` fragment (`excluded.<column>` in a multi-row upsert,
   or a helper from `packages/api/src/utils/sqlDialect.ts`), or an edit to
   an existing raw ``executor.execute(sql`...`)`` statement. The
   maintainers prefer builder implementations; flag a raw-statement edit
   so they can defer it.
5. Order proposals by dependency, and mark protocol leads for hand-off.

## 6. Report

1. Update the checkpoint before returning. Print a short batch summary with
   completed, partial, and pending coverage, verified proposals, deferred
   candidates, and PlanetScale snapshot status. Include the absolute
   checkpoint path and the exact `/database-efficiency-audit resume <path>`
   command.
2. Once coverage and verification are complete, draft the issue from
   [`references/issue-template.md`](references/issue-template.md) in the
   audit directory. Only the coordinator publishes: after confirmation, or
   if the user asked for an issue, create it with
   `gh issue create --label enhancement --title "<title>" --body-file <path>`.
   A request to publish before coverage and verification are complete
   produces an interim issue; follow the template's `Partial` rule.
3. State that nothing was implemented and no PlanetScale state was changed
   apart from the temporary role, and that the role was deleted.
4. Save a project memory with the audited revision, checkpoint path,
   snapshot path, coverage status, issue number if any, and the top
   proposals with their labels. The checkpoint is authoritative for resume.
