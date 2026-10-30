# Batches and Resume

The default is one small batch per invocation, preserving the model and
effort selected by the user. These work limits reduce usage; they are not a
measurement of remaining quota. Do not infer quota from wall-clock time or
launch the remaining queue just because time remains.

## Default work limits

- One queued work item: a slice or a smaller part of one, unfinished
  discovery, candidate verification, or an outstanding capture or plan.
  Prioritize pending High-impact verification, then unfinished work, then
  slices holding Insights top-ten patterns. Keep unselected slices queued.
- For a fresh audit without a focus, start with the slice that owns the
  most production time in the PlanetScale snapshot, then the remaining API
  slices by the baseline's statement totals, then the client slices. Run
  `api-indexes` and `client-indexes` last so they can collate the other
  slices' index findings. An explicit focus takes precedence.
- At most one discovery auditor per batch, with no child agents. A
  multi-command shell call must still use targeted reads.
- `full` mode may run up to three auditors concurrently, because slices are
  read-only and independent. Verification stays sequential, and concurrent
  auditors never share a scratch directory or a scratch database.
- In `full` mode, after every slice's first pass, run one follow-up
  auditor per slice with unchecked paths, briefed with those paths and the
  coordinator's measurements. Without it every slice stays partial; the
  follow-up pass on 2026-10-30 found more than some first passes.
- Launch auditors as foreground Agent calls, up to three in one message.
  In a headless `claude -p` run, background subagents and shell tasks stop
  shortly after the coordinator's turn ends, leaving their slices partial.
  Do not end a turn while an auditor or command this batch launched is
  still running; the stop rules below still decide how many batches run.
- A resumed batch reuses baseline notes, captures, and the snapshot.
- Independently verify at most two proposals per batch, with at most one
  new probe and one harness-repair attempt per proposal. An inconclusive
  measurement keeps its trace, command, failure, and next step and is not
  Measured. Ending a batch early never promotes a label.
- Save discoveries as they arise. When a work item stays partial, record
  unchecked paths and the next step; splitting a slice adds queue entries,
  not agents in this batch.
- Finish the batch and return to the user. Do not sleep, self-invoke
  resume, or loop through the queue unless the user requested `full`. Full
  mode repeats these bounded batches and stops when a batch makes no
  progress or the remaining work needs unavailable tooling or user input.

Examples:

```text
/database-efficiency-audit
/database-efficiency-audit api-write-transactions
/database-efficiency-audit client
/database-efficiency-audit full snapshot /absolute/path/to/snapshot
/database-efficiency-audit resume /absolute/path/to/checkpoint.md
```

## Durable state outside the checkout

Create the audit directory under
`~/.claude/audits/tearleads-database/<full-SHA>/`, with a distinct
subdirectory for a different scope or a fresh audit of the same revision.
PlanetScale snapshots live beside audits in
`~/.claude/audits/tearleads-database/planetscale-snapshots/<UTC-timestamp>/`
because they describe a deployment, not a revision; the checkpoint records
which snapshot it uses. Store the absolute checkpoint path in project memory
and in the final response. A concise `checkpoint.md` indexes:

- `baseline.md`: repository path, audited SHA, focus, exclusions, the
  inventories with counts, the statement baseline per scenario, the
  snapshot path and its deployed revision, the lead map (live, moved,
  stale), known dispositions with issue and PR links, and relevant recent
  commits.
- `coverage.md`: every requested slice with status (`pending`, `partial`,
  `complete`, or `blocked`), checked paths, tables, and leads, remaining
  work, evidence path, and next work item.
- `findings.md`: stable proposal id, slice, the statements, round trips, or
  indexes it removes or adds, source references, label, probe path and
  command, observed numbers, impact, risk, rule notes, and pending
  verification. Keep refuted candidates and protocol leads with a reason.
- `measurements/`: capture logs, per-scenario tables, plans, inventories,
  exit codes, and the revision and dist timestamp they were taken at.
- Per-work-item directories: reports, probes, and test logs. Workers write
  only their own probes and evidence, and return their report as their
  final message; the coordinator saves it as `report.md` there and
  maintains the shared index.

Write the initial checkpoint before launching an auditor and update it after
each report or verification. Link evidence instead of copying reports. A
stopped or interrupted auditor leaves its work partial. When an auditor
finishes, check that none of its shell commands are still running (a search
with no path waits on stdin indefinitely) and stop any that are.

## Resume without repeating the audit

1. Load the supplied checkpoint, or the one referenced by project memory.
   If several match and the intended one is unclear, ask which to continue.
2. Confirm the repository, pinned SHA, focus, exclusions, checkout
   cleanliness, snapshot path, and referenced artifacts. If the checkout has
   moved, measure from a clean worktree at the saved SHA outside the
   repository tree. A request to audit a new head starts a new checkpoint;
   old proposals become leads to re-measure.
3. Check SDK build freshness before probes. Reuse captures only for the
   same clean revision and commands.
4. Read the compact baseline and the selected item's evidence only. Resume
   from the saved unchecked paths or pending proposal, not a fresh sweep. If
   a report is missing, requeue its scope.
5. Update coverage and return the next resume command. Call the audit
   complete only when coverage, verification, and reporting are complete.

## Avoid duplicated context and analysis

The coordinator reads the persistence documents once, then sends each
auditor a compact baseline with the exact sections, captures, and leads for
its scope. Send the brief, the waste-class list, and one slice section; do
not send the whole slice catalog, the full Insights export, or a previous
transcript. Workers save their evidence files and return the report as
their final message, opening with a summary of at most 100 words: proposal
ids with impact, coverage status, and next step. The coordinator saves the
report and reads past the summary only for the proposals it verifies.
