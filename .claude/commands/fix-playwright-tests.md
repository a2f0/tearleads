---
description: Fix failing Playwright tests (project)
---

# Fix Failing Tests

This skill helps diagnose and fix failing tests from GitHub Actions CI.

## 1. Check CI Status

Get the current PR and recent CI runs:

```bash
gh pr view --json number,title,url | cat
gh run list --limit 5
```

## 2. Identify Failing Jobs

View the failing job details:

```bash
# View run summary
gh run view <run-id>

# View failed job logs
gh run view <run-id> --log-failed
```

## 3. Download Test Artifacts

Download debug artifacts (screenshots, logs, reports) from failed runs:

```bash
# List available artifacts
gh run view <run-id> --json artifacts --jq '.artifacts[].name'

# Download specific artifact
gh run download <run-id> -n <artifact-name> -D /tmp/<destination-folder>

# Download all artifacts
gh run download <run-id> -D /tmp/<destination-folder>
```

### Common Artifact Names

- **Playwright**: `playwright-report`, `test-results`
- **Android Maestro**: `android-maestro-debug` (screenshots, logcat, UI hierarchy)
- **iOS Maestro**: `ios-maestro-debug`
- **Electron**: `electron-e2e-results`

## 4. Analyze Artifacts

For Playwright:

```bash
# View the HTML report
open /tmp/playwright-report/index.html

# Check screenshots and traces
ls /tmp/test-results/
```

For Maestro (Android/iOS):

```bash
# View screenshots
open /tmp/android-maestro-debug/*.png

# Check logcat for JS console logs
grep -i "console\|error\|capacitor" /tmp/android-maestro-debug/logcat.txt

# View UI hierarchy
cat /tmp/android-maestro-debug/ui-hierarchy.xml
```

## 5. Run Tests Locally

### Playwright (Web E2E)

```bash
pnpm --filter @rapid/client test:e2e
# Or run specific test
npx playwright test <test-name>
```

### Maestro (Android)

```bash
# Start emulator first, then:
cd packages/client
bundle exec fastlane android test_maestro
```

### Maestro (iOS)

```bash
# Start simulator first, then:
cd packages/client
bundle exec fastlane ios test_maestro
```

## 6. Fix and Verify

1. Fix the failing tests by updating selectors, assertions, or test logic
2. Verify all tests pass locally before pushing
3. Run `/commit-and-push` to commit and push the fixes
4. Monitor the CI run to confirm the fix works
