---
name: space-cleanup
description: Free disk space safely in a repository, across a matrix workspace and its checkouts, or in this machine's developer caches, by removing only regenerable, git-ignored output after a dry run. Use when the disk is low, `bun run health` asks for space, a command fails with ENOSPC, or the user asks to clean up space; not for deleting clones, branches, or anyone's work.
---

# Space Cleanup

Free space by removing what a command can rebuild, never what a person made.
Measure first, remove the cheapest tier that frees enough, and report what
was freed from the volume's real free space, not from the estimate.

## Run it

`agent-tool space` does the work; run the repository's pinned agent-tool
(`bun run agent-tool space` or `node_modules/.bin/agent-tool space`). It is a
dry run until `--apply`.

- In a repository: `agent-tool space [path...] [flags]`. With no paths it
  covers only the repository holding the working directory; each path names
  the repository holding it.
- From a matrix workspace (`matrix.json` beside `checkouts/`):
  `agent-tool space [checkout...] [flags]`. With no names it covers the
  workspace and every checkout in `checkouts/`; names are checkout names or
  `owner/name`.
- If the pinned agent-tool predates the command, run
  `bunx --bun @a2f0/agent-tool@latest space`.

Caches are always included; each other flag adds its own tier independently:

| Flag | Removes | Cost to restore |
| --- | --- | --- |
| (default) | Caches: `.turbo`, `.parcel-cache`, `.eslintcache`, `.stylelintcache`, `coverage`, `.nyc_output`, test reports (`test-results`, `playwright-report`, `blob-report`), Python caches (`__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`), `node_modules/.cache` and `.vite`, `.next/cache`, `.wrangler/tmp` | Next run is slower |
| `--builds` | Build output: `dist`, `build`, `out`, `.next`, `.nuxt`, `.output`, `.svelte-kit`, `.expo`, `.gradle`, `.build`, `DerivedData`, Rust `target`, `*.tsbuildinfo` | The repository's build |
| `--deps` | `node_modules`, `.venv`, CocoaPods `Pods`, `vendor/bundle` | The repository's documented install |
| `--machine` | Xcode DerivedData (not its `SourcePackages` clones), `brew cleanup`, Bun and npm caches, `pnpm store prune` | Re-downloads and rebuilds |

`--json` gives agents the same report, and the command exits 1 when a
repository could not be scanned or a removal failed, 2 when it cannot run at
all (an unknown option, or processes that cannot be listed).
`--include-busy` cleans repositories other processes are working in; use it
only after confirming those processes are your own or finished. It never
applies to `--machine` items, which always wait for running installs and Xcode
builds.

## Procedure

1. Check the volume: `df -h .` (on macOS, `df -h /System/Volumes/Data`). Note
   how much the task needs; matrix sweeps want 50 GiB free.
2. Run the dry run with `--builds --deps --machine` to see every tier's size,
   then choose the cheapest set of tiers that frees enough. Default caches
   alone are always fine to apply.
3. Apply with only the chosen flags plus `--apply`. Read the `Free: before ->
   after` line; APFS clones and hard links mean freed space can be far less
   than the listed sizes, and Time Machine local snapshots can hold it until
   macOS thins them.
4. After `--deps`, reinstall dependencies in each cleaned repository that will
   be used next, with its documented setup, so hooks and `status` keep
   working. Deleting `node_modules` also deletes the pinned agent-tool, so
   where setup runs `bun run agent-tool bun install`, first bootstrap with the
   repository's pinned Bun: `bun install --frozen-lockfile`.
   After `--builds`, nothing is needed: the next build regenerates output.
5. Report the before and after free space, the tiers applied, repositories
   skipped as busy, and the `review` items from `--machine` with their sizes,
   so the user can decide about them.

## Safety rules

The command enforces these; keep them when cleaning by hand:

- Remove a repository path only when git reports it ignored, nothing under it
  is tracked (rechecked just before removal), its name is on the tier's list,
  nothing under it is a repository, `.env` file, `.secrets`, or SQLite
  database, and neither it nor any parent inside the repository is a symlink. Untracked files that are not ignored
  belong to someone: never remove them.
- Never run `git clean` (`-X` included), `rm -rf` on a whole ignored tree, or
  delete `.env*`, `.secrets`, `.wrangler/state`, local databases, or anything
  under `../matrix-secrets`.
- Skip a repository another process is working in (a dev server, a test run,
  another agent session). Idle shells and the session running the command do
  not count. When processes cannot be listed, the command stops instead of
  guessing.
- Never delete clones, worktrees, branches, stashes, Docker data, Gradle
  caches, simulator devices (unavailable ones included: they keep app data),
  or iOS DeviceSupport on your own: the `--machine`
  report lists the large ones as `review` for the user to decide.
- Package caches wait while an install runs, and DerivedData waits for Xcode.
- In a matrix workspace, cleaning ignored output does not change any
  checkout's git state, so it is not a sweep and needs no ledger; a checkout's
  `status` need not be `ready`.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill at `skills/space-cleanup/` and
the command at `src/space/`, with its tests beside it; `agent-tool skills
install --apply` installs it in each adopting repository. Change it there,
never in an installed copy.
