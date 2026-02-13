---
description: Update all dependencies
---

# Update

Update all of the dependencies in the `packages` folder and:

- Make sure biome issues are fixed.
- Make sure TypeScript compiles.
- Make sure unit tests pass.
- Make sure integration tests pass.
- Make sure the pnpm lockfile is updated.
- Make sure all dependencies are pinned.
- Provide a summary of any warnings / deprecations.
- Make sure Capacitor's Podfile.lock is sync'd (`cap:sync` should pass).
- Clean and reinstall CocoaPods to ensure fresh native dependencies (see CocoaPods section below).
- Update Ruby dependencies in `packages/client` (Gemfile and Gemfile.lock), including fastlane.
- Automatically sync Node/Electron and Android SDK levels before dependency updates (see Toolchain Sync section below).
- Update the Gradle wrapper if a new version is available (see Gradle Version Update section below).
- Make sure Maestro tests pass (both iOS and Android).
- Commit and push changes using `/commit-and-push`.
- Prepare the PR for merging using `/enter-merge-queue`.

## Preferred Flow

Use the shared update script:

```bash
./scripts/updateEverything.sh
```

Optional toggles (set to `1` as needed): `SKIP_TOOLCHAIN_SYNC`, `SKIP_TOOLCHAIN_NODE`, `SKIP_TOOLCHAIN_ANDROID`, `SKIP_RUBY`, `SKIP_CAP_SYNC`, `SKIP_POD_CLEAN`, `SKIP_MAESTRO`, `SKIP_TESTS`, `SKIP_BUILD`, `SKIP_LINT`, `SKIP_UPDATE`, `SKIP_INSTALL`.

Additional toolchain controls:

- `TOOLCHAIN_SYNC_MAX_ANDROID_JUMP=<n>`: limit Android API-level bump in one run (default: `1`)
- `TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH=1`: continue even when active `node` runtime differs from updated `.nvmrc`

The script also fails fast if `@capacitor/*` versions in `packages/client/package.json` drift from the resolved versions in `packages/client/ios/App/Podfile.lock`.

## Toolchain Sync (Automatic)

`./scripts/updateEverything.sh` now runs `./scripts/syncToolchainVersions.sh --apply` before dependency updates:

1. **Node/Electron**: reads `electron` from `packages/client/package.json`, resolves its bundled Node version from `https://releases.electronjs.org/releases.json`, then aligns:
   - `.nvmrc`
   - `package.json` `engines.node`
2. **Android SDK levels**: reads latest stable platform API from `https://dl.google.com/android/repository/repository2-1.xml`, then bumps:
   - `packages/client/android/variables.gradle` `compileSdkVersion`
   - `packages/client/android/variables.gradle` `targetSdkVersion`

Guardrails:

- Android bumps are capped by `TOOLCHAIN_SYNC_MAX_ANDROID_JUMP` to avoid large blind jumps.
- If Node files are updated and active runtime does not match `.nvmrc`, the toolchain script exits so you can run `nvm use` and rerun.

## CocoaPods Clean Install

When Capacitor plugins update their native iOS dependencies (e.g., xcframeworks like `IONFilesystemLib`), stale CocoaPods caches can cause build failures even when the upstream library is correctly packaged. Symptoms include:

- Swift compiler errors about missing methods that should exist
- "No such module" errors for vendored frameworks
- Build failures that don't reproduce on clean machines

The update script performs a clean pod install:

```bash
cd packages/client/ios/App
rm -rf Pods Podfile.lock
pod install --repo-update
```

This ensures:

1. Fresh pod specs from the CocoaPods trunk repo (`--repo-update`)
2. No stale cached frameworks or build artifacts
3. Proper resolution of xcframework Swift interface files

**Important**: The regenerated `Podfile.lock` must be committed along with other dependency changes. Always verify `packages/client/ios/App/Podfile.lock` is staged before committing.

Skip with `SKIP_POD_CLEAN=1` if you need to preserve local pod modifications.

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

## Node.js Version Alignment

Node alignment is now automatic via toolchain sync. For manual fallback, when updating `electron`, ensure Node.js versions are aligned:

1. Check Electron's bundled Node.js version at <https://releases.electronjs.org/>
2. Update `.nvmrc` to match Electron's Node.js version (e.g., `v22.21.1`)
3. Update `engines.node` in root `package.json` to enforce the same major version (e.g., `>=22.21.1 <23`)

This alignment is recommended for consistency between development and production environments. While integration tests use SQLite WASM (avoiding native module ABI issues), Electron's production build uses native modules compiled for its bundled Node.js version. Keeping versions aligned ensures consistent behavior across all environments.

## Android Emulator Update

The Android emulator's system image should be kept up-to-date to ensure modern JavaScript features are supported in WebView. Symptoms of an outdated WebView include:

- `TypeError: Object.hasOwn is not a function` (WebView < Chrome 93)
- Blank white screen on app startup
- JavaScript errors for ES2022+ features

To update the Android emulator:

```bash
./scripts/updateAndroidEmulator.sh
```

This script:

1. Installs/updates the Android 35 system image with Google Play Store
2. Deletes old AVDs (`Maestro_Pixel_6_API_33_1`, `Maestro_Pixel_6_API_35`)
3. Creates a new AVD with modern WebView support
4. Configures optimal emulator settings for Maestro tests

**When to update**: Run this script when:

- Maestro tests fail with JavaScript errors in logcat
- WebView version is below Chrome 93 (check with `adb shell dumpsys webviewupdate`)
- A new Android API level is released

**Note**: This is a one-time setup per machine. The AVD persists across reboots.

## Gradle Version Update

To update the Gradle wrapper version:

1. Edit `packages/client/android/gradle/wrapper/gradle-wrapper.properties`
2. Update `distributionUrl` to the new version (e.g., `gradle-8.12-all.zip`)
3. Delete the existing JAR: `rm packages/client/android/gradle/wrapper/gradle-wrapper.jar`
4. Run the download script: `./packages/client/scripts/downloadGradleWrapper.sh`
5. Test locally: `cd packages/client/android && ./gradlew assembleDebug`

**Important**: Do NOT use `gradle wrapper` command to regenerate the wrapper files, as using a different local Gradle version can cause incompatibilities between the wrapper scripts (`gradlew`, `gradlew.bat`) and the JAR file.

## Native Module Rebuilds

When the script updates packages containing native Node.js addons (e.g., `better-sqlite3-multiple-ciphers`), they may need rebuilding for the current Node.js version. Symptoms of a stale native module:

```text
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version
NODE_MODULE_VERSION 143. This version of Node.js requires NODE_MODULE_VERSION 127.
```

To fix, rebuild the native module in the affected package:

```bash
cd packages/cli
npm rebuild better-sqlite3-multiple-ciphers
```

The update script runs `electron-rebuild` for the client package, but the CLI package uses the system Node.js and may require a separate rebuild.

## Biome Schema Migration

When biome is updated, the schema version in `biome.json` should be migrated:

```bash
pnpm biome migrate --write
```

This updates the `$schema` URL to match the installed biome version. The migration is automatic and non-breaking.

## pdfjs-dist and react-pdf Version Coupling

**CRITICAL**: `pdfjs-dist` must match the version expected by `react-pdf`. Version mismatches cause PDF loading failures (PDFs stuck at "Loading...").

**Check react-pdf's pdfjs-dist dependency**:

```bash
cat packages/client/node_modules/react-pdf/package.json | grep '"pdfjs-dist"'
```

If `pdfjs-dist` in `package.json` differs from react-pdf's dependency:

1. **Revert pdfjs-dist** to match react-pdf's version, OR
2. **Wait for react-pdf update** that supports the newer pdfjs-dist version

The update script should NOT update pdfjs-dist independently of react-pdf.

## Researching Breaking Changes

After updates complete, review changelogs for significant package upgrades:

1. **Check pnpm output** for deprecated subdependencies (transitive deps - usually not actionable)
2. **Review GitHub releases** for direct dependencies with version bumps:
   - Capacitor plugins: <https://github.com/ionic-team/capacitor-plugins/releases>
   - Biome: <https://github.com/biomejs/biome/releases>
   - pdfjs-dist: <https://github.com/mozilla/pdf.js/releases>
   - i18next: <https://github.com/i18next/i18next/releases>
3. **Note any breaking changes** that require code modifications
4. **Document deprecation warnings** in the PR description for future reference

## Known Acceptable Warnings

Some warnings are expected and do not require action:

- **electron-builder peer dependency mismatches**: Internal version conflicts between `dmg-builder` and `electron-builder-squirrel-windows` are tracked upstream and do not affect builds
- **Deprecated transitive dependencies**: Packages like `glob`, `rimraf`, `inflight` are deep transitive deps and will be resolved when upstream packages update

## Drizzle-ORM Peer Dependency Conflicts

When `drizzle-orm` is used across multiple packages, its optional peer dependencies (like `sql.js`) can resolve to different versions in different packages. This causes TypeScript errors like:

```text
Types have separate declarations of a private property 'shouldInlineParams'.
Type 'SQL<unknown>' is not assignable to type 'SQL<unknown>'.
```

**Diagnosis**: Run `pnpm why sql.js --recursive` to see if different packages resolve different versions.

**Fix**: Add a pnpm override in root `package.json` to force a single version:

```json
"pnpm": {
  "overrides": {
    "sql.js": "1.14.0"
  }
}
```

Then run `pnpm install` to apply the override.

## Known Flaky CI Issues

Some CI failures are transient infrastructure issues, not code problems:

### Android Instrumented Tests Packaging

The `capacitor-community-sqlite:packageDebugAndroidTest` task occasionally fails with:

```text
Execution failed for task ':capacitor-community-sqlite:packageDebugAndroidTest'.
> A failure occurred while executing PackageAndroidArtifact$IncrementalSplitterRunnable
```

**Fix**: Rerun the workflow - this is a Gradle incremental build cache issue.

### PDF Worker E2E Tests

The `should load PDF without fake worker warning` test may timeout after pdfjs-dist updates:

```text
Expected substring: "Page 1 of"
Timeout: 30000ms
Error: element(s) not found (shows "Loading...")
```

**Cause**: Usually a **version mismatch** between `pdfjs-dist` and `react-pdf`. See "pdfjs-dist and react-pdf Version Coupling" section above.

**Fix**: Revert `pdfjs-dist` to match the version `react-pdf` expects.

### iOS Maestro "App crashed or stopped" Across Random Flows

iOS Maestro can intermittently fail with:

```text
App crashed or stopped while executing flow
```

The failing flow is not stable (`database-reset-setup`, `sync-login-landscape-keyboard`, `orphan-cleanup`, etc.). In Maestro debug logs this often appears as:

```text
XCTestDriver request failed ... "Application com.tearleads.app is not running"
```

immediately after `Launch app "com.tearleads.app" with clear state`.

**Fix**:

1. Rerun only the failed iOS Maestro workflow/job.
2. If `CI Gate` already failed from the first attempt, rerun `CI Gate` after iOS Maestro is green.

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

On failure, stderr is preserved. Re-run without suppression to debug:

```bash
./scripts/updateEverything.sh  # Full output for debugging
```
