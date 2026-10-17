# API test optimization: October 17, 2026

Initial clean checkout: `00efbc5914e9f4a0a5facf26705c0cf858601fd7`.
The [uncached baseline](https://github.com/a2f0/tearleads/actions/runs/39013756331)
at `5c916fd7ab53ece0fe692b4c9505b0560d4c8680` forced all suites to execute.
The API job took 20m26s, including about 29 seconds before test execution;
its concurrent PGlite and SQLite processes took 1,197.17 and 985.44 seconds.
App remained longest at 21m10s; this pass stayed within the requested API scope.

The largest API case sums were document history (95.02 / 104.10 seconds,
PGlite / SQLite), ancestor repair (47.69 / 41.48), and container mutations
(45.69 / 32.27). Ten passing cases per backend lacked parsed durations.
These sums omit hooks and are leads, not process elapsed time.

## Retained: single-version principal history setup

`test/helpers/longPrincipalHistory.ts` previously started up to four fresh
signing workers even for one successor, sending empty batches to the others.
It now signs that single successor in the existing process. Longer histories
retain the same worker path, including the opt-in 16,384-version regression.
Both paths call the same `signPrincipalState`; signing does not populate the
verification caches. No signed input, crypto parameter, storage step, or
verification assertion changed, and no mutable fixture state is reused.

The affected regular tests are `policyPages.test.ts` (a 65-version history
followed by version 66) and `policyStaleRepairRetry.test.ts` (group and
organization each advancing from version 1 to 2). They still check pinned
32-entry pages, corrupted live authorization, and a real SDK stale-create retry
with statuses `[409, 200]` and the updated policy version. Both tests retain
all 20 assertions; none were removed or consolidated.

Measurements used Bun 1.4.2 on `m2.local`, Darwin arm64. Other checkouts ran
heavy checks throughout; our before/after commands ran sequentially without
competing local builds. The isolated stale-retry file passed in every run:

| Backend | Before wall, seconds | After wall, seconds | Median change |
| --- | --- | --- | ---: |
| PGlite | 8.25 / 4.39 / 4.01 | 4.34 / 4.18 / 2.80 | 4.8% less |
| SQLite | 2.06 / 2.41 / 1.81 | 2.39 / 1.93 / 1.77 | 6.3% less |

Median user CPU was 5.42 → 5.32 seconds on PGlite and 2.92 → 2.32 on SQLite.
The two-file runs were noisier: PGlite 5.39 / 4.82 → 4.63 / 5.49 seconds;
SQLite 3.74 / 4.94 → 3.44 / 4.17. These are small local savings, with overlapping
ranges and host contention, not a demonstrated whole-API or CI speedup.
The existing non-browser SQLite OPFS initialization warnings appeared before
and after; no test failures or skips were introduced.

Commands used the root harness and retained the API preload:

```sh
API_DATABASE=memory bun run agent:run --label retry-memory -- \
  /usr/bin/time -p bun test --cwd packages/api \
  ./src/routes/principals/policyStaleRepairRetry.test.ts \
  --max-concurrency=4 --reporter=junit --reporter-outfile=<evidence-path>
```

Repeat with `API_DATABASE=sqlite`; the two-file comparison additionally passes
`./src/routes/principals/policyPages.test.ts`. Raw logs, JUnit reports, comparison
drivers, source variants, and CI rankings are under
`git rev-parse --git-path test-optimization` in `api-2026-10-17`.

A negative control in a private scratch checkout removed the live-head
verification in `readCurrentPrincipalPolicy.ts`. The retained pinned-page test
failed at its corruption assertion with HTTP 200 instead of 409. Restoring the
guard restored the pass. The production guard is unchanged on this branch.

Full API verification in pre-push executed both backends without cache replay:
PGlite passed 1,994 tests with 93 existing skips; SQLite passed 1,997 with 90
existing skips. Both ran 2,087 tests across 530 files, with zero failures.

## Rejected experiments and remaining leads

- One transaction for all 4,098 document-history setup writes increased the
  PGlite process wall time from 120.16 to 192.01 seconds and user CPU from
  121.21 to 137.48. Contention limits the comparison, but it gave no reason to
  retain the change. It was reverted before further measurements.
- In-process signing for up to 128 successors reduced user CPU in the four
  purge-history cases, but wall-time pairs disagreed on both backends. The
  final change applies only when there is no signing work to parallelize.
- Keep the 4,098-entry document and container histories: they cross the former
  4,096-entry limit. Signing their linked events remains expensive; neither
  this pass nor the first pass's bulk-storage experiment established a safe
  speedup there.
- Re-measure container mutations, ancestor repair, writer projections, and
  rotation-carried rekeys next. This pass inspected their costs but did not
  change their fixtures or coverage.

The skill now checks the scheduled uncached workflow before walking recent
main-branch runs that may only replay logs. It also refreshes installed
dependencies before builds: a stale installed Continuity Git dependency caused
an unrelated app seed test to fail despite a current lockfile. A frozen-lockfile
install updated only Continuity's app and app-web links, and the seed test passed
unchanged. API and SDK dependency links were unaffected.
