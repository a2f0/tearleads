
# Preen Deferred Fixes

Complete deferred follow-up commitments from recently merged PR review threads, then ship the fixes with tests.

## Finding Deferred Work

Deferred fixes are tracked via GitHub issues with the `deferred-fix` label. These issues are created automatically by `/enter-merge-queue` when review feedback is deferred rather than fixed on-the-fly.

## Workflow

1. **Find deferred fix issues**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts listDeferredFixIssues --state open
   ```

   If a specific issue number is provided, start from that:

   ```bash
   ./scripts/agents/tooling/agentTool.ts getIssue --number <issue-number>
   ```

2. **Identify deferred commitments** from the issue body:

   - The issue body contains a "Deferred Items" section with checkboxes
   - The issue references the source PR and review threads
   - If more context is needed, use `findDeferredWork` on the source PR:

   ```bash
   # Find comments containing deferred work patterns
   ./scripts/agents/tooling/agentTool.ts findDeferredWork --number <pr-number>
   ```

   The `findDeferredWork` action searches for comments containing patterns like "defer", "follow-up", "future PR", "later", "TODO", or "FIXME" and returns `{id, path, line, body, html_url}` for each match.

3. Convert commitments into a checklist with clear, testable items.
4. Implement each item with minimal, behavior-preserving refactors.
5. Add or update tests for every item (unit/integration/e2e as needed).
6. Validate locally using the smallest reliable command set first, then broader coverage if the area is cross-cutting.
7. Summarize completed checklist items and any remaining risks.
8. Commit and push with `/commit-and-push`, then prepare merge with `/enter-merge-queue`.
9. **After merge**: Close the deferred fix issue (if all items are addressed).

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
