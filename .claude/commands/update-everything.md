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
