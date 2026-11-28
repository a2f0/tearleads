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

## Epoch 2 Scorecard (`000-baseline` -> `005-wire-compactness`)

Baseline `53819b364` -> Latest `fa756b995` (6 checkpoints recorded).

| Dimension | Metric | Baseline | Latest | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | — | — | n/a |
| Schema | API Postgres indexes | 183 indexes | — | — | n/a |
| Schema | API duplicate indexes | 0 indexes | — | — | n/a |
| Schema | Client SQLite tables | 63 tables | — | — | n/a |
| Schema | Unread 2xx OpenAPI fields | 3 fields | — | — | n/a |
| Schema | Drifted canary ceilings | 14 phases | — | — | n/a |
| Wire | Canary requests | 340 reqs | 244 reqs | -96 (-28.2%) | improved |
| Wire | Canary request bytes | 1,609,389 B | 1,607,684 B | -1,705 (-0.1%) | unchanged |
| Wire | Canary response bytes | 1,492,860 B | 1,256,123 B | -236,737 (-15.9%) | improved |
| Wire | Canary redundant response bytes | 198,160 B | 108,992 B | -89,168 (-45%) | improved |
| Wire | Exact-head policy re-reads | 42 reads | 6 reads | -36 (-85.7%) | improved |
| API DB | Canary API SQL statements | 36,878 stmts | 30,958 stmts | -5,920 (-16.1%) | improved |
| API DB | Canary API in-tx statements | 30,788 stmts | 25,919 stmts | -4,869 (-15.8%) | improved |
| API DB | Canary API lock-hold statements | 22,227 stmts | 18,671 stmts | -3,556 (-16%) | improved |
| API DB | Canary API pure read repeats | 4,744 repeats | 1,680 repeats | -3,064 (-64.6%) | improved |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 122,113 stmts | -9,412 (-7.2%) | improved |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 29,796 stmts | -2,650 (-8.2%) | improved |
| Client SQLite | Canary SQLite total duration | 13,058.2 ms | 12,477.2 ms | -581 (-4.4%) | unchanged |
| Client SQLite | Canary SQLite max lock hold | 49.4 ms | 55.1 ms | +5.7 (+11.5%) | REGRESSED |
| Plans | Postgres generic Seq Scans | 0 queries | — | — | n/a |
| Plans | Postgres generic Sort plans | 3 queries | — | — | n/a |
| Plans | Postgres generic Materialize plans | 1 queries | — | — | n/a |
| Scenarios | Bob-and-Alice HTTP requests | 4,975 reqs | — | — | n/a |
| Scenarios | Bob-and-Alice API statements | 122,420 stmts | — | — | n/a |
| Scenarios | Bob-and-Alice pure read repeats | 14,321 repeats | — | — | n/a |
| Scenarios | Bob-and-Alice client SQLite | 486,496 stmts | — | — | n/a |
| Reload | Settled reload requests (shared max tier) | 4 reqs | — | — | n/a |
| Reload | Settled reload API statements | 62 stmts | — | — | n/a |
| Reload | Settled reload client SQLite | 481 stmts | — | — | n/a |
| Realtime | Realtime hub auth statements | 9 stmts | — | — | n/a |
| Realtime | Realtime hub auth PG bytes | 1,383,651 B | — | — | n/a |
| Rotations | Rotation group-shrink PG statements | 623 stmts | — | — | n/a |
| Baselines | Baseline first-unlink PG statements | 102 stmts | — | — | n/a |

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Main baseline (53819b364) | Epoch baseline |
| `001-server-counts-parent-lanes` | checkpoint | `d7e01be58` | — | #3342 | Server update counts & parent-lane batch (#3342) | 12 improved, 2 regressed, 8 tradeoffs |
| `002-realtime-subtree-interest` | checkpoint | `0aa3ec975` | — | #3353 | Subtree-root realtime interest & hub caps (#3353) | 10 improved, 0 regressed, 0 tradeoffs |
| `003-loro-stale-recreation-rebase` | checkpoint | `d74895157` | — | #3263 | Preserved peer ownership, owner allow-restore, pull-only park, multi-segment recovery, causal closure (#3263) | 0 improved, 7 regressed, 0 tradeoffs |
| `004-api-repeats-plans` | checkpoint | `da79619ff` | — | #3396 | PR #7 (#3396 Leads 1 & 4): API tx memo and PG plans | 7 improved, 2 regressed, 3 tradeoffs |
| `005-wire-compactness` | checkpoint | `fa756b995` | — | #3396 | PR #8 (#3396 Lead 2): wire compactness, authored KEK citations, held history & policy warmers | 10 improved, 0 regressed, 0 tradeoffs |
