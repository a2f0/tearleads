# Performance Epoch 2: Greenfield Protocol, Database & Realtime Optimization Pass

Structured longitudinal performance snapshots capturing schema, wire, API DB,
client SQLite, query plan, multi-party scenario, and scaling probe metrics
across greenfield optimization PRs. Started 2026-11-27T22:34:02.103Z.

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Main baseline (53819b364) | Epoch baseline |
| `001-server-counts-parent-lanes` | checkpoint | `d7e01be58` | — | #3342 | Server update counts & parent-lane batch (#3342) | 12 improved, 2 regressed, 8 tradeoffs |
| `002-realtime-subtree-interest` | checkpoint | `0aa3ec975` | — | #3353 | Subtree-root realtime interest & hub caps (#3353) | 10 improved, 0 regressed, 0 tradeoffs |

## Cumulative Scorecard (`000-baseline` -> `002-realtime-subtree-interest`)

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

## Step-by-Step Deltas & Tradeoffs

### `000-baseline` -> `001-server-counts-parent-lanes`

Server update counts & parent-lane batch (#3342). Revisions: `53819b364` ->
`d7e01be58`. Improved: **12**, Regressed: **2**, Tradeoffs: **8**.

Notes: Trigger-maintained documents.update_count +
attribution_revision/updated_at; roster-profile container suppression;
verified idsOnly root-membership parent-lane batch inside repeatable-read
snapshot.

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | Drifted canary ceilings | 14 phases | 19 phases | +5 (+35.7%) | REGRESSED |
| Wire | Canary requests | 340 reqs | 314 reqs | -26 (-7.6%) | improved |
| Wire | Canary response bytes | 1,492,860 B | 1,414,538 B | -78,322 (-5.2%) | improved |
| Wire | Canary redundant response bytes | 198,160 B | 190,224 B | -7,936 (-4%) | improved |
| Wire | Exact-head policy re-reads | 42 reads | 39 reads | -3 (-7.1%) | improved |
| API DB | Canary API SQL statements | 36,878 stmts | 36,268 stmts | -610 (-1.7%) | improved |
| API DB | Canary API in-tx statements | 30,788 stmts | 31,281 stmts | +493 (+1.6%) | REGRESSED |
| API DB | Canary API lock-hold statements | 22,227 stmts | 21,998 stmts | -229 (-1%) | improved |
| API DB | Canary API pure read repeats | 4,744 repeats | 4,704 repeats | -40 (-0.8%) | improved |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 125,471 stmts | -6,054 (-4.6%) | improved |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 30,664 stmts | -1,782 (-5.5%) | improved |
| Reload | Settled reload requests (shared max tier) | 4 reqs | 1 reqs | -3 (-75%) | improved |
| Reload | Settled reload API statements | 62 stmts | 26 stmts | -36 (-58.1%) | improved |
| Reload | Settled reload client SQLite | 481 stmts | 145 stmts | -336 (-69.9%) | improved |

**Tradeoffs:**

- **Wire** (Canary requests: -26 reqs (-7.6%); Canary response bytes: -78322 B
  (-5.2%); Canary redundant response bytes: -7936 B (-4%)) vs **Schema**
  (Drifted canary ceilings: +5 phases (+35.7%))
- **Wire** (Canary requests: -26 reqs (-7.6%); Canary response bytes: -78322 B
  (-5.2%); Canary redundant response bytes: -7936 B (-4%)) vs **API DB**
  (Canary API in-tx statements: +493 stmts (+1.6%))
- **API DB** (Canary API SQL statements: -610 stmts (-1.7%); Canary API
  lock-hold statements: -229 stmts (-1%); Canary API pure read repeats: -40
  repeats (-0.8%)) vs **Schema** (Drifted canary ceilings: +5 phases (+35.7%))
- **API DB** (Canary API SQL statements: -610 stmts (-1.7%); Canary API
  lock-hold statements: -229 stmts (-1%); Canary API pure read repeats: -40
  repeats (-0.8%)) vs **API DB** (Canary API in-tx statements: +493 stmts
  (+1.6%))
- **Client SQLite** (Canary client SQLite statements: -6054 stmts (-4.6%);
  Canary SQLite tx controls: -1782 stmts (-5.5%)) vs **Schema** (Drifted
  canary ceilings: +5 phases (+35.7%))
- **Client SQLite** (Canary client SQLite statements: -6054 stmts (-4.6%);
  Canary SQLite tx controls: -1782 stmts (-5.5%)) vs **API DB** (Canary API
  in-tx statements: +493 stmts (+1.6%))
- **Reload** (Settled reload requests (shared max tier): -3 reqs (-75%);
  Settled reload API statements: -36 stmts (-58.1%); Settled reload client
  SQLite: -336 stmts (-69.9%)) vs **Schema** (Drifted canary ceilings: +5
  phases (+35.7%))
- **Reload** (Settled reload requests (shared max tier): -3 reqs (-75%);
  Settled reload API statements: -36 stmts (-58.1%); Settled reload client
  SQLite: -336 stmts (-69.9%)) vs **API DB** (Canary API in-tx statements:
  +493 stmts (+1.6%))

### `001-server-counts-parent-lanes` -> `002-realtime-subtree-interest`

Subtree-root realtime interest & hub caps (#3353). Revisions: `d7e01be58` ->
`0aa3ec975`. Improved: **10**, Regressed: **0**, Tradeoffs: **0**.

Notes: Declares only subtree roots (top-level roots + directly granted nested
folders persisted via root_lane_member v18 migration) with hub
subtree-coverage routing, 256-root declaration/installed cap, 512 pending id
cap, flat 10s deadline, repeatable-read 1,024 path-container depth budget
scoped via discoveryGrantSubjects/containerHasDiscoveryAccess, and marker
write-back. 100x1000-folder simultaneous reconnect contention: 318-323ms
total, p99 hint lag 1.7-2.6ms, 18-21 MiB peak heap.

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Wire | Canary requests | 314 reqs | 306 reqs | -8 (-2.5%) | improved |
| Wire | Canary response bytes | 1,414,538 B | 1,398,775 B | -15,763 (-1.1%) | improved |
| Wire | Canary redundant response bytes | 190,224 B | 188,401 B | -1,823 (-1%) | improved |
| Wire | Exact-head policy re-reads | 39 reads | 37 reads | -2 (-5.1%) | improved |
| API DB | Canary API SQL statements | 36,268 stmts | 36,065 stmts | -203 (-0.6%) | improved |
| API DB | Canary API in-tx statements | 31,281 stmts | 31,134 stmts | -147 (-0.5%) | improved |
| API DB | Canary API lock-hold statements | 21,998 stmts | 21,966 stmts | -32 (-0.1%) | improved |
| API DB | Canary API pure read repeats | 4,704 repeats | 4,694 repeats | -10 (-0.2%) | improved |
| Client SQLite | Canary client SQLite statements | 125,471 stmts | 124,712 stmts | -759 (-0.6%) | improved |
| Client SQLite | Canary SQLite tx controls | 30,664 stmts | 30,516 stmts | -148 (-0.5%) | improved |

## Latest Per-Canary Breakdown

| Canary | Reqs | Req B | Res B | Redundant B | Head Re-reads | API Stmts | Pure Repeats | Client SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `DeviceFirstOfflineRequestVolume` | 0 | 0 | 0 | 0 | 0 | 1,543 | 177 | 5,215 |
| `DualPaneProvider.groupsRequestVolume` | 90 | 681,592 | 544,052 | 63,666 | 12 | 2,830 | 334 | 9,009 |
| `DualPaneProvider.sharing` | 46 | 104,424 | 337,321 | 42,247 | 5 | 11,086 | 1,365 | 37,531 |
| `ExplorerUploadRequestVolume` | 5 | 34,558 | 2,176 | 384 | 0 | 1,153 | 150 | 2,519 |
| `FolderMutationRequestVolume` | 26 | 114,602 | 62,707 | 16,942 | 8 | 1,771 | 198 | 7,498 |
| `GroupMutationRequestVolume` | 42 | 165,104 | 275,866 | 53,672 | 4 | 2,839 | 340 | 9,479 |
| `OrganizationBootstrapRequestVolume` | 27 | 486,205 | 40,168 | 5,651 | 3 | 2,244 | 326 | 4,574 |
| `PaneReconnectRequestVolume` | 24 | 5,127 | 71,816 | 3,290 | 3 | 3,513 | 439 | 14,140 |
| `PaneRestartRequestVolume` | 46 | 16,072 | 64,669 | 2,549 | 2 | 9,086 | 1,365 | 34,747 |

## Latest Reload Scaling

| Docs | Folders | Reload | Reqs | Settled ms | API Stmts | Client SQL |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 10 | 1 | first | 4 | 177 | 40 | 455 |
| 10 | 1 | settled | 1 | 131 | 17 | 91 |
| 13 | 1 | peer-edited | 11 | 554 | 200 | 1,366 |
| 100 | 10 | first | 4 | 530 | 65 | 2,648 |
| 100 | 10 | settled | 1 | 188 | 26 | 145 |
| 103 | 10 | peer-edited | 11 | 540 | 209 | 1,464 |

## Latest Realtime Hub Scaling

| Folders | Pass | Median ms | CPU ms | PG Stmts | Rows | PG Bytes |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | declaration | 17.4 | 14.5 | 10 | 17 | 115,391 |
| 100 | revalidation | 16.9 | 6.3 | 10 | 17 | 115,391 |
| 1,000 | declaration | 16.8 | 5.9 | 10 | 17 | 115,391 |
| 1,000 | revalidation | 16.7 | 5.7 | 10 | 17 | 115,391 |
