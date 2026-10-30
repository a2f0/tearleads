---
name: protocol-efficiency-audit
description: Audit the client-sdk ↔ API sync protocol for request amplification, redundant persistence, and avoidable mechanism under a capability-preservation rule, in small resumable batches with measured baselines, independent verification, and a GitHub issue of ranked greenfield proposals. Use for a requested sync-efficiency or protocol-simplification audit, not a single-diff review or a security audit.
---

# Protocol Efficiency Audit

Audit the Tearleads sync protocol between `packages/client-sdk` and
`packages/api`, including the `packages/api-shared` schema,
`packages/api-client`, and the sync bindings under `packages/app/src/providers`,
for ways to make synchronization cheaper and simpler. The companion
`protocol-security-audit` skill asks whether the protocol is safe; this skill
asks whether it does more work than its guarantees require. The
`database-efficiency-audit` skill owns the physical layer beneath it: query
shape, statement batching, transaction scope, and indexes. A finding that
changes only those, with no table, route, or response change, belongs there.

Three rules frame every proposal:

- **Capabilities are preserved.** The guarantees in
  `docs/security-guarantees.md`, the contract in `docs/protocol-specification.md`,
  and the bounds in `docs/limits.md` are the floor. A proposal that gives one up
  is a **capability trade**: report it in its own section with the decision it
  needs, never ranked among preserving proposals.
- **Encodings are fixed.** JSON over HTTPS, WebSocket hint frames, canonical
  JSON for signed bytes, Loro binary updates, and the current cipher suites
  stay. Do not propose gRPC, Protocol Buffers, CBOR, MessagePack, custom binary
  framing, or compression schemes. Route shapes, response shapes, and which
  fields travel are in scope.
- **Greenfield.** No compatibility shims, dual reads, rollout flags, or data
  migrations. Routes, tables, and local schema may change freely; deployment is
  the coordinated reset in `docs/developer/api-persistence.md`. The design
  decisions in `docs/request-budgets.md#design-decisions` are candidates for
  change, provided the proposal answers the constraints each decision names.

Waste is measured in five units: requests per operation, bytes per operation,
SQL statements per request, tables, and mechanisms (distinct ways of doing one
job). Local CPU spent verifying signatures is not waste; fetching again what
the client already verified is.

The completed audit delivers a report of ranked, independently verified
proposals and a GitHub issue. Each batch delivers a coverage checkpoint and the
proposals verified so far; a partial batch is not a completed audit. An audit
request authorizes read-only analysis, existing checks and canaries, and
scratch probes outside the checkout. Do not implement proposals, create an
implementation branch, apply fixes, push, or open PRs as part of the audit.
Confirm before creating the issue unless the user already asked for one.

## Arguments

- Optional focus: slice names from
  [`references/slices.md`](references/slices.md) or a subsystem. Defaults to
  queuing every slice, processing one batch per invocation.
- `resume [checkpoint-path]`: continue the saved audit at its pinned revision.
- `full`: process the whole requested scope in this invocation. Without
  `full`, stop after the batch even if work remains.
- Optional extra exclusions, such as issue numbers, slices, or tables.
- Optional revision. A new audit defaults to committed `HEAD`; resume uses the
  checkpoint's revision.

Read [`references/batching.md`](references/batching.md) before starting. It
defines the work limits, durable checkpoint, and resume validation. The first
invocation may only establish the baseline; `resume` continues the queue.

## Rules every proposal is judged against

- **Preserved capabilities, named.** End-to-end opacity of content; client
  verification of access and key state against signed artifacts; signed write
  headers on every content record; fail-closed verification in both directions
  (the two invariants of `protocol-security-audit`); the no-brick rule;
  offline and local-first operation with durable intents; convergence under
  lossy hints; revocation by principal and container rotation; anti-rollback
  checkpoints; verifiable purge proofs; bounded pagination for arbitrarily
  large histories; realtime hint privacy (`docs/developer/realtime-hints.md`).
- **Security precedence.** A proposal must not reintroduce a finding fixed by
  a prior security audit (#2266, #2329, #2365, #2485, #2491). When a proposal
  touches a fixed finding's area, cite the finding and say why it still holds.
- **Measure before claiming.** A saving is a number from a canary, the request
  recorder, the statement counter, or a probe; otherwise it is labelled
  Estimated and ranks below measured proposals of the same size.
- **Remove before tuning.** Prefer deleting a mechanism, table, or round trip
  over making it faster. A proposal that adds a table, cache, or flag must
  retire more than it adds.
- **One job, one mechanism.** When two mechanisms serve one purpose, propose
  the survivor and what each caller must change.
- **Default out of scope:** billing routes and tables; root administration
  routes; the website; cryptographic primitive choice; UI rendering cost;
  anything `docs/security-guarantees.md` lists as an accepted residual.

## 1. Establish the baseline

Run noisy builds, checks, canaries, and probes through
`agent-tool run -- <command>` from the checkout's `node_modules/.bin`. Copy
retained raw logs into the durable audit directory before checkpointing, and
inspect bounded excerpts with `bun run agent:logs <path>`.

1. Create or load the checkpoint as described in `references/batching.md`.
   Record `git rev-parse HEAD` and dirty paths. Audit committed code only: when
   the requested revision is not `HEAD`, or dirty paths touch anything a canary,
   build, or probe would read, measure from a separate clean checkout at that
   revision (`git worktree add --detach <audit-directory>/checkout <revision>`)
   so measurements cannot include uncommitted changes. A new worktree has no
   `node_modules`: run `bun install`, the Electrobun devkit prepare step, and
   the SDK build there before any canary or probe.
2. If `packages/client-sdk/dist` is older than the SDK source, rebuild it once
   with `bun run agent:run -- bun run --filter='@tearleads/client-sdk' build`.
   The app canaries refuse a stale dist; API probes silently use it.
3. Once per audited revision, run the request-volume canaries with the profile
   recorder on, in the background, as described in
   [`references/measurement.md`](references/measurement.md). Save the
   per-endpoint tables as the measured baseline. Reuse completed logs only
   after resume validation.
4. On the first batch, read `docs/protocol-specification.md`,
   `docs/client-sync-ordering.md`, `docs/request-budgets.md`, and the
   "Request costs" section of `docs/developer/current-principal-consumers.md`.
   Save a compact baseline with source references for later batches.
   Compare each measured scenario with the ceilings its canary asserts and
   with the counts the docs and source comments quote; a ceiling far above
   the measurement is ceiling drift, a finding the issue reports so a later
   regression cannot hide under it.
5. Build the inventories from `references/measurement.md`: routes, API tables,
   SDK tables, and the mechanism list. Record counts; the issue reports them.
6. Build a compact known-dispositions index from project memory, the design
   decisions in `docs/request-budgets.md` (the September closeout document is
   gone; its decisions live there), the issues behind them (#1281, #1512,
   #1672, #2203, #2512, #2521), each earlier efficiency audit (#2522 and
   #2697: implemented proposals and the ones declined with evidence), plus
   the security audit issues above. A disposition is context for an
   auditor, not a reason to skip a candidate.
7. Size the surface with non-test TypeScript line counts per directory so
   slices stay balanced. Queue smaller parts of an oversized slice for later
   batches rather than creating more auditors in this invocation.

## 2. Run the selected batch

Select one queued work item using `references/batching.md`. Launch one
read-only `general-purpose` auditor with the Agent tool, using the shared brief
from [`references/auditor-brief.md`](references/auditor-brief.md), its waste
classes, and only the selected section from `references/slices.md`. Fill the
work limits and exact scope. Give it a private directory for notes and probes
and the shared measurement directory separately.

Do not launch all slices, spawn nested auditors, or repeat the auditor's
searches. In `full` mode the coordinator may run up to three auditors
concurrently because slices are independent and read-only; it still verifies
candidates one at a time. The auditor saves probes and logs to disk and
returns its report as its final message; save that as `report.md` in its
work-item directory before verifying. Verify candidates within the remaining
batch budget (step 3), then checkpoint and stop.

## 3. Verify every proposal

Auditors over-count savings and under-count what a change must preserve.
Nothing reaches the ranked proposals on an auditor's word alone. Verify at
most two distinct proposals per default batch; preserve the rest as pending.

- Work High-impact and table-removal proposals first.
- Re-read the cited code on the real production call path. Confirm that the
  request the proposal removes is actually issued there and why: find the
  verifier, cache miss, or scheduler decision that demanded it.
- Re-derive the saving. For requests, use the canary's per-endpoint table and
  name which rows change. For tables, run the reader/writer census in
  `references/measurement.md` yourself. For statements, run the route under
  the statement counter.
- Prefer a probe over an estimate. Write it in the per-work-item directory,
  import repository modules by absolute path, and run
  `<repo-root>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
  from the owning package directory. Run API probes with
  `API_DATABASE=memory`. Never add probe files to the checkout.
- Check the capability list against the proposal, one capability at a time.
  Write the preserved-by line for each capability the proposal touches; a
  proposal that cannot state one is a capability trade.
- Generalize each confirmed proposal across twin paths (documents and blobs,
  containers and documents, groups and organizations) and merge proposals from
  different slices that retire the same mechanism.
- Drop proposals that only move work (a request becomes an equal statement
  count on another route) unless they also remove a round trip or a table.

Label each surviving proposal:

| Label | Meaning |
| --- | --- |
| Measured | Saving reproduced by a canary, recorder, counter, or probe |
| Traced | Production call path re-read; saving derived by counting on it |
| Estimated | One auditor's estimate only; pending verification |

Impact:

- **High:** removes a quarter or more of the requests or bytes in a measured
  scenario, retires three or more tables, or retires a whole mechanism.
- **Medium:** removes a tenth or more of a measured scenario, or retires one or
  two tables.
- **Low:** a smaller measured saving, or a code-only simplification.

Risk, reported beside impact: **Low** touches no signed bytes or verifier;
**Medium** changes a response shape a verifier consumes or a commit guard;
**High** changes signed bytes, a checkpoint rule, or a refusal rule and must
carry an explicit no-brick check.

## 4. Check precedence and dependencies

For each verified proposal:

1. List the security findings whose fixes it touches and how each stays fixed.
2. List the docs it would change (`docs/protocol-specification.md`,
   `docs/limits.md`, `docs/client-sync-ordering.md`, subsystem docs) and the
   canary ceilings that must be lowered with it, so a shipped proposal cannot
   silently regress.
3. List the formal models in `formal/models.md` whose assumptions it changes.
   Do not modify models; name the follow-up.
4. Order proposals by dependency: a table retirement that needs a response
   shape change lists that change as a prerequisite.

## 5. Report

1. Update the checkpoint before returning. Print a short batch summary with
   completed, partial, and pending coverage, verified proposals, deferred
   candidates, and measurement status. Include the absolute checkpoint path
   and the exact `/protocol-efficiency-audit resume <path>` command.
2. Once coverage and verification are complete, draft the issue from
   [`references/issue-template.md`](references/issue-template.md) in the
   audit directory. Group proposals by impact; include labels, measured
   baseline, savings, tables retired, risk, capability notes, and the
   recommended order. Only the coordinator may publish: after confirmation,
   or if the user asked for an issue, create it with
   `gh issue create --label enhancement --title "<title>" --body-file <path>`.
   An explicitly
   requested interim issue must identify its incomplete coverage.
3. State that nothing was implemented as part of the audit.
4. Save a project memory with the audited revision, checkpoint path, coverage
   status, issue number if any, and the top proposals with their labels. The
   checkpoint is authoritative for resume, not the conversation transcript.
