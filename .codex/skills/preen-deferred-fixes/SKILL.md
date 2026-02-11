---
name: preen-deferred-fixes
description: Implement deferred follow-up commitments from merged PR review threads, add coverage, and prepare the branch for merge.
---

# Preen Deferred Fixes

Use this skill to complete postponed refactors, accessibility improvements, and test work that reviewers deferred to a future PR (for example, the flow tracked by issue `#1442`).

## Setup

Determine the repository and always pass `-R "$REPO"` to `gh`:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

## Inputs

- Tracking issue number (preferred), or
- Merged PR number containing deferred review comments

If both are available, start from the issue and use the PR for thread context.

## Workflow

1. Gather the deferred scope:

   ```bash
   gh issue view <issue-number> -R "$REPO" --json title,body,url
   gh pr view <pr-number> -R "$REPO" --json number,title,body,files
   gh api "repos/$REPO/pulls/<pr-number>/comments" --paginate \
     --jq '.[] | select(.body | test("defer|follow[- ]?up|future PR|later"; "i")) | {id,path,line,body,html_url}'
   ```

2. Build an explicit checklist from commitments found in the issue body and review comments.
3. Implement each checklist item with small, behavior-preserving changes.
4. Add tests for every implemented item (unit/integration/e2e depending on impact).
5. Run targeted validation commands first, then broader verification if multiple subsystems changed.
6. Summarize completed items, residual risks, and any intentionally deferred scope.
7. Commit/push using the `commit-and-push` skill and prepare merge readiness with `enter-merge-queue`.

## Quality Constraints

- Preserve existing behavior unless the deferred item explicitly changes it.
- Maintain accessibility guarantees (focus trap, keyboard navigation, semantics).
- Prefer reusable abstractions when removing duplicated logic.
- Do not lower coverage thresholds; increase coverage where touched.
- Follow repository rules: no binary commits, no `any` or `as` TypeScript escapes, no force-push unless explicitly requested.

## Done Criteria

- All checklist items are implemented.
- Tests exist for each item and pass locally.
- Branch is pushed and ready for PR/merge-queue flow.
