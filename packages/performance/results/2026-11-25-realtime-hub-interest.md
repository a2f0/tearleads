# Realtime hub interest authorization, 2026-11-25

The [realtime hub interest probe](../README.md#realtime-hub-interest-authorization)
measured one socket's declaration and revalidation passes for
[issue #3272](https://github.com/a2f0/tearleads/issues/3272), with
`bun run perf:realtime --sizes 100,1000,10000 --samples 3`.

One run on an M2 Pro with Bun 1.4.2 and PostgreSQL 17.12 measured three
samples per size, with `--fanout 10`, from `6bd2c5c17` plus the probe
([#3295](https://github.com/a2f0/tearleads/pull/3295)). CPU
and duration are medians; peak heap is the largest sample. The first
100-folder declaration took 115 ms of CPU before the code was warm, which
leaves its median unaffected.

| Folders | Pass | Statements | Rows | Returned | CPU | Duration | Peak heap | Snapshot |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | Declaration | 9 | 113 | 1.3 MiB | 20 ms | 41 ms | not sampled | |
| 100 | Revalidation | 9 | 113 | 1.3 MiB | 20 ms | 30 ms | not sampled | 26 KB, 2 chunks |
| 1,000 | Declaration | 10 | 1,013 | 12.5 MiB | 155 ms | 170 ms | 18 MiB | |
| 1,000 | Revalidation | 10 | 1,013 | 12.5 MiB | 145 ms | 175 ms | 43 MiB | 300 KB, 19 chunks |
| 10,000 | Declaration | 28 | 10,013 | 124.8 MiB | 1,489 ms | 2,475 ms | 397 MiB | |
| 10,000 | Revalidation | 28 | 10,013 | 124.8 MiB | 1,502 ms | 1,422 ms | 411 MiB | 3.4 MB, 208 chunks |

Every statement was its own round trip. The 100-folder heap peaks fell
between samples.

- **Statements are not the cost.** The batched path read grows from 9 to 28
  statements across a hundredfold increase in folders. In production, 28
  exchanges at about 5 ms each add roughly 0.15 s.
- **Bytes and CPU grow with every folder.** Each folder returns about 13 KB of
  manifest bundles and costs about 0.15 ms of CPU. At 10,000 folders that is
  125 MiB from PostgreSQL and 1.5 s of CPU on the hub's single thread.
- **Revalidation costs as much as connecting.** A revalidation pass repeats
  the whole declaration's reads and checks, every 2.5 to 5 minutes, for each
  open socket.
- **Memory, not the deadline, looks like the limit at 10,000.** The local
  passes finished in 1.3 to 6.1 s, far inside the 60 s budget, even after
  adding production's round trips. But the rows alone are 125 MiB, and Bun's
  heap rose 325 to 411 MiB during the pass. A Workers isolate, which hosts the
  hub, is limited to 128 MB. JavaScriptCore and V8 count memory differently,
  so this does not prove the hub fails at 10,000 folders. It does make memory
  the likeliest failure, ahead of the deadline.
- **The snapshot is larger than the issue's estimate.** It is 3.4 MB in 208
  chunks at 10,000 folders, against an estimated 2 MB.

Durations at 10,000 folders varied from 1.3 to 6.1 s while CPU stayed between
1.4 and 1.9 s. The rest was waiting outside the process, mostly on PostgreSQL.
