# Test optimization findings

The `optimize-tests` skill (in [`.agents/skills`](../../.agents/skills/) for
Codex and [`.claude/skills`](../../.claude/skills/) for Claude) ranks measured
test costs, preserves unique regressions, and requires a coverage map before
deleting a test. This page records what earlier passes learned: where the suites
spend their time, which techniques to reuse, and which approaches did not pay
off. Re-measure before acting on any of it.

## Where the time goes

CI runs the API, app, and client SDK suites in their own `Test (...)` jobs; see
[CI and merge requirements](ci-merge-gate.md). The app and API suites are the
longest, so SDK savings alone rarely shorten CI. The app suite runs its files
in two workers, each running one test at a time (`--max-concurrency=1`), so its
case sums approximate twice its elapsed time. The API suite runs its PGlite
(`API_DATABASE=memory`) and SQLite backends concurrently, each in two workers;
adding their durations does not predict CI time saved.

Bun's case sums omit hooks and any case without a parsed duration, so they
identify leads, not elapsed time. The known expensive files are:

- **API**: `src/workflows/documents/storedDocumentHistory.test.ts` and
  `src/workflows/containers/writerProjection/storedManifestHistory.test.ts`
  (4,098-entry signed histories), `src/routes/documents/automaticAncestorRepair.test.ts`,
  the container mutation route tests
  (`src/routes/containers/mutations.*.test.ts`),
  [writer projections](../glossary/sync.md#writer-projection), and rotation-carried
  [rekeys](../glossary/keys.md#rekey).
- **Client SDK**: `syncRepairLimits.test.ts`,
  `projectionAuthorityPageBudget.test.ts`, and
  `syncContainerRekeyPrefix.test.ts`.
- **App**: the `DualPaneProvider.*.test.tsx` files under
  `src/shell/pane/tests`, led by `recoveredNoteBackspace`, `sharing`, `groups`,
  `miniAppWrites`, `currentPrincipalRecovery`, and `attribution`.

Some of that cost is deliberate:

- The 4,098-entry document and container histories exceed
  [4,096 entries](../limits.md#container-hierarchy) on purpose; shrinking them
  would drop the regression they guard. Building the signed history dominates
  their cost; verification is the smaller part.
- `DualPaneProvider.recoveredNoteBackspace.test.tsx` is CPU-bound. Each of its
  51 sequential uploads spends roughly 100-200 ms in client commit, upload, and
  API work, and each cell of its creator, editor, and sync-mode matrix drives a
  different UI or delivery path. Its upload helper already returns within a
  millisecond of the server accepting the update, so the remaining per-update
  cost is a production-performance lead, not a fixture problem.

## Techniques that work

- **Build immutable signed fixtures once.** `syncContainerRekeyPrefix.test.ts`
  builds its 17-level signed ancestor graph in `beforeAll`. Each case clones
  the graph and key data, rebuilds its identity resolver, re-registers
  [manifest](../glossary/access.md#access-manifest) citations after the preload's
  registry reset, and opens a fresh database. No checkpoint or mutation response
  is shared between cases.
- **Thread acknowledged state through setup chains.**
  `automaticAncestorRepair.test.ts` passes each child's acknowledged manifest
  and key record into the next parent projection instead of refetching the
  growing parent path at every level. Setup uses real SDK creation, API
  writes, crypto verification, and acknowledgement; the root is fetched again
  before rotation, and repair and reads use independent cold SDK databases.
  The deep cases create 18 descendants and assert the
  [16-repair prefix boundary](../limits.md#container-keying).
- **Settle the app runtime in short `act` slices.** React holds commits
  scheduled inside an async `act` scope until the scope exits. A wait inside one
  long scope can therefore block the commit it waits for: Org Manager keeps its
  `mutating` flag, defers its own organization hint, leaves
  `organizationPending` true, and the wait runs to its 30 s timeout. A real
  browser commits immediately. `settleAppTestRuntimeInAct` in
  [`packages/app/test/helpers/appRuntimeIdle.tsx`](../../packages/app/test/helpers/appRuntimeIdle.tsx)
  waits in slices of 250 ms, or twice the combined sync and API quiet windows
  when that is longer, and logs a timeout only for the final slice.
  `importPeerIntoRoster`, `addPeerToAdminsGroup`, and `shareContainerWithGroup`
  use it and assert the result, so a stall fails at the step that caused it.
  Other call sites wrap `waitForAppTestRuntimeToSettle` in one `act` scope; a
  stall there shows up as `App runtime settle timed out` in the app log. The
  short timeouts in `organizationReadModelRealtime.idle.test.ts` emit that
  diagnostic on purpose.
- **Sign a single successor in-process.** `test/helpers/longPrincipalHistory.ts`
  in the API signs one new
  [principal version](../glossary/principals.md#principal-policy-state) in the
  test process and starts signing workers only for longer histories, including
  the opt-in [16,384-version regression](../principal-history-acceptance.md) in
  `test/slow/principalHistoryAvailability.test.ts`. Both paths
  call `signPrincipalState`, and signing does not populate verification caches.
- **Wrap timer-backed retries and async UI actions in `act`.** Explorer's
  menu-retry waits run inside `act`, and the recovery-key actions use async
  `act` callbacks; awaiting a synchronous callback restores the act environment
  before asynchronous updates flush and produces warnings. Check warnings in a
  multi-file run, because suite setup can mask a missing scope when a file runs
  alone.

- **Run the client SDK, app, and API files in two workers.** `bun test`
  otherwise runs a package's files one after another in a single process. All
  three suites pass `--parallel=2 --no-isolate` (the API passes it to each
  backend in
  [`packages/api/scripts/testAllDatabases.ts`](../../packages/api/scripts/testAllDatabases.ts)):
  each worker keeps one global across the files it runs, as the serial run did,
  so CPU time stays the same while wall time halves (SDK 528 s to 257 s locally,
  3,996 tests either way; app 890 s to 402 s back to back on a shared host,
  2,838 tests either way; API 996 s to 510 s, 2,191 tests per backend either
  way). Plain `--parallel` implies `--isolate` and cost about 2.4 times the CPU
  for the SDK, 1.5 times for the app, and 2 times for the API (880 s wall). CI's
  4-vCPU runner fits the API's two backends times two workers.
- **Split the long suites across CI runners.** On CI, the API runs one
  backend per runner (`--database=` in `testAllDatabases.ts`) in three Bun
  shards, and the app, client SDK, and bob-and-alice suites in two each, so no
  job carries a whole suite. API shards keep two workers: with `--parallel=4`,
  four PGlite workers on one 4-vCPU runner pushed a test that takes 3.3 s of
  its 5 s budget on main past the limit. Local runs keep both backends and two
  workers. The bob-and-alice scenarios run in four isolated workers (each
  boots its own in-process API): 35 tests took 167 s locally, where the serial
  CI run of 34 took 850 s. A new shard layout regroups files inside
  `--no-isolate` workers, so it can expose a test that leaks module state
  (see the mouse-release fix in `MiniAppControls.test.tsx`).
- **Keep worker-safe preload hooks.** In a `--parallel` run Bun calls a
  preload's `afterAll` after every file, not once per run, while
  `--no-isolate` keeps module state for the worker's next file. The app and
  API preloads therefore close the API test adapters only in a serial run
  (`BUN_TEST_WORKER_ID` is unset); closing them per file left later files a
  closed PGlite (`PGlite is closed`), which is why both suites first failed in
  parallel.
- **Scope a process-wide swap to the calls that need it.** Which file runs
  first in a worker decides which one pays for process-wide setup.
  `runWithBunFetchLock` in `@tearleads/sqlite-worker` used to point
  `globalThis.fetch` at `Bun.fetch` while SQLite loaded and while each database
  opened, so any request in that window skipped MSW and failed with
  `ECONNREFUSED`. Serially an early file always paid for the load; in a worker
  `Root.suspension.test.tsx` could be the first, and alone it failed 17 of 30
  runs. The lock now sends only the loader's `file:` asset to `Bun.fetch` and
  every other request to the fetch it replaced.

## Explaining flakes

Widen a suspected race in an untracked probe copy (for example, delay the
follow-up query) and log the state transitions; the failure may be a product
bug the test correctly detected.

- `DualPaneProvider.sameIdentity.test.tsx` exposed one: a recovered pane's
  Explorer tree reloads from empty, through a root-only list, to the
  identity's containers. `useExplorerSelection` therefore remembers the slot of
  a vanished device-local system container until exactly one node has it,
  stops following on an ambiguous slot, and lets any explicit selection cancel
  it. Because the reload can still remove the table briefly,
  `expectSingleYouContact` reads the user-ID button from the snapshot that
  satisfied its wait instead of querying again.
- `SystemMonitorRequests.restore.test.tsx` waits until neither identity has a
  request in flight and reads the client totals and proxied request count from
  that same snapshot. The runtime settle point tracks proxied traffic and quiet
  time, while the client counts a request until its response resolves, so
  Explorer queries could still be in flight right after settling.
- An unexplained failure mode in the same-identity file,
  `Primary session did not materialize the new organization profile name`,
  failed CI twice, both on `main` on 2026-10-14, and in no failed or retried
  CI attempt among the roughly 370 runs since. Neither log shows
  `ECONNREFUSED`, the signature of the SQLite fetch swap above, and the flake
  stopped two weeks before that fix, so the swap does not explain it. The
  file's own log section holds only the timeout, React's act-environment
  warnings, and a DOM dump truncated before the organization selector. On
  current `main` the file passed 50 of 50 local runs (20 alone, 30 in six
  concurrent loops). If it returns, capture the selector's options and the
  organization runtime state at the timeout.
- `waitForBusyPaint.test.ts` raced real timers against the 100 ms paint
  fallback: under eight CPU burners its 10 ms sleep overran the fallback in 1
  of 50 runs, and a 1,000 ms wall-clock bound on the fallback failed at
  2,053 ms in a push gate. It now stubs `setTimeout`, `clearTimeout`, and
  `requestAnimationFrame` and fires each callback by hand. Test a timer's
  delay and effect that way rather than measuring elapsed time.

## API test timeout

[`testAllDatabases.ts`](../../packages/api/scripts/testAllDatabases.ts)
passes `--timeout=15000` to both backends, replacing Bun's 5 s default for
every test and hook that sets no timeout of its own (a per-test argument still
wins). Under load, push gates lost lone 5 s timeouts in route tests that take
1-2.5 s alone (`syncPagination`, `policy`, `organizations`,
`deletedContainerDirectGrant`, and others). The time is real work, not hooks:
registering and signing in one user costs about 0.4 s (0.23 s building the
signed registration body, 0.14-0.21 s for the route), and most route tests
register one to three users and then sign manifests and policies. It scales
with free CPU, so the 5 s default left no room under contention.

The budget comes from JUnit reports of the full suite (both backends, two
workers each), counting only tests without their own timeout:

| Run (memory / sqlite) | p99 | p99.9 | Failures |
| --- | --- | --- | --- |
| Normal load (~12), 5 s default | 1.6 / 1.2 s | 2.1 / 2.0 s | 0 / 0 |
| `taskpolicy -c background`, 5 s default | 6.9 / 5.5 s | 11 / 11 s | 143 / 81 |
| `taskpolicy -c background`, 15 s budget | 6.7 / 5.3 s | 15 / 11 s | 7 / 6 |

Throttled, tests ran a median 3.6 times and p90 5.9 times slower than at
normal load, and every failure was a timeout. Of the 13 throttled failures
left, 9 are tests that set their own budget (the 4,098-entry histories at
300 s among them) and 4 reached 15 s on the efficiency cores. The slowest
default-budget test at normal load (2.4 s) times six rounds to 15 s, which is
also the budget most slow API tests already set by hand. Run single files
with the same budget: `API_DATABASE=memory bun test --timeout=15000 <file>`.
Re-measure before changing it, and fix a test that needs more than its share
rather than raising the lane budget.

## Approaches that did not pay off

- **Bulk-inserting history fixtures** without maintaining unused projections
  gave inconsistent results: slightly faster on PGlite, slower on SQLite.
- **One transaction for all 4,098 history setup writes** made the PGlite run
  markedly slower.
- **In-process signing for up to 128 successors** lowered user CPU in the
  purge-history cases, but wall time did not improve consistently on either
  backend. Worker signing stays for multi-version histories.
- **Faster polling** cannot help where the awaited event already completes
  promptly; measure when the event occurs before shortening a wait.

## Measurement notes

- `bun test` ignores `--cpu-prof` in Bun 1.4.3. Time phases with
  `performance.now()` marks in an untracked probe copy of the test.
- Compare wall time with user CPU. Wall time well above CPU, or elapsed times
  that alternate between two values with similar CPU, mean a test is waiting
  out a timeout, usually after a race.
- Measure API candidates on both backends, sequentially, with the same flags
  and host load. Local Bun output omits passing cases; add
  `--reporter=junit --reporter-outfile=<path>` for case durations.
- Keep raw logs and probe variants under
  `git rev-parse --git-path test-optimization`; they are not tracked.
