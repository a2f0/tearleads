# CI lessons

Cross-repository findings from CI passes, newest first. Each names the
repository and the PRs it came from; recheck before relying on one.

## Split the long serial file list out of a catch-all job

a2f0/tearleads #3333. A job running "the remaining package tests" finished
last in 60 of 80 runs (median 18.6 minutes): one package's end-to-end suite ran
1158 s of serial files inside it. Giving that package five matrix shards,
balanced with Bun's `--timings` from per-file times read out of uncached job
logs, took the catch-all job from 20.9 to 7.4 minutes and the whole uncached
run from 21 to 14. The slowest shard came in about 25% over its prediction;
plan shard counts with that margin. Bun keeps files in path order within a
timed shard, so a long file only splits usefully at higher shard counts, and
no shard is shorter than its longest file.

## Playwright shards by test count, not time

a2f0/tearleads #3332. Playwright 1.64 deals whole spec files to shards by test
count in project-then-file order, so a shard full of fast tests finishes early:
three shards left the slowest with 46% of the suite, four with 33%. Four
shards took the browser suite from a 13.1 minute median to about 6 minutes.
`playwright test --list --shard=i/N --reporter=json` names each shard's exact
tests before any build, so a shard can install only the browsers its projects
use (63 s to 23 s for Chromium-only shards). The same shard's time varied from
2.9 to 4.7 minutes with identical inputs: read the slowest shard as a range.

## Environment-conditional config splits local and CI static analysis

a2f0/tearleads #3332. A Playwright config that added a reporter only when `CI`
was set let Knip's Playwright plugin see the reporter on CI but not locally, so
Knip passed locally and failed on CI with a redundant-entry hint. Keep config
the same in every environment, or run static checks with `CI=true` as well.

## Version bumps and lockfiles defeat path filters and task keys

a2f0/tearleads #3331 and #3334. Every pull request bumped package versions and
refreshed the lockfile, so lanes meant only for native or infrastructure
changes ran in 72 to 74 of 80 runs. Two fixes helped:

- Treat a lockfile diff that changes only workspace `version` fields as
  touching nothing, and count anything unparseable as changed.
- Key a task on exactly what it reads. An iOS compile check that synced a
  placeholder page instead of the web build, and moved from a root task to a
  package task, cut its key changes from 277 to 18 per 300 merges, and its
  job from 12.5 minutes to a 30 s replay.

In Turbo, a root (`//#`) task always hashes the root `package.json`, and a
package task with explicit inputs always hashes its own manifest. Keep the
manifest in a native key when the sync tool runs manifest hook scripts, as
`cap sync` does.

## Prove a build cache with a warm run before keeping it

a2f0/tearleads #3334. An exact-key Xcode DerivedData restore on the runner's
Xcode 16.4 still rebuilt all 1622 object files: 690 MB of cache for no gain,
while the same restore on a newer local Xcode cut 190 s to 31 s. Measure a
cold run that saves and a warm run that restores before shipping any cache.

## More workers on the same cores is not a split

a2f0/tearleads #3335. Raising the TLC model checker from two to four JVMs at a
time on 4-vCPU runners made each run at least 1.5 times slower, so the job
fell only to the total work divided by four, and runner speed varied about
twofold between uncached runs on the default branch (491 to 1008 s): one run
could not show the change helped. Once total work bounds a job, split it
across runners, longest item first, and measure against many baseline runs.
A scheduling hint such as a recorded-durations file must ignore stale entries,
as Bun's `--timings` does: failing on a renamed item turns every rename
elsewhere into a CI failure.

## Merge policy can serialize a CI round

a2f0/tearleads, 2026-11-26. A version check that required each branch to carry
the default branch's version of every package made each merge force every
queued pull request to integrate and rerun its full CI, so five pull requests
merged one CI run at a time. A one-off push-gate break on the default branch
(stale ignore entries left by a merge) blocked every push until its repair
merged. Count merge-queue time in a round's estimate, and let the pull request
that repairs a shared gate merge first.
