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

Capacitor + pnpm: if CocoaPods can’t find `pods_helpers.rb`, resolve paths from `.pnpm` (e.g., use a helper that glob-matches `node_modules/.pnpm/@capacitor+ios@*/node_modules/@capacitor/ios`). Avoid hard-coding versioned pnpm paths that break when Capacitor bumps.

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

## Warnings/Deprecations

Collect warnings/deprecations from `pnpm`, bundler, CocoaPods, Gradle, and test runs. Summarize them in the final response along with any required follow-ups.

## Finish

- Review changes with `git status` and `git diff`.
- Commit and push using `/commit-and-push`.
- Prepare the PR for merging using `/enter-merge-queue`.
