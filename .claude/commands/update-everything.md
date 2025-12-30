---
description: Update all dependencies (project)
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
- Commit the changes and push to remote using `/commit-and-push`.
- Run `/enter-merge-queue` to prepare the PR for merging.
