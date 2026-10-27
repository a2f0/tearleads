# Batches and Resume

The default is one small batch per invocation, preserving the model and
effort selected by the user. These work limits reduce usage; they are not a
measurement or guarantee of remaining five-hour quota. Do not infer quota
from wall-clock time or launch the remaining queue just because time remains.

## Default work limits

- One queued work item: a slice or a smaller part, unfinished discovery,
  candidate verification, or outstanding formal-model review. Prioritize
  pending High/parity verification, then unfinished work, then recent
  security changes. Keep all unselected slices in the queue.
- For a fresh audit without a focus, start with parity-heavy domain slices
  (`containers`, `documents`, `principals`), then `blobs`, `sync-placement`,
  `sync-runtime`, `crypto`, and `identity`. Run `api-writes` last so it can
  use those domain reports. Recent security changes may reorder this queue;
  an explicit focus takes precedence.
- At most one discovery auditor, with no child agents. Give it a ceiling of
  25 tool calls, reserving the last five for triage and saving its report.
  This is a prompt-level work limit, not an API token cap. If the available
  Agent tool supports a turn limit, also set it to 25. A multi-command shell
  call must still use targeted reads, not concatenate whole directory trees.
- The coordinator uses at most 20 tool calls for baseline, dispatch,
  verification, and reporting, reserving the last five for the checkpoint.
  If setup consumes the budget, save a setup-only batch without launching an
  auditor. A resumed batch reuses baseline notes and completed check logs.
- Independently verify at most two candidate root causes per batch, with at
  most one new probe and one harness-repair attempt per candidate. Re-running
  a supplied probe is still required before relying on it. If the probe is
  inconclusive, preserve the trace, command, failure, and next step; do not
  call it Probed. Budget exhaustion never promotes an unverified finding.
- Save discoveries as they arise. Stop exploration at the limit even if the
  slice is unfinished. Record the unchecked paths and next concrete step;
  splitting a slice adds queue entries, not agents in this batch. Do not
  discard extra candidates or mark a skimmed slice complete.
- Finish the selected batch and return to the user. Do not sleep until a
  quota reset, self-invoke resume, or loop through the queue unless the user
  explicitly requested `full`. Full mode repeats these bounded batches
  sequentially; it does not remove the no-child-agent rule.

In full mode, stop if a batch makes no progress or the remaining work needs
unavailable tooling or user input. Do not repeat a failed probe beyond its
repair allowance without new evidence or a resolved prerequisite. Preserve
the blocker and unfinished coverage instead of looping until quota runs out.

Examples:

```text
/protocol-security-audit
/protocol-security-audit principals
/protocol-security-audit resume
/protocol-security-audit resume /absolute/path/to/checkpoint.md
/protocol-security-audit full
```

`resume` also defaults to one batch, even after an earlier `full` run. Focus
and exclusions persist unless the user changes them; newly requested scope
starts as pending coverage.

## Durable state outside the checkout

Create an audit directory under `~/.claude/audits/tearleads/<full-SHA>/`.
Use a distinct subdirectory for a different scope or a fresh audit of the
same revision. Store the absolute path in project memory and the final
response as `<audit-directory>/checkpoint.md`, not just the directory path.
Do not rely on a session scratchpad or temporary directory surviving a usage
reset. A concise `checkpoint.md` indexes these files:

- `baseline.md`: repository and clean checkout paths, full audited SHA,
  focus, exclusions, guarantee references, known-issue dispositions with
  issue/PR links, and slice-relevant security commits.
- `coverage.md`: every requested slice and assigned model, status
  (`pending`, `partial`, `complete`, or `blocked`), checked paths/properties,
  remaining work, evidence/report path, and the next work item. Give shared
  models one owner and link other slices to its review.
- `findings.md`: stable candidate id, root cause, source references,
  Probed/Verified/Traced status, verifier, probe path and command, observed
  result, model status, and any pending verification or sibling search.
  Keep refuted candidates with a short reason to avoid rediscovery.
- `formal/`: command logs, exit codes, revision, tooling versions, state
  counts/bounds, and any running process identifiers. Record unavailable or
  unrun checks explicitly; a passing suite is not completed model review.
- Per-work-item directories: reports, small probes, and test logs. Workers
  write only their own probes and logs, and return their report as their
  final message; the coordinator saves it as `report.md` there and
  maintains the shared index.

Write the initial checkpoint before launching an auditor and update it after
each report or verification. Keep it concise; link evidence instead of
copying reports into every file. A stopped or interrupted auditor leaves its
work partial, regardless of whether it returned a final message.

## Resume without repeating the audit

1. Load the supplied checkpoint, or the one referenced by project memory.
   If there is no pointer, look for a matching audit directory. When several
   match and the intended one is unclear, ask which to continue.
2. Confirm the repository, pinned SHA, focus, exclusions, checkout cleanliness,
   and referenced artifacts. Do not merge findings from different revisions
   into one supposedly current audit. If the user's checkout has moved, use
   a separate clean checkout at the saved SHA, outside the repository tree:
   `git worktree add --detach <audit-directory>/checkout <saved-SHA>`.
   Reuse an existing checkout only after verifying its revision and status.
   A request to audit the new head
   starts a new checkpoint; old findings are leads to revalidate.
3. Check SDK build freshness before API/SDK probes. Reuse formal results only
   for the same clean revision, commands, and toolchain; missing logs or
   mismatches mean pending checks. Inspect any recorded running process
   before restarting a command; the process may have completed while idle.
4. Read the compact baseline and the selected item's evidence only. Resume
   from the saved unchecked paths or pending candidate, not from a fresh
   sweep. If a report is missing, requeue its scope rather than claiming it
   was covered. A different auditor may continue from saved notes.
5. Update coverage and return the next resume command. Call the audit complete
   only when requested production and model coverage, candidate verification,
   and reporting are complete. Distinguish checks blocked by tooling from
   checks that actually passed.

## Avoid duplicated context and analysis

The coordinator reads the full guarantee/baseline documents once, then sends
the auditor a compact summary with exact source sections to read for its
scope. Include the brief, bug-class checklist, and one slice section; do not
send the entire slice catalog, issue archive, or previous session transcript.
Use `rg` to locate entry points and bounded reads to follow actual call paths.
Complete the relevant call path before asserting reachability; a read budget
limits coverage, not the evidence required for a finding.

Assign each domain its API/client verifier comparison. The `api-writes` item
uses their route notes for its cross-cutting binding/locking review and
inspects uncovered routes; it does not redo every domain's deep audit. Follow
cross-slice dependencies only as needed to establish a candidate, recording
other work for its owner. Review shared models once and cross-reference them.

Workers return the full report, under 1,200 words, as their final message,
opening with candidate ids/severities, coverage status, and next step. Claude
Code refuses a subagent's report-file write, so the coordinator saves the
message as `report.md` before verifying, then reads only the linked evidence
needed for verification and consolidation.
Log test/TLC output to files and inspect summaries or failures. A failed probe
gets the bounded repair attempt above; do not turn harness debugging into an
unlimited exploration loop.
