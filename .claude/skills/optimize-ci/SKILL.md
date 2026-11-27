---
name: optimize-ci
description: Cut a repository's CI wall-clock time in measured rounds - find the job that holds the critical path across recent runs, then split, parallelize, cache, or gate it without checking less, shipping each change through ship-pr. Use when the user asks to speed up CI, a pipeline, or required checks; not for making individual tests faster, production performance, or page loads (performance-pass).
---

# Optimize CI

A CI pass makes developers wait less for the same verdict. Every test, check,
and required job that ran before still runs; what changes is where and when it
runs and what is reused. A faster pipeline that checks less is a regression,
not a win.

## Measuring

`agent-tool ci timings` reads GitHub Actions through `gh` and changes nothing.
When a repository's agent-tool pin predates the command, run
`bunx --bun @a2f0/agent-tool@latest ci timings`.

| Command | Shows |
| --- | --- |
| `ci timings --workflow <file> --gate <job> [--event pull_request] [--limit 80]` | Over the latest successful first-attempt runs: wall clock (median, p90), the lane that finished last in each run, and every job's duration, how often it took at least `--threshold` minutes (did real work rather than replay a cache), and how long it waited to start |
| `ci timings --run <id>` | One run's jobs, longest first, with their steps |
| `ci timings --job <id>` | One job's log: which Turbo tasks executed and which replayed from cache, and Bun test files ranked by summed case time |

A lane is a job name without shard counters, so `Test (api 1/3)` and
`Test (api 2/3)` both count as `Test (api)`.

## Procedure

1. Scope. Read the repository's guidance and CI policy: required checks, any
   aggregate gate job, path filters, cache bridges, and merge rules. The target
   is the wall clock developers wait on: the median and p90 of pull-request
   runs, measured to the gate job.
2. Baseline. Run `ci timings` over 50 to 80 runs, pull requests and the default
   branch separately. Record wall median and p90, `lastToFinish`, the top jobs'
   medians, and `overThresholdShare`. A scheduled uncached run, where the
   repository has one, shows each job's cost without cache replay.
3. Find the critical path. The lane that finishes last in most runs is the
   target; break it down with `--run` (which step) and `--job` (which task or
   test file). Then name the next two or three lanes: removing the first exposes
   them, so plan a round that brings all of them under the target.
4. Choose levers, safest first:
   - Split serial work across runners. A long suite hidden in a catch-all job
     sets that job's length; give it its own matrix entries. Balance shards by
     measured time, not file count (Bun's `--shard` with `--timings`,
     Playwright's `--shard` from spec durations): a count split of uneven files
     is lopsided. Bun falls back to a count split without a word when the
     timings file is missing, so let a policy test require it. No shard is
     shorter than its longest file, so split that file when its cases are
     independent.
   - Use the cores the runner has. Check effective parallelism: test runners'
     CI defaults (Playwright uses half the cores), tool flags (TLC
     `-workers 1`), and pool sizes. Raise them only with measured memory
     headroom, and keep timing-sensitive end-to-end suites on their own runners
     rather than crowding one. Time each item before and after: when more
     workers only make each item slower, total work bounds the job, and the
     lever is splitting it across runners.
   - Schedule longest first in any pool, so a long item never starts last.
   - Cache what every run rebuilds: toolchains, browsers, package stores,
     compiler output (Xcode DerivedData and SwiftPM, Gradle), and task results.
     Key each cache on exactly what its output depends on.
   - Keep cache keys and path filters narrow. A file every pull request touches
     (a lockfile that version bumps rewrite, version fields, embedded build
     versions) silently defeats both. A job with a high `overThresholdShare`
     that should usually be cached points to one.
   - Remove duplicate work, such as one task in two jobs racing to fill the
     same cache entry.
   - Never delete or skip tests, loosen assertions or timeouts, drop a backend,
     make a required check optional, or let a cache hit stand in for a check
     whose inputs it does not cover.
5. Prove each change. Ship one lever per PR with `ship-pr`. A task cache can
   hide the change, so measure on a run that executes the lane: changed task
   arguments or inputs miss on their own; otherwise dispatch an uncached run.
   Give baseline and after numbers with run ids in the PR body. Keep a policy
   test beside the workflow that fails when a shard or gated job goes missing.
6. Re-measure after merging, with the same command over runs created after the
   merge, and report the change in median and p90 wall clock. Start the next
   round from step 3 with the new top lane.
7. Learn. Repository-specific findings go in that repository's guidance.
   Cross-repository lessons go in agent-tool's
   `skills/optimize-ci/references/lessons.md` by PR, naming the repository and
   PR; [the installed copy](references/lessons.md) is read-only.

## Pitfalls

- GitHub Actions caches are scoped. A pull request reads entries from its own
  ref and the default branch, never another pull request's, and one that starts
  before the default branch's run finishes misses the entries that run is still
  writing. Check timing before calling a miss a key bug.
- Turbo and Nx hash task arguments, so shards cache independently only when the
  shard argument reaches the task.
- A cached job still costs a runner, its setup, and a concurrency slot.
  Account limits, macOS especially, queue jobs as shards multiply: compare
  `startLagSeconds` p90 before and after, and let path filters skip lanes a
  change cannot affect.
- A re-run attempt mixes timestamps from several attempts; `ci timings` leaves
  re-runs out, and manual analysis should too.
- Turbo buffers a task's output until it ends, so log timestamps show
  completion, not progress. Use the test runner's own case durations.
- Turning a job into a matrix renames its check (`Web E2E` becomes
  `Web E2E (1/3)`), and so does moving it into a reusable workflow, which
  prefixes the caller's job name (`models / Protocol models`). Update branch
  protection, rulesets, and the merge helper's required checks together, or
  require an aggregate gate job instead.
- Changing a shard count reshuffles which files share a worker; with test
  isolation off, that can surface leaks between files. Run every new shard
  composition before pushing.
- Config chosen on `CI` (reporters, plugins, entries) looks different to
  static analysis locally and on CI, so a check passes locally and fails on CI.
  Keep config the same everywhere, or run those checks with `CI=true` too.
- A recorded-durations file only orders and balances work. It must ignore
  entries for items that no longer exist and weight unknown ones, or a rename
  in any pull request fails CI on a scheduling hint.
- Merge policy is part of the wall clock: a check that forces queued pull
  requests to integrate after every merge reruns their CI one at a time.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill at `skills/optimize-ci/` and the
`ci timings` command at `src/ci/`, with its tests beside it; `agent-tool skills
install --apply` installs it in each adopting repository. Change it there,
never in an installed copy. A repository's CI layout, required checks, and
measured baselines belong in its own docs.
