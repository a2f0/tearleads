---
description: Optimize CI test execution by mapping PR changes to impacted jobs
---

# Optimize Test Execution

Use dependency-aware impact analysis to decide which CI jobs should run for a PR.

## Workflow

1. Resolve repo and base branch:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BASE=${BASE:-origin/main}
```

1. Run analyzer:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base "$BASE" --head HEAD
```

1. Optional simulation while tuning rules:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts \
  --files "tuxedo/tests/run.sh,packages/shared/src/foo.ts"
```

1. Keep these in sync:

- `scripts/ciImpact/job-groups.json`
- `.github/workflows/build.yml` detect-changes filters

## Safety Model

- Prefer false positives over false negatives.
- If workflow/config paths change, run the full integration matrix.
- If classification is uncertain, choose to run more jobs.
