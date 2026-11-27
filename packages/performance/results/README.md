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

## Epoch 2 Scorecard (`000-baseline` -> `000-baseline`)

Baseline `53819b364` -> Latest `53819b364` (1 checkpoint recorded).

| Dimension | Metric | Baseline | Latest | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | 57 tables | — | baseline |
| Schema | API Postgres indexes | 183 indexes | 183 indexes | — | baseline |
| Schema | API duplicate indexes | 0 indexes | 0 indexes | — | baseline |
| Schema | Client SQLite tables | 63 tables | 63 tables | — | baseline |
| Schema | Unread 2xx OpenAPI fields | 3 fields | 3 fields | — | baseline |
| Schema | Drifted canary ceilings | 14 phases | 14 phases | — | baseline |
| Wire | Canary requests | 340 reqs | 340 reqs | — | baseline |
| Wire | Canary request bytes | 1,609,389 B | 1,609,389 B | — | baseline |
| Wire | Canary response bytes | 1,492,860 B | 1,492,860 B | — | baseline |
| Wire | Canary redundant response bytes | 198,160 B | 198,160 B | — | baseline |
| Wire | Exact-head policy re-reads | 42 reads | 42 reads | — | baseline |
| API DB | Canary API SQL statements | 36,878 stmts | 36,878 stmts | — | baseline |
| API DB | Canary API in-tx statements | 30,788 stmts | 30,788 stmts | — | baseline |
| API DB | Canary API lock-hold statements | 22,227 stmts | 22,227 stmts | — | baseline |
| API DB | Canary API pure read repeats | 4,744 repeats | 4,744 repeats | — | baseline |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 131,525 stmts | — | baseline |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 32,446 stmts | — | baseline |
| Client SQLite | Canary SQLite total duration | 13,058.2 ms | 13,058.2 ms | — | baseline |
| Client SQLite | Canary SQLite max lock hold | 49.4 ms | 49.4 ms | — | baseline |
| Plans | Postgres generic Seq Scans | 0 queries | 0 queries | — | baseline |
| Plans | Postgres generic Sort plans | 3 queries | 3 queries | — | baseline |
| Plans | Postgres generic Materialize plans | 1 queries | 1 queries | — | baseline |
| Scenarios | Bob-and-Alice HTTP requests | 4,975 reqs | 4,975 reqs | — | baseline |
| Scenarios | Bob-and-Alice API statements | 122,420 stmts | 122,420 stmts | — | baseline |
| Scenarios | Bob-and-Alice pure read repeats | 14,321 repeats | 14,321 repeats | — | baseline |
| Scenarios | Bob-and-Alice client SQLite | 486,496 stmts | 486,496 stmts | — | baseline |
| Reload | Settled reload requests (max tier) | 4 reqs | 4 reqs | — | baseline |
| Reload | Settled reload API statements | 62 stmts | 62 stmts | — | baseline |
| Reload | Settled reload client SQLite | 481 stmts | 481 stmts | — | baseline |
| Realtime | Realtime hub auth statements | 9 stmts | 9 stmts | — | baseline |
| Realtime | Realtime hub auth PG bytes | 1,383,651 B | 1,383,651 B | — | baseline |

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Clean main baseline (53819b364) | Epoch baseline |
