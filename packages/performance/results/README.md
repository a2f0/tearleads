# Performance results

Each file records one measured run: when it ran, from which source, on what
machine or tier, and what the numbers mean. The
[package README](../README.md) describes each experiment and how to repeat it.
Name a new file `<date>-<experiment>.md` and add it to the table, newest
first. Raw reports stay private under `.test_files/performance/`.

| Date | Experiment | Target |
| --- | --- | --- |
| 2026-11-25 | [Realtime hub contention](2026-11-25-realtime-hub-contention.md) | Local, M2 Pro |
| 2026-11-25 | [Realtime hub interest authorization](2026-11-25-realtime-hub-interest.md) | Local, M2 Pro |
| 2026-11-20 | [Continuity seed round trip](2026-11-20-continuity-seed-round-trip.md) | Production |
| 2026-10-26 | [Database round trip](2026-10-26-database-round-trip.md) | Staging and production |
| 2026-10-24 | [Account provisioning](2026-10-24-provisioning.md) | Staging and production |
