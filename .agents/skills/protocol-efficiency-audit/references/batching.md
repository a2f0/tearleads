# Batches and Resume

The default is one small batch per invocation, preserving the model and
effort selected by the user. These work limits reduce usage; they are not a
measurement of remaining quota. Do not infer quota from wall-clock time or
launch the remaining queue just because time remains.

## Default work limits

- One queued work item: a slice or a smaller part, unfinished discovery,
  candidate verification, or an outstanding census. Prioritize pending
  High-impact verification, then unfinished work, then slices whose baseline
  numbers changed since the last audit. Keep all unselected slices queued.
- For a fresh audit without a focus, start with the slice that dominates the
  measured baseline (`policy-reads` at the time of writing), then
  `document-write-path`, `discovery-and-hints`, `projections-and-keying`,
  `receipts-and-ledgers`, `org-read-model`, and `bootstrap-and-session`. Run
  the cross-cutting `api-schema` and `local-schema` slices last so they can
  collate the domain slices' table findings. A fresh measurement may reorder
  this queue; an explicit focus takes precedence.
- At most one discovery auditor per batch, with no child agents, and a ceiling
  of 25 tool calls, reserving the last five for triage and saving its report.
  This is a prompt-level work limit, not an API token cap. A multi-command
  shell call must still use targeted reads, not whole-directory dumps.
- `full` mode may run up to three auditors concurrently, each with the same
  ceiling, because slices are read-only and independent. Verification stays
  sequential, and a concurrent auditor never shares a scratch directory.
- In `full` mode, after every slice's first pass, run one follow-up
  auditor per slice with unchecked paths, briefed with those paths and the
  coordinator's measurements (pane attribution, field echo). On 2026-10-30
  the second pass found more than the first.
- Launch auditors as foreground Agent calls, up to three in one message.
  In a headless `claude -p` run, background subagents and shell tasks stop
  shortly after the coordinator's turn ends, leaving their slices partial.
  Do not end a turn while an auditor or command this batch launched is
  still running; the stop rules below still decide how many batches run.
- The coordinator uses at most 20 tool calls per batch for baseline, dispatch,
  verification, and reporting, reserving the last five for the checkpoint. If
  setup consumes the budget, save a setup-only batch without launching an
  auditor. A resumed batch reuses baseline notes and completed measurements.
- Independently verify at most two proposals per batch, with at most one new
  probe or canary re-run and one harness-repair attempt per proposal. If the
  measurement is inconclusive, preserve the trace, command, failure, and next
  step; do not call it Measured. Budget exhaustion never promotes an
  Estimated proposal.
- Save discoveries as they arise. Stop exploration at the limit even if the
  slice is unfinished. Record the unchecked paths and next concrete step;
  splitting a slice adds queue entries, not agents in this batch.
- Finish the selected batch and return to the user. Do not sleep until a
  quota reset, self-invoke resume, or loop through the queue unless the user
  explicitly requested `full`. Full mode repeats these bounded batches.

In full mode, stop if a batch makes no progress or the remaining work needs
unavailable tooling or user input. Preserve the blocker and unfinished
coverage instead of looping until quota runs out.

Examples:

```text
/protocol-efficiency-audit
/protocol-efficiency-audit policy-reads
/protocol-efficiency-audit resume
/protocol-efficiency-audit resume /absolute/path/to/checkpoint.md
/protocol-efficiency-audit full
```

`resume` also defaults to one batch, even after an earlier `full` run. Focus
and exclusions persist unless the user changes them; newly requested scope
starts as pending coverage.

## Durable state outside the checkout

Create an audit directory under
`~/.claude/audits/tearleads-efficiency/<full-SHA>/`. Use a distinct
subdirectory for a different scope or a fresh audit of the same revision.
Store the absolute path of `<audit-directory>/checkpoint.md` in project memory
and in the final response. Do not rely on a session scratchpad surviving a
usage reset. A concise `checkpoint.md` indexes these files:

- `baseline.md`: repository path, full audited SHA, focus, exclusions, the
  inventories (routes, API tables, SDK tables, mechanisms) with counts, the
  measured per-scenario request and byte totals, known dispositions with
  issue and PR links, and slice-relevant recent commits.
- `coverage.md`: every requested slice, status (`pending`, `partial`,
  `complete`, or `blocked`), checked paths and tables, remaining work,
  evidence path, and the next work item.
- `findings.md`: stable proposal id, slice, mechanism or table it retires,
  source references, Measured/Traced/Estimated status, verifier, probe path
  and command, observed numbers, impact, risk, capability notes, and pending
  verification. Keep refuted candidates with a short reason.
- `measurements/`: canary logs with the profile recorder on, per-endpoint
  tables extracted from them, statement-count runs, census outputs, exit
  codes, and the revision and dist timestamp they were taken at.
- Per-work-item directories: reports, small probes, and test logs. Workers
  write only their own probes and logs, and return their report as their
  final message; the coordinator saves it as `report.md` there and
  maintains the shared index.

Write the initial checkpoint before launching an auditor and update it after
each report or verification. Keep it concise; link evidence instead of
copying reports into every file. A stopped or interrupted auditor leaves its
work partial, regardless of whether it returned a final message.

## Resume without repeating the audit

1. Load the supplied checkpoint, or the one referenced by project memory. If
   there is no pointer, look for a matching audit directory. When several
   match and the intended one is unclear, ask which to continue.
2. Confirm the repository, pinned SHA, focus, exclusions, checkout
   cleanliness, and referenced artifacts. If the user's checkout has moved,
   use a separate clean checkout at the saved SHA, outside the repository
   tree: `git worktree add --detach <audit-directory>/checkout <saved-SHA>`.
   A request to audit the new head starts a new checkpoint; old proposals
   are leads to re-measure.
3. Check SDK build freshness before canaries or probes. Reuse measurements
   only for the same clean revision and commands; missing logs or mismatches
   mean pending measurement.
4. Read the compact baseline and the selected item's evidence only. Resume
   from the saved unchecked paths or pending proposal, not from a fresh
   sweep. If a report is missing, requeue its scope.
5. Update coverage and return the next resume command. Call the audit
   complete only when requested coverage, verification, and reporting are
   complete.

## Avoid duplicated context and analysis

The coordinator reads the protocol and ordering documents once, then sends
the auditor a compact baseline with exact sections to read for its scope.
Include the brief, the waste-class list, and one slice section; do not send
the entire slice catalog, issue archive, or previous transcript. Use `rg` to
locate entry points and bounded reads to follow actual call paths. Complete
the call path before asserting that a request is avoidable; a read budget
limits coverage, not the evidence required for a proposal.

Workers return the full report, under 1,200 words, as their final message,
opening with proposal ids with impact, coverage status, and next step. Claude
Code refuses a subagent's report-file write, so the coordinator saves the
message as `report.md` before verifying, then reads only the linked evidence
needed for verification and ranking.
