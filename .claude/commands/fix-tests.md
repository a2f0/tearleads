---
description: Fix failing tests from CI
---

# Fix Failing Tests

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

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

## 6. Common Issues and Fixes

### Maestro: WebView Not Accessible (NAF="true")

If Maestro can't find text/elements in a WebView, the UI hierarchy may show
`NAF="true"` (Not Accessible Friendly) on the WebView node.

**Fix**: Add `androidWebViewHierarchy: devtools` to your test file:

```yaml
appId: com.tearleads.rapid
androidWebViewHierarchy: devtools
---
- launchApp:
    clearState: true
- assertVisible: "My Text"
```

This uses Chrome DevTools Protocol instead of Android accessibility APIs.

**Also required**: Enable WebView debugging in MainActivity.java:

```java
WebView.setWebContentsDebuggingEnabled(true);
```

### Maestro: Use evalScript for Complex Interactions

For reliable WebView interaction, prefer JavaScript-based selectors:

```yaml
- evalScript: document.querySelector('[data-testid="my-button"]').click()
```

### Platform Detection Issues

If tests fail because platform detection returns wrong value (e.g., 'web' instead
of 'android'), check the debug indicator on the Files page and review logcat for
platform detection logs.

## 7. Fix and Verify

1. Fix the failing tests by updating selectors, assertions, or test logic
2. Verify all tests pass locally before pushing
3. Run `/commit-and-push` to commit and push the fixes
4. Monitor the CI run to confirm the fix works
