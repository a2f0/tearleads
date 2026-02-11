---
name: optimize-test-execution
description: Analyze PR file changes plus workspace package dependencies to decide which CI test jobs should run, then keep workflow filters and job rules in sync over time with conservative safety fallbacks.
---

# Optimize Test Execution

Use this skill to reduce unnecessary CI jobs while keeping false negatives low.

## When to use

- You are tuning which CI jobs run for a PR.
- You need dependency-aware impact analysis across `packages/*`.
- You want to keep `.github/workflows/build.yml` change filters aligned with real package dependencies.

## Safety model

- Prefer false positives over false negatives.
- If a change cannot be classified confidently, run more jobs.
- If workflow/config files change, run all integration jobs.

## Workflow

1. Resolve repo and base branch:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BASE=${BASE:-origin/main}
```

1. Generate CI job recommendation for current diff:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base "$BASE" --head HEAD
```

For simulation while tuning rules:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts \
  --files "tuxedo/tests/run.sh,packages/shared/src/foo.ts"
```

1. Apply recommendations to workflow gating logic.

Primary target in this repo:

- `.github/workflows/build.yml` (`detect-changes` with `dorny/paths-filter`)

1. Validate rule quality with targeted simulations:

```bash
# Should not trigger Maestro-only jobs
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "tuxedo/tests/run.sh"

# Should trigger client integrations
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/shared/src/index.ts"

# Should trigger website e2e
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/website/src/pages/index.astro"
```

1. Keep rules in sync over time.

Update in lockstep:

- `scripts/ciImpact/job-groups.json`
- `.github/workflows/build.yml` path filters

## Output contract

The script emits JSON with:

- `changedFiles`
- `changedPackages`
- `affectedPackages` (transitive dependents)
- `jobs` with `run` + `reasons`
- `warnings` for uncertain classification

Use `jobs.<name>.run` as the source of truth when deciding what to run.
