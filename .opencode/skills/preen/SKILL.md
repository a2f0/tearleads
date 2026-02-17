---
name: preen
description: Stateful preening across all preen skills. Lands focused improvements, opens a PR, and enters merge queue.
---

# Preen All

Perform a proactive, stateful pass through preen skills, land a focused improvement, open a PR, and enter the merge queue.

## When to run

Run preen regularly so TypeScript, React, API, database, compliance, and documentation gaps do not drift. Use the default `full` rotation for comprehensive sweeps, or pick `single`, `security`, or `audit` when you need faster, more targeted passes.

## Self-update check (critical)

Before invoking the handler, verify that the docs and registry are in sync:

```bash
./scripts/preen/generatePreenDocs.sh --check
./scripts/checkPreenEcosystem.sh --summary
```

If either command reports a problem, follow the failure message with the stricter variants (`./scripts/preen/generatePreenDocs.sh` and `./scripts/checkPreenEcosystem.sh --strict`) to regenerate docs and restore parity before continuing.

## Running Preen

Use the shared tooling so every agent runs the same discovery, scoring, and logging logic:

```bash
./scripts/agents/tooling/agentTool.ts runPreen --mode full
```

`runPreen` delegates to `scripts/preen/runPreen.sh`, which now contains the shell logic formerly embedded in this skill: it ensures a clean working tree, updates from the default branch, advances the cursor held under `.git/preen`, prints a health report, executes every discovery command listed below, computes the matching `metric_count`, and records the structured outcome in `.git/preen/runs.jsonl`. Add `--mode single|security|audit` to override `PREEN_MODE`, or `--dry-run` to inspect what would happen without mutating files or creating branches.

## Run modes

| Mode | Behavior |
| ---- | -------- |
| `full` (default) | Run every category and land at most one fix per category |
| `single` | Rotate through one category per run and land at most one fix |
| `security` | Run only security categories and land at most one fix |
| `audit` | Discover, score, and log without making edits |

## Categories

| Skill | Purpose |
| ----- | ------- |
| `preen-typescript` | Fix weak TypeScript typings (`any`, `as` casts, `@ts-ignore`) |
| `preen-split-react-components` | Split oversized React components into smaller files |
| `preen-deferred-fixes` | Complete deferred follow-ups from merged PR reviews |
| `preen-optimize-test-execution` | Tune CI impact analysis (workflow filters, package dependencies) |
| `preen-database-performance` | Find and fix database performance issues (N+1 queries, inefficient joins, index gaps) |
| `preen-api-security` | Audit API for authorization, data access, and security issues |
| `preen-dependency-security` | Audit dependency vulnerabilities and unsafe versioning |
| `preen-test-flakiness` | Reduce flaky tests and nondeterministic waiting patterns |
| `preen-msw-parity` | Audit MSW handlers against API routes and improve test coverage assertions |
| `preen-skill-tooling` | Validate skills are wired into `agentTool.ts` and `scriptTool.ts` |
| `preen-skill-parity` | Ensure skill definitions are consistent across OpenCode, Codex, Gemini, and Claude |
| `preen-compliance-docs` | Audit compliance documentation for gaps and cross-framework parity |
| `preen-package-docs` | Audit and generate missing package README.md files |
| `preen-review-instructions` | Audit and update code review instructions (`REVIEW.md`, `.gemini/INSTRUCTIONS.md`) |
| `preen-i18n` | Audit i18n translation coverage, missing keys, and hardcoded strings |
| `preen-docs-internationalization` | Translate and sync documentation across all supported languages |
| `preen-window-consistency` | Normalize window components and standardize refresh patterns into `window-manager` |
| `preen-file-limits` | Break down large files exceeding project limits (500 lines or 20,000 bytes) |

## Workflow overview

`runPreen` encapsulates:

1. A drained working tree check, default-branch sync, and cursor advancement stored under `.git/preen/cursor`.
2. History analysis (`jq` keeps track of stale, under-served, and high-performing categories) to boost under-served buckets.
3. Discovery loops (`rg`, `pnpm exec`, and helper scripts) plus `metric_count` tallies for each active category.
4. Health reporting (last run timestamps, rolling success rates, discovery-health warnings).
5. Selection guidance: the script prints the scoring rubric (`severity * 3 + blast_radius * 2 + confidence * 2 - effort`) and reminds you to capture the baseline, branch only after a candidate is chosen, and enforce the quality delta gate before opening a PR.
6. Structured run logging to `.git/preen/runs.jsonl` so the rotation remembers its state and success history.

## After a run

Use the printed instructions as your checklist:

- Pick the highest-value candidate only when confidence is high and behavior impact is clear.
- Capture the baseline metric (`runPreen` shows the `metric_count` command for the selected category) before making edits.
- Create a branch (`refactor/preen-YYYYMMDD-HHMMSS`), implement the fix, and run the impacted coverage/quality checks (`pnpm exec tsx scripts/ciImpact/...`, `pnpm typecheck`, `pnpm lint`, `pnpm test` when relevant).
- Verify the quality delta gate (`AFTER_COUNT < BASELINE_COUNT`), stage the change, and commit with `refactor(preen): stateful single-pass improvements`.
- Push, open a PR (the action prints the suggested title/body), and enter the merge queue (`./scripts/agents/tooling/agentTool.ts tagPrWithTuxedoInstance` on the resulting PR).
- Record the run in `.git/preen/runs.jsonl`; `runPreen` handles this automatically, but double-check the newest entry for accuracy.

## Guardrails

- In `single` mode, do not land more than one fix total.
- In `full` mode, do not land more than one fix per category.
- In `security` mode, land at most one security fix.
- In `audit` mode, do not make edits.
- Do not change runtime behavior unless fixing a bug; keep the change focused and independently verifiable.
- Avoid reintroducing `any`, unsafe casts, or `@ts-ignore`.
- Do not open empty PRs; every run should document the measured delta.

## Token efficiency

`runPreen` streamlines the commands that used to be repeated in this document, but you still need to keep lint/type/test logs quiet when running locally:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

Run them without redirection if you encounter failures so you can inspect the output.
