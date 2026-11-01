# Audit usage receipts

Apply this procedure at invocation start and before publishing any database,
protocol-efficiency, or protocol-security audit, in either harness. It does
not authorize an audit or disclosure: retain the skill's publication and
security-disclosure gates. Without permission, save the receipt beside the
local report. Zero findings, partial coverage, and unavailable counters still
require a receipt.

## Start and checkpoint

Before baseline work or launching an auditor, create a private `usage.md`
beside the checkpoint. For the `.agents`
[full-scope security skill](../../.agents/skills/protocol-security-audit/SKILL.md#1-establish-the-baseline),
choose a durable private directory outside its temporary scratch for the
ledger and evidence, following baseline step 2. Temporary slice files are not
that durable store. Use a fresh random run ID, not a path or provider session
ID. A resume keeps that run ID but gets a new batch ID. Record:

- Audited repository and full commit; requested scope, exclusions, and whether
  this is a batch, full run, or resume. Record the actual skill copy used
  (`.claude` or `.agents`), its Git blob hash and each loaded reference's hash
  using `git hash-object <file>`. Dirty skill files need their actual hashes,
  not just the audited commit. Hashes identify instructions, not token usage.
- Harness name/version, provider, model and effort when exposed (otherwise
  `unavailable`), UTC start, source format/version, private evidence location,
  and the starting counters/request boundary. Use dedicated run usage when
  available; mixed sessions require before/after counters with unchanged
  semantics. Missing baseline or unrelated interleaved work means explicitly
  shared-session/partial coverage, not exact audit attribution.
- A component ledger for coordinator, each child/auditor, auxiliary model
  calls, and terminal-launched external CLI auditors. Give each a local alias,
  source, batch boundaries, and whether a parent already includes it. Tell
  workers to return exposed usage/source/cutoff or an explicit unavailable
  reason, not estimates, alongside their reports; only the coordinator posts.

Save observed counters and evidence after each worker result/verification and
before every checkpoint, interruption, and publication. Record closed batch
deltas and the last measured cutoff. Resume from that boundary, never from
zero against a cumulative session counter. Keep earlier evidence and mark
unobserved intervals. If counters reset/decrease or semantics change, start a
separate segment rather than subtracting incompatible snapshots. Reusing an
existing report issue retains its canonical URL and receipt location.

## Evidence and accounting

Only use actual harness/provider usage. For Claude Code or Codex, inspect the
installed CLI's help and official usage/event schema before selecting a
source; record the field paths and whether it includes children. Do not guess
transcript paths or treat a context-window gauge as consumed tokens. If this
session cannot expose counters, say `unavailable: no attributable usage source
exposed` and retain any separately measured child subtotal. Exact cross-harness
accounting may require shared runtime/agent-tool work; report that limitation,
not a new per-repository collector.

For an already authorized outer Hermes launcher, `--usage-file <private-path>`
with `hermes -z` writes JSON only after the child returns. Do not self-invoke
an audit to obtain it, change approval mode, or assume a live child can read
its own final file. Verify the installed format against the
[CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
and
[`oneshot.py`](https://github.com/NousResearch/hermes-agent/blob/820967473d4d5b6777d3a9419def4be422711d16/hermes_cli/oneshot.py).
Its main-loop fields include `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `total_tokens`,
`api_calls`, `model`, `provider`, `completed`, `partial`, and `interrupted`.
`auxiliary` is a breakdown; `total_including_auxiliary` is a rollup, not an
extra component. `input_tokens` already includes `cache_read_tokens` and
`cache_write_tokens`; the cache columns are subsets, never added to input.
That format does not supply duration or effort; these are unavailable unless
separately exposed. A successful process exit does not prove the best-effort
usage file was written.

The usage file covers the main loop only: delegate children run as separate
`subagent` sessions and are excluded from it. Each `delegate_task` result
returns that child's `tokens.input` and `tokens.output` (input inclusive of
cache, as above), `api_calls`, and `duration_seconds`. After exit, the outer
launcher can read the child sessions from the Hermes session store by their
parent session ID and record each as its own receipt row, never folded into
the main loop's row. A live coordinator that receives child counters records
them privately in its ledger as they arrive; publish them only as separate
rows that state these semantics, and leave any main-loop total to the
launcher's usage file.

The following **local inspection**, not a public payload or total calculator,
preserves null/missing counters. `USAGE_FILE` names that private JSON file.
Validate the file's run identity and completion flags separately; never publish
its session ID or free-text error. The fixture test uses invented test inputs,
not claimed audit measurements.

```sh
# usage-inspection
jq '{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
     reasoning_tokens, total_tokens, api_calls, completed, partial,
     interrupted, auxiliary, total_including_auxiliary}' "$USAGE_FILE"
```

Preserve each provider's native definitions. Cache reads/writes and reasoning
may already be included in input/output; do not add subfields again. Never add
parent rollups to included children, auxiliary breakdowns to inclusive totals,
repeated events with the same request ID, or successive cumulative snapshots.
Deduplicate request IDs privately within their source/session; a repeated event
is not another request. Keep model/provider segments separate after a switch;
if only a mixed aggregate exists, label it mixed rather than attributing it to
the last model. Sum only nonoverlapping, compatible, attributable segments.
Unknown components stay unknown, not zero; a measured subtotal is not a grand
total. Record API calls and harness duration where available, distinct from
elapsed wall time. Dollar estimates, if included with source and assumptions,
are not subscription charges or quota usage.

Static instruction bytes, context-size estimates, model guesses, tool-call
counts, and agent-tool command duration/log bytes are not runtime tokens.
Optional static load sizes belong in a separate section, never in the receipt's
token columns.

## Cutoff and public template

A live coordinator freezes usage at the last completed provider request before
publication. Take the cutoff timestamp as the UTC time at which it observed
the last completed tool or provider result before freezing the draft, and
record it before publishing. Exclude the current in-flight request,
publication, final reply, and any unobserved tail explicitly. It cannot know
its own post-exit bill.
An authorized outer launcher may reconcile the same run's receipt after the
child exits; label the child's completed cutoff and exclude the launcher's own
unmeasured work. Never promise an exact final total from inside that request.

Copy the following into the report body, replacing every placeholder. Repeat
component rows by model/provider as needed; write `unavailable: <reason>` for
missing fields, not a fabricated zero. Include measurable subtotals even when
whole-run coverage is unavailable. Only allowlisted metadata/counters and
sanitized source descriptions go public. Omit prompts, transcripts, raw usage
exports, provider request IDs/payloads, credentials, private paths/hostnames,
production rows, and arbitrary provider error text. Keep raw evidence private.

```markdown
<!-- audit-usage:RUN_ID:start -->
## Audit usage receipt

- Run / batches: <public run ID; closed batch IDs and measured intervals>
- Scope / revision: <batch|full|resumed; coverage; repository@commit>
- Instructions: <skill name; harness copy; skill/reference hashes>
- Harness / model: <version; provider/model segments; effort or unavailable>
- Source / baseline: <sanitized format/version; dedicated run or delta basis>
- Cutoff: <UTC; last completed request before publication OR exited child>
- Coverage: <complete through cutoff|partial|unavailable; reason>

| Component / model | Input | Output | Cache read | Cache write | Reasoning | Calls | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <coordinator> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> |
| <children / external CLI / auxiliary> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> | <value or unavailable> |

- Accounting: <native inclusion semantics; parent/child deduplication>
- Measured subtotal / cumulative rollup: <only justified disjoint segments;
  otherwise unavailable, with reason; never label partial coverage a total>
- Exclusions: <missing components/batches; shared-session work; current request,
  publication, final reply and unobserved tail as applicable>
<!-- audit-usage:RUN_ID:end -->
```

## Publish and reconcile

Use **body mode** for these skills: include the receipt when creating the issue,
so issue and receipt publish together, with no comment-failure window or race
with a bot's first comment. Keep the receipt in the body when moving oversized
findings into comments. The issue URL is also the receipt URL; comment ID is
`not applicable (body)`. An existing comment-based receipt must be reconciled
in place, not silently duplicated in the body; see below.

1. Resolve the repository with `gh repo view --json nameWithOwner`. Assign one
   coordinator as publisher for this run. Sanitize the draft, put the run marker
   in it, and persist `publication: pending`, run ID and intended repository in
   the checkpoint **before** creating anything. Use the skill's existing label
   and `gh issue create --repo "$REPO" --title "$TITLE" --label "$LABEL"
   --body-file "$REPORT"`. Save the returned canonical URL immediately.
2. On retry/resume, never recreate an issue just because receipt publication or
   readback failed. Read the saved issue; if its identity was lost after an
   ambiguous create, list all pages with `gh api --paginate --slurp
   "repos/$REPO/issues?state=all&per_page=100"` and locate the exact run marker,
   expected author, and report (exclude pull requests). Confirm the target;
   unresolved ambiguity or a failed listing blocks retry, not permission to
   create another issue. A different run must not overwrite this run's receipt.
3. For an existing issue, read its current body with `gh api
   "repos/$REPO/issues/$ISSUE"` into private notes. Replace only the section
   between this run's markers; preserve other runs and report content. A fresh
   run on an existing report adds its own section. Reject duplicate or unmatched
   markers. Before `gh issue edit "$ISSUE" --repo "$REPO" --body-file
   "$REPORT"`, re-read and compare the source body: changed content needs a
   fresh merge, never a blind overwrite. Coordinate concurrent publishers.
4. After every create/edit, run the exact-target readback below, where `REPORT`
   is the posted body and `ISSUE` the confirmed number. It compares the entire
   body (including markers/counters) and saves the canonical issue URL. Record
   that URL, receipt location, cutoff and `publication: verified` in the
   checkpoint and final report only after success.

```sh
# issue-readback
set -eu
umask 077
gh api "repos/$REPO/issues/$ISSUE" > "$AUDIT_DIR/issue-readback.json"
jq -e --rawfile expected "$REPORT" \
  '.body == $expected and (.pull_request == null)' \
  "$AUDIT_DIR/issue-readback.json"
jq -r '.html_url' "$AUDIT_DIR/issue-readback.json"
```

If an older run already has a receipt comment, keep its recorded comment ID/URL.
Read `gh api "repos/$REPO/issues/comments/$COMMENT_ID"` and check `issue_url`,
author, and the exact run marker before updating with `gh api --method PATCH
"repos/$REPO/issues/comments/$COMMENT_ID" -F "body=@$RECEIPT"`. Read that exact
comment again and compare `.body` with the sanitized receipt file as above;
record its `id` and `html_url`. Never use `--edit-last`, which can hit another
run or an overflow comment. If the ID was lost, paginate the issue's comments
and require one matching run marker/author; ambiguity blocks publication.

Any create/edit/comment/readback failure leaves publication **incomplete**.
Keep the draft, receipt, identifiers, and failure reason privately for safe
retry; report the canonical issue URL if known, never claim success or create a
replacement issue. A receipt with explicitly unavailable usage is valid; an
unverified or missing receipt is not. Do not run an audit, open a test issue,
or post a test comment just to validate this procedure.
