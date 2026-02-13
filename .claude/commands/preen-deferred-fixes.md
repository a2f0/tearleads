---
description: Implement deferred review follow-ups from merged PRs
---

# Preen Deferred Fixes

Complete deferred follow-up commitments from recently merged PR review threads, then ship the fixes with tests.

Use this when a tracking issue exists (for example `#1442`) or when reviewers explicitly deferred work to a future PR.

## Setup

Determine the repository once and use it for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

## Workflow

1. Identify deferred commitments.

   ```bash
   # Start from the tracking issue
   gh issue view <issue-number> -R "$REPO" --json title,body,url

   # If the issue references a merged PR, inspect comments for deferred work
   gh pr view <pr-number> -R "$REPO" --json number,title,body,files
   gh api "repos/$REPO/pulls/<pr-number>/comments" --paginate \
     --jq '.[] | select(.body | test("defer|follow[- ]?up|future PR|later"; "i")) | {id,path,line,body,html_url}'
   ```

2. Convert commitments into a checklist with clear, testable items.
3. Implement each item with minimal, behavior-preserving refactors.
4. Add or update tests for every item (unit/integration/e2e as needed).
5. Validate locally using the smallest reliable command set first, then broader coverage if the area is cross-cutting.
6. Summarize completed checklist items and any remaining risks.
7. Commit and push with `/commit-and-push`, then prepare merge with `/enter-merge-queue`.

## Quality Bar

- Keep behavior unchanged unless the deferred item explicitly changes behavior.
- Preserve accessibility requirements (keyboard flow, focus management, semantics).
- Prefer shared abstractions when removing duplication.
- Do not reduce coverage thresholds; add tests to lock in behavior.

## Output

Report:

- Deferred items completed (mapped to files/tests changed)
- Validation commands run and results
- Follow-ups that were intentionally left out of scope

## Token Efficiency

Use `--jq` filtering to limit PR comment output:

```bash
# Filter to deferred work patterns only
gh api "repos/$REPO/pulls/<pr>/comments" --paginate \
  --jq '.[] | select(.body | test("defer|follow[- ]?up"; "i")) | {id,path,body}'
```

Suppress verbose validation output:

```bash
pnpm lint >/dev/null
pnpm typecheck >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to debug.
