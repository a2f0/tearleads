---
name: update-everything
description: Update all dependencies across the repo (including Ruby/iOS/Android), fix lint/type/test issues, and prepare the PR for merge.
---

# Update Everything

Update all dependencies in the workspace (especially under `packages/`) and verify linting, builds, and tests. Capture and summarize warnings/deprecations.

## Preflight

- Confirm you are not on `main`; create/switch branches before running updates.
- Start from a clean `git status` or note existing changes so you do not clobber them.
- `nvm use` to match `.nvmrc`; install if missing so builds/tests run with the expected Node version.
- Ensure platform tooling is available (pnpm, bundler, CocoaPods, Android SDK). If something is missing, continue where possible and flag the gap in the final summary.

## Workflow

Use the shared script to perform the standard update flow:

```bash
./scripts/updateEverything.sh
```

Optional toggles (set to `1` as needed): `SKIP_RUBY`, `SKIP_CAP_SYNC`, `SKIP_POD_CLEAN`, `SKIP_MAESTRO`, `SKIP_TESTS`, `SKIP_BUILD`, `SKIP_LINT`, `SKIP_UPDATE`, `SKIP_INSTALL`.

Script exits early on dependency hygiene checks—fix then rerun:

- Caret/tilde ranges in `dependencies`/`devDependencies` are blocked. Pin versions where reported.
- Pinned `peerDependencies` must match `packages/client/package.json` versions. Align the peer versions to the client version before rerunning.
- `@capacitor/*` versions in `packages/client/package.json` must match the resolved versions in `packages/client/ios/App/Podfile.lock` (when present). Align and rerun sync/pod install if mismatched.

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

When updating `electron`, align Node.js versions:

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

## Warnings/Deprecations

Collect warnings/deprecations from `pnpm`, bundler, CocoaPods, Gradle, and test runs. Summarize them in the final response along with any required follow-ups.

## Finish

- Review changes with `git status` and `git diff`.
- **Verify `packages/client/ios/App/Podfile.lock` is staged** if iOS dependencies changed (the script regenerates it via `pod install`).
- Commit and push using `/commit-and-push`.
- Prepare the PR for merging using `/enter-merge-queue`.
