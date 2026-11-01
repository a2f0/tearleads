---
name: protocol-security-audit
description: Audit the client-sdk ↔ API trust boundary in both directions in small resumable batches, with independent probe verification, read-only TLA+ model auditing and recommendations, and a GitHub issue report. Use for a requested protocol security or sync-integrity audit, not a single-diff review.
---

# Protocol Security Audit

This batching policy is specific to Claude usage windows. The Codex copy in
`.agents/skills/protocol-security-audit` intentionally retains its existing
execution flow. The two trust invariants, no-brick rule, and severity rubric
remain unchanged.

Audit the Tearleads protocol boundary between `packages/client-sdk` and
`packages/api`, including `packages/crypto`, `packages/api-client`, and the
backup paths in `packages/app`, against two invariants:

- **A. An honest client detects a dishonest API.** Server data that drives
  decryption, recipient wrapping, signing, local deletion or overwrite,
  checkpoint advancement, or authorization is verified against signed
  artifacts, pinned identities, and local checkpoints.
- **B. An honest API detects a dishonest or misconfigured client.** The API
  rejects submissions that are unauthorized, malformed, or that honest clients
  would later refuse.

A **parity** gap, where the API accepts what honest client verifiers refuse,
breaks both invariants at once and violates the no-brick invariant. Parity gaps
have produced the most severe past findings, so hunt for them first.

The completed audit delivers a verified findings report, including an audit
of the existing TLA+ models and recommendations to fix or augment them, and a
GitHub issue. Each batch delivers a coverage checkpoint and verified findings
so far; a partial batch is not a completed audit. An audit request authorizes
read-only analysis, existing checks, and scratch probes outside the checkout.
**Do not implement TLA+ updates as part of the audit.** This includes models,
configurations, negative controls, trace fixtures, registries, and model
documentation. Put proposed changes in the report; implementation requires a
separate follow-up task. Do not create or
commit an audit implementation branch, apply production fixes, push, or open
PRs as part of the audit. The repository is public: confirm before creating
the issue unless the user already asked for one, and say that it discloses
exploitable paths.

Before any audit work, start the
[usage receipt](../../../docs/developer/audit-usage-receipts.md#start-and-checkpoint).
Every published report includes it, even when counters are unavailable.

## Arguments

- Optional focus: slice names from
  [`references/slices.md`](references/slices.md) or a subsystem.
  Defaults to queuing every slice, processing one batch per invocation.
- `resume [checkpoint-path]`: continue the saved audit at its pinned revision.
- `full`: explicitly process the whole requested scope in this invocation.
  This can still consume a usage window; concurrency limits alone do not save
  total tokens. Without `full`, stop after the batch even if work remains.
- Optional extra exclusions, such as issue numbers or finding classes.
- Optional revision. A new audit defaults to committed `HEAD`; resume uses
  the checkpoint's revision, without updating it to the latest branch head.

Read [`references/batching.md`](references/batching.md) before starting. It
defines the work limits, durable checkpoint, and resume validation. Keep the
current model and effort; reduce work per invocation rather than silently
changing them. The first invocation may only establish the baseline; this is
an expected setup-only batch, and `resume` continues with the queued audit work.

## Rules every finding is judged against

- **No bricked device.** A client refusal is acceptable only for data an honest
  server can never produce: bad signatures, forks, rollbacks below the device's
  own checkpoint, or citations regressing below signed history. No device's
  ability to read or write may depend on another device's cache or write.
  Every suggested fix carries an explicit no-brick check. Prefer server-side
  enforcement at commit.
- **Default out of scope:** equivocation and split view; cold-start rollback on
  a device with no checkpoint; first-sight (`observed`) identity pins of
  referenced users; key transparency,
  witnesses, and semantic currentness (#2186 or its successor); pure
  availability or withholding; DoS and rate limits; residuals that
  `docs/security-guarantees.md` already accepts.
- **Documentation is a claim.** Anything `docs/security-guarantees.md` promises
  that the code does not implement is a finding.

## 1. Establish the baseline

Run noisy builds, checks, and probes through `agent-tool run -- <command>`.
Use the checkout's `node_modules/.bin/agent-tool`; from a package directory,
invoke that binary by its absolute path to preserve the probe's working
directory. Its logs live under the system temp directory, so copy every log the
report or receipt cites into the durable audit directory before checkpointing,
and inspect bounded excerpts with `bun run agent:logs <path>`
instead of loading successful logs.

1. Create or load the checkpoint as described in `references/batching.md`.
   Record `git rev-parse HEAD` and dirty paths. Audit committed code only;
   use a separate clean checkout when the requested revision or dirty paths
   would make reads, builds, or probes test different code.
2. Once per audited revision, start the existing formal checks from
   [`references/formal-models.md`](references/formal-models.md) in the
   background, logging output and exit codes under the audit directory.
   Reuse completed logs only after resume validation; do not stream full
   passing logs into context or restart checks already running.
3. If `packages/client-sdk/dist` is older than the SDK source, rebuild it once
   with `bun run agent:run -- bun run --filter='@tearleads/client-sdk' build`.
   `packages/api`
   resolves the SDK from `dist`, so API probes otherwise test stale code. The
   brief tells auditors not to rebuild it themselves.
4. On the first batch, read `docs/security-guarantees.md`, `formal/README.md`,
   and the model index `formal/models.md` in full. Save a compact baseline
   with source references for later batches.
5. Build a compact known-issues index, starting with project memory and the
   latest audit. Fetch details only for the selected slice or a candidate:
   - prior audit issues and their follow-ups, with each finding's fix PR
     (`gh issue list --state all --search "audit in:title"`, plus #2158 and
     #2266). Read the closing comments too;
   - the "Not in scope" or follow-up sections of each fix PR
     (`gh pr view <n>`), where carried-forward items are recorded;
   - security commits since the last audit, from
     `git log --since=<last audit> --oneline` filtered for keying, verify,
     signature, checkpoint, projection, grant, wrap, purge, and incident. Pass
     only slice-relevant entries to its auditor as code to examine first.

   A known item is reported again only as a regression or a bypass. Memory
   locates evidence; it does not prove a fix, and lists copied from memory or
   an earlier brief go stale. Before handing one to an auditor, check each
   item against its fix PR or issue state
   (`gh api repos/{owner}/{repo}/issues/<n> --jq '.state'`, which covers PRs
   too) and list it as open only when that check says so. Save issue/PR
   dispositions and source links so resumes do not reload the entire audit
   history.
6. Size the surface with non-test TypeScript line counts per directory, so
   slices stay balanced. Queue smaller parts of an oversized slice for later
   batches rather than creating more auditors in this invocation.

## 2. Run the selected batch

Select one queued work item using `references/batching.md`. For discovery,
launch one read-only `general-purpose` auditor with the Agent tool, using the
shared brief from
[`references/auditor-brief.md`](references/auditor-brief.md), its bug-class
list, and only the selected section from
[`references/slices.md`](references/slices.md). Fill the work limits and
exact scope, including relevant models. Give it a private directory for notes
and probes, and the shared formal-log directory separately.

Do not launch all slices, spawn nested auditors, or repeat the auditor's
searches. Use the Workflow tool only if the user opted into workflows; it does
not expand the batch budget. The auditor saves probes and logs to disk and
returns its report as its final message; save that as `report.md` in its
work-item directory before verifying. Verify candidates within the remaining
batch budget (step 3), then checkpoint and stop. Only explicit `full` repeats
batches automatically, still with one auditor at a time.

## 3. Verify every finding

Auditors over-report and mislabel reachability. Nothing reaches the confirmed
findings on an auditor's word alone. Verify at most two distinct candidate
root causes per default batch; preserve the rest as pending for resume.

- Work High and parity findings first.
- Re-read the cited code on the real production call path. Confirm option
  defaults at the call site, not only in the helper; an omitted option such as
  `authorizationMembership` silently takes the verifier's default.
- Decide honest reachability from the honest client's own flow. A server-side
  guard gap is reachable by honest use only if the SDK never avoids it. For
  example, the SDK delete path does not revoke grants first.
- Prefer a runtime probe. Write it in the durable per-work-item audit directory,
  import repository modules by absolute path, and run
  `<repo-root>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
  from the owning package directory so workspace imports resolve. Reuse
  `packages/crypto/src/keying/testFixtures.ts` and
  `packages/client-sdk/test/helpers/`. Never add probe files to the checkout.
  Re-run an auditor's probe yourself and read what it asserts: a probe that
  calls a helper directly proves less than one that drives the production
  handler.
- Run API probes with `API_DATABASE=memory` (PGlite, Postgres semantics). The
  sqlite backend hides uuid lowercasing and text normalization. For parity,
  the strongest evidence is a probe from `packages/api` that commits through
  real routes and feeds the served projection to the real SDK verifier.
- Build long chains or deep trees with fixtures rather than routes when a probe
  needs thousands of commits; route-driven cost grows with history.
- Generalize each confirmed root cause. Search sibling artifact types and twin
  paths (principal state, access event, write header; document and blob
  stores; container and document verifiers). A second instance often has a
  worse impact than the first. Queue a targeted follow-up when this exceeds
  the batch budget; do not quietly expand into another full slice.
- Merge findings from different slices that share a root cause, and keep the
  strongest impact analysis. Expect several: api-writes overlaps every
  API-side slice, and sync overlaps identity and documents.
- Drop findings that are documented residuals, unreachable, or fixable only by
  a refusal that would brick a device. Say why in the coverage section.

Label each surviving finding:

| Label | Meaning |
| --- | --- |
| Probed | Reproduced by a runtime probe against repository code |
| Verified | Production call path independently re-read and confirmed |
| Traced | One auditor's trace only; pending verification, never confirmed |

Severity:

- **High:** permanent lockout of shared data reachable by honest use or by any
  single writer, or a key wrapped for an unauthorized recipient.
- **Medium:** data loss, confidentiality steering that needs a malicious
  server, or lockout with a narrow trigger.
- **Low:** metadata leaks, incident-ledger integrity, or attacks that need a
  malicious server plus a colluding member.

A key wrapped for an unauthorized recipient is High even when it needs only a
malicious server, as in #2158. It drops to Low when a colluding member must
also act. Medium steering means choosing where a write lands without a key
reaching an unauthorized party.

## 4. Audit the TLA+ models and recommend changes

Audit the existing formal models for the selected work item without modifying
them. Record remaining model coverage in the checkpoint, including models
with no production finding; passing checks do not replace model review. Reuse
completed model reviews, inspecting the evidence behind specific gaps rather
than repeating the whole model sweep. Follow
[`references/formal-models.md`](references/formal-models.md):

1. Review the relevant models, configurations, negative controls, and
   production mappings for incorrect assumptions, missing behaviors, and gaps
   in the properties they check, even if no production finding requires a
   model change.
2. Classify every verified finding as model-shaped or not, with a reason.
3. For each model-shaped finding, report the existing coverage and recommend
   the module, rule or parameter, property, configurations, negative controls,
   and trace coverage that should be fixed or added in a follow-up task.
4. Use the baseline results for relevant existing formal checks, running any
   missing checks without changing their inputs. Capture results and available
   counterexamples; if a finding needs new model work
   to reproduce, record that limitation and the proposed validation instead.

A finding that is not model-shaped still names the regression test (unit,
property, or parity test) that would have caught it. Recommendations are not
implemented or model-checked fixes; label their validation status explicitly.

## 5. Report

Before publishing, checkpoint usage and follow
[receipt publication](../../../docs/developer/audit-usage-receipts.md#publish-and-reconcile).
Include the receipt in the issue body and verify the exact readback; keep the
issue and receipt URLs in the checkpoint or durable notes.

1. Update the checkpoint before returning. Print a short batch summary with
   completed, partial, and pending coverage, verified findings, deferred
   candidates, and formal-review status. Include the absolute checkpoint
   path and exact `/protocol-security-audit resume <path>` command.
2. Once coverage and verification are complete, draft the issue from
   [`references/issue-template.md`](references/issue-template.md) in the
   audit directory. Group findings by invariant (parity, A, B) and severity;
   include labels, evidence, TLA+ status, and fix order. Only the coordinator
   may publish: after confirmation, or if the user asked for an issue, create
   it with `gh issue create --label bug --title "<title>" --body-file <path>`.
   An explicitly requested interim issue must identify incomplete coverage.
3. Include actionable TLA+ follow-up recommendations and their validation
   gaps. State that no production or formal-model fixes were implemented as
   part of the audit.
4. Save a project memory with the audited revision, checkpoint path, coverage
   status, issue number if any, verification labels, and fix status. The
   checkpoint is authoritative for resume, not the conversation transcript.
