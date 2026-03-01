# CI Overview

This repository uses impact-aware CI selection with a single gate check.

## High-level flow

1. `scripts/ciImpact/ciImpact.ts` analyzes changed files and computes job decisions (`jobs.<job>.run`).
2. Release/E2E workflows run `detect-impact` and skip heavy jobs when `should-run` is `false`.
3. `.github/workflows/ci-gate.yml` computes required workflow names from ciImpact output and waits for only those workflows to report success.
4. Branch protection should require `CI Gate` (not every individual conditional workflow).

This gives "required if applicable" behavior in practice.

## CI Gate behavior

Workflow: `.github/workflows/ci-gate.yml`

- Trigger: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- Step 1 (`Detect Required Workflows`):
  - Runs `scripts/ciImpact/requiredWorkflows.ts` using PR base/head SHAs
  - Produces a JSON list of required workflow names (for this PR)
- Step 2 (`CI Gate`):
  - Polls GitHub Actions runs for the PR head SHA
  - Waits until all required workflows are `completed/success`
  - Fails if any required workflow fails
  - Fails on timeout if required workflows never report

Because `CI Gate` is always present, you can safely make this the required branch-protection check even when individual workflows are conditionally skipped.

## ciImpact scripts

Core analyzer:

- `scripts/ciImpact/ciImpact.ts`
  - Inputs: base/head diff (or explicit `--files`)
  - Outputs:
    - `changedFiles`, `materialFiles`, `changedPackages`, `affectedPackages`
    - `jobs.<job>.run` and `jobs.<job>.reasons`

Gate mapping helper:

- `scripts/ciImpact/requiredWorkflows.ts`
  - Runs `ciImpact.ts`
  - Maps job decisions to workflow names used in GitHub Actions
  - Outputs:
    - `requiredWorkflows`
    - `reasons` (keyed by workflow name)

Local pre-push quality selector:

- `scripts/ciImpact/runImpactedQuality.ts`
  - Runs selective lint/typecheck/build by impact
  - Falls back to full quality pipeline for high-risk changes

Local pre-push coverage selector:

- `scripts/ciImpact/runImpactedTests.ts`
  - Runs selective package `test:coverage` by impact
  - Falls back to full coverage targets for high-risk changes

## How impact selection is applied

In CI workflows:

- E2E/release workflows include a `detect-impact` job and conditionally run test jobs when impact requires them.

Locally (git hooks):

- `.husky/pre-push` runs:
  - `scripts/ciImpact/runImpactedQuality.ts`
  - `scripts/ciImpact/runImpactedTests.ts`

## Useful commands

Inspect job decisions for a branch:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD
```

Inspect required workflows for gate evaluation:

```bash
pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --base origin/main --head HEAD
```

Simulate with explicit files:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "scripts/ciImpact/ciImpact.ts,.github/workflows/ci-gate.yml"
```

Check for mapping drift between `ciImpact`, required workflows, and workflow files:

```bash
pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
```

Architecture guardrail summaries:

```bash
pnpm checkDependencyCruiserSummary
pnpm checkDependencyCruiserSummaryJson
pnpm lintKnipStrict
```

## Notes

- If a commit changes only ignored paths (for example docs-only paths configured in workflow triggers), some workflows may not report.
- `CI Gate` should be the merge requirement so merges are blocked only on relevant workflow outcomes for the PR.

## Runbook

When a workflow unexpectedly skipped or ran, use this flow:

1. Reproduce the decision locally with explicit files:

   ```bash
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "path/a.ts,path/b.ts"
   ```

2. Inspect `jobs.<job>.run` and `jobs.<job>.reasons` in the JSON output.
3. Derive gate expectations and verify workflow names:

   ```bash
   pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --files "path/a.ts,path/b.ts"
   ```

4. Validate mapping drift:

   ```bash
   pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
   ```

5. If behavior still looks wrong, check nightly validation output in `CI Impact Validation` workflow artifacts.

Safe tuning guidance:

- Keep fail-open behavior for ambiguous files (prefer extra runs over missed runs).
- Update `scripts/ciImpact/job-groups.json` and logic in `scripts/ciImpact/ciImpact.ts` together.
- Add or update scenario tests in:
  - `scripts/ciImpact/ciImpact.test.ts`
  - `scripts/ciImpact/requiredWorkflows.test.ts`
- Re-run drift + coverage checks before merging:

  ```bash
  pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
  pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --base origin/main --head HEAD --scripts-only
  pnpm dlx c8 --reporter=text-summary node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  ```
