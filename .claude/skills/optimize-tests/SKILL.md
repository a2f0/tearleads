---
name: optimize-tests
description: Reduce Tearleads test and CI runtime by measuring the slowest tests, optimizing fixtures and waits, and deleting demonstrably redundant tests while preserving regression coverage. Start with API and client SDK unless timings or the requested scope point elsewhere. Use for test-suite optimization, not production performance audits or weakening CI gates.
---

# Optimize Tests

Make the slowest useful tests cheaper and remove tests whose protection is
already provided elsewhere. Optimize elapsed CI time with evidence; test count
and lines deleted are not success metrics. Keep matching copies of this skill
under `.agents/skills` and `.claude/skills`.

An optimization request authorizes test and fixture edits. Honor report-only
requests. Shipping is separate: use `ship-pr` only when requested. Read
`AGENTS.md` for validation, build prerequisites, output capture, and versioning.

## Find the expensive work

1. Record HEAD, relevant dirty paths, Bun version, machine/runner, and commands.
   Inspect `.github/workflows/ci.yml`, package scripts, and Turbo dependencies.
   Consult `docs/developer/test-optimization.md` for earlier findings; re-measure
   them before treating them as a current baseline.
   Default to `packages/api` and `packages/client-sdk`; verify that they actually
   dominate the current CI critical path. The app suite runs its files serially
   (`--max-concurrency=1`), so its case sum approximates its elapsed time; while
   it is the longest job, API and SDK savings cannot shorten CI. Mention another
   bottleneck when the evidence identifies one, and state any change of scope
   rather than silently expanding the requested work.
2. Prefer a recent successful CI run with actual cache misses. Use `gh run list`,
   `gh run view <run> --json jobs`, and
   `gh run view <run> --job <job> --log` to save timings locally. Distinguish
   checkout/install/build time from test execution, and cached log replay from
   a fresh run. Retain the run URL and source revision.
3. Rank test cases and files by reported duration, grouped by package and API
   backend. Bun logs include `(pass) ... [duration]` and file headers. CI logs
   can add timestamps, Turbo prefixes, and `::group::` or `##[group]` markers;
   API output interleaves `[memory]` and `[sqlite]`, so track each stream's
   current file separately. Report unparsed/missing timings rather than treating
   them as zero. File sums identify leads, not elapsed time: hooks, module
   initialization, parallel execution, and subprocesses can change the total.
4. Reproduce the top candidates locally before changing them. Build prerequisites
   with `bun run agent:run --label test-build -- bun run build:packages`.
   For focused measurements, use the root output harness with
   `bun test --cwd packages/api ./src/path/to/file.test.ts` (or the SDK
   directory), retaining the package's normal preload.
   Use explicit file paths: appending a filename to `bun run test` does not
   narrow a script that already passes `src` to Bun. Local Bun output omits
   passing cases, so add `--reporter=junit --reporter-outfile=<evidence path>`
   for case durations. Record user CPU beside wall time, for example with
   `/usr/bin/time -p`.
5. Measure API candidates on both `API_DATABASE=memory` (PGlite) and
   `API_DATABASE=sqlite`. Run comparisons sequentially with the same flags,
   concurrency, and machine load. Avoid launching competing heavy checks or
   builds during measurements. On a shared host, record unavoidable contention
   and qualify timing claims. Include setup/teardown in process wall
   time; keep case timings as a separate diagnostic. Save raw logs under a
   local evidence directory such as `git rev-parse --git-path test-optimization`.
6. Separate waiting from compute. Wall time well above user CPU, or elapsed
   times that alternate between two values with similar CPU, mean a test is
   waiting out a timeout, often after a race; repeat such runs before comparing.
   Search CI logs for timeout diagnostics such as `App runtime settle timed out`,
   and look for wait helpers whose timeout result is discarded. `bun test`
   ignores `--cpu-prof` in Bun 1.4.2; time phases with `performance.now()` marks
   in an untracked probe copy of the test, and delete the probe afterward.

Use the longest tests first, then repeated setup that makes a whole file or
suite expensive. Pick a coherent, reviewable group of changes; complete its
measurement and validation before widening the scope.

## Decide what to preserve, optimize, or delete

For each candidate, identify its behavioral assertion, regression history,
boundary values, production path, database/backend, and isolation requirements.
Read the test and its fixture helpers, not only the name or coverage percentage.

- **Keep unique protection.** Security refusals, retry/restart behavior, races,
  dialect differences, maximum-depth/history cases, and real persistence or
  crypto integration can be expensive for a reason. A large fixture that
  crosses a former limit must still cross that limit. A mocked unit test does
  not replace a real adapter test merely because both cover the same lines.
- **Optimize avoidable work.** Look for repeated graph construction, redundant
  fixture verification, needless round trips during setup, fixed sleeps,
  repeatedly imported/building subprocesses, and unnecessarily broad fixtures.
  Prefer deterministic synchronization to sleeps. Reuse immutable signed
  fixture data when appropriate, but give each test fresh mutable state,
  databases, checkpoints, and mocks. Re-register shared fixture data after
  per-test registry resets; never warm the cold verifier the test is measuring.
  Before shortening a poll or wait, measure when the awaited event occurs: if
  the helper already returns promptly, the remaining cost is production work.
- **Do not starve React while waiting.** React defers renders scheduled inside
  an async `act` scope until it exits, so a long wait inside one scope can hold
  back the commit it is waiting for until the timeout. In the app, use
  `settleAppTestRuntimeInAct`, and assert a wait helper's result rather than
  discarding it.
- **Explain flakes before changing them.** If a failure will not reproduce
  under repeated or parallel runs, widen its race window in an untracked probe
  (for example, delay the follow-up query) and log the state transitions. The
  cause may be a product bug the test correctly detected. Read the DOM in the
  same snapshot that satisfies a wait instead of querying it again afterward.
- **Delete only with a coverage map.** For every removal or consolidated case,
  name the surviving test and assertion that detects the same failure at the
  same relevant boundary and layer. For obsolete behavior, cite the removed
  contract or code. Similar names or overlapping line coverage are insufficient.
  Keep distinct inputs/error outcomes in a parameterized test when they matter;
  parameterization alone does not save runtime.
- **Keep production semantics.** Do not lower crypto parameters, replace the
  verifier under test with a fake, drop backends, skip/quarantine tests, relax
  assertions/timeouts, weaken required checks, or hide work behind cache hits
  to claim a speedup. Treat production algorithm changes and CI sharding as
  separate proposals unless the user requested them.

If a slow test has no safe optimization or redundancy proof, retain it and
record why. There is no deletion quota.

## Prove the improvement

1. Run the same focused commands before and after the change. For noisy or small
   differences, repeat paired runs and compare medians/ranges; avoid repeated
   full-suite baselines when targeted measurements answer the question. Record
   wall time, test/pass/skip/failure counts, and measured setup cost where useful.
2. When changing a security regression's fixture or replacing/deleting its
   test, perform a negative control: temporarily restore the relevant bug or
   disable the exact guard in an isolated scratch checkout, and show that the
   retained test fails for the intended assertion. Restore the source before
   validation. A fixture rejected by an earlier guard does not prove the target
   check. Check fresh state and order independence when introducing reuse.
3. Run affected full package suites via
   `bun run agent:run --label api-tests -- bun run check:package @tearleads/api`
   and/or the equivalent `@tearleads/client-sdk` command. These bypass Turbo test
   replay and produce verification reports with build prerequisites. An
   equivalent forced run through `scripts/testing/runVerifiedTurbo.ts` is also
   suitable when validating several packages; inspect its task execution
   evidence to confirm every intended suite ran. Rebuild
   SDK dist after SDK source edits before API tests; API tests have no stale
   dist guard. Follow `AGENTS.md` for TypeScript, architecture, and static checks.
   Keep isolated worktrees beneath a private user-owned path. Desktop upload
   tests reject world-writable temporary ancestors; Turbo filters `TMPDIR`, so
   a shell override alone does not repair their fallback inside the checkout.
   Correct the environment without weakening that guard.
4. Inspect failures, warnings, counts, and verification reports, not just the
   harness exit receipt. Do not edit sources during a verified run. If a helper
   changes outside a package, inspect that package's Turbo inputs/dependencies.
5. Report the measured before/after values and percentage for the measured
   scope, the preserved coverage or deletion map, commands, logs, and remaining
   ranked leads. Separate local speedups from CI results; only claim a CI
   improvement after a comparable uncached CI run. Do not sum concurrent API
   backend durations and call the result CI time saved.

Update this skill from observed dogfooding failures, keeping both copies equal.
The handoff should let the next invocation resume from the remaining expensive
tests without mistaking historical timings for a current baseline.
