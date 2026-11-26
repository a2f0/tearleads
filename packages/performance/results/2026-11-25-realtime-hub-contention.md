# Realtime hub contention, 2026-11-25

The [realtime hub contention probe](../README.md#realtime-hub-contention)
measured, for [issue #3272](https://github.com/a2f0/tearleads/issues/3272),
how long other sockets' events wait while the hub authorizes large
declarations and revalidations, with one, two and four sockets running their
passes at once:

```sh
bun run perf:realtime-contention --sizes 1000,10000 --sockets 1,2,4 \
  --samples 3 --reuse
```

One run on an M2 Pro with Bun 1.4.2 and PostgreSQL 17.12, from `4afa359c8`
plus the probe, against the 10,000-folder tree (`--fanout 10`) that the
[interest probe's run](2026-11-25-realtime-hub-interest.md) seeded. Hints were
published every 10 ms. Durations, CPU and p99 lag are medians of three
samples; the longest lag and peak heap are the worst sample.

| Folders | Sockets | Pass | Duration | CPU | p99 lag | Longest lag | Blocked | Peak heap |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| | | Idle hub | 1,001 ms | 41 ms | 1.4 ms | 2.4 ms | 0 ms | |
| 1,000 | 1 | Declaration | 167 ms | 165 ms | 63 ms | 66 ms | 53 ms | 44 MiB |
| 1,000 | 1 | Revalidation | 178 ms | 178 ms | 62 ms | 63 ms | 52 ms | 48 MiB |
| 1,000 | 2 | Declaration | 290 ms | 326 ms | 68 ms | 73 ms | 107 ms | 91 MiB |
| 1,000 | 2 | Revalidation | 305 ms | 332 ms | 61 ms | 68 ms | 100 ms | 89 MiB |
| 1,000 | 4 | Declaration | 471 ms | 591 ms | 124 ms | 133 ms | 230 ms | 125 MiB |
| 1,000 | 4 | Revalidation | 461 ms | 577 ms | 128 ms | 191 ms | 229 ms | 127 MiB |
| 10,000 | 1 | Declaration | 1,744 ms | 1,562 ms | 18 ms | 743 ms | 644 ms | 373 MiB |
| 10,000 | 1 | Revalidation | 1,810 ms | 1,598 ms | 20 ms | 640 ms | 624 ms | 386 MiB |
| 10,000 | 2 | Declaration | 3,012 ms | 2,944 ms | 606 ms | 641 ms | 1,247 ms | 707 MiB |
| 10,000 | 2 | Revalidation | 3,118 ms | 2,993 ms | 592 ms | 684 ms | 1,324 ms | 659 MiB |
| 10,000 | 4 | Declaration | 4,529 ms | 5,406 ms | 611 ms | 1,791 ms | 2,486 ms | 1,316 MiB |
| 10,000 | 4 | Revalidation | 4,294 ms | 5,316 ms | 647 ms | 1,207 ms | 2,553 ms | 1,105 MiB |
| 10,000 | 1 | Unmarked declaration | 78,886 ms | 76,214 ms | 4 ms | 25 ms | 15 ms | 232 MiB |

Every hint was delivered. Blocked is lag above one interval, summed: the time
hints spent queued behind the hub.

- **A 10,000-folder pass stops the hub for about 0.65 s at a time.** Each
  marked declaration or revalidation at 10,000 folders delayed a hint by
  607 to 743 ms, in one stretch. At 1,000 folders the stretch was about
  60 ms, so it grows with folder count. Every other socket on the hub waits
  that long for any event, every 2.5 to 5 minutes per open large socket.
- **Sockets do not share the work; their stalls queue.** Two and four sockets
  took 1.7 and 2.6 times as long as one, used 1.9 and 3.5 times the CPU, and
  blocked hints for about 0.63 s per socket-pass. With four sockets at
  10,000 folders the longest wait was 1.2 to 1.8 s, two stretches back to
  back.
- **Memory multiplies with sockets.** Peak heap rose by 373, 707 and
  1,316 MiB for one, two and four sockets at 10,000 folders. Each pass holds
  its own 125 MiB of rows and their parsed bundles.
- **A pass with no usable verification markers took 79 s.** The first
  declaration in the process found no marker it accepts, so it verified all
  10,000 manifests in full. It issued 10,029 statements, about one per
  folder, against 28 for a marked pass. An earlier run, where this pass came
  first by accident, took 81 s. It received 226 MiB, sent
  17.5 MiB, and used 76 s of CPU. That is past the 60 s production budget
  before adding production's round trips, about 5 ms each through
  Hyperdrive, or roughly 50 s more here. The work came in small slices, so no
  hint waited more than 25 ms. In production, markers are keyed by
  `DOCUMENT_SYNC_CURSOR_HMAC_KEY` and bound to the verification revisions in
  `verificationMarkers.ts`, so this cost returns after a secret rotation or a
  revision bump, until markers are recorded again.

This run cannot say which code forms the 0.65 s stretch. Profiling the hub's
authorization at 10,000 folders is the next step. It cannot say either whether
workerd's V8 would split it the same way. The interest probe's boundary
applies: JavaScriptCore, local PostgreSQL, and no Durable Object.
