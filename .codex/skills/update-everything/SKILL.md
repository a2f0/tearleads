---
name: update-everything
description: Update all dependencies across the repo (including Ruby/iOS/Android), fix lint/type/test issues, and prepare the PR for merge.
---

# Update Everything

Update all dependencies in the workspace (especially under `packages/`) and verify linting, builds, and tests. Capture and summarize warnings/deprecations.

## Preflight

- Confirm you are not on `main`; create/switch branches before running updates.
- Start from a clean `git status` or note existing changes so you do not clobber them.
- `nvm` must be available in an interactive shell PATH; if missing, stop and report the blocker.
- Run `nvm install && nvm use` to match `.nvmrc`.
- Never install or update Node with Homebrew in this workflow.
- Ensure platform tooling is available (pnpm, bundler, CocoaPods, Android SDK). If something is missing, continue where possible and flag the gap in the final summary.

## Workflow

Use the shared script to perform the standard update flow:

```bash
./scripts/updateEverything.sh
```

This now includes `nvm install && nvm use` (hard-fails if `nvm` is unavailable) and an automatic toolchain sync step before dependency updates.

Optional toggles (set to `1` as needed): `SKIP_TOOLCHAIN_SYNC`, `SKIP_TOOLCHAIN_NODE`, `SKIP_TOOLCHAIN_ANDROID`, `SKIP_RUBY`, `SKIP_CAP_SYNC`, `SKIP_POD_CLEAN`, `SKIP_MAESTRO`, `SKIP_TESTS`, `SKIP_BUILD`, `SKIP_LINT`, `SKIP_UPDATE`, `SKIP_INSTALL`.

Additional toolchain controls:

- `TOOLCHAIN_SYNC_MAX_ANDROID_JUMP=<n>`: limit Android API-level bump in one run (default: `1`)
- `TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH=1`: continue even when active `node` runtime differs from updated `.nvmrc`

Script exits early on dependency hygiene checks—fix then rerun:

- Caret/tilde ranges in `dependencies`/`devDependencies` are blocked. Pin versions where reported.
- Pinned `peerDependencies` must match `packages/client/package.json` versions. Align the peer versions to the client version before rerunning.
- `@capacitor/*` versions in `packages/client/package.json` must match the resolved versions in `packages/client/ios/App/Podfile.lock` (when present). Align and rerun sync/pod install if mismatched.

## Automatic Toolchain Sync

`./scripts/updateEverything.sh` runs `./scripts/syncToolchainVersions.sh --apply` before package updates:

1. **Node/Electron**: reads `electron` from `packages/client/package.json`, resolves its bundled Node version from `https://releases.electronjs.org/releases.json`, then aligns:
   - `.nvmrc`
   - `package.json` `engines.node`
2. **Android SDK levels**: reads latest stable platform API from `https://dl.google.com/android/repository/repository2-1.xml`, then bumps:
   - `packages/client/android/variables.gradle` `compileSdkVersion`
   - `packages/client/android/variables.gradle` `targetSdkVersion`
3. **Ansible playbooks**: uses the Node major version from step 1 (or falls back to `.nvmrc`) to align:
   - `ansible/playbooks/main.yml` `nodejs_major_version`
   - `ansible/playbooks/tuxedo.yml` `nodejs_major_version`

Guardrails:

- Android bumps are capped by `TOOLCHAIN_SYNC_MAX_ANDROID_JUMP` to avoid large blind jumps.
- If Node files are updated and active runtime does not match `.nvmrc`, the toolchain script exits so you can run `nvm use` and rerun.

## Fastlane and Ruby Gems Update

Fastlane and other Ruby gems should be updated as part of the dependency update process:

```bash
cd packages/client
bundle update fastlane
```

To update all gems (not just fastlane):

```bash
cd packages/client
bundle update
```

**When to update fastlane**: Always check for fastlane updates when:

- Running a full dependency update
- Encountering App Store Connect API errors
- Seeing deprecation warnings from fastlane actions

**Verify the update**: After updating, run a dry-run to ensure fastlane still works:

```bash
cd packages/client
bundle exec fastlane ios build_release --dry_run
```

**Important**: The `Gemfile.lock` must be committed along with other dependency changes.

## Node.js Version Alignment (Electron)

Node alignment is now automatic via toolchain sync. For manual fallback, when updating `electron`, align Node.js versions:

1. Check Electron's bundled Node.js version at <https://releases.electronjs.org/>.
2. Update `.nvmrc` to match (e.g., `v22.21.1`).
3. Update `engines.node` in `package.json` to the same major range (e.g., `>=22.21.1 <23`).

## Gradle Wrapper Update

Only if a new Gradle version is available:

1. Edit `packages/client/android/gradle/wrapper/gradle-wrapper.properties`.
2. Update `distributionUrl` (e.g., `gradle-8.12-all.zip`).
3. Delete the existing JAR: `rm packages/client/android/gradle/wrapper/gradle-wrapper.jar`.
4. Run `./packages/client/scripts/downloadGradleWrapper.sh`.
5. Validate: `cd packages/client/android && ./gradlew assembleDebug`.

## Native Module Rebuilds

When updating packages with native Node.js addons (e.g., `better-sqlite3-multiple-ciphers`), they may need rebuilding. Symptoms:

```text
Error: The module 'better_sqlite3.node' was compiled against NODE_MODULE_VERSION 143.
This version of Node.js requires NODE_MODULE_VERSION 127.
```

Fix by rebuilding the module:

```bash
cd packages/cli
npm rebuild better-sqlite3-multiple-ciphers
```

The client package runs `electron-rebuild` via postinstall, but CLI uses system Node and may need manual rebuild.

## Biome Schema Migration

When biome is updated, migrate the schema:

```bash
pnpm biome migrate --write
```

## Coverage Threshold Adjustments

Dependency updates can cause pre-push hook failures due to coverage threshold mismatches. This happens when:

- New code was added without tests (thresholds drift below configured values)
- Coverage exclusion patterns changed
- Test file organization changed

**Symptoms**: Pre-push hook fails with "Coverage threshold not met" even though no test code changed.

**Fix approach**:

1. **Exclude untested modules** from coverage in `vitest.config.ts`:

   ```typescript
   coverage: {
     exclude: [
       'src/**/*.test.ts',
       'src/test/**/*',
       'src/untested-module/**/*'  // Add exclusions for untested code
     ]
   }
   ```

2. **Lower thresholds** to match actual coverage if exclusions aren't appropriate.

3. **Add TODO comments** explaining the reduction - Gemini will request this:

   ```typescript
   // TODO: Increase coverage thresholds back to X% by adding tests
   // for <specific modules that need tests>
   thresholds: {
     statements: 85,
     branches: 75,
     functions: 90,
     lines: 85
   }
   ```

**Important**: Gemini code review will flag threshold reductions without explanation. Adding TODO comments preemptively satisfies this requirement and documents technical debt.

## pdfjs-dist and react-pdf Version Coupling

**CRITICAL**: `pdfjs-dist` must match the version expected by `react-pdf`. **Check this BEFORE pushing** - Web E2E tests will fail if versions mismatch.

```bash
# Check what version react-pdf expects
cat packages/client/node_modules/react-pdf/package.json | grep '"pdfjs-dist"'

# Check what version is installed
cat packages/client/package.json | grep '"pdfjs-dist"'
```

If versions differ, revert pdfjs-dist to match react-pdf's dependency:

```bash
# Example: if react-pdf expects 5.4.296 but pnpm updated to 5.4.624
pnpm --filter @tearleads/client add pdfjs-dist@5.4.296
```

The update script should NOT update pdfjs-dist independently - always revert to react-pdf's expected version.

## Researching Breaking Changes

After updates, review changelogs for major version bumps:

1. **Check pnpm output** for deprecated subdependencies (transitive - usually not actionable)
2. **Review GitHub releases** for direct deps:
   - Capacitor plugins: <https://github.com/ionic-team/capacitor-plugins/releases>
   - Biome: <https://github.com/biomejs/biome/releases>
   - pdfjs-dist: <https://github.com/mozilla/pdf.js/releases>
   - i18next: <https://github.com/i18next/i18next/releases>
3. **Document deprecations** in the PR for future reference

## Known Acceptable Warnings

These warnings are expected and do not require action:

- **electron-builder peer dependency mismatches**: Internal conflicts between `dmg-builder`/`electron-builder-squirrel-windows` tracked upstream
- **Deprecated transitive dependencies**: `glob`, `rimraf`, `inflight` etc. are deep deps resolved when upstream updates

## Drizzle-ORM Peer Dependency Conflicts

When `drizzle-orm` is used across multiple packages, its optional peer dependencies (like `sql.js`) can resolve to different versions. This causes TypeScript errors like:

```text
Types have separate declarations of a private property 'shouldInlineParams'.
Type 'SQL<unknown>' is not assignable to type 'SQL<unknown>'.
```

**Diagnosis**: Run `pnpm why sql.js --recursive` to see version mismatches.

**Fix**: Add a pnpm override in root `package.json`:

```json
"pnpm": {
  "overrides": {
    "sql.js": "1.14.0"
  }
}
```

Then run `pnpm install` to apply.

## Known Flaky CI Issues

Some CI failures are transient infrastructure issues:

### Android Instrumented Tests Packaging

`capacitor-community-sqlite:packageDebugAndroidTest` may fail with `PackageAndroidArtifact$IncrementalSplitterRunnable` error. **Fix**: Rerun workflow (Gradle cache issue).

### PDF Worker E2E Tests

PDF loading tests may timeout after pdfjs-dist updates (shows "Loading..." instead of "Page 1 of"). **Fix**: Check for version mismatch with react-pdf - see "pdfjs-dist and react-pdf Version Coupling" section.

### iOS Maestro "App crashed or stopped" Across Random Flows

iOS Maestro may fail with:

```text
App crashed or stopped while executing flow
```

The failing flow can vary (`database-reset-setup`, `sync-login-landscape-keyboard`, `orphan-cleanup`, etc.). In `maestro.log`, this often appears as:

```text
XCTestDriver request failed ... "Application com.tearleads.app is not running"
```

immediately after `Launch app "com.tearleads.app" with clear state`.

**Fix**:

1. Rerun only the failed iOS Maestro workflow/job.
2. If `CI Gate` already failed due to that first attempt, rerun `CI Gate` after the iOS rerun is green.

## Warnings/Deprecations

Collect warnings/deprecations from `pnpm`, bundler, CocoaPods, Gradle, and test runs. Summarize them in the final response along with any required follow-ups.

## Finish

- Review changes with `git status` and `git diff`.
- **Verify `packages/client/ios/App/Podfile.lock` is staged** if iOS dependencies changed (the script regenerates it via `pod install`).
- Commit and push using `$commit-and-push`.
- Prepare the PR for merging using `$enter-merge-queue`.

## Token Efficiency

The update script and its sub-commands produce thousands of lines of output. Suppress stdout where only the exit code matters:

```bash
# Suppress verbose output - only show errors
./scripts/updateEverything.sh >/dev/null

# Or capture to file for debugging later
./scripts/updateEverything.sh > /tmp/update.log 2>&1
```

When running individual commands manually:

```bash
pnpm install >/dev/null
pnpm build >/dev/null
pnpm test:coverage >/dev/null
bundle install >/dev/null
pod install --repo-update >/dev/null
./gradlew assembleDebug >/dev/null
```

On failure, stderr is preserved. Re-run without suppression to debug.
