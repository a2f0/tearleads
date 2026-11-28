# Performance results

Structured longitudinal performance ledger for Tearleads (**Epoch 2**).
Previous ad-hoc Epoch 1 markdown reports were pruned when Epoch 2 began so every
checkpoint is machine-readable JSON with automated improvement, regression, and
cross-dimension tradeoff analysis.

- Manifest: [epoch-2/manifest.json](epoch-2/manifest.json)
- Full trend & tradeoff report: [epoch-2/TRENDS.md](epoch-2/TRENDS.md)
- Raw captures remain private under `.test_files/performance/`.

## Commands

```sh
bun run perf:epoch record --id <seq-slug> --label '<description>' \
  --canaries .test_files/performance/canaries-<id>.json \
  --inventory .test_files/performance/inventory-<ts>.json \
  --plans .test_files/performance/plans-<id>.json \
  --scenarios .test_files/performance/scenarios-<id>.json
bun run perf:epoch analyze --from 000-baseline --to <latest-id>
bun run perf:epoch render
```

## Epoch 2 Scorecard (`000-baseline` -> `001-server-counts-parent-lanes`)

Baseline `53819b364` -> Latest `d7e01be58` (2 checkpoints recorded).

| Dimension | Metric | Baseline | Latest | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | 57 tables | 0 | unchanged |
| Schema | API Postgres indexes | 183 indexes | 183 indexes | 0 | unchanged |
| Schema | API duplicate indexes | 0 indexes | 0 indexes | 0 | unchanged |
| Schema | Client SQLite tables | 63 tables | 63 tables | 0 | unchanged |
| Schema | Unread 2xx OpenAPI fields | 3 fields | 3 fields | 0 | unchanged |
| Schema | Drifted canary ceilings | 14 phases | 19 phases | +5 (+35.7%) | REGRESSED |
| Wire | Canary requests | 340 reqs | 314 reqs | -26 (-7.6%) | improved |
| Wire | Canary request bytes | 1,609,389 B | 1,609,605 B | +216 (+0%) | unchanged |
| Wire | Canary response bytes | 1,492,860 B | 1,414,538 B | -78,322 (-5.2%) | improved |
| Wire | Canary redundant response bytes | 198,160 B | 190,224 B | -7,936 (-4%) | improved |
| Wire | Exact-head policy re-reads | 42 reads | 39 reads | -3 (-7.1%) | improved |
| API DB | Canary API SQL statements | 36,878 stmts | 36,268 stmts | -610 (-1.7%) | improved |
| API DB | Canary API in-tx statements | 30,788 stmts | 31,281 stmts | +493 (+1.6%) | REGRESSED |
| API DB | Canary API lock-hold statements | 22,227 stmts | 21,998 stmts | -229 (-1%) | improved |
| API DB | Canary API pure read repeats | 4,744 repeats | 4,704 repeats | -40 (-0.8%) | improved |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 125,471 stmts | -6,054 (-4.6%) | improved |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 30,664 stmts | -1,782 (-5.5%) | improved |
| Client SQLite | Canary SQLite total duration | 13,058.2 ms | 12,716.1 ms | -342.1 (-2.6%) | unchanged |
| Client SQLite | Canary SQLite max lock hold | 49.4 ms | 49.5 ms | +0.1 (+0.2%) | unchanged |
| Plans | Postgres generic Seq Scans | 0 queries | 0 queries | 0 | unchanged |
| Plans | Postgres generic Sort plans | 3 queries | 3 queries | 0 | unchanged |
| Plans | Postgres generic Materialize plans | 1 queries | 1 queries | 0 | unchanged |
| Scenarios | Bob-and-Alice HTTP requests | 4,975 reqs | — | — | n/a |
| Scenarios | Bob-and-Alice API statements | 122,420 stmts | — | — | n/a |
| Scenarios | Bob-and-Alice pure read repeats | 14,321 repeats | — | — | n/a |
| Scenarios | Bob-and-Alice client SQLite | 486,496 stmts | — | — | n/a |
| Reload | Settled reload requests (shared max tier) | 4 reqs | 1 reqs | -3 (-75%) | improved |
| Reload | Settled reload API statements | 62 stmts | 26 stmts | -36 (-58.1%) | improved |
| Reload | Settled reload client SQLite | 481 stmts | 145 stmts | -336 (-69.9%) | improved |
| Realtime | Realtime hub auth statements | 9 stmts | — | — | n/a |
| Realtime | Realtime hub auth PG bytes | 1,383,651 B | — | — | n/a |
| Rotations | Rotation group-shrink PG statements | 623 stmts | — | — | n/a |
| Baselines | Baseline first-unlink PG statements | 102 stmts | — | — | n/a |

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Main baseline (53819b364) | Epoch baseline |
| `001-server-counts-parent-lanes` | checkpoint | `d7e01be58` | — | #3342 | Server update counts & parent-lane batch (#3342) | 12 improved, 2 regressed, 8 tradeoffs |
