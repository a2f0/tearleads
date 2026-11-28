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

## Epoch 2 Scorecard (`000-baseline` -> `002-realtime-subtree-interest`)

Baseline `53819b364` -> Latest `0aa3ec975` (3 checkpoints recorded).

| Dimension | Metric | Baseline | Latest | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | 57 tables | 0 | unchanged |
| Schema | API Postgres indexes | 183 indexes | 183 indexes | 0 | unchanged |
| Schema | API duplicate indexes | 0 indexes | 0 indexes | 0 | unchanged |
| Schema | Client SQLite tables | 63 tables | 63 tables | 0 | unchanged |
| Schema | Unread 2xx OpenAPI fields | 3 fields | 3 fields | 0 | unchanged |
| Schema | Drifted canary ceilings | 14 phases | 19 phases | +5 (+35.7%) | REGRESSED |
| Wire | Canary requests | 340 reqs | 306 reqs | -34 (-10%) | improved |
| Wire | Canary request bytes | 1,609,389 B | 1,607,684 B | -1,705 (-0.1%) | unchanged |
| Wire | Canary response bytes | 1,492,860 B | 1,398,775 B | -94,085 (-6.3%) | improved |
| Wire | Canary redundant response bytes | 198,160 B | 188,401 B | -9,759 (-4.9%) | improved |
| Wire | Exact-head policy re-reads | 42 reads | 37 reads | -5 (-11.9%) | improved |
| API DB | Canary API SQL statements | 36,878 stmts | 36,065 stmts | -813 (-2.2%) | improved |
| API DB | Canary API in-tx statements | 30,788 stmts | 31,134 stmts | +346 (+1.1%) | REGRESSED |
| API DB | Canary API lock-hold statements | 22,227 stmts | 21,966 stmts | -261 (-1.2%) | improved |
| API DB | Canary API pure read repeats | 4,744 repeats | 4,694 repeats | -50 (-1.1%) | improved |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 124,712 stmts | -6,813 (-5.2%) | improved |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 30,516 stmts | -1,930 (-5.9%) | improved |
| Client SQLite | Canary SQLite total duration | 13,058.2 ms | 12,725.4 ms | -332.8 (-2.5%) | unchanged |
| Client SQLite | Canary SQLite max lock hold | 49.4 ms | 45 ms | -4.4 (-8.9%) | unchanged |
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
| Realtime | Realtime hub auth statements | 9 stmts | 10 stmts | +1 (+11.1%) | REGRESSED |
| Realtime | Realtime hub auth PG bytes | 1,383,651 B | 115,391 B | -1,268,260 (-91.7%) | improved |
| Rotations | Rotation group-shrink PG statements | 623 stmts | — | — | n/a |
| Baselines | Baseline first-unlink PG statements | 102 stmts | — | — | n/a |

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Main baseline (53819b364) | Epoch baseline |
| `001-server-counts-parent-lanes` | checkpoint | `d7e01be58` | — | #3342 | Server update counts & parent-lane batch (#3342) | 12 improved, 2 regressed, 8 tradeoffs |
| `002-realtime-subtree-interest` | checkpoint | `0aa3ec975` | — | #3353 | Subtree-root realtime interest & hub caps (#3353) | 10 improved, 0 regressed, 0 tradeoffs |
