# Performance results

Historical performance reports and compactness baselines for Tearleads. Each
report records when it ran, the exact revision, the host or deployed tier, and
what the measurements mean. See the [package README](../README.md) and
[plans-and-inventory.md](../plans-and-inventory.md) to repeat any experiment.
Raw JSON and JSONL captures stay private under `.test_files/performance/`.

## Latest compactness scorecard

From [2026-11-27 combined baseline](baselines/2026-11-27-combined-baseline.md)
(`dd507ff3b`, Apple M2 Pro, Bun 1.4.3):

| Dimension | Measured |
| --- | ---: |
| API Postgres tables / columns / indexes | 57 / 572 / 183 (0 duplicate indexes) |
| Client SQLite tables / columns / indexes | 62 / 468 / 97 (0 duplicate indexes) |
| OpenAPI operations / 2xx fields / unreferenced leads | 99 / 405 / 6 |
| Canary requests / wire bytes (req / res) | 340 / 1.61 MB / 1.49 MB |
| Redundant response bytes (echo + redelivery + re-download) | 198,160 B (13.3%) |
| API statements (total / in-tx / lock-hold / pure repeats) | 36,917 / 30,818 / 22,243 / 4,264 |
| Client SQLite statements / max mutation-lock hold | 131,503 / 61.8 ms |
| Postgres generic-plan warnings (top 25 `SELECT`s) | 0 Seq Scan, 3 Sort/Materialize |

## Report layout

Reports are organized by experiment family so historical runs remain easy to
browse and compare over time:

- [`baselines/`](baselines/2026-11-27-combined-baseline.md) — Combined
  protocol + database compactness baselines and request-volume / statement
  canary snapshots.
- [`reload/`](reload/2026-11-26-document-reload.md) — Returning-client document
  reload scaling runs (`perf:reload`).
- [`realtime/`](realtime/2026-11-25-realtime-hub-interest.md) — Realtime hub
  interest authorization (`perf:realtime`) and contention
  (`perf:realtime-contention`) runs.
- [`deployed/`](deployed/2026-11-20-continuity-seed-round-trip.md) — Staging
  and production runs (`perf:seed`, `perf:database`, `perf:provision`).

When recording a new run, add `<category>/<YYYY-MM-DD>-<experiment>.md`, insert
it at the top of its category table below, and refresh the scorecard above for
new combined baselines.

## Archive

### Baselines

| Date | Revision | Report | Target |
| --- | --- | --- | --- |
| 2026-11-27 | `dd507ff3b` | [Combined protocol and database baseline](baselines/2026-11-27-combined-baseline.md) | Local, M2 Pro |
| 2026-11-26 | `c78d5c40d` | [Canary statement capture](baselines/2026-11-26-canary-statements.md) | Local, M2 Pro |
| 2026-11-26 | `1844df270` | [Request-volume canaries](baselines/2026-11-26-request-volume-canaries.md) | Local, M2 Pro |

### Reload at scale

| Date | Revision | Report | Target |
| --- | --- | --- | --- |
| 2026-11-26 | `cc3de1404` | [Document reload](reload/2026-11-26-document-reload.md) | Local, M2 Pro |

### Realtime hub

| Date | Revision | Report | Target |
| --- | --- | --- | --- |
| 2026-11-25 | — | [Realtime hub contention](realtime/2026-11-25-realtime-hub-contention.md) | Local, M2 Pro |
| 2026-11-25 | — | [Realtime hub interest authorization](realtime/2026-11-25-realtime-hub-interest.md) | Local, M2 Pro |

### Deployed tiers

| Date | Revision | Report | Target |
| --- | --- | --- | --- |
| 2026-11-20 | — | [Continuity seed round trip](deployed/2026-11-20-continuity-seed-round-trip.md) | Production |
| 2026-10-26 | — | [Database round trip](deployed/2026-10-26-database-round-trip.md) | Staging and production |
| 2026-10-24 | — | [Account provisioning](deployed/2026-10-24-provisioning.md) | Staging and production |
