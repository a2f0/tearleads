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
- Update Ruby dependencies in `packages/client` (Gemfile and Gemfile.lock).
- Update the Gradle wrapper if a new version is available (see Gradle Version Update section below).
- Make sure Maestro tests pass (both iOS and Android).
- Commit and push changes using `/commit-and-push`.
- Prepare the PR for merging using `/enter-merge-queue`.

## Node.js Version Alignment

When updating `electron`, ensure Node.js versions are aligned:

1. Check Electron's bundled Node.js version at <https://releases.electronjs.org/>
2. Update `.nvmrc` to match Electron's Node.js version (e.g., `v22.21.1`)
3. Update `engines.node` in root `package.json` to enforce the same major version (e.g., `>=22.21.1 <23`)

This alignment is recommended for consistency between development and production environments. While integration tests use SQLite WASM (avoiding native module ABI issues), Electron's production build uses native modules compiled for its bundled Node.js version. Keeping versions aligned ensures consistent behavior across all environments.

## Gradle Version Update

To update the Gradle wrapper version:

1. Edit `packages/client/android/gradle/wrapper/gradle-wrapper.properties`
2. Update `distributionUrl` to the new version (e.g., `gradle-8.12-all.zip`)
3. Delete the existing JAR: `rm packages/client/android/gradle/wrapper/gradle-wrapper.jar`
4. Run the download script: `./packages/client/scripts/downloadGradleWrapper.sh`
5. Test locally: `cd packages/client/android && ./gradlew assembleDebug`

**Important**: Do NOT use `gradle wrapper` command to regenerate the wrapper files, as using a different local Gradle version can cause incompatibilities between the wrapper scripts (`gradlew`, `gradlew.bat`) and the JAR file.
