---
description: Fix failing tests from CI
---

# Fix Failing Tests

**First**: Determine the repository and PR number:

```bash
# Get repo (works with -R flag)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Get PR number (infers from current branch - do NOT use -R flag here)
PR_NUMBER=$(gh pr view --json number --jq '.number')
```

**IMPORTANT**: Run these as separate commands, not chained. After capturing `PR_NUMBER`, use `-R "$REPO"` with explicit PR number for subsequent commands.

This skill diagnoses and fixes failing CI jobs. It can target a specific job when called with an argument (e.g., `/fix-tests electron-e2e`) or diagnose all failures when called without arguments.

## Job Names Reference

| Job Name                   | Workflow                    | Approx Duration |
| -------------------------- | --------------------------- | --------------- |
| `build`                    | build.yml                   | ~15 min         |
| `web-e2e`                  | web-e2e.yml                 | ~10 min         |
| `electron-e2e`             | electron-e2e.yml            | ~10 min         |
| `android-maestro-release`  | android-maestro-release.yml | ~20 min         |
| `ios-maestro-release`      | ios-maestro-release.yml     | ~30 min         |
| `website-e2e`              | website-e2e.yml             | ~5 min          |

## 1. Identify Failing Jobs

Get the failing workflow run for the current commit:

```bash
COMMIT=$(git rev-parse HEAD)
gh run list --commit "$COMMIT" --limit 1 --json databaseId,status,conclusion -R "$REPO"
```

If a specific job name was provided (e.g., `/fix-tests electron-e2e`), focus on that job. Otherwise, identify all failing jobs:

```bash
# Get all jobs and their statuses (token-efficient)
gh run view <run-id> --json jobs --jq '[.jobs[] | {name, status, conclusion}]' -R "$REPO"

# Filter to just failed jobs
gh run view <run-id> --json jobs --jq '[.jobs[] | select(.conclusion=="failure") | .name]' -R "$REPO"
```

## 2. Download Failed Job Logs

Download only the logs for failed jobs (not all artifacts):

```bash
# View failed job logs directly (most token-efficient)
gh run view <run-id> --log-failed -R "$REPO"

# Or download specific artifact for detailed analysis
gh run download <run-id> -n <artifact-name> -D /tmp/<folder> -R "$REPO"
```

### Artifact Names by Job

| Job                       | Artifact Name          | Contents                            |
| ------------------------- | ---------------------- | ----------------------------------- |
| `build`                   | `coverage-reports`     | Coverage JSON files                 |
| `web-e2e`                 | `playwright-report`    | HTML report, screenshots, traces    |
| `electron-e2e`            | (logs only)            | Electron test output                |
| `android-maestro-release` | `android-maestro-debug`| Screenshots, logcat, UI hierarchy   |
| `ios-maestro-release`     | `ios-maestro-debug`    | Screenshots, logs                   |

## 3. Categorize the Failure

Analyze the logs to determine the failure type:

### Lint/Type Errors (build job)

**Symptoms**: ESLint errors, TypeScript errors in build job logs

```bash
# Look for lint errors
grep -i "error\|warning" /tmp/logs.txt | head -20

# Common patterns:
# - "'foo' is defined but never used"
# - "Type 'X' is not assignable to type 'Y'"
# - "Unexpected any. Specify a different type"
```

**Fix**: Address the lint/type error in the source file. Run locally to verify:

```bash
pnpm lint
pnpm exec tsc -b
```

### Test Failures

**Symptoms**: Test assertion failures, timeout errors

```bash
# For unit tests (build job)
grep -i "fail\|error\|timeout" /tmp/logs.txt
```

**Fix**: Update test assertions or fix the code logic. Run locally:

```bash
# Unit tests
pnpm --filter @tearleads/<package> test

# E2E tests
pnpm --filter @tearleads/client test:e2e
```

### Coverage Drop (build job)

**Symptoms**: "Coverage threshold not met" errors

```bash
# Look for coverage errors
grep -i "coverage\|threshold" /tmp/logs.txt
```

**Fix**: Add tests to restore coverage. Check which files dropped:

```bash
# Run coverage locally
pnpm --filter @tearleads/<package> test:coverage

# Check the coverage report
cat packages/<package>/coverage/coverage-summary.json
```

Focus on:

- New code that lacks tests
- Branches not covered
- Functions not called

### Flaky Tests

**Symptoms**: Test passes locally but fails intermittently in CI

**Common causes**:

- Race conditions in async code
- Timing-dependent assertions
- Shared state between tests

**Fix options**:

1. Add explicit waits/retries
2. Isolate test state
3. Use deterministic mocks
4. Mark as `.skip` temporarily and create an issue

### Infrastructure/Timeout Failures

**Symptoms**: Network errors, service unavailable, timeout without test output

**Fix**: Usually transient - rerun CI:

```bash
gh run rerun <run-id> -R "$REPO"
```

If persistent, check:

- CI resource limits
- External service dependencies
- Database connection issues

## 4. Job-Specific Fixes

### build Job

The build job runs lint, type-check, build, and tests with coverage.

```bash
# Run the full build pipeline locally
pnpm lint && pnpm exec tsc -b && pnpm build && pnpm test:coverage
```

Common issues:

- **Lint errors**: Fix in source, run `pnpm lint`
- **Type errors**: Fix types, run `pnpm exec tsc -b`
- **Build errors**: Check imports, run `pnpm build`
- **Coverage drop**: Add tests, run `pnpm --filter @tearleads/<pkg> test:coverage`

### web-e2e / electron-e2e Jobs

```bash
# Download Playwright report
gh run download <run-id> -n playwright-report -D /tmp/playwright -R "$REPO"
open /tmp/playwright/index.html

# Run locally
pnpm --filter @tearleads/client test:e2e
```

Common issues:

- **Selector changed**: Update the selector in the test
- **Timing issue**: Add `await page.waitFor*` assertions
- **API response changed**: Update expected values

### android-maestro-release / ios-maestro-release Jobs

```bash
# Download debug artifacts
gh run download <run-id> -n android-maestro-debug -D /tmp/maestro -R "$REPO"

# View screenshots
open /tmp/maestro/*.png

# Check logcat (Android)
grep -i "console\|error\|capacitor" /tmp/maestro/logcat.txt

# View UI hierarchy
cat /tmp/maestro/ui-hierarchy.xml
```

Common issues:

- **Element not found**: Update selector or add wait
- **WebView NAF="true"**: Add `androidWebViewHierarchy: devtools` to test
- **Timing issue**: Use `waitForAnimationToEnd` or increase `retryTapIfNoChange`

## 5. Apply Fix and Verify

1. Make the fix in the source code
2. Verify locally (run the relevant test command)
3. Commit and push:

   ```bash
   git add -A
   git commit -S -m "fix(tests): <description of fix>" >/dev/null
   git push >/dev/null
   ```

4. Report which job was fixed and what changed

## 6. Common Issues Reference

### Maestro: WebView Not Accessible (NAF="true")

If Maestro can't find elements in a WebView:

```yaml
appId: com.tearleads.app
androidWebViewHierarchy: devtools
---
- launchApp:
    clearState: true
- assertVisible: "My Text"
```

### Maestro: Use evalScript for Complex Interactions

```yaml
- evalScript: document.querySelector('[data-testid="my-button"]').click()
```

### Playwright: Flaky Selector

```typescript
// Instead of:
await page.click('.dynamic-class');

// Use:
await page.getByTestId('button-submit').click();
await page.getByRole('button', { name: 'Submit' }).click();
```

### Coverage: Adding Tests for New Code

1. Identify uncovered lines in coverage report
2. Write tests that exercise those code paths
3. Focus on branch coverage (if/else, switch cases)
4. Run `pnpm --filter @tearleads/<pkg> test:coverage` to verify

## Token Efficiency

- Use `--log-failed` instead of downloading all artifacts when possible
- Use `--jq` filtering to minimize JSON response size
- Only download artifacts for the specific failing job
- Suppress git output: `git commit ... >/dev/null && git push >/dev/null`
