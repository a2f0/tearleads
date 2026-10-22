# Test optimization measurements

Use the `optimize-tests` skill in `.agents/skills` (Codex) or `.claude/skills`
(Claude) for another pass. It ranks measured test costs, preserves unique
regressions, and requires a coverage map before deleting a test.

## First pass: October 15, 2026

Baseline checkout: `51f16372de6c4d3a989b0bd8a8780a0a2c84ec0a`.
The [CI baseline run](https://github.com/a2f0/tearleads/actions/runs/38776184981)
at `fe252fb1184bbc2e8103631b79978ce30ca87d6f` had test cache misses. Its API,
SDK, and app jobs took approximately 18, 16.7, and 17 minutes respectively.
API and SDK were the requested focus; app remains another critical-path lead.

The most expensive reported file totals included:

| Package/backend | Test file | Case sum |
| --- | --- | ---: |
| API / SQLite | `storedDocumentHistory.test.ts` | 89.52 s |
| API / PGlite | `storedDocumentHistory.test.ts` | 81.72 s |
| API / PGlite | `automaticAncestorRepair.test.ts` | 44.99 s |
| API / PGlite | `mutations.test.ts` in container routes | 42.58 s |
| SDK | `syncContainerRekeyPrefix.test.ts` | 23.65 s |
| SDK | `syncRepairLimits.test.ts` | 10.30 s |
| SDK | `projectionAuthorityPageBudget.test.ts` | 8.91 s |

These are sums of timed cases, not file or job elapsed times. Hooks and untimed
cases are absent: 12 passing PGlite cases, 14 SQLite cases, and 12 SDK cases had
no parsed case duration. API backends execute concurrently, so adding their
totals does not predict CI time saved.

## Retained optimization

`packages/client-sdk/src/workflows/documents/syncRekeys/syncContainerRekeyPrefix.test.ts`
rebuilt the same 17-level signed ancestor graph and document six times. It now
builds that immutable template once in `beforeAll`. Each case clones all graph
and key data, reconstructs its identity resolver, re-registers manifest
citations after the preload's registry reset, and creates a fresh database.
No checkpoint or mutation response is shared between cases.

Local process wall time, including setup, using Bun 1.4.2 on Darwin arm64:

| Scope | Before | After | Change |
| --- | ---: | ---: | ---: |
| SDK prefix file, six passing cases | 15.32 s | 10.69 s | 30.2% less |

Command, run through `bun run agent:run` from the repository root:

```sh
bun test --cwd packages/client-sdk \
  ./src/workflows/documents/syncRekeys/syncContainerRekeyPrefix.test.ts --max-concurrency=4
```

All six test bodies retain their original assertions. Repeated fixture
assertions move into setup, which explains the reported assertion-count change
from 20 to 14. No test, backend, or cryptographic verification was removed.
The measured scope is one file, not the full SDK suite or the CI critical path.

Negative controls in a scratch checkout confirmed that the retained tests fail:

- Disabling checkpoint persistence causes the cold-device case to reject with
  `locally acknowledged access manifest does not begin at epoch 1` instead of
  reaching its expected post-commit `unrefreshable` stop.
- Suppressing terminal-refusal classification makes the 403 case observe zero
  terminal failures where it asserts one.

A scratch isolation probe mutated one clone's key bytes and paths, cleared the
manifest registry, and confirmed that a second clone retained the original data
and restored its citations. It and the six regressions passed together in
randomized order with seed 2544. The deliberate production mutations existed
only in the scratch checkout and were restored before this run; they never
reached this branch.

## Rejected experiment and next leads

The API history fixture was experimentally changed to bulk-insert signed
events/manifests without maintaining unused projections. Its local wall times
(before → after) were 110.79 s → 105.59 s on PGlite and 100.20 s → 106.44 s on
SQLite.
That inconsistent result did not justify another fixture implementation, so
the experiment was reverted. The SQLite diagnostic split was 85.37 seconds of
signed-history setup and 20.47 seconds of verification. The first PGlite run
also shared the host with other test processes; treat these as investigative
timings rather than a stable performance comparison.

Keep the API's 4,098-entry history: it protects the removal of the former
4,096-entry limit in PR #2383. Reducing its size would erase that regression.
Next candidates are API automatic ancestor repair and container mutations, then
SDK repair limits and authority-page budgeting. Re-measure at the next revision
before acting; these historical totals identify where to look.

Raw baseline, experiment, and negative-control logs were saved locally under
`git rev-parse --git-path test-optimization`; they are not tracked artifacts.

## Second pass: October 15, 2026

Baseline: `063e2744abcb3b7d6d6a5b34b873e2935ba0208b`, after PR #2550 merged.
The [fresh CI run](https://github.com/a2f0/tearleads/actions/runs/38832488726)
at `3f966ab636719fb21aa9a50a79ef1cb2b810461c` executed API and SDK tests with
cache misses. The app job was longest at 24m26s; API took 17m37s and SDK 14m53s.
API and SDK remain the requested scope, but these changes alone cannot remove
the app bottleneck.

`packages/api/src/routes/documents/automaticAncestorRepair.test.ts` now passes
the parent projection explicitly when creating its setup chain. Each successful
child creation contributes its acknowledged manifest and key record to the next
parent projection. This avoids fetching the same growing parent path again on
every level while retaining real SDK creation, API writes, crypto verification,
and acknowledgement. The root is fetched again before rotation, and repair and
subsequent reading still use independent cold SDK databases.

Two sequential before/after pairs on an otherwise quiet Darwin arm64 host,
Bun 1.4.2, reported these full-file elapsed times including setup:

| API backend | Before runs | After runs | Median reduction |
| --- | ---: | ---: | ---: |
| PGlite (`memory`) | 30.30 / 30.25 s | 28.51 / 28.09 s | 6.5% |
| SQLite | 25.81 / 25.71 s | 24.39 / 24.38 s | 5.3% |

These are Bun's reported elapsed times, not sums of case timings. The local
harness also records process wall time; the first SQLite wall receipt was lost,
so the table consistently uses Bun totals. Commands, each through the harness:

```sh
API_DATABASE=memory bun run agent:run --label ancestor-memory -- \
  bun test --cwd packages/api \
  ./src/routes/documents/automaticAncestorRepair.test.ts --max-concurrency=4
API_DATABASE=sqlite bun run agent:run --label ancestor-sqlite -- \
  bun test --cwd packages/api \
  ./src/routes/documents/automaticAncestorRepair.test.ts --max-concurrency=4
```

Every run passed the same five cases and 49 assertions. Owner, child-only,
deep-owner, interrupted-response, and blocked-sync behavior remain distinct.
The three deep cases still create 18 descendants and assert the 16-repair prefix
boundary, with the interrupted case checking its additional acknowledged repair.
No tests, assertions, backends, or depth boundaries were removed.

In an isolated scratch checkout, reducing the SDK's automatic repair batch from
16 to 15 made the deep-owner case fail at its existing inline-repair assertion:
three container IDs were received where two were expected. The scratch SDK was
rebuilt before running the API test, and its resolved dist path was verified.
Restoring the guard, rebuilding, and rerunning the case passed. No production
change is part of this optimization.

Remaining CI leads include the retained 4,098-entry API history test (77.47 s
PGlite / 83.80 s SQLite case time), container mutations (40.41 / 27.83 s across
39 cases), SDK repair limits (10.19 s across two cases), and SDK authority-page
budgeting (8.91 s). These case sums omit hooks and 13 PGlite, 11 SQLite, and
11 SDK cases with missing durations. Re-measure before another optimization;
the focused local improvement above is not a measured whole-CI speedup.

## Third pass: October 16, 2026

Baseline: `b31da8d3c1cb115e9d76c70f36c92df5e465eab6`, after PR #2551 merged.
Its [main CI run](https://github.com/a2f0/tearleads/actions/runs/38840939333)
executed API and app tests and replayed the SDK suite. Bun reported 1,325.97 s
for the app suite's 552 files, against 949.96 s (PGlite) and 754.75 s (SQLite)
for the concurrent API backends. The SDK's most recent fresh run took 859.88 s.
The app suite was the critical path in all three recent fresh runs (21-24 min),
so this pass worked on the app suite rather than API or SDK. The app suite runs
files serially (`--max-concurrency=1`), so its case sums approximate elapsed time.

| App test file | Cases | Case sum |
| --- | ---: | ---: |
| `DualPaneProvider.recoveredNoteBackspace.test.tsx` | 8 | 230.43 s |
| `DualPaneProvider.sharing.test.tsx` | 4 | 138.56 s |
| `DualPaneProvider.groups.test.tsx` | 8 | 121.31 s |
| `DualPaneProvider.miniAppWrites.test.tsx` | 2 | 84.65 s |
| `DualPaneProvider.currentPrincipalRecovery.test.tsx` | 2 | 78.56 s |
| `DualPaneProvider.attribution.test.tsx` | 1 | 47.77 s |

### Retained: recovered-note backspaces

The backspace file is CPU-bound (113.4 s wall, 125.2 s user CPU locally). Each
of its 51 sequential uploads spends about 106 ms (delayed sync) or 193 ms (live
sync, where the peer pulls concurrently) in client commit, upload, and API work.
A probe found that the upload helper returned within 1 ms of the server
recording the accepted update, so faster polling would not help. The 51-update
batch reproduces the regression fixed in PR #2259, and each cell of its
creator, editor, and sync-mode matrix drives a different UI or delivery path.
The file is unchanged. Its per-update client cost is a production-performance
lead, not a test-fixture problem.

### Retained optimization: roster-import settling

The attribution test's elapsed time was bimodal locally: about 13 s or 41 s,
with the same ~18 s of user CPU. Each slow run spent 30 s in
`importPeerIntoRoster`, which waited for the app runtime inside a single
`act(async ...)` scope and ignored the helper's timeout result. CI logged four
of these `App runtime settle timed out` diagnostics per run: three in
`DualPaneProvider.sharing.test.tsx` and one in the attribution test. Two other
diagnostics come from intentional short timeouts in
`organizationReadModelRealtime.idle.test.ts`.

Selecting the imported user starts a roster profile-document mutation. If that
mutation completes after the test's act scope opens, React holds the commit
that clears Org Manager's `mutating` state until the scope exits. Until that
commit, Org Manager keeps a self-originated organization hint deferred,
`organizationPending` stays true, and the wait runs to its 30 s timeout. A real
browser commits immediately; the delay came only from the test helper.

`settleAppTestRuntimeInAct` in `test/helpers/appRuntimeIdle.tsx` waits in act
scopes of at most 250 ms (or twice its combined sync and API quiet windows), so
React commits between them. It logs a timeout only for the final slice. `importPeerIntoRoster`
now uses it and asserts that the runtime settled, as `waitForPaneRuntimeToSettle`
already did. No production code, timeout bound, or test case changed.

The five files that import a roster peer (attribution, sharing, organization
name, active-peer request volume, and identity links) ran in one sequential
invocation through the output harness. Darwin arm64, Bun 1.4.2:

| Scope | Before runs | After runs | Median change |
| --- | ---: | ---: | ---: |
| 5 files, 8 tests | 124.90 / 125.55 / 154.37 s | 68.37 / 68.92 / 73.49 s | 45.1% less |

Before: 2, 2, and 3 settle timeouts. After: none. Every run passed all 8 tests.
Per case, attribution moved from 12.5 or 40.5 s to 12.4-13.5 s, and the sharing
cases that had taken 35-37 s now took 7.4-10.6 s.
The first baseline's log was overwritten by a later run; its receipt remains.

Negative controls in an isolated worktree:

- Restoring one act scope for the whole timeout made two of three attribution
  runs fail at the new `Roster import ... did not settle` assertion. The third
  run took the fast side of the race.
- Making `releaseDeferredOrganizationReadModelHint` a no-op failed three of
  three runs at the same assertion, with `organizationPending` true. With the
  original helpers, the same production bug was caught only by the next
  `waitForPaneRuntimeToSettle`, after 67 s and two silent timeouts.

This is a local measurement of the affected files. If CI reaches the same four
timeouts, about two minutes of the app job should disappear; verify this with a
fresh app test run before claiming it.

### Next leads

- `addPeerToAdminsGroup` (eight files) and `shareContainerWithGroup` also wait
  inside a single 30 s act scope and ignore the result. CI showed no timeouts
  for them, so switching them offers no measured gain yet; it would make a
  future stall fail where it occurs.
- Nineteen other call sites wrap `waitForAppTestRuntimeToSettle` in one act
  scope. A stall at any of them would show up as `App runtime settle timed out`
  in the app log.
- `bun test` ignores `--cpu-prof` in Bun 1.4.3 (rechecked with a bounded probe).
  Use `performance.now()` phase marks in an untracked probe copy of a test,
  and compare wall time with user
  CPU time to separate idle waits from compute.
- The API and SDK leads from the second pass were not re-measured here.

## Fourth pass: October 16, 2026

This pass followed up the third pass's leads, starting from
`fdf76713348b40e1198353f362dcd5a488ddc89f`.

### Flaky recovered-identity test

`DualPaneProvider.sameIdentity.test.tsx` failed the pre-push gate for PR #2553
at "a recovered peer shares a newly created local organization name and
preserves the You label (0ms responses)". It reported `Unable to find an
accessible element with the role "table" and name "Items in Contacts"`
immediately after a wait had seen that table. The file passed 5 isolated runs
and 42 runs under 4- or 10-way parallel load.

A probe copy, which waited 3 s before the follow-up query, reproduced the
failure in 7 of 11 runs. Logging the container list showed the cause.
When the recovered pane opened Contacts, Explorer still showed the device's own
Contacts. The tree then reloaded from empty, through a root-only list, to the
identity's Contacts. Emptying the tree cleared the selection, so the slot
follow added in #2435 had no vanished selection to match and fell back to the
root. Users of a recovered device viewing Contacts saw the same jump.

`useExplorerSelection` now remembers the slot of a vanished device-local
system container until exactly one node has it, then selects that node. An
ambiguous slot stops following, and any explicit selection cancels it. Three
hook tests cover a reload through empty and root-only lists, a selection made
mid-reload, and a synced container through a reload. With the previous hook,
the reload test ended on the remote root instead of the replacement Contacts.
The same probe with the fix ended all five runs on the identity's Contacts.

The reload can still remove the table briefly after the wait is satisfied.
`expectSingleYouContact` therefore reads the user-ID button in the snapshot
that satisfied the wait instead of querying the table again. The fixed file
passed 3 isolated runs and 12 runs under 4-way load.

A second failure mode, `Primary session did not materialize the new
organization profile name` (CI runs 38586581274 and 38567819572 on
2026-10-14), was not reproduced. Its CI DOM dumps are truncated before the
organization selector, and no failed CI run since then shows it.

### Sharing-kit settle sites

`addPeerToAdminsGroup` and `shareContainerWithGroup` now use
`settleAppTestRuntimeInAct` and assert the result, so a future stall fails at
the step that caused it. Their 10 caller files (21 tests) took 232.5 and
220.3 s before and 213.1 and 214.0 s after, with no settle timeouts in either.
The first baseline ran during other host load, and CI had logged no timeouts at
these sites, so this is not a claimed speedup.

### Request-metrics restore test

PR #2555's first CI run failed `SystemMonitorRequests.restore.test.tsx`, where
`inFlight` was 1 right after `waitForPaneRuntimeToSettle`. The settle point
tracks proxied traffic and quiet time, while the client counts a request from
dispatch until its response resolves. Explorer reads such as
`POST /containers/documents/query` and principal policy fetches could still be
counted in flight. Under 10-way parallel load, an untracked probe failed 2 of
40 runs on this branch and 3 of 40 with the previous Explorer selection hook,
so the flake predates this pass.

The test now waits until neither identity has a request in flight, and takes
the client totals and the proxied request count in that same snapshot before
asserting that they reconcile exactly. It passed 80 of 80 runs under the same
load.

## Fifth pass: API, October 17, 2026

The [API history report](test-optimization-api-history.md) records a small
fixture optimization: sign a single new principal version in-process instead of
starting workers. It preserves the longer-history worker path and all existing
assertions. The report includes paired timings on both backends, a negative
control, rejected experiments, and remaining ranked leads.
