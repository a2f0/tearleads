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

One run on an M2 Pro with Bun 1.4.2 and PostgreSQL 17.12, from `38e35e652`
plus this probe, against the 10,000-folder tree (`--fanout 10`) that the
[interest probe's run](2026-11-25-realtime-hub-interest.md) seeded. Hints were
published every 10 ms. Duration, CPU and Blocked are medians of three samples;
Longest lag and Peak heap are the worst sample. The unmarked declaration ran
once, first in the process, so its row is one pass.

| Folders | Sockets | Pass | Duration | CPU | Longest lag | Blocked | Peak heap |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| | | Idle hub | 1,000 ms | 45 ms | 11 ms | 0 ms | |
| 1,000 | 1 | Declaration | 164 ms | 159 ms | 58 ms | 46 ms | 45 MiB |
| 1,000 | 1 | Revalidation | 148 ms | 159 ms | 58 ms | 47 ms | 48 MiB |
| 1,000 | 2 | Declaration | 214 ms | 267 ms | 59 ms | 85 ms | 90 MiB |
| 1,000 | 2 | Revalidation | 221 ms | 256 ms | 57 ms | 88 ms | 87 MiB |
| 1,000 | 4 | Declaration | 412 ms | 520 ms | 110 ms | 199 ms | 138 MiB |
| 1,000 | 4 | Revalidation | 431 ms | 557 ms | 114 ms | 197 ms | 135 MiB |
| 10,000 | 1 | Declaration | 1,609 ms | 1,482 ms | 595 ms | 588 ms | 361 MiB |
| 10,000 | 1 | Revalidation | 1,556 ms | 1,483 ms | 599 ms | 595 ms | 353 MiB |
| 10,000 | 2 | Declaration | 2,645 ms | 2,875 ms | 903 ms | 1,299 ms | 521 MiB |
| 10,000 | 2 | Revalidation | 2,579 ms | 2,817 ms | 612 ms | 1,203 ms | 634 MiB |
| 10,000 | 4 | Declaration | 3,895 ms | 4,790 ms | 1,740 ms | 2,363 ms | 1,310 MiB |
| 10,000 | 4 | Revalidation | 4,068 ms | 5,039 ms | 1,725 ms | 2,418 ms | 1,372 MiB |
| 10,000 | 1 | Unmarked declaration | 78,210 ms | 74,940 ms | 27 ms | 19 ms | 264 MiB |

Every hint was delivered. Longest lag is the longest any one hint waited.
Blocked is lag above one interval, summed: the time hints spent queued
behind the hub. The report's percentiles count stalls rather than time, since
a stall delays one hint, so they are left out here.

- **A 10,000-folder pass stops the hub for about 0.6 s at a time.** Every
  marked declaration and revalidation at 10,000 folders on one socket delayed
  a hint by 575 to 600 ms, in one stretch: Blocked matches Longest lag. At
  1,000 folders the stretch was about 58 ms, so it grows with folder count.
  Every other socket on the hub waits that long for any event, every 2.5 to
  5 minutes for each open large socket.
- **Sockets do not share the work; their stalls queue.** Two and four sockets
  took 1.6 and 2.4 times as long as one and used 1.9 and 3.2 times the CPU.
  Each socket-pass blocked hints for about 0.6 s. With four sockets at
  10,000 folders, two of three samples kept one hint waiting 1.2 to 1.7 s,
  two or three stretches back to back.
- **Memory multiplies with sockets.** Peak heap rose by about 360 MiB,
  520 to 630 MiB, and 1.3 GiB for one, two and four sockets at 10,000
  folders. Each pass holds its own 125 MiB of rows and their parsed
  bundles.
- **A pass with no usable verification markers took 78 s.** The first
  declaration in the process found no marker it accepts, so it verified all
  10,000 manifests in full. It issued 10,029 statements, about one per folder,
  against 28 for a marked pass. It received 226 MiB, sent 17.5 MiB, and used
  75 s of CPU. That is past the 60 s production budget before adding
  production's round trips, about 5 ms each through Hyperdrive, or roughly
  50 s more here. The work came in small slices, so no hint waited more than
  27 ms. Two earlier runs, before review repairs to the probe, took 79 and
  81 s for the same pass. In production, markers are keyed by
  `DOCUMENT_SYNC_CURSOR_HMAC_KEY` and bound to the verification revisions in
  `verificationMarkers.ts`, so this cost returns after a secret rotation or a
  revision bump, until markers are recorded again.

This run cannot say which code forms the 0.6 s stretch. Profiling the hub's
authorization at 10,000 folders is the next step. It cannot say either whether
workerd's V8 would split it the same way. The interest probe's boundary
applies: JavaScriptCore, local PostgreSQL, and no Durable Object.
