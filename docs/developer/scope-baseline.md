# Scope discoverability pilot — 2026-10-26

This pilot measures whether an agent can discover supported workflows and
implementation boundaries by inspecting Tearleads. Passing a criterion means
its report answered that question with source evidence. It does not mean the
repository has no onboarding friction or that a clean machine can build it.

## Conditions and provenance

- Source and tooling: `67f738b6fe21cb11789eccf898123d2e03cb61eb`.
- Suite: `agent-friendliness-v1`, one trial per task, one iteration each.
- Scope: `16544702d9dd4f0f5a7991fa4dbdf07a9247fedc`.
- Worker: Claude Code 2.1.310, ACP 0.52.0, Claude Agent SDK 0.3.191.
- Coder: provider default; session evidence identifies `claude-opus-5-5`.
- Judge: Codex CLI 0.160.0, `gpt-6-astra`, low reasoning, saved ChatGPT login.
- Environment: native macOS arm64, committed source archive without `.git`,
  installed dependencies, or build output. Tasks permit only inspection and
  writing `agent-readiness.md`. No clean bootstrap or execution test was run.
- Judge calibration: correct report 4/4, deliberately incorrect report 1/4
  (only report existence passed), unknown criterion HTTP 500.

The local receipt is
`.scope/benchmarks/1793014297971-agent-friendliness-v1/receipt.json`.
Its adjacent task files retain the reports, full verdicts and artifact URLs.
The registration remains pinned to this source commit even after this findings
document is committed.

## Results

| Task | Criteria passed | Wall time, including Judge | Run ID |
| --- | --- | --- | --- |
| Setup and verification discovery | 2/2 | 4m47s | `7d420cde-ffb9-4f2a-bb28-4cbb4368a4ee` |
| Architecture navigation | 2/2 | 7m15s | `d7039c3d-87b1-4cfd-be8f-4a910409071f` |
| SDK onboarding | 1/2 initially | 7m13s | `ebc04a05-be44-46be-b41b-c39bbff99120` |

These are single-run observations, not stable latency estimates or an overall
repository score. The architecture agent recovered from conflicting guidance;
that recovery explains how passing criteria can coexist with useful findings.

## Reviewed findings

1. **Document SQLite persistence explicitly.** The
   [SDK README](../../packages/client-sdk/README.md) describes an OPFS-backed
   worker, but [the worker options](../../packages/sqlite-worker/src/types.ts)
   default to `"memory"`, and
   [database loading](../../packages/sqlite-worker/src/loadSqlite3.ts)
   uses that default. The advanced example in
   [the SDK guide](client-sdk.md) omits `persistence`. Clarify the default and
   show `persistence: "opfs-sahpool"` where durable browser storage is intended.
   This is verified documentation drift; reload behavior was not exercised.
2. **Align the architecture guide with the workflow layer.**
   [API architecture](../api-architecture.md#3-application-service-layer) says
   services own transaction boundaries, and its document-mutation discussion
   assigns validation and storage to `documentMutations`.
   [The service facade](../../packages/api/src/services/documents/documentMutations.ts)
   delegates to
   [the create workflow](../../packages/api/src/workflows/documents/mutations/createDocument.ts),
   which owns the transaction. AGENTS.md agrees with the implementation.
   The guide's layer diagram and ownership wording should be reconciled.
3. **Clarify the common SDK creation path.** The agent found that the app uses
   `documents.open()` to create local document state and sync it later. It also
   found lower-level root exports such as `createRemoteDocument`. A short
   decision guide would make the intended entry point easier to choose without
   tracing store internals. This is a discoverability proposal, not evidence
   that either API is broken.
4. **Prepare a Git checkout before testing execution.** `git archive` omits
   `.git`; verification uses Git for root discovery, base comparisons and
   fingerprints. This is a harness limitation, not a repository failure.
   Future execution cases need explicit Git metadata and a known base ref.
5. **Make first-use tool trust explicit.** Captured agent sessions repeatedly
   contain mise trust errors from shell startup in the fresh snapshot path.
   README starts with `mise install`, without discussing trust. A reviewed
   trust step and separate prerequisite lists for focused tests versus all
   gates would reduce setup uncertainty. The tasks did not change trust state.

Other agent observations, including possible single-file test-preload issues,
were not reproduced and are not established defects. Search glob mistakes are
agent/tool usage friction, not repository bugs.

## Evidence limits and next experiment

The initial Judge requests lacked tool-call evidence in native mode. Setup and
architecture passed; SDK onboarding lost one criterion because the Judge could
not verify the reported shell errors. That failure belongs to evidence capture,
not SDK readiness. The original portal grades remain intact for auditability.

The adapter was repaired to resolve the exact workspace and Claude session from
Scope's run log and attach that session's tool calls and results. It excludes
reasoning content, unrelated sessions, and prior Judge feedback. Saved outputs
were regraded with the same criteria and Judge model; no coding agent was rerun.
The corrected regrade passed **6/6 criteria** (2/2 in each task), with the same
source outputs and criterion definitions. The SDK verdict now cites the
captured zsh and mise failures in `evidence/native-tools.json`.

- Judge repair: `9c55adf36d9db96e4eefd6df6b639879b5d36bb5`.
- Corrected receipt: `.scope/regrades/1793016222066/receipt.json`.
- Initial grade: 5/6 criteria; corrected grade: 6/6.

The table above records original timings and grades. Regrading took 2m18s in
total and does not change the coding-agent observations or the portal history.

All three snapshot comparisons found the same 7,025 source files unchanged and
only `agent-readiness.md` added. Details remain in
`.scope/baseline-snapshot-audit.json`. The archive contains no installed
dependencies or build outputs, so this does not establish execution readiness.

Before expanding the suite, repair the identified documentation drift and
repeat the same tasks with a fixed coder model and several trials. Compare
navigation mistakes and friction as well as criterion outcomes. For a separate
setup benchmark, first provide a real Git checkout, explicit tool trust, and
captured command output; then measure installation and a focused verification
command. Keep those execution results separate from this inspection pilot.

## Follow-up fixes

The SDK README and advanced example now initialize SQLite before configuring
the SDK, opt into OPFS explicitly, and explain the memory default. The
[document creation guide](document-creation.md) distinguishes the normal store
path from custom workflow APIs. Architecture guidance assigns document mutation
transactions to workflows. Setup now includes reviewed mise trust and separate
[verification prerequisites](verification.md#prerequisites).

New Scope registrations include fresh Git metadata, the exact source commit,
and a pinned `origin/main` with their common ancestor. They exclude host Git
configuration, hooks, local edits, and ignored files. These fixes do not change
the pilot's archived reports, grades, or conditions. A repeated discoverability
experiment and an actual execution benchmark remain separate follow-up work.

## Tooling verification

Offline verdict, archive, run-state and native-evidence tests passed, along with
the tools TypeScript check. Negative controls confirmed that removing artifact
path/origin validation or native session validation makes the corresponding
tests fail. The native installer, stop/restart path and positive/negative Judge
calibration were exercised locally. Repository `check:fast` passed; the repair
was followed by another static run. No application behavior was changed.
