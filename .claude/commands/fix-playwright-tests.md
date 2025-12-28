---
description: Fix failing Playwright tests
---

# Fix Playwright Tests

1. Get the PR number and check CI status:

   ```bash
   gh pr view --json number,title,url | cat
   gh run list --limit 3
   ```

2. View the failing test logs:

   ```bash
   gh run view <run-id> --log-failed
   ```

3. Run the failing tests locally to reproduce:

   ```bash
   pnpm --filter @rapid/client test:e2e
   ```

4. Fix the failing tests by updating selectors, assertions, or test logic.

5. Verify all tests pass locally before pushing.

6. Run `/commit-and-push` to commit and push the fixes.
