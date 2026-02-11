---
name: fix-tests
description: Diagnose and fix failing CI jobs. Can target a specific job (e.g., `/fix-tests electron-e2e`) or diagnose all failures when called without arguments.
---

# Fix Failing Tests

Diagnose and fix failing CI jobs from GitHub Actions.

## Setup

Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Always pass `-R "$REPO"` to `gh` commands.

## Job Names Reference

| Job Name                  | Workflow                    | Duration |
| ------------------------- | --------------------------- | -------- |
| `build`                   | build.yml                   | ~15 min  |
| `web-e2e`                 | web-e2e.yml                 | ~10 min  |
| `electron-e2e`            | electron-e2e.yml            | ~10 min  |
| `android-maestro-release` | android-maestro-release.yml | ~20 min  |
| `ios-maestro-release`     | ios-maestro-release.yml     | ~30 min  |
| `website-e2e`             | website-e2e.yml             | ~5 min   |

## Workflow

1. Identify failing jobs:

   ```bash
   COMMIT=$(git rev-parse HEAD)
   RUN_ID=$(gh run list --commit "$COMMIT" --limit 1 --json databaseId --jq '.[0].databaseId' -R "$REPO")
   gh run view $RUN_ID --json jobs --jq '[.jobs[] | select(.conclusion=="failure") | .name]' -R "$REPO"
   ```

   If a specific job was provided as an argument, focus on that job.

2. Download failed job logs:

   ```bash
   gh run view $RUN_ID --log-failed -R "$REPO"
   ```

   For detailed artifacts:

   | Job                       | Artifact                |
   | ------------------------- | ----------------------- |
   | `build`                   | `coverage-reports`      |
   | `web-e2e`                 | `playwright-report`     |
   | `android-maestro-release` | `android-maestro-debug` |
   | `ios-maestro-release`     | `ios-maestro-debug`     |

3. Categorize the failure:

   - **Lint/type error**: ESLint or TypeScript errors → fix source code
   - **Test failure**: Assertion failed → fix test or code logic
   - **Coverage drop**: Threshold not met → add tests
   - **Flaky test**: Passes locally, fails in CI → add waits/retries or fix race condition
   - **Infrastructure**: Network/timeout → rerun CI with `gh run rerun $RUN_ID`

4. Apply fix by job type:

   **build job** (lint, types, coverage):

   ```bash
   pnpm lint && pnpm exec tsc -b && pnpm build && pnpm test:coverage
   ```

   **web-e2e / electron-e2e** (Playwright):

   ```bash
   pnpm --filter @tearleads/client test:e2e
   ```

   **android-maestro-release / ios-maestro-release** (Maestro):

   - Download debug artifacts for screenshots and logs
   - Check logcat for Android: `grep -i "console\|error" logcat.txt`
   - Check UI hierarchy for selector issues

5. Commit and push the fix:

   ```bash
   git add -A
   git commit -S -m "fix(tests): <description>" >/dev/null
   git push >/dev/null
   ```

6. Report which job was fixed and what changed.

## Common Fixes

### Coverage Drop

1. Run `pnpm --filter @tearleads/<pkg> test:coverage`
2. Check `coverage/coverage-summary.json` for dropped files
3. Add tests for uncovered branches/functions

### Maestro WebView Issues

Add to test file header:

```yaml
appId: com.tearleads.app
androidWebViewHierarchy: devtools
```

### Playwright Flaky Selectors

Use stable selectors:

```typescript
await page.getByTestId('button-submit').click();
await page.getByRole('button', { name: 'Submit' }).click();
```

## Token Efficiency

- Use `--log-failed` instead of downloading all artifacts
- Use `--jq` filtering: `--jq '[.jobs[] | {name, conclusion}]'`
- Suppress git output: `git commit ... >/dev/null && git push >/dev/null`
