# Audit usage receipts

This procedure applies to any repository audited with audit-trails. It measures
the audit workflow, not the instruction file's size. Use the
[report template](report-template.md#audit-usage-receipt) even when all usage is
unavailable. It does not authorize an audit, model call, issue, or disclosure.

## Start and checkpoint

Before work or delegation, create a private checkpoint beside the local report
(outside the checkout by default). Use a fresh opaque run ID, such as a UUID,
not a provider session ID. Record:

- Run ID and batch ID, start time, full/batch/resumed scope and requested focus.
- Audited repository and full commit, dirty-path treatment, the audit-trails
  version (the `agentToolVersion` in `.agent-tool-skills.json`) or hashes of
  the loaded skill and references, harness name/version, provider/model and
  effort when exposed; mark missing metadata unavailable.
- Usage source and its documented semantics, dedicated run identity or the
  before counters and last completed request boundary. Keep raw identities,
  source paths and evidence private; publish only sanitized provenance/digests.
- Expected coordinator, children, auxiliary model calls and terminal-launched
  CLI auditors, with each source's inclusion in parent totals (or unknown).
- Report path, canonical issue URL if already published, receipt run marker,
  last verified body and pending update. Do not discard these on interruption.

Prefer dedicated run counters. In a mixed session take before/after snapshots;
if isolation is impossible, say shared-session usage is not attributable to the
audit. A missing baseline cannot be retroactively invented. At each coverage
checkpoint and before stopping, save available counters, measured cutoff,
completed/partial/interrupted status, and remaining scope.

Resume the same run with a new batch ID and baseline. Keep prior batches; record
revision, harness, or model changes and revalidate affected findings. Deltas
must have disjoint request boundaries. Never add cumulative snapshots from
multiple resumes as if they were separate runs. Counter resets or changed
semantics require separate rows, not negative deltas or silent correction.

## Evidence and accounting

Use actual harness/provider-reported input/output tokens, cache-read/cache-write,
reasoning, API-call counts, and duration when exposed. Keep native field names
and semantics in the evidence; distinguish wall-clock elapsed time from a
provider's duration. Missing/null fields mean unavailable, not zero. Even a
numeric zero is not proof of measurement if that harness defaults missing
provider usage to zero; disclose that source limitation.

Do not infer runtime consumption from skill bytes, context size estimates,
model guesses, agent-tool command duration/log bytes, or a subscription meter.
Static load size, if useful, belongs in a separately labeled estimate, never
in the usage total. Optional dollar estimates are neither subscription charges
nor quota usage.

For the installed harness, verify its help and source/schema before naming a
collector. Do not guess Claude/Codex transcript paths or counter fields; if no
verified source is exposed, publish `unavailable (no verified usage source)`.
No new accounting CLI is required by this skill. A demand for exact counters
that the harness does not expose is a tooling blocker, not permission to
invent numbers or build a per-repository runtime collector.

### Verified Hermes source

An outer launcher can use `hermes -z "$task" --usage-file "$usage_file"` for an
already authorized child run; the file is written after the run returns, not
while its final request is still running. Check the installed
`hermes_cli/oneshot.py` writer and [CLI reference][hermes] for the actual
version. The fields below were checked against [Hermes
v0.22.5+2418.g8209674][hermes-source]; verify them again after upgrades.
One-shot mode bypasses approval prompts: do not switch a live audit
to it or launch another audit merely to obtain usage. Its execution policy
needs separate authorization.

The writer copies `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `reasoning_tokens`, `total_tokens`, `api_calls`, `model`,
`provider`, `session_id`, `completed`, `partial`, `interrupted`, and
`turn_exit_reason`. Keep session IDs and free-text failure details private.
When present, `auxiliary.by_task` breaks down auxiliary calls, and
`total_including_auxiliary` includes them already: never add it to main or
auxiliary totals. Those fields alone do not establish child coverage, per-model
breakdowns, effort, or duration; mark unexposed dimensions unavailable.

### Combine only proven nonoverlapping coverage

- Keep coordinator, delegated children, auxiliary calls, and external CLI
  auditors identifiable. External CLI auditors need their own receipts; a
  terminal invocation's elapsed time is not their token usage.
- Deduplicate repeated assistant events by provider request identity. Keep raw
  IDs private. For cumulative sources use differences, not sums of snapshots.
- Do not add child usage already rolled into the parent. When inclusion is
  unknown, show separate non-additive rows and explain why no total is valid.
- Cache and reasoning may be subfields of input/output. Do not add them to
  totals without verified provider semantics. Preserve native totals rather
  than imposing an incompatible token formula.
- Group by provider/model when switched; if the source only labels the final
  model, call its aggregate mixed/unattributed instead of assigning it all to
  that model. Sum batches only with matching semantics and disjoint coverage.
- Partial measurements are measurable subtotals, never a workflow grand total.
  Name every missing participant/field and exclude it explicitly.

## Cutoff, not an imaginary final bill

A live coordinator cannot see its own post-exit receipt. Freeze the receipt at
the last completed provider request **before publication** and label that
cutoff and timestamp. Exclude the in-flight request, publication work and final
reply, plus anything else not observable. Save what is available at checkpoints
so an interrupted audit can still report partial usage.

Alternatively, an authorized outer launcher can reconcile the same receipt
after the audited child exits. Include the child's observable tail, but keep
unmeasured launcher/publication costs excluded. Never recursively invoke the
audit to produce a receipt or promise an exact final bill inside that run.

## Publish and resume

Publish the receipt **in the report body**. This avoids a second comment write
and a race with bot comments; there is no receipt comment ID. Partial audits,
zero findings, and unavailable counts still need the section. Retain the existing
issue-publication and security-disclosure gates. Without authorization, save
the report and receipt locally, and report that publication was not authorized.
Allowlist only sanitized run/batch IDs, repository/revision, versions/hashes,
model/provider/effort, counters, timestamps, outcome and coverage descriptions.
No secrets, credentials, raw prompts/transcripts, request payloads, production
rows, private paths/hostnames, raw session/request IDs or free-text failures.
Review the entire public body, not just the receipt, before sending.

The examples require GitHub CLI, jq, and a POSIX shell.
Set `repo` to the resolved repository, `title` to the report title, `body_file`
to the private sanitized complete report, and `receipt_dir` to its private
checkpoint directory. Run snippets with `sh -eu` (or equivalent fail-fast
handling). They are alternatives/steps, not one script to run indiscriminately.

Only for a new authorized report with no previously created issue:

```sh
gh issue create --repo "$repo" --title "$title" --body-file "$body_file" \
  > "$receipt_dir/issue-url.txt"
IFS= read -r issue_url < "$receipt_dir/issue-url.txt"
```

Immediately save the returned URL as `issue_url` in the checkpoint, before any
later action. For a resumed/existing report use its recorded canonical URL.
Read back that exact issue after creation and after every edit:

```sh
gh issue view "$issue_url" --repo "$repo" --json url,number,body \
  > "$receipt_dir/issue-candidate.json"
jq -e --arg url "$issue_url" --rawfile expected "$body_file" \
  '.url == $url and .body == $expected' "$receipt_dir/issue-candidate.json" > /dev/null
mv "$receipt_dir/issue-candidate.json" "$receipt_dir/issue-readback.json"
```

Inspect the returned canonical URL/repository/number and compare the decoded
`body` exactly with the intended complete body, including both run markers and
the receipt. A successful write command alone is not verified publication.
The snippets compare the URL and decoded body, and only then promote the
candidate to the last-verified checkpoint. A failed read or mismatch leaves
previous verified evidence intact. Keep one publisher per private directory.
Record the canonical URL plus `audit-usage:RUN_ID` as the receipt handle; location
is the issue body, comment URL/ID not applicable.

For an authorized resume/retry, read the latest issue body first, replace only
that run's `<!-- audit-usage:RUN_ID:begin -->` through matching end marker,
and preserve other runs and unrelated edits. If absent, append that run's
section once; ambiguous or duplicate markers require manual reconciliation,
not an overwrite. Serialize publishers for the same issue, recheck the latest
body before writing, and reconcile concurrent changes instead of blindly
sending a stale local body. Do not overwrite another run's receipt. Save the
reconciled full body privately, then edit the existing issue and read back:

```sh
gh issue edit "$issue_url" --repo "$repo" --body-file "$body_file"
gh issue view "$issue_url" --repo "$repo" --json url,number,body \
  > "$receipt_dir/issue-candidate.json"
jq -e --arg url "$issue_url" --rawfile expected "$body_file" \
  '.url == $url and .body == $expected' "$receipt_dir/issue-candidate.json" > /dev/null
mv "$receipt_dir/issue-candidate.json" "$receipt_dir/issue-readback.json"
```

On any failed/ambiguous write or readback, retain the intended body, run marker,
known URL and last verified state locally; report **incomplete publication**.
Recover an uncertain create by finding the existing issue and checking its
exact run marker before retrying; never blindly rerun create. A failed receipt
update must not create another report issue. If an older report used a receipt
comment, retain its recorded comment ID/URL and reconcile that exact receipt
before changing placement; never use `--edit-last` to guess ownership.

Sources: GitHub CLI [create][create], [edit][edit], and [view][view]. The shell
examples are exercised with a stub CLI in agent-tool's tests
(`src/skills/auditTrails.test.ts`); they do not open real issues or execute
audits.

[hermes]: https://hermes-agent.nousresearch.com/docs/reference/cli-commands
[hermes-source]: https://github.com/NousResearch/hermes-agent/blob/820967473d4d5b6777d3a9419def4be422711d16/hermes_cli/oneshot.py
[create]: https://cli.github.com/manual/gh_issue_create
[edit]: https://cli.github.com/manual/gh_issue_edit
[view]: https://cli.github.com/manual/gh_issue_view
