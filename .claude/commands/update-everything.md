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
- Make sure Maestro tests pass (both iOS and Android).
- Commit and push changes using `/commit-and-push`.
- Prepare the PR for merging using `/enter-merge-queue`.

## Node.js Version Alignment

When updating `electron`, ensure Node.js versions are aligned:

1. Check Electron's bundled Node.js version at <https://releases.electronjs.org/>
2. Update `.nvmrc` to match Electron's Node.js version (e.g., `v22.21.1`)
3. Update `engines.node` in root `package.json` to enforce the same major version (e.g., `>=22.21.1 <23`)

This alignment is critical because `electron-rebuild` compiles native modules (like `better-sqlite3-multiple-ciphers`) for Electron's bundled Node.js. If the system Node.js has a different `NODE_MODULE_VERSION`, integration tests will fail.
