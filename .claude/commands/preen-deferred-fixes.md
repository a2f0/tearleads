---
description: Implement deferred review follow-ups from merged PRs
---

# Preen Deferred Fixes

Complete deferred follow-up commitments from recently merged PR review threads, then ship the fixes with tests.

Use this when a tracking issue exists (for example `#1442`) or when reviewers explicitly deferred work to a future PR.

## Workflow

1. Identify deferred commitments.

   ```bash
   # Start from the tracking issue
   gh issue view <issue-number> --json title,body,url

   # If the issue references a merged PR, get PR info and find deferred work
   ./scripts/agents/tooling/agentTool.ts getPrInfo --fields number,title,body,files

   # Find comments containing deferred work patterns
   ./scripts/agents/tooling/agentTool.ts findDeferredWork --number <pr-number>
   ```

   The `findDeferredWork` action searches for comments containing patterns like "defer", "follow-up", "future PR", "later", "TODO", or "FIXME" and returns `{id, path, line, body, html_url}` for each match.

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

The `findDeferredWork` wrapper already filters to deferred patterns only:

```bash
# Returns only comments matching defer/follow-up patterns
./scripts/agents/tooling/agentTool.ts findDeferredWork --number <pr-number>
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
