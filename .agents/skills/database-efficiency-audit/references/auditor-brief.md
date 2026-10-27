# Auditor Brief

Send the selected auditor the shared brief with its placeholders filled, then
the waste-class list and exactly one section from [slices.md](slices.md).
Apply the limits in [`batching.md`](batching.md).

## Shared brief

```text
You are the selected slice auditor of a database efficiency audit of the
Tearleads monorepo (<REPO_ROOT>, revision <SHA>). READ-ONLY: do not edit,
create, or delete files in the repository, do not commit, and do not run
state-changing git commands. Write notes and probes only under
<SCRATCH_DIR>. You may run existing tests and probes and create one local
scratch Postgres database named <SCRATCH_DB>, which you drop before you
finish. Do not touch PlanetScale, spawn agents, invoke another skill, or
publish anything; the coordinator owns reporting.

Your exact work item and remaining coverage: <WORK_ITEM>
Use targeted searches and reads, not whole-directory dumps. Every search
names its paths: a grep or rg without one reads stdin and never returns.
Leave no background job running when you finish. Save candidate evidence as
you go. If you cannot finish the work item, stop and report unchecked paths,
unresolved candidates, and the next concrete step. A partial slice is a
valid result; never call it complete.

Mission: find ways for the API (Postgres in production via PlanetScale and
Hyperdrive; PGlite, SQLite, and Turso in tests) and the client SDK (SQLite
wasm behind a worker) to issue fewer statements, fewer serial round trips,
read fewer rows, and maintain fewer useless indexes, without changing
behavior. Units: statements per operation, round trips on the critical path,
rows read per row returned, indexes maintained per write, and client worker
round trips.

Four rules bound every proposal:
- Behavior is preserved: same rows and results, same transaction atomicity
  and isolation, same lock acquisition order, every verification read of a
  signed artifact, every commit guard, and every bound in docs/limits.md.
  A change to what the protocol stores or sends (retiring or folding a
  table, a route or response shape) is a protocol lead: list it separately
  and do not develop it.
- Dialect parity: an API change works on Postgres, PGlite, SQLite, and
  Turso and keeps packages/api-shared/src/schemaParity.test.ts green. A
  client change respects the SQLite bind budget
  (packages/client-sdk/src/data/sqlite/sqliteBindBudget.ts).
- Greenfield: schema changes edit the Drizzle definitions and regenerate
  the baselines; no migrations, backfills, dual reads, or flags.
- Measure before claiming: a saving is a statement capture, a plan, or a
  probe at this revision. PlanetScale telemetry is a lead, not proof.

Out of scope, do not report: <EXCLUSIONS>

Already decided or tracked; use as context, not as a reason to skip:
<KNOWN_DISPOSITIONS>

PlanetScale leads for this slice (live or moved at this revision, with
production counts from the snapshot): <LEADS>

Changes since the deployed revision, the least-observed code in production;
read their diffs first (`git show <sha>`): <RECENT_COMMITS>

Read the compact baseline at <BASELINE_FILE>, the statement captures under
<MEASUREMENT_DIR>, and docs/developer/api-persistence.md (database section)
or the slice's client persistence doc. Do not reload the whole issue history.

Quality bar: report only proposals traced through real call paths with
file:line evidence and the exact statements they remove or change. For each,
name the executor it runs on (root database or a transaction; see
gatherWithExecutor in packages/api-shared/src/adapters/executor.ts) and
whether its statements are serial. Try to refute each candidate: does a
verifier or commit guard need the read, does reordering change a lock order
a concurrency test pins, does the other dialect lack the feature, does the
saving merely move a statement elsewhere in the same operation, and does a
loop that loads one row at a time exist to stop at a byte ceiling (a bound
in docs/limits.md or a comment saying so)? A set load must keep that bound.
List plausible but untraced ideas separately as Estimated.

Implementation path: say whether Drizzle's query builder can express each
proposal (drizzle-orm 0.45 has joins, inArray, onConflictDoUpdate with
setWhere and targetWhere, and returning on every dialect, but no recursive
CTE builder and no tuple IN), whether it needs a short sql fragment such as
excluded.<column> or a helper in packages/api/src/utils/sqlDialect.ts, or
whether it edits an existing raw executor.execute(sql`...`) statement. The
maintainers prefer builder implementations; name a raw-statement edit
plainly.

Measurement: follow the statement-capture, plan, and probe instructions in
<MEASUREMENT_REFERENCE>. The capture preload is at <CAPTURE_PRELOAD>. Probe
at most two candidates, with one harness-repair attempt each. The
coordinator has checked packages/client-sdk/dist at this revision: do not
rebuild it or run bun install.

Save probes, captures, and extracts under your scratch directory. Return
the report itself as your final message, under 1,200 words, linking longer
evidence files; the coordinator saves it as report.md in your scratch
directory. For each proposal give: a title; the slice; what it removes
(statements per operation, round trips, rows read, indexes) with numbers
and their source (Measured, Observed, Traced, or Estimated); file:line
evidence for the current behavior; the proposed query, statement, index, or
transaction shape in enough detail to estimate the change, on each dialect
it touches, and its implementation path; impact (High, Medium, Low) and
risk (Low, Medium, High) using the coordinator's definitions; how each
rule is preserved; the statement budget tests, plan tests, concurrency
tests, docs, and formal models that would change; and prerequisites among
your proposals. End with short lists
of checked paths, refuted candidates with reasons, protocol leads, unchecked
paths, and next steps. Begin the message with at most 100 words naming the
proposal ids with impact, coverage status, and next step.
```

Default `<EXCLUSIONS>`: the out-of-scope list in `SKILL.md`, plus any
exclusions the user added. Fill `<KNOWN_DISPOSITIONS>` with slice-relevant
entries from the saved index, `<LEADS>` with the slice's rows from the lead
map (normalized SQL shortened to its table and predicate, count, total time,
rows read per returned, index used), and `<RECENT_COMMITS>` with commits
since the deployed revision that touch the slice. Point `<BASELINE_FILE>`,
`<MEASUREMENT_DIR>`, `<MEASUREMENT_REFERENCE>` (this skill's
`references/measurement.md`), and `<CAPTURE_PRELOAD>` at absolute paths.
Give each concurrent auditor its own `<SCRATCH_DB>`.

## Waste classes to sweep

Append this list to every brief.

- **Per-row statement loops.** A select, insert, update, or delete issued
  once per item when the operation knows the set: replace with `IN` or
  `= ANY`, a multi-row `INSERT`, or a set-based `UPDATE`, chunked to the
  bind budget. A loop that stops at a byte ceiling is a memory bound, not
  waste, unless the set load keeps the same bound.
- **Repeated identical reads.** The same table and key read more than once
  in one request or transaction because each helper loads its own copy.
  Load once and pass the row; never skip a verification that the row feeds.
- **Read-then-write pairs.** A select followed by an insert or update that
  one statement could do with `ON CONFLICT ... DO UPDATE`, `DO NOTHING`,
  or `RETURNING`, when the read serves no verification or guard.
- **Serial independent statements.** Awaited sequences outside a
  transaction whose statements share no data dependency; on the root
  executor they can run concurrently. Inside a transaction they cannot.
- **Transaction scope wider than needed.** Reads inside a transaction that
  need neither its snapshot nor its locks, and CPU work (verification,
  hashing) done while holding row locks.
- **Per-request fixed cost.** Statements every authenticated request pays
  (session, user, signer, activity) that a single joined read or the
  request's existing state could serve.
- **Missing index.** A filter, join, cursor, or `ORDER BY` on a growing
  table with no usable leading index on one dialect; high rows read per row
  returned in production.
- **Redundant index.** An index whose columns are a left prefix of another
  index, or that duplicates a primary key, when it is not unique and serves
  no query the wider index cannot.
- **Unused index.** No production query filters, joins, or orders by its
  leading columns and no constraint depends on it; each write still pays
  for it.
- **Over-fetched columns.** Loading large `jsonb`, `bytea`, or text
  columns the caller never reads, especially in loops.
- **Recursive or repeated path resolution.** The same ancestor or path
  query run once per object when one query could resolve the set.
- **Sweeps that scan.** Retention, cleanup, or GC passes that scan a
  growing table or re-read rows they already processed.
- **Client worker chatter.** One worker message per statement for work
  that could be one statement; transaction controls and schema ensures on
  hot paths; per-row local writes inside an apply loop.
